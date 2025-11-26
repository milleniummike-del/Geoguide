
/**
 * GeoGuide AI Backend Server
 * 
 * MODES:
 * 1. LOCAL MODE (Default): Uses 'tours.json' and local 'uploads/' folder.
 * 2. CLOUD MODE: Uses Google Firestore and Google Cloud Storage.
 * 
 * TO ENABLE CLOUD MODE:
 * 1. npm install @google-cloud/firestore @google-cloud/storage
 * 2. Set env vars: GCP_PROJECT_ID and GCS_BUCKET_NAME
 * 
 * DEPLOYMENT NOTE (Vercel):
 * Vercel has a read-only file system. Local Mode will NOT work for persistence.
 * You MUST use Cloud Mode (set env vars in Vercel dashboard) for this to work in production.
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;

// --- Configuration ---
const PROJECT_ID = process.env.GCP_PROJECT_ID;
const BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// Check if Cloud libraries are available
let Firestore, Storage;
try {
    Firestore = require('@google-cloud/firestore').Firestore;
    Storage = require('@google-cloud/storage').Storage;
} catch (e) {
    if (process.env.NODE_ENV !== 'production') {
        console.warn("⚠️  Google Cloud libraries not found. Run 'npm install' to enable cloud features.");
    }
}

const USE_CLOUD = !!(PROJECT_ID && BUCKET_NAME && Firestore && Storage);

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Request Logger
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${Date.now() - start}ms`);
    });
    next();
});

// --- STRATEGY PATTERN: Data Providers ---

/**
 * Strategy 1: Local File System Provider
 * Persists data to tours.json and files to /uploads folder
 */
class LocalProvider {
    constructor() {
        this.dataFile = path.join(__dirname, 'tours.json');
        // If on Vercel/Lambda, use /tmp for temporary storage to prevent crash on startup, 
        // though data won't persist.
        this.isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION;
        
        this.uploadsDir = this.isServerless ? '/tmp/uploads' : path.join(__dirname, 'uploads');
        this.localTours = [];

        // Ensure uploads directory exists
        if (!fs.existsSync(this.uploadsDir)) {
            try {
                fs.mkdirSync(this.uploadsDir, { recursive: true });
            } catch (e) {
                console.error("Could not create uploads dir", e);
            }
        }
        
        // Serve static files (only works for non-serverless or persistent disk)
        if (!this.isServerless) {
            app.use('/uploads', express.static(this.uploadsDir));
        }

        // Load initial data
        if (fs.existsSync(this.dataFile)) {
            try {
                this.localTours = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            } catch (e) { 
                this.localTours = []; 
                console.error("Error reading local tours.json", e);
            }
        }
        
        if (this.isServerless) {
            console.warn("⚠️  RUNNING IN SERVERLESS MODE WITHOUT CLOUD CONFIG. DATA WILL NOT PERSIST.");
        } else {
            console.log(`📂 LocalProvider initialized. Data: ${this.dataFile}`);
        }
    }

    _saveDisk() {
        if (this.isServerless) {
             console.warn("⚠️  Cannot save to disk in Serverless environment.");
             return;
        }
        fs.writeFileSync(this.dataFile, JSON.stringify(this.localTours, null, 2));
    }

    async getTours() {
        return this.localTours;
    }

    async getTour(id) {
        return this.localTours.find(t => t.id === id);
    }

    async saveTour(tour) {
        const index = this.localTours.findIndex(t => t.id === tour.id);
        if (index >= 0) {
            this.localTours[index] = tour;
        } else {
            this.localTours.push(tour);
        }
        this._saveDisk();
        return tour;
    }

    async deleteTour(id) {
        const initialLen = this.localTours.length;
        this.localTours = this.localTours.filter(t => t.id !== id);
        if (this.localTours.length !== initialLen) this._saveDisk();
    }

    async uploadFile(file) {
        if (this.isServerless) {
            throw new Error("Local file upload disabled in Serverless mode. Configure Google Cloud.");
        }
        const filename = file.filename;
        return `http://localhost:${PORT}/uploads/${filename}`;
    }
}

/**
 * Strategy 2: Google Cloud Provider
 * Persists data to Firestore and files to Cloud Storage
 */
class CloudProvider {
    constructor() {
        this.db = new Firestore({ projectId: PROJECT_ID });
        this.storage = new Storage({ projectId: PROJECT_ID });
        this.bucket = this.storage.bucket(BUCKET_NAME);
        this.collection = this.db.collection('tours');
        console.log(`☁️  CloudProvider initialized. Project: ${PROJECT_ID}, Bucket: ${BUCKET_NAME}`);
    }

    async getTours() {
        const snapshot = await this.collection.get();
        if (snapshot.empty) return [];
        return snapshot.docs.map(doc => doc.data());
    }

    async getTour(id) {
        const doc = await this.collection.doc(id).get();
        return doc.exists ? doc.data() : undefined;
    }

    async saveTour(tour) {
        // Firestore 'set' acts as an Upsert (Update or Insert)
        await this.collection.doc(tour.id).set(tour);
        return tour;
    }

    async deleteTour(id) {
        await this.collection.doc(id).delete();
    }

    async uploadFile(file) {
        return new Promise((resolve, reject) => {
            const blob = this.bucket.file(Date.now() + '-' + file.originalname);
            const blobStream = blob.createWriteStream({
                resumable: false,
                contentType: file.mimetype,
            });

            blobStream.on('error', err => reject(err));

            blobStream.on('finish', () => {
                // Return the public URL
                // IMPORTANT: Your bucket must be configured to allow public read access
                const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${blob.name}`;
                resolve(publicUrl);
            });

            blobStream.end(file.buffer);
        });
    }
}

// --- Initialize Provider ---

let dataProvider;
let uploadMiddleware;

if (USE_CLOUD) {
    dataProvider = new CloudProvider();
    // Cloud uses MemoryStorage to hold file in buffer before streaming to GCS
    uploadMiddleware = multer({ storage: multer.memoryStorage() });
} else {
    dataProvider = new LocalProvider();
    
    // In Serverless/Vercel (without cloud), we can't write to disk uploads.
    // We force memory storage to prevent crashes, but uploads won't be savable.
    if (process.env.VERCEL) {
        uploadMiddleware = multer({ storage: multer.memoryStorage() });
    } else {
        // Local uses DiskStorage to save directly to disk
        const diskStorage = multer.diskStorage({
            destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                cb(null, uniqueSuffix + path.extname(file.originalname));
            }
        });
        uploadMiddleware = multer({ storage: diskStorage });
    }
}

// --- API Routes ---

app.get('/', (req, res) => {
    res.send(`GeoGuide Backend Running. Mode: ${USE_CLOUD ? '☁️ GOOGLE CLOUD' : '💻 LOCAL FILE SYSTEM'}`);
});

// GET All Tours
app.get('/api/tours', async (req, res) => {
    try {
        const tours = await dataProvider.getTours();
        res.json(tours);
    } catch (e) {
        console.error("GET /tours error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET Single Tour
app.get('/api/tours/:id', async (req, res) => {
    try {
        const tour = await dataProvider.getTour(req.params.id);
        if (tour) res.json(tour);
        else res.status(404).json({ message: 'Tour not found' });
    } catch (e) {
        console.error(`GET /tours/${req.params.id} error:`, e);
        res.status(500).json({ error: e.message });
    }
});

// CREATE (Post) & UPDATE (Put)
// We treat both similarly here because our Save logic is an Upsert
const handleSave = async (req, res) => {
    try {
        const tour = req.body;
        // Ensure ID
        if (!tour.id) tour.id = 'tour-' + Date.now();
        
        await dataProvider.saveTour(tour);
        res.status(200).json(tour);
    } catch (e) {
        console.error("Save Tour error:", e);
        res.status(500).json({ error: e.message });
    }
};

app.post('/api/tours', handleSave);
app.put('/api/tours/:id', handleSave);

// DELETE Tour
app.delete('/api/tours/:id', async (req, res) => {
    try {
        await dataProvider.deleteTour(req.params.id);
        res.status(204).send();
    } catch (e) {
        console.error("DELETE Tour error:", e);
        res.status(500).json({ error: e.message });
    }
});

// UPLOAD Media
app.post('/api/upload', uploadMiddleware.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    try {
        const url = await dataProvider.uploadFile(req.file);
        console.log(`Media uploaded: ${url}`);
        res.json({ url });
    } catch (e) {
        console.error("Upload error:", e);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// Export the app for Vercel/Serverless usage
module.exports = app;

// Start the server ONLY if run directly (node server.js)
// This prevents port binding issues when deployed as a serverless function
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}
