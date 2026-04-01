const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");
const multer = require('multer');

// ==========================================
// 1. CONFIGURATION & R2 SETUP
// ==========================================
const r2 = require('../config/r2');
const JAMENDO_ID = process.env.JAMENDO_CLIENT_ID;
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const turso = require('../config/turso');

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
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

// ==========================================
// 3. HELPERS & MIDDLEWARE
// ==========================================

// Normalizes any stored image URL to use the canonical CDN_URL.
// Handles three cases:
//   1. Raw R2 dev URLs (pub-xxx.r2.dev) — saved before a custom domain was configured
//   2. Relative paths (no http prefix)
//   3. Already-correct CDN or external URLs (passed through unchanged)
const R2_DEV_PATTERN = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;

// ── Artist profile in-process cache ─────────────────────────────────────────
// Keyed by artistId. Stores the artist/tracks/albums payload (not currentUser
// — that's always fetched live per request). TTL = 5 min.
// Invalidated automatically on TTL expiry; artists who just updated their
// profile will see fresh data within 5 minutes.
const _profileCache = new Map(); // artistId → { payload, ts }
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
function normalizeUrl(url, fallback = null) {
    if (!url) return fallback;
    // Already has a protocol — only fix raw R2 dev domain
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return R2_DEV_PATTERN.test(url) ? url.replace(R2_DEV_PATTERN, CDN_URL) : url;
    }
    // Bare CDN hostname (e.g. "cdn.eporiamusic.com/artists/...") — just add https://
    const cdnHost = CDN_URL.replace(/^https?:\/\//, ''); // → "cdn.eporiamusic.com"
    if (url.startsWith(cdnHost)) return `https://${url}`;
    // Relative path — prepend full CDN base
    return `${CDN_URL}/${url.replace(/^\//, '')}`;
}

// Passed into crate_view.pug and artist_profile.pug as a template local
// so track durations render correctly server-side.
function formatTime(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Convert an artist name to a URL-safe slug: "My Artist!" → "my-artist" */
function slugify(str = '') {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // strip accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Resolve an artist Firestore doc from a slug (or legacy doc ID).
 *
 * Priority:
 *  1. `slug` field exact match  — fastest path, used for all newly created artists
 *  2. Slugified `name` match    — covers artists created before the slug field existed
 *  3. Raw Firestore doc ID       — backward-compat for any bookmarked /player/artist/:id URLs
 *
 * Side-effect: back-fills the `slug` field on first resolution via paths 2 or 3
 * so subsequent lookups hit path 1 immediately.
 */
async function resolveArtistBySlug(slug) {
    // 1. Slug field
    const bySlug = await db.collection('artists')
        .where('slug', '==', slug)
        .limit(1)
        .get();
    if (!bySlug.empty) return bySlug.docs[0];

    // 2. Name-based slug match (scan up to 200 docs — one-time cost until slug is back-filled)
    const allSnap = await db.collection('artists').limit(200).get();
    for (const doc of allSnap.docs) {
        if (slugify(doc.data().name || '') === slug) {
            doc.ref.update({ slug }).catch(() => {});
            return doc;
        }
    }

    // 3. Raw Firestore doc ID fallback
    try {
        const byId = await db.collection('artists').doc(slug).get();
        if (byId.exists) {
            const generatedSlug = slugify(byId.data().name || '');
            if (generatedSlug) byId.ref.update({ slug: generatedSlug }).catch(() => {});
            return byId;
        }
    } catch (_) { /* not a valid doc ID — ignore */ }

    return null;
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
                .where('userId', '==', uid)
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
    // verifyUser passes through for page routes even with no session,
    // so req.uid is undefined for guests — all guest branches below
    // use that to decide what data to fetch / what to render.
    const isGuest    = !req.uid;
    const currentUser = isGuest ? null : await getCurrentUser(req.uid);

    // Artist accounts don't belong in the player — redirect to their studio
    if (currentUser?._isArtist) {
        const dest = currentUser.artistId
            ? `/artist/studio?artistId=${currentUser.artistId}`
            : '/artist/login';
        return res.redirect(dest);
    }

    // Guests get a null location so the template and client JS both know
    // to request the global scene instead of a city-specific feed.
    let userLocation = { city: null, state: null };

    if (!isGuest && db) {
        try {
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userLocation = {
                    city:  userData.city  || null,
                    state: userData.state || null,
                };
            }
        } catch (error) {
            console.error('Error fetching user location:', error);
        }
    }

    res.render('dashboard', { 
        title:        'The Scene | Eporia',
        path:         '/player/dashboard',
        userLocation,
        currentUser,  // null for guests — player_shell.pug should render sign-in pill when null
        isGuest,      // convenience flag for Pug conditionals
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

router.get('/artist/:slug', verifyUser, async (req, res) => {
    try {
        const slug = req.params.slug;

        // ── 1. WRAPPER INTERCEPTOR: Jamendo Artists ────────────────────────
        if (slug.startsWith('jam_')) {
            const jamId = slug.split('_').pop(); // Extracts '12345' from 'jam_12345' or 'jam_art_12345'
            
            // Fetch Artist Info
            const artistRes = await fetch(`https://api.jamendo.com/v3.0/artists/?client_id=${JAMENDO_ID}&format=json&id=${jamId}`);
            const artistData = await artistRes.json();
            
            if (!artistData.results || artistData.results.length === 0) {
                return res.status(404).render('error', { message: "Verified Human Artist not found" });
            }
            
            const jArtist = artistData.results[0];
            
            // Fetch Artist's Top Tracks
            const tracksRes = await fetch(`https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_ID}&format=json&artist_id=${jamId}&limit=20&order=popularity_total&imagesize=300&audioformat=mp32`);
            const tracksData = await tracksRes.json();
            
            // Map to Eporia Native Schema
            const artist = {
                id: `jam_art_${jamId}`,
                name: jArtist.name || 'Unknown Artist',
                profileImage: normalizeUrl(jArtist.image, `${CDN_URL}/assets/default-avatar.jpg`),
                bannerImage: normalizeUrl(jArtist.image, null), 
                location: 'Independent Artist',
                bio: 'Verified human-created music curated via the Jamendo independent catalog.',
                musicProfile: { primaryGenre: 'Independent' },
                slug: slug,
                source: 'jamendo'
            };
            
            const tracks = (tracksData.results || []).map(t => ({
                id: `jam_${t.id}`,
                title: t.name,
                duration: t.duration || 0,
                artUrl: normalizeUrl(t.image, artist.profileImage),
                audioUrl: t.audio,
                artistId: artist.id
            }));
            
            const payload = {
                title: `${artist.name} | Eporia`,
                artist,
                tracks,
                albums: [],        // Wrapper artists won't have Eporia native albums yet
                initialPosts: [],  // Wrapper artists won't have community posts yet
                hasMorePosts: false,
                path: '/player/artist',
                formatTime: (seconds) => {
                    if (!seconds) return "-:--";
                    const m = Math.floor(seconds / 60);
                    const s = Math.floor(seconds % 60);
                    return `${m}:${s < 10 ? '0' : ''}${s}`;
                }
            };
            
            const currentUser = await getCurrentUser(req.uid);
            return res.render('artist_profile', { ...payload, currentUser });
        }

        // ── 2. NATIVE ROUTE: Eporia Artists ────────────────────────────────
        const artistDoc = await resolveArtistBySlug(slug);

        if (!artistDoc) {
            return res.status(404).render('error', { message: "Artist not found" });
        }

        const rawArtist = artistDoc.data();
        const artistId  = artistDoc.id;
        const canonicalSlug = rawArtist.slug || slugify(rawArtist.name || '');

        // Redirect old /player/artist/:id links to the canonical slug URL
        if (slug !== canonicalSlug && canonicalSlug) {
            return res.redirect(301, `/player/artist/${canonicalSlug}`);
        }

        // ── In-process cache check ─────────────────────────────────────────
        const cached = _profileCache.get(artistId);
        if (cached && (Date.now() - cached.ts) < PROFILE_CACHE_TTL_MS) {
            const currentUser = await getCurrentUser(req.uid);
            return res.render('artist_profile', { ...cached.payload, currentUser });
        }

        const artist = {
            ...rawArtist,
            id: artistId,
            slug: canonicalSlug,
            profileImage: normalizeUrl(
                rawArtist.profileImage || rawArtist.avatarUrl,
                `${CDN_URL}/assets/default-avatar.jpg`
            ),
            bannerImage: normalizeUrl(
                rawArtist.bannerImage || rawArtist.bannerUrl,
                null
            ),
        };

        // ── Parallel data fetch ────────────────────────────────────────────
        const [songsSnap, albumsSnap, postsResult] = await Promise.all([
            db.collection('songs')
                .where('artistId', '==', artistId)
                .orderBy('uploadedAt', 'desc')
                .limit(20)
                .get(),
            db.collection('artists').doc(artistId)
                .collection('albums')
                .orderBy('uploadedAt', 'desc')
                .limit(20)
                .get(),
            db.collection('artists').doc(artistId)
                .collection('posts')
                .orderBy('createdAt', 'desc')
                .limit(12)
                .get()
                .then(snap => ({ snap, err: null }))
                .catch(err  => ({ snap: null, err })),
        ]);

        const featuredIds = new Set(rawArtist.publicProfile?.featuredTrackIds || []);
        const tracks = [];
        songsSnap.forEach(doc => {
            if (featuredIds.size > 0 && !featuredIds.has(doc.id)) return;
            const data = doc.data();
            tracks.push({
                id:       doc.id,
                title:    data.title,
                duration: data.duration || 0,
                artUrl:   normalizeUrl(data.artUrl,   artist.profileImage || 'https://via.placeholder.com/150'),
                audioUrl: normalizeUrl(data.audioUrl, null),
            });
        });

        const albums = albumsSnap.docs.map(doc => {
            const d = doc.data();
            return {
                id:         doc.id,
                title:      d.title      || 'Untitled Album',
                artUrl:     normalizeUrl(d.artUrl, artist.profileImage || 'https://via.placeholder.com/150'),
                trackCount: d.trackCount || 0,
                uploadedAt: d.uploadedAt?.toDate() || new Date(),
            };
        });

        if (postsResult.err) {
            console.warn('[artist profile] posts fetch failed:', postsResult.err.message);
        }

        const initialPosts = (postsResult.snap?.docs || []).map(doc => {
            const d = doc.data();
            return {
                id:           doc.id,
                imageUrl:     normalizeUrl(d.imageUrl, null),
                caption:      d.caption      || '',
                createdAt:    d.createdAt?.toDate() || new Date(),
                likes:        d.likes        || 0,
                commentCount: d.commentCount || 0,
                likedByMe:    false, 
            };
        });
        const hasMorePosts = (postsResult.snap?.docs.length || 0) === 12;

        const payload = {
            title:      `${artist.name} | Eporia`,
            artist,
            tracks,
            albums,
            initialPosts,
            hasMorePosts,
            path:       '/player/artist',
            formatTime: (seconds) => {
                if (!seconds) return "-:--";
                const m = Math.floor(seconds / 60);
                const s = Math.floor(seconds % 60);
                return `${m}:${s < 10 ? '0' : ''}${s}`;
            }
        };

        _profileCache.set(artistId, { payload, ts: Date.now() });

        const currentUser = await getCurrentUser(req.uid);
        res.render('artist_profile', { ...payload, currentUser });

    } catch (e) {
        console.error("Artist Profile Error:", e);
        res.redirect('/player/dashboard');
    }
});

router.get('/crate/:id', verifyUser, async (req, res) => {
    try {
        const crateId       = req.params.id;
        const currentUserId = req.uid;

        // Flat collection — one document read, no collectionGroup needed
        const snap = await db.collection('crates').doc(crateId).get();

        if (!snap.exists) {
            return res.status(404).render('error', { message: "Crate not found" });
        }

        const crateData = snap.data();
        const ownerId   = crateData.creatorId;

        if (crateData.privacy === 'private' && currentUserId !== ownerId) {
            return res.status(403).render('error', { message: "This crate is private" });
        }

        // Use stored creator fields; back-fill from users doc for old records
        let creatorHandle = crateData.creatorHandle || null;
        let creatorAvatar = crateData.creatorAvatar || null;
        if (!creatorHandle && ownerId) {
            const ownerDoc = await db.collection('users').doc(ownerId).get();
            if (ownerDoc.exists) {
                creatorHandle = ownerDoc.data().handle   || null;
                creatorAvatar = creatorAvatar || ownerDoc.data().photoURL || null;
            }
        }

        const enrichedCrate = {
            id: crateId,
            ownerId,
            ...crateData,
            tracks: (crateData.tracks || []).map(track => ({
                ...track,
                artUrl:   normalizeUrl(track.artUrl || track.img, 'https://via.placeholder.com/150'),
                img:      normalizeUrl(track.img    || track.artUrl, 'https://via.placeholder.com/150'),
                audioUrl: normalizeUrl(track.audioUrl, null),
            })),
            creatorHandle: creatorHandle || 'Anonymous',
            creatorAvatar: creatorAvatar ? normalizeUrl(creatorAvatar) : null,
            creatorId:     ownerId,
        };

        const crateDataJson = JSON.stringify({
            id:            enrichedCrate.id,
            title:         enrichedCrate.title,
            creatorHandle: enrichedCrate.creatorHandle || null,
            creatorId:     enrichedCrate.creatorId     || null,
            coverImage:    enrichedCrate.coverImage    || null,
            likes:         enrichedCrate.likes         || 0,
            tracks: (enrichedCrate.tracks || []).map(t => ({
                id:       t.id,
                title:    t.title,
                artist:   t.artist,
                artUrl:   normalizeUrl(t.artUrl || t.img, null),
                audioUrl: normalizeUrl(t.audioUrl, null),
                duration: t.duration || 0,
                artistId: t.artistId || t.ownerId || t.uid || null,
            })),
        });

        res.render('crate_view', {
            title: `${crateData.title} | Eporia`,
            crateId,
            crate: enrichedCrate,
            crateDataJson,
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
const walletRoutes  = require('./player_routes/wallet')(db, turso, verifyUser);
const profileRoutes     = require('./player_routes/profile')(db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL);
const connectionsRoutes = require('./player_routes/connections')(db, verifyUser);
const settingsRoutes    = require('./player_routes/settings')(db, verifyUser);
const likesRoutes       = require('./player_routes/likes')(db, verifyUser);
const cratesRoutes      = require('./player_routes/crates')(db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL);
const dashboardRoutes   = require('./player_routes/dashboard')(db, verifyUser, CDN_URL);
const communityRoutes   = require('./player_routes/community')(db, verifyUser);
const postsRoutes       = require('./player_routes/posts_routes')(db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL);
// Single-request bundle: replaces the 5 independent API calls that fire on
// every page load (wallet, sidebar-artists, likes/ids, notifications, follow/check)
const bundleRoutes  = require('./player_routes/init_bundle')(db, verifyUser, turso);

router.use('/', walletRoutes);
router.use('/', profileRoutes);
router.use('/', connectionsRoutes);
router.use('/', settingsRoutes);
router.use('/', likesRoutes);
router.use('/', cratesRoutes);
router.use('/', dashboardRoutes);
router.use('/', communityRoutes);
router.use('/', postsRoutes);
router.use('/', bundleRoutes);

module.exports = router;