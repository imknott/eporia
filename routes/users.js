/* routes/users.js */
var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require("firebase-admin");

// --- 1. FIREBASE & MULTER SETUP ---
// Prevent double-initialization
if (!admin.apps.length) {
    try {
        // Attempt to load the local key file (Development)
        var serviceAccount = require("../serviceAccountKey.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: "eporia.firebasestorage.app"
        });
    } catch (e) {
        // If key is missing (Cloud Run / Production), use Default Credentials
        console.log("Local key not found, using Default Credentials (Cloud Run Mode)");
        try {
            admin.initializeApp({
                // [!] FORCE CONNECTION TO THE MAIN PROJECT
                projectId: "eporia",
                storageBucket: "eporia.firebasestorage.app"
            });
        } catch (initError) {
            // If it fails again, just log it. The app might still crash on db access, 
            // but this prevents the startup crash if another file initialized it.
            console.error("Firebase Init Failed:", initError);
        }
    }
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.get('/signup', (req, res) => {
    res.render('userSignup', { title: 'Join the Collective | Eporia' });
});

router.get('/signin', (req, res) => {
    res.render('signin', { title: 'Welcome Back | Eporia' });
});

router.get('/logout', (req, res) => {
    res.render('signin', { title: 'Signed Out', autoLogout: true });
});

// --- [NEW] HANDLE AVAILABILITY CHECK ---
// Checks 'users' collection specifically
router.get('/api/check-handle/:handle', async (req, res) => {
    try {
        const rawHandle = req.params.handle.toLowerCase();
        // Ensure strictly formatted for DB search
        const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;

        const snapshot = await db.collection('users')
            .where('handle', '==', handle)
            .limit(1)
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

// --- BETA CREATE ACCOUNT ---
router.post('/api/create-account', upload.single('profileImage'), async (req, res) => {
    try {
        const { email, password, handle, location, genres, profileSong, idToken } = req.body;

        // Basic Validation
        if (!handle) return res.status(400).json({ error: "Handle is required" });
        if (!location) return res.status(400).json({ error: "Location is required" });

        // Check Handle Uniqueness (Double Check)
        const handleRef = db.collection('users').where('handle', '==', `@${handle}`);
        const snapshot = await handleRef.get();
        if (!snapshot.empty) {
            return res.status(400).json({ error: "Handle already taken." });
        }

        let userRecord;

        // Auth Strategy
        if (idToken) {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            userRecord = await admin.auth().getUser(decodedToken.uid);
        } else {
            if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
            userRecord = await admin.auth().createUser({
                email: email,
                password: password,
                displayName: handle
            });
        }

        // Image Upload
        let photoURL = userRecord.photoURL || ""; 
        if (req.file) {
            const filename = `users/${userRecord.uid}/profile.jpg`;
            const fileUpload = bucket.file(filename);
            await fileUpload.save(req.file.buffer, { contentType: req.file.mimetype, public: true });
            const [url] = await fileUpload.getSignedUrl({ action: 'read', expires: '03-09-2491' });
            photoURL = url;
        }

        // Data Parsing
        const selectedGenres = genres ? JSON.parse(genres) : [];
        const anthem = profileSong ? JSON.parse(profileSong) : null;
        
        // Admin Follow Logic
        const ADMIN_UID = "KTWXkLsdXMfjgZZLKEfgg9OwLJw2"; 
        let followers = [];
        let following = [];
        
        if (ADMIN_UID && ADMIN_UID !== userRecord.uid) {
            followers.push(ADMIN_UID);
            following.push(ADMIN_UID);
            db.collection('users').doc(ADMIN_UID).update({
                following: admin.firestore.FieldValue.arrayUnion(userRecord.uid)
            }).catch(e => console.log("Admin follow-back error", e));
        }

        // Firestore Write
        await db.collection('users').doc(userRecord.uid).set({
            uid: userRecord.uid,
            handle: `@${handle}`,
            displayName: handle,
            email: userRecord.email,
            photoURL: photoURL,
            role: 'user', 
            joinDate: admin.firestore.FieldValue.serverTimestamp(),
            location: location,
            genres: selectedGenres,
            profileSong: anthem,
            followers: followers,
            following: following,
            impactScore: 0,
            subscription: {
                status: 'beta_free',
                plan: 'beta_access',
                startDate: admin.firestore.FieldValue.serverTimestamp()
            }
        });

        let customToken = null;
        if (!idToken) {
            customToken = await admin.auth().createCustomToken(userRecord.uid);
        }
        
        res.json({ success: true, token: customToken });

    } catch (error) {
        console.error("Signup Error:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;