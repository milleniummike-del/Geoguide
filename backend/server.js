
/**
 * GeoGuide AI Backend Server
 * 
 * MODULAR ARCHITECTURE:
 * Decouples Data Persistence (Tours) from Media Storage (Images/Audio).
 * 
 * CONFIGURATION:
 * You can mix and match strategies using Environment Variables.
 * 
 * PERSISTENCE_MODE: 'FILE' (Default), 'MEMORY', 'FIRESTORE'
 * STORAGE_MODE:     'DISK' (Default), 'GCS' (Google Cloud Storage)
 * 
 * 
 * AUTOMATIC DETECTION:
 * If GCP_PROJECT_ID is set -> Defaults PERSISTENCE to 'FIRESTORE'
 * If GCS_BUCKET_NAME is set -> Defaults STORAGE to 'GCS'
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 443;
// Variable for local URL construction, defaults to localhost
const BASE_URL = process.env.BASE_URL || `https://geoguide-456850480610.europe-west1.run.app/`;

// --- Feature Detection & Configuration ---
const PROJECT_ID = process.env.GCP_PROJECT_ID;
const BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// Determine Modes
let persistenceMode = process.env.PERSISTENCE_MODE || (PROJECT_ID ? 'FIRESTORE' : 'FILE');
let storageMode = process.env.STORAGE_MODE || (BUCKET_NAME ? 'GCS' : 'DISK');

// Serverless fallback: Read-only file systems cannot use 'FILE' or 'DISK' reliably for writes
if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    if (persistenceMode === 'FILE') {
        console.warn("⚠️  Serverless environment detected. Switching Persistence to MEMORY.");
        persistenceMode = 'MEMORY';
    }
    if (storageMode === 'DISK') {
        console.warn("⚠️  Serverless environment detected. Local Disk Storage will not persist.");
        // We allow it for demo purposes, but data vanishes on function teardown
    }
}

console.log('------------------------------------------------');
console.log(`🔧 CONFIGURATION`);
console.log(`   Persistence: ${persistenceMode}`);
console.log(`   Storage:     ${storageMode}`);
console.log('------------------------------------------------');

// --- Lazy Load Cloud Libraries ---
let Firestore, Storage;
if (persistenceMode === 'FIRESTORE' || storageMode === 'GCS') {
    try {
        Firestore = require('@google-cloud/firestore').Firestore;
        Storage = require('@google-cloud/storage').Storage;
    } catch (e) {
        console.error("❌ Google Cloud libraries missing. Install with: npm install @google-cloud/firestore @google-cloud/storage");
        process.exit(1);
    }
}

// ==========================================
// 1. PERSISTENCE STRATEGIES (Data)
// ==========================================

class MemoryPersistence {
    constructor() {
        this.tours = [];
        console.log("🧠 MemoryPersistence initialized");
    }
    async getTours() { return this.tours; }
    async getTour(id) { return this.tours.find(t => t.id === id); }
    async saveTour(tour) {
        const index = this.tours.findIndex(t => t.id === tour.id);
        if (index >= 0) this.tours[index] = tour;
        else this.tours.push(tour);
        return tour;
    }
    async deleteTour(id) {
        this.tours = this.tours.filter(t => t.id !== id);
    }
}

class FilePersistence extends MemoryPersistence {
    constructor() {
        super();
        this.dataFile = path.join(__dirname, 'tours.json');
        console.log(`TB FilePersistence initialized (${this.dataFile})`);
        this._load();
    }
    _load() {
        if (fs.existsSync(this.dataFile)) {
            try {
                this.tours = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            } catch (e) { console.error("Error loading JSON", e); }
        }
    }
    _save() {
        fs.writeFileSync(this.dataFile, JSON.stringify(this.tours, null, 2));
    }
    async saveTour(tour) {
        await super.saveTour(tour);
        this._save();
        return tour;
    }
    async deleteTour(id) {
        await super.deleteTour(id);
        this._save();
    }
}

class FirestorePersistence {
    constructor() {
        this.db = new Firestore({ projectId: PROJECT_ID });
        this.collection = this.db.collection('tours');
        console.log(`🔥 FirestorePersistence initialized (${PROJECT_ID})`);
    }
    async getTours() {
        const snapshot = await this.collection.get();
        return snapshot.empty ? [] : snapshot.docs.map(d => d.data());
    }
    async getTour(id) {
        const doc = await this.collection.doc(id).get();
        return doc.exists ? doc.data() : undefined;
    }
    async saveTour(tour) {
        await this.collection.doc(tour.id).set(tour);
        return tour;
    }
    async deleteTour(id) {
        await this.collection.doc(id).delete();
    }
}

// ==========================================
// 2. STORAGE STRATEGIES (Media)
// ==========================================

class DiskStorage {
    constructor() {
        this.uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(this.uploadsDir)) {
            fs.mkdirSync(this.uploadsDir, { recursive: true });
        }
        // Serve static files
        app.use('/uploads', express.static(this.uploadsDir));
        console.log(`💾 DiskStorage initialized (${this.uploadsDir})`);
    }

    // Returns a Multer Storage Engine
    getMulterStorage() {
        return multer.diskStorage({
            destination: (req, file, cb) => cb(null, this.uploadsDir),
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                cb(null, uniqueSuffix + path.extname(file.originalname));
            }
        });
    }

    // Returns the public URL for the file
    async getFileUrl(req, file) {
        // Use the configured BASE_URL variable
        return `${BASE_URL}/uploads/${file.filename}`;
    }
}

class GoogleCloudStorage {
    constructor() {
        const storage = new Storage({ projectId: PROJECT_ID });
        this.bucket = storage.bucket(BUCKET_NAME);
        console.log(`☁️  GoogleCloudStorage initialized (${BUCKET_NAME})`);
    }

    getMulterStorage() {
        // We use memory storage to buffer the file before streaming to GCS
        return multer.memoryStorage();
    }

    async getFileUrl(req, file) {
        if (!file.buffer) throw new Error("GCS Upload requires file buffer");
        
        return new Promise((resolve, reject) => {
            const blob = this.bucket.file(Date.now() + '-' + file.originalname);
            const blobStream = blob.createWriteStream({
                resumable: false,
                contentType: file.mimetype,
            });

            blobStream.on('error', err => reject(err));
            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${blob.name}`;
                resolve(publicUrl);
            });

            blobStream.end(file.buffer);
        });
    }
}

// ==========================================
// 3. INITIALIZATION
// ==========================================

// Initialize Persistence
let persistence;
switch (persistenceMode) {
    case 'FIRESTORE': persistence = new FirestorePersistence(); break;
    case 'MEMORY': persistence = new MemoryPersistence(); break;
    case 'FILE': default: persistence = new FilePersistence(); break;
}

// Initialize Storage
let storage;
switch (storageMode) {
    case 'GCS': storage = new GoogleCloudStorage(); break;
    case 'DISK': default: storage = new DiskStorage(); break;
}

// Initialize Multer
const upload = multer({ 
    storage: storage.getMulterStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// ==========================================
// 4. API ROUTES
// ==========================================

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Request Logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${Date.now() - start}ms`));
    next();
});

// Root
app.get('/', (req, res) => res.send({ 
    status: 'ok', 
    persistence: persistenceMode, 
    storage: storageMode 
}));

// Tours CRUD
app.get('/api/tours', async (req, res) => {
    try {
        const tours = await persistence.getTours();
        res.json(tours);
    } catch (e) {
        console.error("Get Tours Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/tours/:id', async (req, res) => {
    try {
        const tour = await persistence.getTour(req.params.id);
        if (tour) res.json(tour);
        else res.status(404).json({ message: 'Not found' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const handleSave = async (req, res) => {
    try {
        const tour = req.body;
        if (!tour.id) tour.id = 'tour-' + Date.now();
        await persistence.saveTour(tour);
        res.status(200).json(tour);
    } catch (e) {
        console.error("Save Error:", e);
        res.status(500).json({ error: e.message });
    }
};

app.post('/api/tours', handleSave);
app.put('/api/tours/:id', handleSave);

app.delete('/api/tours/:id', async (req, res) => {
    try {
        await persistence.deleteTour(req.params.id);
        res.status(204).send();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Media Upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    try {
        // Delegate URL generation to the active storage strategy
        const url = await storage.getFileUrl(req, req.file);
        console.log(`File uploaded: ${url}`);
        res.json({ url });
    } catch (e) {
        console.error("Upload Error:", e);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Export for Vercel
module.exports = app;

// Start Server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`   Base URL: ${BASE_URL}`);
    });
}
