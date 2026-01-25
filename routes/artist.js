var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require("firebase-admin");


if (!admin.apps.length) {
    try {
        var serviceAccount = require("../serviceAccountKey.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: "eporia.firebasestorage.app"
        });
    } catch (e) {
        // In Cloud Run, you might rely on Google Application Default Credentials
        // instead of a key file. If so, initialize without creds:
        console.warn("Attempting default init...", e);
        try {
            admin.initializeApp({
                // [!] FORCE CONNECTION TO THE MAIN PROJECT
                projectId: "eporia",
                storageBucket: "eporia.firebasestorage.app"
            });
        } catch (err) {
            console.error("Firebase Init Failed:", err);
        }
    }
}

// --- 1. SETUP FIREBASE & STORAGE ---
const db = admin.firestore();
const bucket = admin.storage().bucket();


// --- 2. CONFIGURE MULTER (Handles both Images & Audio) ---
// We use memory storage to buffer the file before uploading to Firebase
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB Limit (for high-quality WAVs)
    fileFilter: (req, file, cb) => {
        // Accept images and audio
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images and audio allowed.'), false);
        }
    }
});

// --- 3. MIDDLEWARE: VERIFY USER ---
// Ensures the request comes from a logged-in user
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).send("Unauthorized");

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken.split(' ')[1]);
        req.uid = decodedToken.uid;
        next();
    } catch (error) {
        res.status(403).send("Invalid Token");
    }
}

// ==================================================================
// API ENDPOINTS
// ==================================================================

// 1. ASSET UPLOAD ENDPOINT
// Handles Avatar, Banner, and Demo Track uploads immediately
router.post('/api/upload-asset', verifyUser, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const type = req.body.type; // 'avatar', 'banner', or 'demo'
        const ext = req.file.originalname.split('.').pop(); // Get extension (jpg, mp3)
        
        // Structure: artists/{userID}/{type}.{ext}
        // Example: artists/user_123/demo.mp3
        const filePath = `artists/${req.uid}/${type}_${Date.now()}.${ext}`;
        const fileUpload = bucket.file(filePath);

        // Upload to Firebase Storage
        await fileUpload.save(req.file.buffer, {
            contentType: req.file.mimetype,
            public: true
        });

        // Generate Signed URL (valid for 100 years)
        const [url] = await fileUpload.getSignedUrl({
            action: 'read',
            expires: '03-09-2491'
        });

        res.json({ success: true, url: url, path: filePath });

    } catch (error) {
        console.error("Asset Upload Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. FINAL PROFILE SUBMISSION
// Saves the complex taxonomy data and links to the uploaded files
router.post('/api/create-profile', verifyUser, express.json(), async (req, res) => {
    try {
        const data = req.body;
        
        // Construct the Artist Document (Matching firestore-schema.md)
        const artistData = {
            id: req.uid, // Artist ID matches User ID
            name: data.identity.artistName,
            handle: data.identity.handle || "",
            location: data.identity.location || "",
            bio: data.identity.bio || "",
            
            // Visuals (URLs returned from the previous upload step)
            profileImage: data.visuals.avatarUrl || null,
            bannerImage: data.visuals.bannerUrl || null,
            
            // The Demo Track
            demoTrack: {
                url: data.music.demoUrl || null,
                submittedAt: new Date().toISOString()
            },

            // Music Taxonomy (Critical for Playlist Generator)
            musicProfile: {
                primaryGenre: data.music.primaryGenre, // e.g., "electronic"
                subgenres: data.music.subgenres,       // ["synthwave", "chill"]
                moods: data.music.moods,               // ["focus", "drive"]
                
                // Typical Features (Sliders)
                typicalFeatures: {
                    tempo: parseInt(data.music.features.tempo),
                    energy: parseFloat(data.music.features.energy),
                    valence: parseFloat(data.music.features.valence),
                    instrumentalness: parseFloat(data.music.features.instrumentalness)
                }
            },

            // Default Stats
            stats: {
                totalTracks: 0,
                followers: 0,
                monthlyListeners: 0
            },

            // System Flags
            status: 'pending_review', // Requires admin approval
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Save to 'artists' collection
        await db.collection('artists').doc(req.uid).set(artistData, { merge: true });

        // Update the 'users' collection to link this user to the artist profile
        await db.collection('users').doc(req.uid).update({
            isArtist: true,
            artistProfileId: req.uid
        });

        res.json({ success: true, artistId: req.uid });

    } catch (error) {
        console.error("Profile Creation Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- VIEW ROUTES ---
router.get('/onboarding', (req, res) => {
    res.render('artist_signup', { title: 'Artist Setup | Eporia' });
});

// ==================================================================
// 3. HANDLE AVAILABILITY CHECK
// Checks 'artists' collection ONLY (Separate from users)
// ==================================================================
router.get('/api/check-handle/:handle', async (req, res) => {
    try {
        const rawHandle = req.params.handle.toLowerCase();
        // Ensure strictly formatted for DB search
        const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;

        // Query Firestore 'artists' collection
        const snapshot = await db.collection('artists')
            .where('handle', '==', handle)
            .limit(1) // Performance optimization
            .get();

        if (snapshot.empty) {
            res.json({ available: true });
        } else {
            res.json({ available: false });
        }

    } catch (error) {
        console.error("Handle Check Error:", error);
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;