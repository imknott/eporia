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
    res.clearCookie('session'); // Clear server session 
    res.render('signin', { 
        title: 'Signed Out', 
        autoLogout: true // This is the trigger for the fix above 
    });
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
        const { email, password, handle, location, genres, profileSong, idToken, geo } = req.body;

        if (!handle) return res.status(400).json({ error: "Handle is required" });
        if (!location) return res.status(400).json({ error: "Location is required" });

        // 1. Check Handle Availability
        const handleRef = db.collection('users').where('handle', '==', `@${handle}`);
        const snapshot = await handleRef.get();
        if (!snapshot.empty) return res.status(400).json({ error: "Handle already taken." });

        // 2. Create/Verify Auth User
        let userRecord;
        if (idToken) {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            userRecord = await admin.auth().getUser(decodedToken.uid);
        } else {
            if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
            userRecord = await admin.auth().createUser({ email, password, displayName: handle });
        }

        // 3. Handle Profile Image (Upload or Default)
        // [FIX] Use your local default image if no file is uploaded
        let photoURL = userRecord.photoURL || "/images/pexels-cottonbro-6864495.jpg"; 

        if (req.file) {
            const filename = `users/${userRecord.uid}/profile.jpg`;
            const fileUpload = bucket.file(filename);
            await fileUpload.save(req.file.buffer, { contentType: req.file.mimetype, public: true });
            
            // Get the public URL (Note: 'public: true' makes it accessible via standard GCS link)
            photoURL = `https://storage.googleapis.com/${bucket.name}/${filename}`;
        }

        // 4. Parse Data
        const selectedGenres = genres ? JSON.parse(genres) : [];
        const anthem = profileSong ? JSON.parse(profileSong) : null;

        // [NEW] Hybrid Location Parsing
        let city = location;
        let state = "Global"; 
        let country = "Unknown";
        let coordinates = null;

        // Try Geo Data from Frontend
        if (geo) {
            try {
                const geoData = JSON.parse(geo);
                if (geoData.city) city = geoData.city;
                if (geoData.state) state = geoData.state;
                if (geoData.country) country = geoData.country;
                if (geoData.lat && geoData.lng) {
                    coordinates = new admin.firestore.GeoPoint(parseFloat(geoData.lat), parseFloat(geoData.lng));
                }
            } catch (e) { console.error("Geo parse error", e); }
        }

        // Fallback Location Parsing
        if ((!state || state === "Global") && location.includes(',')) {
            const parts = location.split(',').map(s => s.trim());
            const parsedCountry = parts[parts.length - 1];
            const granularCountries = ['United States', 'United Kingdom'];
            if (parts.length >= 2 && granularCountries.includes(parsedCountry)) {
                 if(parts.length >= 3) state = parts[1];
            } else {
                state = parsedCountry;
            }
        }

        // 5. FIRESTORE BATCH WRITE (User + Follows + Notification)
        const ADMIN_UID = "KTWXkLsdXMfjgZZLKEfgg9OwLJw2"; 
        const now = admin.firestore.FieldValue.serverTimestamp();
        const batch = db.batch();

        // A. Main User Document
        const newUserRef = db.collection('users').doc(userRecord.uid);
        batch.set(newUserRef, {
            uid: userRecord.uid,
            handle: `@${handle}`,
            displayName: handle,
            email: userRecord.email,
            photoURL: photoURL, // Uses the uploaded URL or your local default
            role: 'user', 
            joinDate: now,
            
            // Location
            location: location, 
            city: city,
            state: state,
            country: country,
            coordinates: coordinates,
            
            genres: selectedGenres,
            profileSong: anthem,
            impactScore: 0,
            subscription: {
                status: 'beta_free',
                plan: 'beta_access',
                startDate: now
            }
        });

        // B. Reciprocal Admin Following
        if (ADMIN_UID && ADMIN_UID !== userRecord.uid) {
            // Get Admin Data
            const adminDoc = await db.collection('users').doc(ADMIN_UID).get();
            const adminData = adminDoc.exists ? adminDoc.data() : { handle: '@imknott', photoURL: '' };

            // User follows Admin
            const userFollowsAdminRef = newUserRef.collection('following').doc(ADMIN_UID);
           batch.set(userFollowsAdminRef, {
                name: adminData.displayName || 'imknott',
                handle: adminData.handle || '@imknott',
                img: adminData.photoURL || '',
                followedAt: now,
                type: 'user' // [FIX] Mark Admin as user so they appear in "users"
            });

            // Admin follows User (Using the new photoURL)
            const adminFollowsUserRef = db.collection('users').doc(ADMIN_UID).collection('following').doc(userRecord.uid);
            batch.set(adminFollowsUserRef, {
                name: handle, 
                handle: `@${handle}`,
                img: photoURL,
                followedAt: now,
                type: 'user' // [FIX] Mark new account as User so they DON'T appear in "Top Artists"
            });

            // C. Welcome Notification
            const notifRef = newUserRef.collection('notifications').doc();
            batch.set(notifRef, {
                type: 'follow',
                fromUid: ADMIN_UID,
                fromName: adminData.displayName || 'imknott',
                fromHandle: adminData.handle || '@imknott',
                avatar: adminData.photoURL || 'https://via.placeholder.com/50',
                message: 'started following you.',
                timestamp: now,
                read: false,
                link: `/player/u/${(adminData.handle || 'imknott').replace('@', '')}` 
            });
        }

        // 6. Commit All
        await batch.commit();

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

// --- CHECK EMAIL AVAILABILITY ---
router.get('/api/check-email/:email', async (req, res) => {
    try {
        const email = req.params.email;
        
        // Basic backend validation before hitting Firebase
        if (!email || !email.includes('@')) {
             return res.json({ available: false, reason: 'invalid_format' });
        }

        // Check Firebase Auth for existing user
        try {
            await admin.auth().getUserByEmail(email);
            // If function succeeds, user exists -> Email NOT available
            res.json({ available: false });
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // User not found -> Email IS available
                res.json({ available: true });
            } else if (error.code === 'auth/invalid-email') {
                // Firebase rejected the format
                res.json({ available: false, reason: 'invalid_format' });
            } else {
                // Log the REAL error to your console for debugging
                console.error("Firebase Auth Error:", error.code, error.message);
                throw error;
            }
        }
    } catch (error) {
        console.error("Email Check API Error:", error);
        // Return 500 but with JSON so frontend doesn't break
        res.status(500).json({ error: "Server check failed" });
    }
});

module.exports = router;