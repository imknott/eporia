/* routes/artist/studio.js */
const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const multer  = require('multer');

// ─────────────────────────────────────────────────────────────
// R2 / CDN SETUP  (needed for the posts image upload route)
// ─────────────────────────────────────────────────────────────
const r2 = require('../../config/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || 'https://cdn.eporiamusic.com';
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────
// URL NORMALIZER
// Stored URLs may be missing the https:// protocol (e.g. from
// older uploads). Always ensure a full URL before returning to
// the client so the browser doesn't treat it as a relative path.
// ─────────────────────────────────────────────────────────────
function normalizeUrl(url) {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
}

// ==========================================
// MIDDLEWARE: VERIFY USER
// ==========================================
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).json({ error: 'No authentication token provided' });

    try {
        const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
    }
}

// ==========================================
// PAGE RENDER ROUTES
// ==========================================
router.get('/studio', (req, res) => {
    res.render('artist_studio', { title: 'Artist Studio | Eporia' });
});

router.get('/pending-status', async (req, res) => {
    try {
        const db = admin.firestore();
        const artistId = req.query.id;
        if (!artistId) return res.redirect('/artist/login');

        const artistDoc = await db.collection('artists').doc(artistId).get();
        if (!artistDoc.exists) return res.redirect('/artist/login');

        const artistData = artistDoc.data();

        res.render('pending_approval', {
            status:          artistData.status,
            appliedAt:       artistData.appliedAt?.toDate(),
            rejectionReason: artistData.rejectionReason,
            artistId
        });
    } catch (error) {
        res.redirect('/artist/login');
    }
});

// ==========================================
// STUDIO DASHBOARD API
// ==========================================
router.get('/api/studio/dashboard', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({ error: 'No artist profile linked to this login.' });
        }

        const doc  = snapshot.docs[0];
        const data = doc.data();

        if (!data.dashboardAccess || data.status !== 'approved') {
            return res.json({ isPending: true, status: data.status, artistId: doc.id });
        }

        // Count merch items
        let merchCount = 0;
        try {
            const merchSnap = await db.collection('artists').doc(doc.id)
                .collection('merch')
                .where('status', '==', 'active')
                .get();
            merchCount = merchSnap.size;
        } catch (_) { /* non-fatal */ }

        res.json({
            artistId: doc.id,
            profile: {
                name:   data.name   || '',
                handle: data.handle || '',
                bio:    data.bio    || '',
                // FIX: normalize URLs — both old (profileImage) and new (avatarUrl) field names
                image:  normalizeUrl(data.profileImage || data.avatarUrl)  || null,
                banner: normalizeUrl(data.bannerImage  || data.bannerUrl)  || null
            },
            stats: {
                listeners: data.stats?.monthlyListeners || 0,
                followers: data.stats?.followers        || 0,
                tipsTotal: data.stats?.tipsTotal        || 0.00
            },
            recentActivity: [],
            catalog: {
                albums: 0,
                tracks: 0,
                merch:  merchCount
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// SECURITY & SETUP API
// ==========================================
router.get('/api/studio/check-status/:artistId', async (req, res) => {
    try {
        const db  = admin.firestore();
        const doc = await db.collection('artists').doc(req.params.artistId).get();
        if (!doc.exists) return res.status(404).json({ error: 'Artist not found' });

        const data = doc.data();
        res.json({
            needsSetup:   !data.ownerEmail,
            artistName:   data.name,
            artistHandle: data.handle
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/studio/setup-credentials', express.json(), async (req, res) => {
    try {
        const db = admin.firestore();
        const { artistId, email, password } = req.body;

        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: `Artist: ${artistId}`
        });

        await db.collection('artists').doc(artistId).update({
            ownerUid:  userRecord.uid,
            ownerEmail: email,
            status:    'active',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const customToken = await admin.auth().createCustomToken(userRecord.uid);
        res.json({ success: true, token: customToken });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// CATALOG API — artist's own songs + albums
// ==========================================
router.get('/api/studio/catalog', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();

        // Resolve artistId from ownerUid
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });
        const artistId = artistSnap.docs[0].id;

        const filter = req.query.filter || 'all'; // 'all' | 'singles' | 'albums'

        // Fetch songs (all tracks live in global 'songs' collection keyed by artistId)
        let songsQuery = db.collection('songs')
            .where('artistId', '==', artistId)
            .limit(200);

        const snap = await songsQuery.get();

        let songs = snap.docs.map(d => {
            const data = d.data();
            return {
                id:         d.id,
                title:      data.title      || 'Untitled',
                artUrl:     normalizeUrl(data.artUrl) || null,
                audioUrl:   data.audioUrl   || null,
                duration:   data.duration   || 0,
                genre:      data.genre      || null,
                bpm:        data.bpm        || null,
                key:        data.key        || null,
                mode:       data.mode       || null,
                energy:     data.energy     || null,
                isSingle:   data.isSingle   !== false,
                album:      data.album      || null,
                trackNumber:data.trackNumber|| null,
                plays:      data.stats?.plays || 0,
                likes:      data.stats?.likes || 0,
                uploadedAt: data.uploadedAt?.toMillis?.() || 0,
            };
        });

        // Sort newest first
        songs.sort((a, b) => b.uploadedAt - a.uploadedAt);

        // Filter
        if (filter === 'singles') songs = songs.filter(s => s.isSingle);
        if (filter === 'albums')  songs = songs.filter(s => !s.isSingle);

        // Strip internal sort field
        songs = songs.map(({ uploadedAt, ...rest }) => rest);

        // Also fetch album docs for album covers
        const albumsSnap = await db.collection('artists').doc(artistId)
            .collection('albums').orderBy('uploadedAt', 'desc').limit(50).get();
        const albums = albumsSnap.docs.map(d => ({
            id:         d.id,
            title:      d.data().title,
            artUrl:     normalizeUrl(d.data().artUrl) || null,
            trackCount: d.data().trackCount || 0,
            uploadedAt: d.data().uploadedAt?.toMillis?.() || 0,
        }));

        res.json({ songs, albums, artistId });
    } catch (e) {
        console.error('[catalog] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// posts_routes lives at routes/player_routes/ — go up one level from routes/artist/
const db = admin.firestore();
const postsRoutes = require('../player_routes/posts_routes')(db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL);
router.use('/', postsRoutes);

module.exports = router;