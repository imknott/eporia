/* routes/player.js */
var express = require('express');
var router = express.Router();
var multer = require('multer'); // For Image Uploads
var admin = require("firebase-admin");

const playlistEngine = require('../utils/playlistEngine');

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
                storageBucket: "eporia.firebasestorage.app"
            });
        } catch (initError) {
            // If it fails again, just log it. The app might still crash on db access, 
            // but this prevents the startup crash if another file initialized it.
            console.error("Firebase Init Failed:", initError);
        }
    }
} console.warn("⚠️ Warning: serviceAccountKey.json not found. Server checks will be skipped.");


// Get DB & Bucket references
const db = admin.apps.length ? admin.firestore() : null;
const bucket = admin.apps.length ? admin.storage().bucket() : null;

// Configure Multer (Ram Storage for fast uploads)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// --- MIDDLEWARE: VERIFY USER ---
// This ensures only logged-in users can hit the API endpoints
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;

    // CASE 1: Client sent a token (API Call or SPA Router)
    if (idToken && idToken.startsWith('Bearer ')) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken.split(' ')[1]);
            req.uid = decodedToken.uid;
            return next();
        } catch (error) {
            return res.status(403).json({ error: "Invalid Token" });
        }
    } 
    
    // CASE 2: No token (Browser Navigation / Refresh)
    // We cannot verify them server-side without cookies. 
    // STRATEGY: Render a "Shell" page that client-side JS will fill in.
    
    // Check if this is a request for the Settings Page HTML
    if (req.path === '/settings' && req.method === 'GET') {
         // Render the page WITHOUT sensitive data (client JS will fetch it)
         return res.render('settings', { 
             title: 'Settings', 
             // Empty data - Client JS will fetch real data via API
             settings: {}, 
             walletBalance: 0,
             subscription: {} 
         });
    }

    // Default: Block access
    return res.status(401).send("Unauthorized - Please Login");
}

const PLAN_PRICES = {
    'individual': 12.99,
    'duo': 15.99,
    'family': 19.99
};

// GET /api/wallet - Get User's Fair Trade Balance
router.get('/api/wallet', verifyUser, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.uid);
        const doc = await userRef.get();
        
        if (!doc.exists) return res.status(404).json({ error: "User not found" });
        
        const data = doc.data();
        const plan = data.subscription?.plan || 'individual';
        const monthlyPrice = PLAN_PRICES[plan] || 12.99;
        
        // LOGIC: 80% of subscription goes to user's wallet
        const fairTradeAllocation = (monthlyPrice * 0.80);
        
        // If 'walletBalance' doesn't exist yet (first time), set it to the full allocation
        let currentBalance = data.walletBalance;
        
        if (currentBalance === undefined) {
            currentBalance = fairTradeAllocation;
            await userRef.update({ 
                walletBalance: currentBalance,
                lastRollover: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        res.json({
            balance: currentBalance.toFixed(2),
            monthlyAllocation: fairTradeAllocation.toFixed(2),
            currency: '$',
            plan: plan
        });

    } catch (e) {
        console.error("Wallet Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/check-allocation', verifyUser, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.uid);
        const doc = await userRef.get();
        const data = doc.data();
        
        if (!data || !data.subscription) return res.json({ due: false });

        const nextPayment = new Date(); 
        nextPayment.setDate(nextPayment.getDate() - 1); 
        // ---------------------------

        const now = new Date();
        const isDue = (now >= nextPayment);

        if (isDue) {
            // Get their Top Artists to populate the modal
            // (In a real app, you might query a 'listeningHistory' collection)
            const topArtistIds = data.topArtists || [];
            res.json({ 
                due: true, 
                balance: data.walletBalance,
                topArtists: topArtistIds 
            });
        } else {
            res.json({ due: false });
        }
    } catch (e) {
        console.error("Allocation Check Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/commit-allocation', verifyUser, express.json(), async (req, res) => {
    try {
        // allocations = [{ artistId: "1", amount: 10.00 }, ...]
        const { action, allocations } = req.body; 
        const userRef = db.collection('users').doc(req.uid);
        
        await db.runTransaction(async (t) => {
            // 1. READ: Get User's Current Balance
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error("User does not exist!");
            
            const userData = userDoc.data();
            const currentBalance = userData.walletBalance || 0;
            
            // Calculate Next Month Date (for rollover or reset)
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 30);

            // CASE A: SKIP (Rollover)
            if (action === 'skip') {
                t.update(userRef, { 
                    'subscription.nextPaymentDate': nextDate.toISOString(),
                    'lastRollover': admin.firestore.FieldValue.serverTimestamp()
                });
                return;
            }

            // CASE B: ALLOCATE (Auto or Custom)
            if (action === 'allocate' && allocations && allocations.length > 0) {
                // 1. Validate Math (Client Side isn't trusted)
                const totalAttempted = allocations.reduce((sum, item) => sum + Number(item.amount), 0);
                
                // Allow 1 cent buffer for floating point weirdness
                if (totalAttempted > (currentBalance + 0.01)) {
                    throw new Error(`Insufficient funds. Wallet: $${currentBalance}, Tried: $${totalAttempted}`);
                }

                // 2. EXECUTE WRITES
                allocations.forEach(item => {
                    const amount = Number(item.amount);
                    const artistId = item.artistId; // e.g., "1" or "3"

                    // A. Create Receipt Log (For User & Artist History)
                    // We can query this later: db.collection('allocations').where('toArtist', '==', artistId)
                    const allocationRef = db.collection('allocations').doc();
                    t.set(allocationRef, {
                        fromUser: req.uid,
                        toArtist: artistId,
                        amount: amount,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // B. [!] NEW: PAY THE ARTIST (Atomic Increment)
                    // We use set({ ... }, { merge: true }) so if the Artist doc 
                    // doesn't exist yet (e.g. artist "1"), it creates it automatically.
                    const artistRef = db.collection('artists').doc(artistId);
                    t.set(artistRef, { 
                        // This updates the balance safely without needing to read it first
                        balance: admin.firestore.FieldValue.increment(amount),
                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                });

                // 3. DEDUCT FROM USER
                const newBalance = Math.max(0, currentBalance - totalAttempted);
                
                t.update(userRef, { 
                    walletBalance: newBalance,
                    'subscription.nextPaymentDate': nextDate.toISOString()
                });
            }
        });

        res.json({ success: true, receipt: allocations || [] });

    } catch (e) {
        console.error("Allocation Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- 2. THE SHARED BRAIN (C++ Polling Memory) ---
let commandMailbox = null; 
let songUrlMailbox = null;

let playerState = {
    position: 0,
    duration: 1,
    isPlaying: false
};


// --- 3. CORE PLAYER ROUTES ---

// Route: The Dashboard (UI)
router.get('/dashboard', (req, res) => {
    res.render('player');
});

// Route: Browser Sends Command (Play/Pause)
router.get('/send-command', (req, res) => {
    const action = req.query.action;
    const url = req.query.url;

    if (action) {
        commandMailbox = action;
        if (url) songUrlMailbox = url;
        
        // Optimistic Update
        if (action === 'play') playerState.isPlaying = true;
        if (action === 'pause') playerState.isPlaying = false;
        
        console.log("MAILBOX: Received command -> " + action);
        res.send("OK");
    } else {
        res.status(400).send("No action specified");
    }
});

// Route: C++ Polls for Commands
router.get('/poll-command', (req, res) => {
    // 1. Capture Stats from C++
    if (req.query.pos) {
        playerState.position = parseFloat(req.query.pos);
        playerState.duration = parseFloat(req.query.len);
    }

    // 2. Deliver Mail
    if (commandMailbox) {
        res.json({ action: commandMailbox, url: songUrlMailbox });
        commandMailbox = null; 
    } else {
        res.json({ action: "none" });
    }
});

// Route: Browser Asks for Status
router.get('/player-status', (req, res) => {
    res.json(playerState);
});


// --- 4. PROFILE ROUTES (Views) ---

router.get('/artist/:id', (req, res) => {
    const artistId = req.params.id;
    res.render('artist_profile', { 
        title: 'Artist Profile | Eporia',
        artistId: artistId 
    });
});

router.get('/profile', (req, res) => {
    res.render('profile', { 
        title: 'My Profile | Eporia',
        viewMode: 'private', 
        targetHandle: null,
        isAdminProfile: false 
    });
});



router.get('/u/:handle', async (req, res) => {
    const handle = req.params.handle;
    let isAdminProfile = false;

    // Secure Server-Side Role Check
    if (db) {
        try {
            const snapshot = await db.collection('users')
                                     .where('handle', '==', `@${handle}`)
                                     .limit(1)
                                     .get();
            
            if (!snapshot.empty) {
                const userData = snapshot.docs[0].data();
                if (userData.role === 'admin') isAdminProfile = true;
            }
        } catch (error) {
            console.error("Server DB Error:", error);
        }
    }
    
    res.render('profile', { 
        title: `@${handle} | Eporia`,
        viewMode: 'public', 
        targetHandle: handle,
        isAdminProfile: isAdminProfile 
    });
});

// --- SETTINGS ROUTE (Smart Load) ---
router.get('/settings', verifyUser, async (req, res) => {
    try {
        // 1. Fetch User Data so the settings match their DB state
        const userDoc = await db.collection('users').doc(req.uid).get();
        
        if (!userDoc.exists) return res.redirect('/members/login');
        
        const userData = userDoc.data();

        // 2. Render the Settings Page with their data injected
        res.render('settings', { 
            title: 'Settings | Eporia',
            // We pass the entire 'settings' object so Pug can check boxes automatically
            // e.g., input(type="checkbox" checked=settings.ghostMode)
            settings: userData.settings || {}, 
            
            // Pass wallet info for the Finance tab
            walletBalance: userData.walletBalance || 0,
            subscription: userData.subscription || {}
        });

    } catch (e) {
        console.error("Settings Load Error:", e);
        res.status(500).send("Server Error loading settings");
    }
});

// --- API: SAVE SETTINGS (The "Save" Button) ---
router.post('/api/settings/save', verifyUser, express.json(), async (req, res) => {
    try {
        const newSettings = req.body; // { audioQuality: 'high', ghostMode: true, ... }
        
        // Merge these into the 'settings' map in Firestore
        await db.collection('users').doc(req.uid).set({
            settings: newSettings
        }, { merge: true });

        res.json({ success: true });
    } catch (e) {
        console.error("Save Settings Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/explore', verifyUser, (req, res) => {
    res.render('explore', { 
        title: 'Explore | Eporia',
        user: req.user || {} // Ensure user object exists for the header
    });
});

// Route: Local Scene (Hyper-Local Feed)
router.get('/local', verifyUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.uid).get();
        const userData = userDoc.data();
        
        // Default to San Diego if user has no location set yet
        const city = userData.city || "San Diego";
        const state = userData.state || "California";

        res.render('local_scene', { 
            title: `Local: ${city} | Eporia`,
            user: userData,
            userLocation: { city, state } 
        });
    } catch (e) {
        console.error("Local Route Error:", e);
        res.redirect('/player/dashboard');
    }
});

// --- 5. SECURE API ENDPOINTS (The New Stuff) ---

// API: Upload Image (Avatar/Cover)
// verifyUser ensures only the account owner can do this
router.post('/api/upload-image', verifyUser, upload.single('image'), async (req, res) => {
    try {
        if (!req.file || !bucket) return res.status(400).json({ error: "No file or DB connection" });
        
        const type = req.body.type; // 'avatar' or 'cover'
        const filename = type === 'avatar' ? 'profile.jpg' : 'cover.jpg';
        // Force the path to match the verified UID (User cannot upload to another user's folder)
        const filePath = `users/${req.uid}/${filename}`;
        
        const file = bucket.file(filePath);
        
        await file.save(req.file.buffer, {
            contentType: req.file.mimetype,
            public: true
        });

        // Get Signed URL
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: '03-09-2491'
        });

        // Update Firestore
        const updateField = type === 'avatar' ? { photoURL: url } : { coverURL: url };
        await db.collection('users').doc(req.uid).update(updateField);

        res.json({ success: true, url: url });
    } catch (e) {
        console.error("Upload Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// API: Update Text Data (Bio, Anthem)
router.post('/api/update-profile', verifyUser, express.json(), async (req, res) => {
    try {
        const data = req.body; 
        
        // Force the update to apply ONLY to the verified UID
        await db.collection('users').doc(req.uid).update(data);
        res.json({ success: true });
    } catch (e) {
        console.error("Update Error:", e);
        res.status(500).json({ error: e.message });
    }
});


// =========================================================
// API: GENERATE PLAYLIST (Server-Side)
// =========================================================
router.get('/api/playlist/generate', verifyUser, async (req, res) => {
    try {
        const mood = req.query.mood;
        const userId = req.uid; // From verifyUser middleware

        if (!mood) return res.status(400).json({ error: "Mood required" });

        console.log(`Generating ${mood} playlist for user ${userId}...`);

        // Run the engine
        const tracks = await playlistEngine.generate(userId, mood);

        res.json({ 
            success: true, 
            mood: mood,
            count: tracks.length,
            tracks: tracks 
        });

    } catch (e) {
        console.error("Playlist API Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;