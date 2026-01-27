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
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (idToken && idToken.startsWith('Bearer ')) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken.split(' ')[1]);
            req.uid = decodedToken.uid;
            return next();
        } catch (error) { return res.status(403).json({ error: "Invalid Token" }); }
    }
    // Allow page loads to pass through (client-side auth handles the rest)
    if (req.method === 'GET') return next();
    return res.status(401).send("Unauthorized");
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
    res.render('dashboard', { 
        title: 'Dashboard | Eporia',
        path: '/dashboard'
    });
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

// Route: Dynamic Artist Profile
router.get('/artist/:id', verifyUser, async (req, res) => {
    try {
        const artistId = req.params.id;

        // 1. Fetch Artist Details
        const artistDoc = await db.collection('artists').doc(artistId).get();
        if (!artistDoc.exists) {
            return res.status(404).render('error', { message: "Artist not found" });
        }
        const artist = artistDoc.data();

        // 2. Fetch Artist's Tracks
        const songsSnap = await db.collection('songs')
            .where('artistId', '==', artistId)
            .orderBy('uploadedAt', 'desc') // Newest first
            .limit(20)
            .get();

        const tracks = [];
        songsSnap.forEach(doc => {
            const data = doc.data();
            tracks.push({
                id: doc.id,
                title: data.title,
                plays: data.plays || 0,
                duration: data.duration || 0, // in seconds
                artUrl: data.artUrl || artist.profileImage || 'https://via.placeholder.com/150',
                audioUrl: data.audioUrl
            });
        });

        // 3. Render View
        res.render('artist_profile', { 
            title: `${artist.name} | Eporia`,
            artist: artist,
            tracks: tracks,
            // Helper to format time (e.g. 185s -> 3:05)
            formatTime: (seconds) => {
                if (!seconds) return "-:--";
                const m = Math.floor(seconds / 60);
                const s = Math.floor(seconds % 60);
                return `${m}:${s < 10 ? '0' : ''}${s}`;
            }
        });

    } catch (e) {
        console.error("Artist Profile Error:", e);
        res.redirect('/player/dashboard');
    }
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

// ==========================================
// 6. USER SOCIAL GRAPH (Follows & Notifications)
// ==========================================

// TOGGLE USER FOLLOW
router.post('/api/user/follow', verifyUser, async (req, res) => {
    const { targetUid, targetHandle } = req.body;
    const uid = req.uid;

    if (!targetUid || targetUid === uid) return res.status(400).json({ error: "Invalid target" });

    const userRef = db.collection('users').doc(uid);
    const targetRef = db.collection('users').doc(targetUid);
    
    // Subcollections
    const followingRef = userRef.collection('followingUsers').doc(targetUid);
    const followerRef = targetRef.collection('followers').doc(uid);
    
    // Notification Ref (New ID)
    const notifRef = targetRef.collection('notifications').doc();

    try {
        await db.runTransaction(async (t) => {
            const followDoc = await t.get(followingRef);
            const currentUserDoc = await t.get(userRef);
            const currentUser = currentUserDoc.data();

            if (followDoc.exists) {
                // UNFOLLOW CASE
                t.delete(followingRef);
                t.delete(followerRef);
                // We typically don't delete the notification history, just the link
                res.json({ following: false });
            } else {
                // FOLLOW CASE
                const timestamp = admin.firestore.FieldValue.serverTimestamp();
                
                // 1. My "Following" List
                t.set(followingRef, {
                    uid: targetUid,
                    handle: targetHandle,
                    followedAt: timestamp
                });

                // 2. Their "Followers" List
                t.set(followerRef, {
                    uid: uid,
                    handle: currentUser.handle,
                    img: currentUser.photoURL,
                    followedAt: timestamp
                });

                // 3. SEND NOTIFICATION
                t.set(notifRef, {
                    type: 'follow',
                    fromUid: uid,
                    fromHandle: currentUser.handle,
                    fromImg: currentUser.photoURL || null,
                    read: false,
                    timestamp: timestamp
                });

                res.json({ following: true });
            }
        });
    } catch (e) {
        console.error("User Follow Error:", e);
        res.status(500).json({ error: "Transaction failed" });
    }
});

// CHECK FOLLOW STATUS
router.get('/api/user/follow/status', verifyUser, async (req, res) => {
    const { targetUid } = req.query;
    try {
        const doc = await db.collection('users').doc(req.uid).collection('followingUsers').doc(targetUid).get();
        res.json({ following: doc.exists });
    } catch (e) { res.json({ following: false }); }
});

// GET UNREAD NOTIFICATIONS
router.get('/api/notifications', verifyUser, async (req, res) => {
    try {
        const snap = await db.collection('users').doc(req.uid).collection('notifications')
            .where('read', '==', false)
            .orderBy('timestamp', 'desc')
            .limit(10)
            .get();
            
        const notifs = [];
        snap.forEach(doc => notifs.push({ id: doc.id, ...doc.data() }));
        res.json({ notifications: notifs });
    } catch (e) { 
        console.error("Notif Error:", e);
        res.json({ notifications: [] }); 
    }
});

// MARK NOTIFICATIONS AS READ
router.post('/api/notifications/mark-read', verifyUser, async (req, res) => {
    try {
        const { ids } = req.body; // Array of IDs to mark read
        if (!ids || ids.length === 0) return res.json({ success: true });

        const batch = db.batch();
        ids.forEach(id => {
            const ref = db.collection('users').doc(req.uid).collection('notifications').doc(id);
            batch.update(ref, { read: true });
        });
        
        await batch.commit();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET FULL FOLLOWING LISTS (Artists & Users)
router.get('/api/profile/following/:uid', verifyUser, async (req, res) => {
    const targetUid = req.params.uid;
    
    try {
        const userRef = db.collection('users').doc(targetUid);
        
        // 1. Fetch Artists (from subcollection 'following')
        const artistsSnap = await userRef.collection('following').orderBy('followedAt', 'desc').get();
        const artists = [];
        artistsSnap.forEach(doc => artists.push({ id: doc.id, ...doc.data() }));

        // 2. Fetch Users (from subcollection 'followingUsers')
        const usersSnap = await userRef.collection('followingUsers').orderBy('followedAt', 'desc').get();
        const users = [];
        // Note: We might want to fetch latest avatar/name here if not stored denormalized, 
        // but for now we rely on the data stored at follow time. 
        //Ideally, you'd do a "live" fetch of user docs if you want up-to-date avatars.
        const userIds = [];
        usersSnap.forEach(doc => {
            users.push({ id: doc.id, ...doc.data() });
            userIds.push(doc.id);
        });

        // OPTIONAL: Fetch fresh user data (Handle/Avatar) for the user list
        // This ensures if they changed their pic, it shows up.
        if (userIds.length > 0) {
            // Firestore 'in' query supports max 10/30. For scalability, stick to stored data 
            // or do client-side hydration. We will return stored data for speed.
        }

        res.json({ artists, users });

    } catch (e) {
        console.error("Fetch Following Error:", e);
        res.status(500).json({ error: "Could not fetch connections" });
    }
});

// --- SETTINGS ROUTE (Crash Fix) ---
router.get('/settings', verifyUser, async (req, res) => {
    // [FIX] If no UID (Browser Navigation), render "Skeleton" view
    // The client-side JS will fetch the actual data using the Auth Token.
    if (!req.uid) {
        return res.render('settings', { 
            title: 'Settings | Eporia',
            settings: {},       // Empty defaults
            walletBalance: 0,
            subscription: {},
            user: {},
            clientSideLoad: true // Flag to tell JS to fetch data
        });
    }

    try {
        const userDoc = await db.collection('users').doc(req.uid).get();
        if (!userDoc.exists) return res.redirect('/members/login');
        
        const userData = userDoc.data();

        res.render('settings', { 
            title: 'Settings | Eporia',
            settings: userData.settings || {}, 
            walletBalance: userData.walletBalance || 0,
            subscription: userData.subscription || {},
            user: userData
        });

    } catch (e) {
        console.error("Settings Load Error:", e);
        res.status(500).send("Server Error loading settings");
    }
});

// [NEW] API: Get Settings JSON (Securely)
router.get('/api/settings', verifyUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.uid).get();
        if (!userDoc.exists) return res.json({});
        res.json(userDoc.data());
    } catch (e) {
        res.status(500).json({ error: e.message });
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

router.get('/explore', (req, res) => {
    res.render('explore', { 
        title: 'Explore | Eporia',
        user: {}, // Placeholder
        path: '/explore'
    });
});
// 3. LOCAL SCENE
router.get('/local', verifyUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.uid).get();
        const userData = userDoc.data();
        const city = userData.city || "San Diego";
        const state = userData.state || "California";

        res.render('local_scene', { 
            title: `Local: ${city} | Eporia`,
            user: userData,
            userLocation: { city, state },
            path: '/local' // [NEW] Matches sidebar check
        });
    } catch (e) {
        console.error("Local Route Error:", e);
        res.redirect('/player/dashboard');
    }
});

// --- 5. SECURE API ENDPOINTS (The New Stuff) ---
router.post('/api/artist/follow', verifyUser, async (req, res) => {
    const { artistId, artistName, artistImg } = req.body;
    const uid = req.uid; // From verifyUser
    
    if (!artistId) return res.status(400).json({ error: "Artist ID required" });

    // Refs
    const userRef = db.collection('users').doc(uid);
    const artistRef = db.collection('artists').doc(artistId);
    
    // Subcollections (The Full History)
    const userFollowingRef = userRef.collection('following').doc(artistId);
    const artistFollowerRef = artistRef.collection('followers').doc(uid);

    try {
        await db.runTransaction(async (t) => {
            // 1. Get current state
            const followDoc = await t.get(userFollowingRef);
            const userDoc = await t.get(userRef);
            const userData = userDoc.exists ? userDoc.data() : {};
            
            // Get current sidebar array (or empty)
            let currentSidebar = userData.sidebarArtists || [];

            if (followDoc.exists) {
                // --- CASE: UNFOLLOW ---
                
                // A. Remove from Subcollections
                t.delete(userFollowingRef);
                t.delete(artistFollowerRef);
                
                // B. Decrement Counts
                t.update(artistRef, { followersCount: admin.firestore.FieldValue.increment(-1) });
                t.update(userRef, { followingCount: admin.firestore.FieldValue.increment(-1) });

                // C. Remove from Sidebar Array (Filter it out)
                const newSidebar = currentSidebar.filter(a => a.id !== artistId);
                t.update(userRef, { sidebarArtists: newSidebar });

                res.json({ following: false, sidebar: newSidebar });

            } else {
                // --- CASE: FOLLOW ---
                
                const timestamp = admin.firestore.FieldValue.serverTimestamp();

                // A. Add to User's "Following" Collection
                t.set(userFollowingRef, {
                    artistId, name: artistName, img: artistImg, followedAt: timestamp
                });

                // B. Add to Artist's "Followers" Collection (So they can see YOU)
                t.set(artistFollowerRef, {
                    userId: uid,
                    handle: userData.handle || "Anonymous",
                    img: userData.photoURL || null,
                    followedAt: timestamp
                });

                // C. Increment Counts
                t.update(artistRef, { followersCount: admin.firestore.FieldValue.increment(1) });
                t.update(userRef, { followingCount: admin.firestore.FieldValue.increment(1) });

                // D. Add to Sidebar Array (Limit to 50 to keep document small)
                // We unshift to put the new follow at the top
                const newArtistObj = { id: artistId, name: artistName, img: artistImg };
                
                // Remove if exists (safety), then add to top
                let newSidebar = currentSidebar.filter(a => a.id !== artistId);
                newSidebar.unshift(newArtistObj);
                
                if (newSidebar.length > 50) newSidebar.pop(); // Keep it lightweight

                t.update(userRef, { sidebarArtists: newSidebar });

                res.json({ following: true, sidebar: newSidebar });
            }
        });
    } catch (e) {
        console.error("Follow Error:", e);
        res.status(500).json({ error: "Transaction failed" });
    }
});

// CHECK STATUS (For button state on page load)
router.get('/api/artist/follow/status', verifyUser, async (req, res) => {
    const { artistId } = req.query;
    try {
        const doc = await db.collection('users').doc(req.uid).collection('following').doc(artistId).get();
        res.json({ following: doc.exists });
    } catch (e) {
        res.json({ following: false });
    }
});
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

// GET /api/dashboard/new-releases
// Fetches the 10 most recent global uploads
router.get('/api/dashboard/new-releases', verifyUser, async (req, res) => {
    try {
        const snapshot = await db.collection('songs')
            .orderBy('uploadedAt', 'desc')
            .limit(10)
            .get();

        const songs = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            songs.push({
                id: doc.id,
                title: data.title,
                artist: data.artistName,
                // Fallbacks in case old data is missing fields
                artUrl: data.artUrl || 'https://via.placeholder.com/300/111/333?text=No+Art',
                audioUrl: data.audioUrl,
                genre: data.genre
            });
        });

        res.json({ success: true, songs: songs });

    } catch (e) {
        console.error("New Releases Error:", e);
        // Don't crash the dashboard if this fails, just return empty
        res.json({ success: false, songs: [] }); 
    }
});

// =========================================================
// OMNI-SEARCH API (Case-Insensitive)
// Prefixes: @ (Artist), u: (User), # (Genre), s: (Song), C: (City)
// =========================================================
router.get('/api/search', verifyUser, async (req, res) => {
    try {
        const rawQuery = req.query.q || "";
        if (rawQuery.length < 2) return res.json({ results: [] });

        let results = [];
        const limit = 5;

        // 1. PARSE & NORMALIZE
        let type = 'general';
        let cleanQuery = rawQuery;

        // Detect Prefix
        if (rawQuery.startsWith('@')) { type = 'artist'; cleanQuery = rawQuery.substring(1); }
        else if (rawQuery.startsWith('u:')) { type = 'user'; cleanQuery = rawQuery.substring(2); }
        else if (rawQuery.startsWith('#')) { type = 'genre'; cleanQuery = rawQuery.substring(1); }
        else if (rawQuery.startsWith('s:')) { type = 'song'; cleanQuery = rawQuery.substring(2); }
        else if (rawQuery.startsWith('C:')) { type = 'city'; cleanQuery = rawQuery.substring(2); }

        // [FIX] Normalize to lowercase for the DB query
        const queryLower = cleanQuery.trim().toLowerCase();
        const endQuery = queryLower + '\uf8ff'; 

        // 2. EXECUTE QUERIES
        
        // --- ARTIST SEARCH ---
        if (type === 'artist' || type === 'general') {
            // [FIX] Query 'nameLower' instead of 'name'
            const snap = await db.collection('artists')
                .where('nameLower', '>=', queryLower)
                .where('nameLower', '<=', endQuery)
                .limit(limit).get();
            
            snap.forEach(doc => results.push({
                type: 'artist',
                id: doc.id,
                title: doc.data().name, // Display original name
                subtitle: '@' + doc.data().handle,
                img: doc.data().profileImage || null,
                url: `/player/artist/${doc.id}`
            }));
        }

        // --- SONG SEARCH ---
        if (type === 'song' || type === 'general') {
            // [FIX] Query 'titleLower' instead of 'title'
            const snap = await db.collection('songs')
                .where('titleLower', '>=', queryLower)
                .where('titleLower', '<=', endQuery)
                .limit(limit).get();
            
            snap.forEach(doc => results.push({
                type: 'song',
                id: doc.id,
                title: doc.data().title, // Display original title
                subtitle: doc.data().artistName,
                img: doc.data().artUrl || null,
                audioUrl: doc.data().audioUrl,
                artistId: doc.data().artistId
            }));
        }

        // --- USER SEARCH ---
        if (type === 'user') {
            // Note: For users, we assume you might want to match handles.
            // If you store handleLower, use that. For now, we'll try a direct match
            // or you might need to add handleLower to your user signup flow too.
            const snap = await db.collection('users')
                .where('handle', '>=', '@' + cleanQuery) // Handles are usually case-sensitive or strict
                .where('handle', '<=', '@' + cleanQuery + '\uf8ff')
                .limit(limit).get();

            snap.forEach(doc => results.push({
                type: 'user',
                id: doc.id,
                title: doc.data().handle,
                subtitle: 'Listener',
                img: doc.data().photoURL || null,
                url: `/player/u/${doc.data().handle.replace('@','')}`
            }));
        }

        // --- CITY SEARCH ---
        if (type === 'city') {
            const cities = ['San Diego', 'San Francisco', 'New York', 'London', 'Tokyo'];
            const matches = cities.filter(c => c.toLowerCase().includes(queryLower));
            matches.forEach(c => results.push({
                type: 'city',
                id: c,
                title: c,
                subtitle: 'Local Scene',
                icon: 'fas fa-map-marker-alt',
                url: `/player/local?city=${c}`
            }));
        }

        res.json({ results });

    } catch (e) {
        console.error("Search Error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ==========================================
// 8. LIKE SYSTEM (Songs)
// ==========================================

// [NEW] GET ALL LIKED SONG IDs (For Local Caching)
router.get('/api/user/likes/ids', verifyUser, async (req, res) => {
    try {
        const snapshot = await db.collection('users').doc(req.uid).collection('likes').select().get();
        // Return array of IDs only
        const ids = snapshot.docs.map(doc => doc.id);
        res.json({ ids });
    } catch (e) {
        console.error("Fetch Likes Error:", e);
        res.status(500).json({ ids: [] });
    }
});

// TOGGLE LIKE (Save to User's "Likes" Collection)
router.post('/api/song/like', verifyUser, async (req, res) => {
    // ... (Keep existing like logic) ...
    // Copy the exact code from the previous step for consistency
    const { songId, title, artist, artUrl, audioUrl, duration } = req.body;
    const uid = req.uid;

    if (!songId) return res.status(400).json({ error: "Song ID required" });

    const likeRef = db.collection('users').doc(uid).collection('likes').doc(songId);
    const songRef = db.collection('songs').doc(songId);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(likeRef);

            if (doc.exists) {
                t.delete(likeRef);
                t.update(songRef, { likesCount: admin.firestore.FieldValue.increment(-1) });
                res.json({ liked: false });
            } else {
                t.set(likeRef, {
                    songId,
                    title: title || 'Unknown Title',
                    artist: artist || 'Unknown Artist',
                    artUrl: artUrl || null,
                    audioUrl: audioUrl || null,
                    duration: duration || 0,
                    likedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                t.update(songRef, { likesCount: admin.firestore.FieldValue.increment(1) });
                res.json({ liked: true });
            }
        });
    } catch (e) {
        console.error("Like Transaction Error:", e);
        res.status(500).json({ error: "Failed to toggle like" });
    }
});

// ... (Keep existing status check as fallback, though we rely on cache now) ...
router.get('/api/song/like/status', verifyUser, async (req, res) => {
    const { songId } = req.query;
    try {
        const doc = await db.collection('users').doc(req.uid).collection('likes').doc(songId).get();
        res.json({ liked: doc.exists });
    } catch (e) { res.json({ liked: false }); }
});

module.exports = router;