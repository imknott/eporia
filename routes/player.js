var express = require('express');
var router = express.Router();
var admin = require("firebase-admin");
var multer = require('multer'); // [RESTORED]

// [RESTORED] Configure Multer (Memory Storage for fast uploads to Firebase)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// --- 1. FIREBASE & MULTER SETUP ---
if (!admin.apps.length) {
    try {
        var serviceAccount = require("../serviceAccountKey.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: "eporia.firebasestorage.app"
        });
    } catch (e) {
        try {
            admin.initializeApp({
                projectId: "eporia",
                storageBucket: "eporia.firebasestorage.app"
            });
        } catch (initError) {
            console.error("Firebase Init Failed:", initError);
        }
    }
}
console.warn("⚠️ Warning: serviceAccountKey.json not found. Server checks will be skipped.");

const db = admin.apps.length ? admin.firestore() : null;
const bucket = admin.apps.length ? admin.storage().bucket() : null;

const PLAN_PRICES = {
    'individual': 12.99,
    'duo': 15.99,
    'family': 19.99
};

// --- 2. MIDDLEWARE: VERIFY USER (HYBRID MODE) ---
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    
    // A. Check for Client-Side Token (API Calls)
    if (idToken && idToken.startsWith('Bearer ')) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken.split(' ')[1]);
            req.uid = decodedToken.uid;
            return next();
        } catch (error) { 
            // If token is invalid, reject immediately
            return res.status(403).json({ error: "Invalid Token" }); 
        }
    }

    // B. Check if this is an API Call (Strict Mode)
    // If we are hitting an API endpoint but have no token, REJECT.
    if (req.originalUrl.includes('/api/')) {
        return res.status(401).json({ error: "Unauthorized: Missing Token" });
    }

    // C. Page Loads (Lenient Mode)
    // If rendering a page (HTML), let it pass so the client can handle auth.
    if (req.method === 'GET') {
        return next();
    }

    return res.status(401).send("Unauthorized");
}
// ==========================================
// 4. PAGE ROUTES
// ==========================================

router.get('/dashboard', verifyUser, async (req, res) => {
    let userLocation = { city: 'Local', state: '' };
    let activeCount = 128;

    // Try to get user's actual location from database if authenticated
    if (req.uid && db) {
        try {
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userLocation = {
                    city: userData.city || 'Local',
                    state: userData.state || ''
                };
                
                // Get active listener count for this city
                const citySnapshot = await db.collection('users')
                    .where('city', '==', userLocation.city)
                    .get();
                activeCount = citySnapshot.size;
            }
        } catch (error) {
            console.error("Error fetching user location:", error);
        }
    }

    res.render('dashboard', { 
        title: 'The Scene | Eporia',
        path: '/player/dashboard',
        userLocation: userLocation,
        activeCount: activeCount
    });
});

router.get('/favorites', verifyUser, (req, res) => {
    res.render('favorites', { title: 'My Favorites | Eporia', path: '/player/favorites' });
});

router.get('/workbench', verifyUser, (req, res) => {
    res.render('workbench', { title: 'Crate Creator | Eporia', path: '/player/workbench' });
});

router.get('/wallet', verifyUser, (req, res) => {
    res.render('wallet', { title: 'My Wallet | Eporia', path: '/player/wallet' });
});

router.get('/settings', verifyUser, (req, res) => {
    res.render('settings', { title: 'Settings | Eporia', path: '/player/settings' });
});

// Route: My Profile
router.get('/profile', (req, res) => {
    res.render('profile', { 
        title: 'My Profile | Eporia',
        viewMode: 'private', 
        targetHandle: null,
        isAdminProfile: false,
        path: '/player/profile' // [FIX] Added path to prevent 500 error
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
        isAdminProfile: isAdminProfile,
        path: '/player/profile' // [FIX] Added path here too
    });
});

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
            .orderBy('uploadedAt', 'desc') 
            .limit(20)
            .get();

        const tracks = [];
        songsSnap.forEach(doc => {
            const data = doc.data();
            tracks.push({
                id: doc.id,
                title: data.title,
                plays: data.plays || 0,
                duration: data.duration || 0,
                artUrl: data.artUrl || artist.profileImage || 'https://via.placeholder.com/150',
                audioUrl: data.audioUrl
            });
        });

        // 3. Render View
        res.render('artist_profile', { 
            title: `${artist.name} | Eporia`,
            artist: artist,
            tracks: tracks,
            path: '/player/artist', // [FIX] Added path to prevent nav crash
            
            // Helper to format time
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

// ==========================================
// 5. API ROUTES (Data Fetching)
// ==========================================

// ====== NEW: LIKE ENDPOINTS ======
// GET /api/user/likes/ids - Get all liked song IDs for current user
router.get('/api/user/likes/ids', verifyUser, async (req, res) => {
    try {
        const likesSnap = await db.collection('users')
            .doc(req.uid)
            .collection('likedSongs')
            .get();
        
        const likedIds = [];
        likesSnap.forEach(doc => {
            likedIds.push(doc.id);
        });
        
        res.json({ likedSongIds: likedIds });
    } catch (e) {
        console.error("Fetch Likes Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/user/like - Like a song
router.post('/api/user/like', verifyUser, express.json(), async (req, res) => {
    try {
        const { songId, title, artist, artUrl, audioUrl, duration } = req.body;
        
        if (!songId) {
            return res.status(400).json({ error: "Missing songId" });
        }

        const likeRef = db.collection('users')
            .doc(req.uid)
            .collection('likedSongs')
            .doc(songId);

        await likeRef.set({
            title: title || '',
            artist: artist || '',
            artUrl: artUrl || '',
            audioUrl: audioUrl || '',
            duration: duration || 0,
            likedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, liked: true });
    } catch (e) {
        console.error("Like Song Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/user/like/:songId - Unlike a song
router.delete('/api/user/like/:songId', verifyUser, async (req, res) => {
    try {
        const songId = req.params.songId;
        
        await db.collection('users')
            .doc(req.uid)
            .collection('likedSongs')
            .doc(songId)
            .delete();

        res.json({ success: true, liked: false });
    } catch (e) {
        console.error("Unlike Song Error:", e);
        res.status(500).json({ error: e.message });
    }
});
// ====== END LIKE ENDPOINTS ======

router.get('/api/dashboard', verifyUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
        
        const userData = userDoc.data();
        const userCity = userData.city || 'Local';
        const userState = userData.state || '';
        const userCountry = userData.country || 'US';

        // 1. FRESH DROPS - Individual songs (NOT in albums) from user's city
        const citySnap = await db.collection('songs')
            .where('city', '==', userCity)
            .orderBy('uploadedAt', 'desc')
            .limit(12)
            .get();

        const freshDrops = [];
        for (const doc of citySnap.docs) {
            const data = doc.data();
            
            // Skip if part of an album (singles only)
            if (data.albumId) continue;
            
            const artistDoc = await db.collection('artists').doc(data.artistId).get();
            const artistData = artistDoc.exists ? artistDoc.data() : {};
            
            freshDrops.push({
                id: doc.id,
                title: data.title,
                artist: artistData.name || 'Unknown',
                img: data.artUrl || artistData.profileImage || 'https://via.placeholder.com/150',
                audioUrl: data.audioUrl,
                duration: data.duration || 0,
                type: 'song'
            });
        }

        // 2. COMMUNITY CRATES - User-curated playlists from local users
        const cratesSnap = await db.collection('crates')
            .where('city', '==', userCity)
            .where('privacy', '==', 'public')
            .orderBy('createdAt', 'desc')
            .limit(8)
            .get();

        const localCrates = [];
        cratesSnap.forEach(doc => {
            const data = doc.data();
            localCrates.push({
                id: doc.id,
                title: data.title,
                artist: `by ${data.creatorHandle}`,
                img: data.tracks?.[0]?.img || 'https://via.placeholder.com/150',
                trackCount: data.metadata?.trackCount || 0,
                type: 'crate'
            });
        });

        // Fallback to state-wide crates if no local crates exist
        if (localCrates.length === 0 && userState) {
            const stateCratesSnap = await db.collection('crates')
                .where('state', '==', userState)
                .where('privacy', '==', 'public')
                .orderBy('createdAt', 'desc')
                .limit(8)
                .get();
            
            stateCratesSnap.forEach(doc => {
                const data = doc.data();
                localCrates.push({
                    id: doc.id,
                    title: data.title,
                    artist: `by ${data.creatorHandle}`,
                    img: data.tracks?.[0]?.img || 'https://via.placeholder.com/150',
                    trackCount: data.metadata?.trackCount || 0,
                    type: 'crate'
                });
            });
        }

        // 3. TOP LOCAL ARTISTS - Artists from user's city
        const artistsSnap = await db.collection('artists')
            .where('location', '==', userCity)
            .limit(8)
            .get();

        const topLocal = [];
        artistsSnap.forEach(doc => {
            const data = doc.data();
            topLocal.push({
                id: doc.id,
                name: data.name || 'Unknown Artist',
                img: data.profileImage || 'https://via.placeholder.com/150'
            });
        });

        res.json({
            userName: userData.handle || 'User',
            city: userCity,
            state: userState,
            country: userCountry,
            freshDrops: freshDrops,
            localCrates: localCrates,
            topLocal: topLocal
        });

    } catch (e) {
        console.error("Dashboard API Error:", e);
        res.status(500).json({ error: "Failed to load dashboard" });
    }
});

router.get('/api/favorites', verifyUser, async (req, res) => {
    try {
        const likesSnap = await db.collection('users')
            .doc(req.uid)
            .collection('likedSongs')
            .orderBy('likedAt', 'desc')
            .get();

        const songs = [];
        likesSnap.forEach(doc => {
            const data = doc.data();
            songs.push({
                id: doc.id,
                title: data.title || '',
                artist: data.artist || '',
                img: data.artUrl || 'https://via.placeholder.com/150',
                audioUrl: data.audioUrl || '',
                duration: data.duration || 0
            });
        });

        res.json({ songs });
    } catch (e) {
        console.error("Favorites Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/user/following', verifyUser, async (req, res) => {
    try {
        const followingSnap = await db.collection('users')
            .doc(req.uid)
            .collection('following')
            .orderBy('followedAt', 'desc')
            .limit(6)
            .get();

        const artists = [];
        followingSnap.forEach(doc => {
            const data = doc.data();
            artists.push({
                id: doc.id,
                name: data.name || '',
                img: data.img || 'https://via.placeholder.com/150'
            });
        });

        res.json({ artists });
    } catch (e) {
        console.error("Following Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/settings', verifyUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

        const data = userDoc.data();
        res.json({
            handle: data.handle || '',
            bio: data.bio || '',
            settings: data.settings || {}
        });
    } catch (e) {
        console.error("Settings Fetch Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/settings/save', verifyUser, express.json(), async (req, res) => {
    try {
        await db.collection('users').doc(req.uid).update({
            settings: req.body,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.json({ success: true });
    } catch (e) {
        console.error("Settings Save Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/search', verifyUser, async (req, res) => {
    const query = req.query.q || '';
    const results = [];

    try {
        // Search Artists
        if (query.startsWith('@')) {
            const artistName = query.slice(1).toLowerCase();
            const artistSnap = await db.collection('artists')
                .orderBy('name')
                .startAt(artistName)
                .endAt(artistName + '\uf8ff')
                .limit(5)
                .get();

            artistSnap.forEach(doc => {
                const data = doc.data();
                results.push({
                    type: 'artist',
                    id: doc.id,
                    title: data.name,
                    subtitle: 'Artist',
                    img: data.profileImage || 'https://via.placeholder.com/150',
                    url: `/player/artist/${doc.id}`
                });
            });
        } 
        // Search Cities
        else if (query.startsWith('C:')) {
            const cityName = query.slice(2).toLowerCase();
            const userSnap = await db.collection('users')
                .where('city', '>=', cityName)
                .where('city', '<=', cityName + '\uf8ff')
                .limit(5)
                .get();

            const cities = new Set();
            userSnap.forEach(doc => {
                const data = doc.data();
                if (data.city) cities.add(data.city);
            });

            cities.forEach(city => {
                results.push({
                    type: 'city',
                    title: city,
                    subtitle: 'City',
                    img: null,
                    url: `/player/dashboard?city=${encodeURIComponent(city)}`
                });
            });
        }
        // Search Songs
        else {
            const songSnap = await db.collection('songs')
                .orderBy('title')
                .startAt(query.toLowerCase())
                .endAt(query.toLowerCase() + '\uf8ff')
                .limit(8)
                .get();

            for (const doc of songSnap.docs) {
                const data = doc.data();
                const artistDoc = await db.collection('artists').doc(data.artistId).get();
                const artistName = artistDoc.exists ? artistDoc.data().name : 'Unknown';

                results.push({
                    type: 'song',
                    id: doc.id,
                    title: data.title,
                    subtitle: artistName,
                    img: data.artUrl || 'https://via.placeholder.com/150',
                    audioUrl: data.audioUrl,
                    duration: data.duration || 0
                });
            }
        }

        res.json({ results });
    } catch (e) {
        console.error("Search Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 6. ARTIST FOLLOWING (NEW)
// ==========================================
router.post('/api/artist/follow', verifyUser, express.json(), async (req, res) => {
    try {
        const { artistId, name, img } = req.body;
        
        if (!artistId) {
            return res.status(400).json({ error: "Missing artistId" });
        }

        const followRef = db.collection('users')
            .doc(req.uid)
            .collection('following')
            .doc(artistId);

        await followRef.set({
            name: name || '',
            img: img || '',
            followedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, following: true });
    } catch (e) {
        console.error("Follow Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.delete('/api/artist/follow/:artistId', verifyUser, async (req, res) => {
    try {
        const artistId = req.params.artistId;
        
        await db.collection('users')
            .doc(req.uid)
            .collection('following')
            .doc(artistId)
            .delete();

        res.json({ success: true, following: false });
    } catch (e) {
        console.error("Unfollow Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/artist/follow/check', verifyUser, async (req, res) => {
    try {
        const artistId = req.query.artistId;
        
        if (!artistId) {
            return res.status(400).json({ error: "Missing artistId" });
        }

        const followDoc = await db.collection('users')
            .doc(req.uid)
            .collection('following')
            .doc(artistId)
            .get();

        res.json({ following: followDoc.exists });
    } catch (e) {
        console.error("Check Follow Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 7. PROFILE (NEW)
// ==========================================

// Route: Upload Profile Pic (Avatar)
router.post('/api/profile/upload', verifyUser, upload.single('avatar'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file uploaded" });

        // Generate Filename
        const filename = `avatars/${req.uid}_${Date.now()}.${file.mimetype.split('/')[1]}`;
        const blob = bucket.file(filename);
        const blobStream = blob.createWriteStream({
            metadata: { contentType: file.mimetype },
            public: true
        });

        // Upload Promise
        await new Promise((resolve, reject) => {
            blobStream.on('error', reject);
            blobStream.on('finish', async () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
                
                // Save URL to Firestore
                await db.collection('users').doc(req.uid).update({ 
                    avatar: publicUrl,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                res.json({ success: true, url: publicUrl });
                resolve();
            });
            blobStream.end(file.buffer);
        });

    } catch (e) {
        console.error("Profile Upload Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// PROFILE IMAGE UPLOAD ENDPOINTS
// ==========================================

// POST /api/profile/upload-avatar - Upload avatar image
router.post('/api/profile/upload-avatar', verifyUser, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Generate unique filename
        const timestamp = Date.now();
        const filename = `avatars/${req.uid}_${timestamp}.jpg`;
        
        // Upload to Firebase Storage
        const file = bucket.file(filename);
        const stream = file.createWriteStream({
            metadata: {
                contentType: req.file.mimetype,
                metadata: {
                    firebaseStorageDownloadTokens: timestamp
                }
            }
        });

        stream.on('error', (err) => {
            console.error('Upload error:', err);
            res.status(500).json({ error: 'Upload failed' });
        });

        stream.on('finish', async () => {
            // Make file public and get URL
            await file.makePublic();
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
            
            // Note: We don't update the user document here
            // The client will send this URL in the main save request
            res.json({ 
                success: true, 
                url: publicUrl 
            });
        });

        stream.end(req.file.buffer);

    } catch (e) {
        console.error('Avatar upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/profile/upload-cover - Upload cover photo
router.post('/api/profile/upload-cover', verifyUser, upload.single('cover'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Generate unique filename
        const timestamp = Date.now();
        const filename = `covers/${req.uid}_${timestamp}.jpg`;
        
        // Upload to Firebase Storage
        const file = bucket.file(filename);
        const stream = file.createWriteStream({
            metadata: {
                contentType: req.file.mimetype,
                metadata: {
                    firebaseStorageDownloadTokens: timestamp
                }
            }
        });

        stream.on('error', (err) => {
            console.error('Upload error:', err);
            res.status(500).json({ error: 'Upload failed' });
        });

        stream.on('finish', async () => {
            // Make file public and get URL
            await file.makePublic();
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
            
            res.json({ 
                success: true, 
                url: publicUrl 
            });
        });

        stream.end(req.file.buffer);

    } catch (e) {
        console.error('Cover upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

// UPDATE THE EXISTING /api/profile/update ENDPOINT
// Replace or update the existing endpoint with this enhanced version:

router.post('/api/profile/update', verifyUser, express.json(), async (req, res) => {
    try {
        const { handle, bio, location, avatar, coverURL, anthem } = req.body;
        const updateData = {};
        
        // Only update fields that are provided
        if (handle) updateData.handle = handle;
        if (bio !== undefined) updateData.bio = bio; // Allow empty string
        if (location) updateData.location = location;
        if (avatar) updateData.avatar = avatar;
        if (coverURL) updateData.coverURL = coverURL;
        if (anthem !== undefined) updateData.anthem = anthem; // Allow null to remove anthem
        
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('users').doc(req.uid).update(updateData);
        
        res.json({ success: true, data: updateData });
    } catch (e) {
        console.error('Profile update error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// HELPER: Clean up old images (optional)
// ==========================================
async function deleteOldProfileImage(userId, type) {
    try {
        const prefix = type === 'avatar' ? 'avatars/' : 'covers/';
        const [files] = await bucket.getFiles({ prefix: `${prefix}${userId}_` });
        
        // Keep only the latest 3 images, delete older ones
        if (files.length > 3) {
            const sorted = files.sort((a, b) => b.metadata.timeCreated - a.metadata.timeCreated);
            const toDelete = sorted.slice(3);
            
            await Promise.all(toDelete.map(file => file.delete()));
            console.log(`Cleaned up ${toDelete.length} old ${type} images for user ${userId}`);
        }
    } catch (e) {
        console.error('Cleanup error:', e);
        // Don't fail the request if cleanup fails
    }
}


// GET /api/profile/:uid - Get user profile data
router.get('/api/profile/:uid', verifyUser, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        
        const userDoc = await db.collection('users').doc(targetUid).get();
        
        if (!userDoc.exists()) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userData = userDoc.data();
        
        // Return safe profile data (don't expose sensitive fields)
        res.json({
            uid: targetUid,
            handle: userData.handle,
            displayName: userData.displayName || userData.handle,
            bio: userData.bio || '',
            avatar: userData.avatar || '',
            coverURL: userData.coverURL || '',
            role: userData.role || 'member',
            createdAt: userData.createdAt,
            anthem: userData.anthem || null,
            city: userData.city,
            state: userData.state
        });
        
    } catch (e) {
        console.error('Get Profile Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/user/by-handle - Get user ID by handle
router.get('/api/user/by-handle', verifyUser, async (req, res) => {
    try {
        const handle = req.query.handle;
        
        if (!handle) {
            return res.status(400).json({ error: 'Handle required' });
        }
        
        // Query for user with this handle
        const snapshot = await db.collection('users')
            .where('handle', '==', handle)
            .limit(1)
            .get();
        
        if (snapshot.empty) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userDoc = snapshot.docs[0];
        
        res.json({
            uid: userDoc.id,
            handle: userDoc.data().handle
        });
        
    } catch (e) {
        console.error('Get User by Handle Error:', e);
        res.status(500).json({ error: e.message });
    }
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

// UPDATE PROFILE TEXT (Handle, Bio, Location)
router.post('/api/profile/update', verifyUser, express.json(), async (req, res) => {
    try {
        const { handle, bio, location } = req.body;
        const updateData = {};
        
        // Only update fields that are provided
        if (handle) updateData.handle = handle;
        if (bio) updateData.bio = bio;
        if (location) updateData.location = location; // Ensure your DB uses 'location' or 'city' consistently
        
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('users').doc(req.uid).update(updateData);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



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

// ==========================================
// COMMUNITY CRATES (USER-CURATED PLAYLISTS) API
// ==========================================

// CREATE A NEW CRATE
router.post('/api/crate/create', verifyUser, upload.none(), async (req, res) => {
    try {
        const { title, tracks, privacy, metadata } = req.body;
        
        if (!title || !tracks) {
            return res.status(400).json({ error: "Missing title or tracks" });
        }

        const tracksArray = typeof tracks === 'string' ? JSON.parse(tracks) : tracks;
        const metadataObj = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

        // Get user data for location
        const userDoc = await db.collection('users').doc(req.uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        const crateData = {
            title: title,
            creatorId: req.uid,
            creatorHandle: userData.handle || 'Anonymous',
            creatorAvatar: userData.photoURL || null,
            tracks: tracksArray,
            privacy: privacy || 'public',
            metadata: {
                trackCount: tracksArray.length,
                totalDuration: metadataObj?.totalDuration || 0,
                genres: metadataObj?.genres || [],
                avgBpm: metadataObj?.avgBpm || 0
            },
            // Location data for local discovery
            city: userData.city || null,
            state: userData.state || null,
            country: userData.country || 'US',
            
            // Stats
            plays: 0,
            likes: 0,
            shares: 0,
            
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const crateRef = await db.collection('crates').add(crateData);

        res.json({ 
            success: true, 
            crateId: crateRef.id,
            message: 'Crate created successfully'
        });

    } catch (e) {
        console.error("Crate Creation Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET USER'S CRATES (For Profile Page)
router.get('/api/crates/user/:uid', verifyUser, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        
        const cratesSnap = await db.collection('crates')
            .where('creatorId', '==', targetUid)
            .where('privacy', '==', 'public')
            .orderBy('createdAt', 'desc')
            .get();

        const crates = [];
        cratesSnap.forEach(doc => {
            const data = doc.data();
            crates.push({
                id: doc.id,
                title: data.title,
                creatorHandle: data.creatorHandle,
                creatorAvatar: data.creatorAvatar,
                trackCount: data.metadata?.trackCount || 0,
                genres: data.metadata?.genres || [],
                plays: data.plays || 0,
                likes: data.likes || 0,
                img: data.tracks?.[0]?.img || 'https://via.placeholder.com/150'
            });
        });

        res.json({ crates });

    } catch (e) {
        console.error("Fetch User Crates Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET SINGLE CRATE DETAILS
router.get('/api/crate/:id', verifyUser, async (req, res) => {
    try {
        const crateDoc = await db.collection('crates').doc(req.params.id).get();
        
        if (!crateDoc.exists) {
            return res.status(404).json({ error: "Crate not found" });
        }

        const data = crateDoc.data();
        
        res.json({
            id: crateDoc.id,
            title: data.title,
            creatorHandle: data.creatorHandle,
            creatorAvatar: data.creatorAvatar,
            tracks: data.tracks,
            metadata: data.metadata,
            plays: data.plays || 0,
            likes: data.likes || 0,
            createdAt: data.createdAt
        });

    } catch (e) {
        console.error("Fetch Crate Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET LOCAL ARTISTS WITH PAGINATION
router.get('/api/artists/local', verifyUser, async (req, res) => {
    try {
        const city = req.query.city;
        const state = req.query.state;
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 24;

        let artistsSnap;

        // 1. Try Specific City First
        if (city) {
            artistsSnap = await db.collection('artists')
                .where('city', '==', city)
                .orderBy('stats.followers', 'desc')
                .offset(offset)
                .limit(limit)
                .get();
        }

        // 2. Fallback to State if city query is empty or wasn't run (only on first page)
        if ((!artistsSnap || artistsSnap.empty) && state && offset === 0) {
            // console.log(`No artists in ${city}, falling back to ${state}`);
            artistsSnap = await db.collection('artists')
                .where('state', '==', state)
                .orderBy('stats.followers', 'desc')
                .limit(limit)
                .get();
        }

        // [FIX] Initialize the array properly
        const artists = [];

        if (artistsSnap && !artistsSnap.empty) {
            artistsSnap.forEach(doc => {
                const data = doc.data();
                artists.push({
                    id: doc.id,
                    name: data.name || 'Unknown Artist',
                    img: data.profileImage || 'https://via.placeholder.com/150',
                    followers: data.stats?.followers || 0,
                    city: data.city || '',
                    state: data.state || ''
                });
            });
        }

        // Return the array (even if empty)
        res.json({ artists, hasMore: artists.length === limit });

    } catch (e) {
        console.error("Fetch Local Artists Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;