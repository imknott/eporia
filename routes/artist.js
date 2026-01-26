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
        const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch (error) { res.status(403).send("Invalid Token"); }
}

// ==========================================
// 2. TRACK UPLOAD (Single MP3)
// ==========================================
// [CHANGE 1] Update the Route Definition to use upload.fields()
router.post('/api/upload-track', 
    // Accept 2 separate files
    upload.fields([
        { name: 'audioFile', maxCount: 1 }, 
        { name: 'artFile', maxCount: 1 }
    ]), 
    async (req, res) => {
    try {
        // Check if both files exist
        if (!req.files || !req.files['audioFile'] || !req.files['artFile']) {
            return res.status(400).json({ error: "Missing audio or artwork file" });
        }
        
        const audioFile = req.files['audioFile'][0];
        const artFile = req.files['artFile'][0];
        const { title, genre, subgenre, artistId, artistName, albumName, duration } = req.body;

        // --- 1. UPLOAD AUDIO ---
        const audioExt = audioFile.originalname.split('.').pop();
        const audioPath = `artists/${artistId}/tracks/${Date.now()}_${title.replace(/\s+/g, '_')}.${audioExt}`;
        const audioUpload = bucket.file(audioPath);

        await audioUpload.save(audioFile.buffer, { contentType: audioFile.mimetype, public: true });
        const [audioUrl] = await audioUpload.getSignedUrl({ action: 'read', expires: '01-01-2100' });

        // --- 2. UPLOAD ARTWORK ---
        const artExt = artFile.originalname.split('.').pop();
        const artPath = `artists/${artistId}/art/${Date.now()}_${title.replace(/\s+/g, '_')}_art.${artExt}`;
        const artUpload = bucket.file(artPath);

        await artUpload.save(artFile.buffer, { contentType: artFile.mimetype, public: true });
        const [artUrl] = await artUpload.getSignedUrl({ action: 'read', expires: '01-01-2100' });

        // --- 3. SAVE TO DB ---
        const songData = {
            title: title,
            titleLower: title.toLowerCase(), // [NEW] Normalized for search
            artistId: artistId,
            artistName: artistName,
            album: albumName || "Single",
            isSingle: !albumName,
            genre: genre,
            subgenre: subgenre || "General",
            
            // [NEW] Storing the new assets and metadata
            audioUrl: audioUrl,
            artUrl: artUrl,
            duration: parseInt(duration) || 0, // Seconds
            
            plays: 0,
            uploadedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('songs').add(songData);

        // Link to Artist Profile
        await db.collection('artists').doc(artistId).collection('releases').doc(docRef.id).set({
            ref: docRef,
            title: title,
            artUrl: artUrl, // Helpful for displaying thumbnails in Studio
            uploadedAt: new Date()
        });

        res.json({ success: true, songId: docRef.id });

    } catch (error) {
        console.error("Track Upload Error:", error);
        res.status(500).json({ error: error.message });
    }
});
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
router.post('/api/create-profile', express.json(), async (req, res) => {
    try {
        const data = req.body;
        
        // [FIX] Generate a brand new Artist ID (Not linked to a User UID yet)
        const newArtistRef = db.collection('artists').doc();
        const artistId = newArtistRef.id;
        
        const artistData = {
            id: artistId,
            name: data.identity.artistName,
            nameLower: data.identity.artistName.toLowerCase(),
            handle: data.identity.handle || "",
            location: data.identity.location || "",
            bio: data.identity.bio || "",
            
            // [FIX] Set owner to null initially. 
            // The Studio "Security Modal" will generate the login and fill this later.
            ownerUid: null, 
            ownerEmail: null,
            status: 'pending_setup',
            
            profileImage: data.visuals.avatarUrl || null,
            bannerImage: data.visuals.bannerUrl || null,

            musicProfile: {
                primaryGenre: data.music.primaryGenre,
                subgenres: data.music.subgenres,
                moods: data.music.moods,
                typicalFeatures: {
                    tempo: parseInt(data.music.features.tempo) || 0,
                    energy: parseFloat(data.music.features.energy) || 0,
                    valence: parseFloat(data.music.features.valence) || 0,
                    instrumentalness: parseFloat(data.music.features.instrumentalness) || 0
                }
            },

            stats: {
                totalTracks: 0,
                followers: 0,
                monthlyListeners: 0
            },

            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // [FIX] Write to the new document ID
        await newArtistRef.set(artistData);

        // Return the new ID so the frontend can redirect to the Studio
        res.json({ success: true, artistId: artistId });

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

// ==========================================
// ARTIST STUDIO ROUTES
// ==========================================

// 1. RENDER STUDIO (The Landing Page)
router.get('/studio', (req, res) => {
    // Pass the ID from query params so the frontend knows who to setup
    const artistId = req.query.id;
    res.render('artist_studio', { 
        title: 'Artist Command Center | Eporia',
        artistId: artistId 
    });
});

// 2. CHECK SETUP STATUS (The Gatekeeper)
router.get('/api/studio/check-status/:artistId', async (req, res) => {
    try {
        const doc = await db.collection('artists').doc(req.params.artistId).get();
        if (!doc.exists) return res.status(404).json({ error: "Artist not found" });
        
        const data = doc.data();
        // If 'ownerEmail' is missing, they haven't set up the secure login yet
        const needsSetup = !data.ownerEmail; 
        
        res.json({ 
            needsSetup: needsSetup,
            artistName: data.name,
            artistHandle: data.handle
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. CREATE SEPARATE ARTIST LOGIN (The Fix)
router.post('/api/studio/setup-credentials', async (req, res) => {
    try {
        const { artistId, email, password } = req.body;
        
        // A. Create a NEW Firebase Auth User (Distinct from any User account)
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
            displayName: `Artist: ${artistId}`
        });

        // B. Lock the Artist Doc to this new ID
        await db.collection('artists').doc(artistId).update({
            ownerUid: userRecord.uid,
            ownerEmail: email,
            status: 'active', // Beta Auto-Approval
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // C. Generate Token for immediate login
        const customToken = await admin.auth().createCustomToken(userRecord.uid);
        
        res.json({ success: true, token: customToken });

    } catch (e) {
        console.error("Credential Setup Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// 4. DASHBOARD DATA API
router.get('/api/studio/dashboard', verifyUser, async (req, res) => {
    try {
        // Query by the Auth UID (Security Check)
        const snapshot = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
        
        if (snapshot.empty) return res.status(404).json({ error: "No artist profile linked to this login." });
        
        const data = snapshot.docs[0].data();

        // [MOCK] We will replace these with real sub-collection queries later
        const dashboardData = {
            profile: {
                name: data.name,
                image: data.profileImage,
                handle: data.handle
            },
            stats: {
                listeners: data.stats?.monthlyListeners || 0,
                followers: data.stats?.followers || 0,
                tipsTotal: 0.00,
                tipsGrowth: 0
            },
            recentActivity: [], // Empty for now
            catalog: { albums: 0, tracks: 0, merch: 0 }
        };

        res.json(dashboardData);

    } catch (error) {
        console.error("Studio Data Error:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;