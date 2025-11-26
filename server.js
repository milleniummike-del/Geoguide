
/**
 * GeoGuide AI Backend Server
 * 
 * SETUP INSTRUCTIONS:
 * 1. Install dependencies:
 *    npm install express cors multer @google-cloud/firestore @google-cloud/storage
 * 
 * 2. Run the server (Local Mode):
 *    node server.js
 * 
 * 3. Run the server (Google Cloud Mode):
 *    export GCP_PROJECT_ID="your-project-id"
 *    export GCS_BUCKET_NAME="your-bucket-name"
 *    # Ensure you have 'GOOGLE_APPLICATION_CREDENTIALS' set or are logged in via 'gcloud auth application-default login'
 *    node server.js
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Optional: Google Cloud Imports (Lazy loaded to prevent crash if not installed/used)
let Firestore, Storage;
try {
  const firestoreLib = require('@google-cloud/firestore');
  const storageLib = require('@google-cloud/storage');
  Firestore = firestoreLib.Firestore;
  Storage = storageLib.Storage;
} catch (e) {
  // Libraries not installed, will fallback to local only
}

const app = express();
const PORT = process.env.PORT || 3001;

// --- Feature Flags for Cloud Persistence ---
const PROJECT_ID = process.env.GCP_PROJECT_ID;
const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const USE_CLOUD = !!(PROJECT_ID && BUCKET_NAME && Firestore && Storage);

console.log('------------------------------------------------');
if (USE_CLOUD) {
    console.log(`☁️  GOOGLE CLOUD MODE ACTIVE`);
    console.log(`   Project: ${PROJECT_ID}`);
    console.log(`   Bucket:  ${BUCKET_NAME}`);
} else {
    console.log(`💻 LOCAL MODE ACTIVE`);
    if (!Firestore) console.log(`   (Cloud libs not found. Run 'npm install @google-cloud/firestore @google-cloud/storage' to enable cloud features)`);
    else if (!PROJECT_ID) console.log(`   (Missing GCP_PROJECT_ID env var)`);
}
console.log('------------------------------------------------');

// --- Cloud Clients ---
let db, bucket;
if (USE_CLOUD) {
    db = new Firestore({ projectId: PROJECT_ID });
    const storage = new Storage({ projectId: PROJECT_ID });
    bucket = storage.bucket(BUCKET_NAME);
}

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Request Logger ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// --- Storage Configuration (Multer) ---
// If Cloud: Use MemoryStorage to buffer file before streaming to GCS
// If Local: Use DiskStorage to save directly to 'uploads' folder
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!USE_CLOUD && !fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

const upload = multer({
    storage: USE_CLOUD ? multer.memoryStorage() : multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOADS_DIR),
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    })
});

// Serve local uploads statically if in local mode
if (!USE_CLOUD) {
    app.use('/uploads', express.static(UPLOADS_DIR));
}

// --- Data Access Layer (DAL) ---

// Local In-Memory Cache
const DATA_FILE = path.join(__dirname, 'tours.json');
let localTours = [];

if (!USE_CLOUD) {
    if (fs.existsSync(DATA_FILE)) {
        try {
            localTours = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } catch (e) { localTours = []; }
    }
}

const saveLocalData = () => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(localTours, null, 2));
};

// DAL Methods
const DAL = {
    getAllTours: async () => {
        if (USE_CLOUD) {
            const snapshot = await db.collection('tours').get();
            return snapshot.docs.map(doc => doc.data());
        }
        return localTours;
    },

    getTourById: async (id) => {
        if (USE_CLOUD) {
            const doc = await db.collection('tours').doc(id).get();
            return doc.exists ? doc.data() : undefined;
        }
        return localTours.find(t => t.id === id);
    },

    saveTour: async (tour) => {
        if (USE_CLOUD) {
            await db.collection('tours').doc(tour.id).set(tour);
            return tour;
        }
        
        const index = localTours.findIndex(t => t.id === tour.id);
        if (index >= 0) {
            localTours[index] = tour;
        } else {
            localTours.push(tour);
        }
        saveLocalData();
        return tour;
    },

    deleteTour: async (id) => {
        if (USE_CLOUD) {
            await db.collection('tours').doc(id).delete();
            return;
        }
        
        const initialLen = localTours.length;
        localTours = localTours.filter(t => t.id !== id);
        if (localTours.length !== initialLen) saveLocalData();
    },

    uploadFile: async (file) => {
        if (USE_CLOUD) {
            return new Promise((resolve, reject) => {
                const blob = bucket.file(Date.now() + '-' + file.originalname);
                const blobStream = blob.createWriteStream({
                    resumable: false,
                    contentType: file.mimetype,
                });

                blobStream.on('error', err => reject(err));

                blobStream.on('finish', () => {
                    // Assuming bucket is publicly readable or you use signed URLs.
                    // For a public app, making the bucket public is easiest for reading.
                    const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${blob.name}`;
                    resolve(publicUrl);
                });

                blobStream.end(file.buffer);
            });
        }

        // Local URL
        return `http://localhost:${PORT}/uploads/${file.filename}`;
    }
};

// --- Endpoints ---

app.get('/', (req, res) => res.send(`GeoGuide Backend running in ${USE_CLOUD ? 'CLOUD' : 'LOCAL'} mode`));

// Get All
app.get('/api/tours', async (req, res) => {
    try {
        const tours = await DAL.getAllTours();
        res.json(tours);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Get One
app.get('/api/tours/:id', async (req, res) => {
    try {
        const tour = await DAL.getTourById(req.params.id);
        if (tour) res.json(tour);
        else res.status(404).json({ message: 'Not found' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Create / Update
app.post('/api/tours', async (req, res) => {
    try {
        const tour = req.body;
        if (!tour.id) tour.id = 'tour-' + Date.now();
        await DAL.saveTour(tour);
        res.status(201).json(tour);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/tours/:id', async (req, res) => {
    try {
        await DAL.saveTour(req.body);
        res.json(req.body);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete
app.delete('/api/tours/:id', async (req, res) => {
    try {
        await DAL.deleteTour(req.params.id);
        res.status(204).send();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    
    try {
        const url = await DAL.uploadFile(req.file);
        console.log(`File uploaded to: ${url}`);
        res.json({ url });
    } catch (e) {
        console.error("Upload Error:", e);
        res.status(500).json({ error: 'Upload failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
