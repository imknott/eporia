const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");
const multer = require('multer');

// ==========================================
// 1. CONFIGURATION & R2 SETUP
// ==========================================
const r2 = require('../config/r2');
const { PutObjectCommand } = require("@aws-sdk/client-s3");

// Canonical CDN base — always ensure https:// prefix
const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || "https://cdn.eporiamusic.com";
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// Configure Multer (Memory Storage for fast uploads to R2)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ==========================================
// 2. FIREBASE INITIALIZATION
// ==========================================
if (!admin.apps.length) {
    try {
        const serviceAccount = require("../serviceAccountKey.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        try {
            admin.initializeApp({ projectId: "eporia" });
        } catch (initError) {
            console.error("Firebase Init Failed:", initError);
        }
    }
}
const db = admin.apps.length ? admin.firestore() : null;

// ==========================================
// 3. HELPERS & MIDDLEWARE
// ==========================================

// Normalizes any stored image URL to use the canonical CDN_URL.
// Handles three cases:
//   1. Raw R2 dev URLs (pub-xxx.r2.dev) — saved before a custom domain was configured
//   2. Relative paths (no http prefix)
//   3. Already-correct CDN or external URLs (passed through unchanged)
const R2_DEV_PATTERN = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;
function normalizeUrl(url, fallback = null) {
    if (!url) return fallback;
    if (!url.startsWith('http')) return `${CDN_URL}/${url.replace(/^\//, '')}`;
    if (R2_DEV_PATTERN.test(url)) return url.replace(R2_DEV_PATTERN, CDN_URL);
    return url;
}

// Passed into crate_view.pug and artist_profile.pug as a template local
// so track durations render correctly server-side.
function formatTime(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;

    // Bearer token path — used by SPA (appRouter.js) and direct API calls
    if (idToken && idToken.startsWith('Bearer ')) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken.split(' ')[1]);
            req.uid = decodedToken.uid;
            return next();
        } catch (error) {
            return res.status(403).json({ error: "Invalid Token" });
        }
    }

    // Session cookie path — used by direct browser page loads
    const sessionCookie = req.cookies?.session;
    if (sessionCookie) {
        try {
            const decoded = await admin.auth().verifySessionCookie(sessionCookie, true);
            req.uid = decoded.uid;
        } catch (e) { /* continue as guest */ }
    }

    // API routes always require a resolved uid
    if (req.originalUrl.includes('/api/') && !req.uid) {
        return res.status(401).json({ error: "Unauthorized: Missing Token" });
    }

    return next();
}

// ==========================================
// 4. FRONTEND PAGE ROUTES
// ==========================================

// ==========================================
// HELPER — fetches user doc and returns safe currentUser object
// for passing to every page render so right_sidebar.pug has
// the avatar and handle it needs.
// ==========================================
async function getCurrentUser(uid) {
    if (!uid || !db) return null;
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (!doc.exists) {
            // No users/ doc — could be an artist account. Look up their artistId.
            const artistSnap = await db.collection('artists')
                .where('ownerUid', '==', uid)
                .limit(1)
                .get();
            if (!artistSnap.empty) {
                // Return a sentinel so routes can redirect them
                return { _isArtist: true, artistId: artistSnap.docs[0].id };
            }
            return null;
        }
        const d = doc.data();
        // Also catch stale role:'artist' docs
        if (d.role === 'artist') {
            return { _isArtist: true, artistId: d.artistId || null };
        }
        return {
            uid,
            handle:   d.handle   || '',
            photoURL: d.photoURL  || `${process.env.R2_PUBLIC_URL || 'https://cdn.eporiamusic.com'}/assets/default-avatar.jpg`,
            coverURL: d.coverURL  || null,
        };
    } catch (e) {
        console.error('getCurrentUser error:', e);
        return null;
    }
}

// ==========================================
// PAGE ROUTES  (all pass currentUser so right_sidebar avatar works)
// ==========================================

router.get('/dashboard', verifyUser, async (req, res) => {
    let userLocation = { city: 'Local', state: '' };
    const currentUser = await getCurrentUser(req.uid);

    // Artist accounts don't belong in the player — redirect to their studio
    if (currentUser?._isArtist) {
        const dest = currentUser.artistId
            ? `/artist/studio?artistId=${currentUser.artistId}`
            : '/artist/login';
        return res.redirect(dest);
    }

    if (req.uid && db) {
        try {
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userLocation = {
                    city: userData.city || 'Local',
                    state: userData.state || ''
                };
            }
        } catch (error) {
            console.error("Error fetching user location:", error);
        }
    }

    res.render('dashboard', { 
        title: 'The Scene | Eporia',
        path: '/player/dashboard',
        userLocation,
        currentUser   // ← right_sidebar.pug needs this
    });
});

router.get('/favorites', verifyUser, async (req, res) => {
    res.render('favorites', { 
        title: 'My Favorites | Eporia', 
        path: '/player/favorites',
        currentUser: await getCurrentUser(req.uid)
    });
});

router.get('/workbench', verifyUser, async (req, res) => {
    res.render('workbench', { 
        title: 'Crate Creator | Eporia', 
        path: '/player/workbench',
        currentUser: await getCurrentUser(req.uid)
    });
});

router.get('/wallet', verifyUser, async (req, res) => {
    res.render('wallet', { 
        title: 'My Wallet | Eporia', 
        path: '/player/wallet',
        currentUser: await getCurrentUser(req.uid)
    });
});

router.get('/settings', verifyUser, async (req, res) => {
    res.render('settings', { 
        title: 'Settings | Eporia', 
        path: '/player/settings',
        currentUser: await getCurrentUser(req.uid)
    });
});

router.get('/profile', verifyUser, async (req, res) => {
    res.render('profile', { 
        title: 'My Profile | Eporia',
        viewMode: 'private', 
        targetHandle: null,
        isAdminProfile: false,
        path: '/player/profile',
        currentUser: await getCurrentUser(req.uid)
    });
});

router.get('/u/:handle', async (req, res) => {
    const handle = req.params.handle;
    let isAdminProfile = false;

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

    // For /u/:handle the req.uid may not be set (no verifyUser middleware)
    // so we read the session cookie manually if present
    let currentUser = null;
    if (req.uid) {
        currentUser = await getCurrentUser(req.uid);
    }

    res.render('profile', { 
        title: `@${handle} | Eporia`,
        viewMode: 'public', 
        targetHandle: handle,
        isAdminProfile,
        path: '/player/profile',
        currentUser
    });
});

router.get('/artist/:id', verifyUser, async (req, res) => {
    try {
        const artistId = req.params.id;
        const artistDoc = await db.collection('artists').doc(artistId).get();
        if (!artistDoc.exists) {
            return res.status(404).render('error', { message: "Artist not found" });
        }
       const rawArtist = artistDoc.data();

        // Normalize image fields: settings saves avatarUrl/bannerUrl,
        // but older records and the template use profileImage/bannerImage.
        // normalizeUrl() fixes any raw R2 dev URLs → canonical CDN domain.
        const artist = {
            ...rawArtist,
            id: artistId,
            profileImage: normalizeUrl(
                rawArtist.profileImage || rawArtist.avatarUrl,
                `${CDN_URL}/assets/default-avatar.jpg`
            ),
            bannerImage: normalizeUrl(
                rawArtist.bannerImage || rawArtist.bannerUrl,
                null
            ),
        };

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

        res.render('artist_profile', { 
            title: `${artist.name} | Eporia`,
            artist,
            tracks,
            path: '/player/artist',
            currentUser: await getCurrentUser(req.uid),
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

router.get('/crate/:id', verifyUser, async (req, res) => {
    try {
        const crateId = req.params.id;
        const currentUserId = req.uid;
        
        console.log(`[CRATE PAGE] Loading crate ${crateId}`);
        
        const querySnapshot = await db.collectionGroup('crates')
            .where('id', '==', crateId) 
            .limit(1)
            .get();
            
        if (querySnapshot.empty) {
            return res.status(404).render('error', { message: "Crate not found" });
        }
        
        const doc = querySnapshot.docs[0];
        const crateData = doc.data();
        const pathSegments = doc.ref.path.split('/');
        const ownerId = pathSegments[1]; 

        if (crateData.privacy === 'private' && currentUserId !== ownerId) {
            return res.status(403).render('error', { message: "This crate is private" });
        }

        const ownerDoc = await db.collection('users').doc(ownerId).get();
        const ownerData = ownerDoc.exists ? ownerDoc.data() : {};

        const enrichedCrate = {
            id: crateId,
            ownerId,
            ...crateData,
            tracks: (crateData.tracks || []).map(track => ({
                ...track,
                // inside songsSnap.forEach:
                artUrl: normalizeUrl(data.artUrl || artist.profileImage, 'https://via.placeholder.com/150'),
                img:    track.img    || track.artUrl || 'https://via.placeholder.com/150'
            })),
            creatorHandle: ownerData.handle || 'Unknown',
            creatorAvatar: ownerData.photoURL || null,
            creatorId: ownerId
        };

        res.render('crate_view', { 
            title: `${crateData.title} | Eporia`,
            crateId,
            crate: enrichedCrate,
            path: '/player/crate',
            currentUser: await getCurrentUser(currentUserId),
            formatTime: (seconds) => {
                if (!seconds) return "0:00";
                const m = Math.floor(seconds / 60);
                const s = Math.floor(seconds % 60);
                return `${m}:${s < 10 ? '0' : ''}${s}`;
            }
        });

    } catch (e) {
        console.error("Crate View Error:", e);
        res.status(500).render('error', { message: "Server Error loading crate" });
    }
});

// ==========================================
// 5. MOUNT API SUB-ROUTERS
// ==========================================
const walletRoutes      = require('./player_routes/wallet')(db, verifyUser);
const profileRoutes     = require('./player_routes/profile')(db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL);
const connectionsRoutes = require('./player_routes/connections')(db, verifyUser);
const settingsRoutes    = require('./player_routes/settings')(db, verifyUser);
const likesRoutes       = require('./player_routes/likes')(db, verifyUser);
const cratesRoutes      = require('./player_routes/crates')(db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL);
const dashboardRoutes   = require('./player_routes/dashboard')(db, verifyUser, CDN_URL);
const communityRoutes   = require('./player_routes/community')(db, verifyUser);

router.use('/', walletRoutes);
router.use('/', profileRoutes);
router.use('/', connectionsRoutes);
router.use('/', settingsRoutes);
router.use('/', likesRoutes);
router.use('/', cratesRoutes);
router.use('/', dashboardRoutes);
router.use('/', communityRoutes);

module.exports = router;