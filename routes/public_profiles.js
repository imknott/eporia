/* routes/public_profile.js
 *
 * Public-facing profile pages — no authentication required.
 * Mounted at root level in app.js (e.g. app.use('/', publicProfileRoutes))
 *
 * Page routes  (render views without player shell):
 *   GET /artist/:slug          → public artist profile
 *   GET /u/:handle             → public user profile
 *
 * API routes  (JSON, no auth):
 *   GET /api/public/artist/:slug   → artist data + top tracks
 *   GET /api/public/user/:handle   → user data + public crates
 *
 * Slug strategy:
 *   Artists  → `slug` field on the Firestore doc (set at creation / first load).
 *              Falls back to: (1) slugified `name`, (2) raw Firestore doc ID for
 *              any old in-player links that still use the ID.
 *   Users    → `handle` field already exists (e.g. "@cooluser"), URL uses the
 *              bare handle without the @ sign.
 */

const express = require('express');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert any string into a URL-safe slug: "My Artist Name!" → "my-artist-name" */
function slugify(str = '') {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // strip accent marks
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')       // non-alphanumeric → hyphen
        .replace(/^-+|-+$/g, '');          // trim leading/trailing hyphens
}

const R2_DEV_PATTERN = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;

function normalizeUrl(url, cdnUrl, fallback = null) {
    if (!url) return fallback;
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return R2_DEV_PATTERN.test(url) ? url.replace(R2_DEV_PATTERN, cdnUrl) : url;
    }
    const cdnHost = cdnUrl.replace(/^https?:\/\//, '');
    if (url.startsWith(cdnHost)) return `https://${url}`;
    return `${cdnUrl}/${url.replace(/^\//, '')}`;
}

function formatTime(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ---------------------------------------------------------------------------
// Theme CSS builder
//
// Converts publicProfile.theme (stored in Firestore) into:
//   1. A CSS custom-property inline style string → injected onto the
//      `.artist-pub-themed` wrapper div in the public_artist_profile.pug
//      template, scoping all overrides to that artist's page.
//   2. A `themeData` object passed separately for data-* attributes
//      (buttonStyle, bgImageStyle) that drive CSS selectors.
//
// Usage in public_artist_profile.pug:
//   .artist-pub-themed(
//     style=themeVars
//     data-btn-style=themeData.buttonStyle
//     data-bg-style=themeData.bgImageStyle
//   )
// ---------------------------------------------------------------------------
const THEME_DEFAULTS_PUBLIC = {
    accentColor:    '#00ffd1',
    bgColor:        '#050505',
    cardColor:      '#111111',
    textColor:      '#ffffff',
    textMutedColor: '#888888',
    btnBgColor:     '#00ffd1',
    btnTextColor:   '#000000',
    buttonStyle:    'neon',
    bgImageUrl:     null,
    bgImageStyle:   'cover',
    bannerFocalX:   50,
    bannerFocalY:   50,
};

function buildThemeVars(rawTheme = {}) {
    const t = { ...THEME_DEFAULTS_PUBLIC, ...rawTheme };

    // Build inline style string with CSS custom properties
    const vars = [
        `--pp-accent:${t.accentColor}`,
        `--pp-bg:${t.bgColor}`,
        `--pp-card:${t.cardColor}`,
        `--pp-text:${t.textColor}`,
        `--pp-muted:${t.textMutedColor}`,
        `--pp-btn-bg:${t.btnBgColor}`,
        `--pp-btn-text:${t.btnTextColor}`,
    ];

    // Guard: only emit the CSS url() for genuine https:// CDN URLs.
    // Firestore can contain null, the JS string 'null', or a bare path from
    // an old upload — any of these produce url('null') which the browser
    // treats as a hostname and logs ERR_NAME_NOT_RESOLVED on the public page.
    const safeBgUrl = typeof t.bgImageUrl === 'string' && t.bgImageUrl.startsWith('https://') ? t.bgImageUrl : null;
    if (safeBgUrl) {
        vars.push(`--pp-bg-image:url('${safeBgUrl}')`);
    }

    return vars.join(';');
}

// ---------------------------------------------------------------------------
// Artist slug resolution
//
// Priority:
//   1. Exact `slug` field match  (fastest, requires slug field to be populated)
//   2. Exact `name` slugify match (for artists created before slug field existed)
//   3. Raw Firestore document ID  (backward-compat for any old /player/artist/:id links)
//
// As a side-effect, if the doc is found via path 2 or 3 and has no `slug` field,
// we write the slug back so future lookups hit path 1.
// ---------------------------------------------------------------------------
async function resolveArtistBySlug(db, slug) {
    // 1. Slug field
    const bySlug = await db.collection('artists')
        .where('slug', '==', slug)
        .limit(1)
        .get();

    if (!bySlug.empty) {
        return bySlug.docs[0];
    }

    // 2. Scan by slugified name (limited to 200 docs — acceptable for name-match bootstrap)
    //    In production you'd run a one-time migration to populate `slug` on all artist docs.
    const allSnap = await db.collection('artists').limit(200).get();
    for (const doc of allSnap.docs) {
        const data = doc.data();
        if (slugify(data.name || '') === slug) {
            // Back-fill slug so future lookups are instant
            doc.ref.update({ slug }).catch(() => {});
            return doc;
        }
    }

    // 3. Raw Firestore ID fallback (backward-compat with old /player/artist/:id links)
    try {
        const byId = await db.collection('artists').doc(slug).get();
        if (byId.exists) {
            const name = byId.data().name || '';
            const generatedSlug = slugify(name);
            if (generatedSlug) {
                byId.ref.update({ slug: generatedSlug }).catch(() => {});
            }
            return byId;
        }
    } catch (_) {
        // slug string isn't a valid Firestore ID — ignore
    }

    return null;
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------
module.exports = (db, CDN_URL) => {
    const router = express.Router();

    const norm = (url, fallback = null) => normalizeUrl(url, CDN_URL, fallback);

    // ========================================================================
    // PAGE ROUTES  — render views WITHOUT the player shell
    // ========================================================================

    // ── Public Artist Profile ────────────────────────────────────────────────
    router.get('/artist/:slug', async (req, res) => {
        try {
            const artistDoc = await resolveArtistBySlug(db, req.params.slug);

            if (!artistDoc) {
                return res.status(404).render('public_not_found', {
                    title: 'Artist not found | Eporia',
                    message: 'This artist profile does not exist.'
                });
            }

            const raw = artistDoc.data();
            const artistId = artistDoc.id;
            const canonicalSlug = raw.slug || slugify(raw.name || '');

            // Redirect to canonical slug if they arrived via an old ID URL
            if (req.params.slug !== canonicalSlug && canonicalSlug) {
                return res.redirect(301, `/artist/${canonicalSlug}`);
            }

            const artist = {
                ...raw,
                id: artistId,
                slug: canonicalSlug,
                profileImage: norm(
                    raw.profileImage || raw.avatarUrl,
                    `${CDN_URL}/assets/default-avatar.jpg`
                ),
                bannerImage: norm(raw.bannerImage || raw.bannerUrl, null),
            };

            // Top tracks — explicitly exclude plays from the public shape
            const songsSnap = await db.collection('songs')
                .where('artistId', '==', artistId)
                .orderBy('uploadedAt', 'desc')
                .limit(20)
                .get();

            const allTracks = songsSnap.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    title: d.title || 'Untitled',
                    // plays intentionally excluded — play counts create popularity bias
                    duration: d.duration || 0,
                    durationFormatted: formatTime(d.duration),
                    artUrl: norm(d.artUrl, artist.profileImage),
                    album: d.album || null,
                    genre: d.genre || null,
                    digitalPrice: d.digitalPrice || null,
                };
            });

            // Featured tracks — artist-curated subset, with 30-second preview URL
            const featuredIds  = new Set(artist.publicProfile?.featuredTrackIds || []);
            const featuredTracks = featuredIds.size > 0
                ? allTracks
                    .filter(t => featuredIds.has(t.id))
                    .slice(0, 6)
                    .map(t => {
                        // Find the full song doc to get the audio URL
                        const doc = songsSnap.docs.find(d => d.id === t.id);
                        const audioUrl = doc ? norm(doc.data().audioUrl, null) : null;
                        return {
                            ...t,
                            // previewUrl exposed only for featured tracks — 30s enforced client-side
                            previewUrl: audioUrl || null,
                        };
                    })
                : [];
            const tracks = allTracks.slice(0, 10);

            // Social links + credits from publicProfile
            const socialLinks = artist.publicProfile?.socialLinks || {};
            const credits     = artist.publicProfile?.credits    || {};
            const bandMembers = credits.bandMembers || [];
            const producers   = credits.producers   || [];

            // ── Theme ─────────────────────────────────────────────────────
            // Build the CSS custom-property string and pass data-* values so
            // the pug template can scope all overrides to .artist-pub-themed.
            const rawTheme  = raw.publicProfile?.theme || {};
            const themeVars = buildThemeVars(rawTheme);
            const themeData = {
                buttonStyle:  rawTheme.buttonStyle  || 'neon',
                bgImageStyle: rawTheme.bgImageStyle || 'cover',
            };

            // Passed separately so public_artist_profile.pug can apply them to
            // the <body> (full-bleed) rather than the constrained content wrapper.
            const themeBgColor    = rawTheme.bgColor || '#050505';
            const themeBgImageUrl = (
                typeof rawTheme.bgImageUrl === 'string' &&
                rawTheme.bgImageUrl.startsWith('https://')
            ) ? rawTheme.bgImageUrl : null;

            // Banner background-position from the artist-set focal point
            const bannerFocalX = rawTheme.bannerFocalX ?? 50;
            const bannerFocalY = rawTheme.bannerFocalY ?? 50;
            const bannerPosition = `${bannerFocalX}% ${bannerFocalY}%`;

            // Albums
            const albumsSnap = await db.collection('artists').doc(artistId)
                .collection('albums')
                .orderBy('uploadedAt', 'desc')
                .limit(10)
                .get();

            const albums = albumsSnap.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    title: d.title || 'Untitled Album',
                    artUrl: norm(d.artUrl, artist.profileImage),
                    trackCount: d.trackCount || 0,
                };
            });

            res.render('public_artist_profile', {
                title: `${artist.name} | Eporia`,
                artist,
                tracks,
                featuredTracks,
                albums,
                socialLinks,
                bandMembers,
                producers,
                acknowledgements: credits.acknowledgements || null,
                canonicalUrl: `${process.env.APP_URL || 'https://eporiamusic.com'}/artist/${canonicalSlug}`,
                playerUrl: `/player/artist/${canonicalSlug}`,
                formatTime,
                themeVars,
                themeData,
                bannerPosition,
                themeBgColor,
                themeBgImageUrl,
            });

        } catch (e) {
            console.error('Public artist profile error:', e);
            res.status(500).render('public_error', { message: 'Could not load this profile.' });
        }
    });

    // ── Public User Profile ──────────────────────────────────────────────────
    router.get('/u/:handle', async (req, res) => {
        try {
            const rawHandle = req.params.handle;
            const cleanHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;

            const snap = await db.collection('users')
                .where('handle', '==', cleanHandle)
                .limit(1)
                .get();

            if (snap.empty) {
                return res.status(404).render('public_not_found', {
                    title: 'User not found | Eporia',
                    message: 'This user profile does not exist.'
                });
            }

            const userDoc = snap.docs[0];
            const uid = userDoc.id;
            const userData = userDoc.data();

            // Public crates — flat collection, filter by creatorId
            const cratesSnap = await db.collection('crates')
                .where('creatorId', '==', uid)
                .where('privacy', '==', 'public')
                .orderBy('createdAt', 'desc')
                .limit(12)
                .get();

            const crates = cratesSnap.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    title: d.title || 'Untitled Crate',
                    trackCount: d.metadata?.trackCount || 0,
                    coverImage: norm(
                        d.coverImage || d.tracks?.[0]?.artUrl || d.tracks?.[0]?.img,
                        `${CDN_URL}/assets/placeholder_art.jpg`
                    ),
                    genres: d.metadata?.genres || [],
                };
            });

            const handle = userData.handle || `@${rawHandle}`;
            const bareHandle = handle.replace('@', '');

            res.render('public_user_profile', {
                title: `${handle} | Eporia`,
                user: {
                    uid,
                    handle,
                    bio: userData.bio || '',
                    photoURL: norm(userData.photoURL, `${CDN_URL}/assets/default-avatar.jpg`),
                    coverURL: norm(userData.coverURL, null),
                    joinDate: userData.joinDate || null,
                    role: userData.role || 'member',
                    location: userData.location || null,
                },
                crates,
                canonicalUrl: `${process.env.APP_URL || 'https://eporiamusic.com'}/u/${bareHandle}`,
                playerUrl: `/player/u/${bareHandle}`,
            });

        } catch (e) {
            console.error('Public user profile error:', e);
            res.status(500).render('public_error', { message: 'Could not load this profile.' });
        }
    });

    // ========================================================================
    // JSON API ROUTES  — consumed by public-page client JS if needed
    // ========================================================================

    // GET /api/public/artist/:slug
    router.get('/api/public/artist/:slug', async (req, res) => {
        try {
            const artistDoc = await resolveArtistBySlug(db, req.params.slug);
            if (!artistDoc) return res.status(404).json({ error: 'Artist not found' });

            const raw = artistDoc.data();
            const artistId = artistDoc.id;

            const songsSnap = await db.collection('songs')
                .where('artistId', '==', artistId)
                .orderBy('uploadedAt', 'desc')
                .limit(10)
                .get();

            const tracks = songsSnap.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    title: d.title || 'Untitled',
                    // plays intentionally excluded
                    duration: d.duration || 0,
                    durationFormatted: formatTime(d.duration),
                    artUrl: norm(d.artUrl, null),
                    // audioUrl intentionally omitted — auth required to stream
                };
            });

            res.json({
                id: artistId,
                slug: raw.slug || slugify(raw.name || ''),
                name: raw.name || '',
                bio: raw.bio || '',
                location: raw.location || '',
                profileImage: norm(raw.profileImage || raw.avatarUrl, `${CDN_URL}/assets/default-avatar.jpg`),
                bannerImage: norm(raw.bannerImage || raw.bannerUrl, null),
                primaryGenre: raw.musicProfile?.primaryGenre || raw.primaryGenre || null,
                subgenres: raw.musicProfile?.subgenres || raw.subgenres || [],
                followers: raw.stats?.followers || 0,
                tracks,
                playerUrl: `/player/artist/${raw.slug || slugify(raw.name || '')}`,
            });

        } catch (e) {
            console.error('Public artist API error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/public/user/:handle
    router.get('/api/public/user/:handle', async (req, res) => {
        try {
            const rawHandle = req.params.handle;
            const cleanHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;

            const snap = await db.collection('users')
                .where('handle', '==', cleanHandle)
                .limit(1)
                .get();

            if (snap.empty) return res.status(404).json({ error: 'User not found' });

            const userDoc = snap.docs[0];
            const uid = userDoc.id;
            const d = userDoc.data();

            const cratesSnap = await db.collection('crates')
                .where('creatorId', '==', uid)
                .where('privacy', '==', 'public')
                .orderBy('createdAt', 'desc')
                .limit(12)
                .get();

            const crates = cratesSnap.docs.map(doc => {
                const cd = doc.data();
                return {
                    id: doc.id,
                    title: cd.title || 'Untitled Crate',
                    trackCount: cd.metadata?.trackCount || 0,
                    coverImage: norm(
                        cd.coverImage || cd.tracks?.[0]?.artUrl || cd.tracks?.[0]?.img,
                        `${CDN_URL}/assets/placeholder_art.jpg`
                    ),
                    genres: cd.metadata?.genres || [],
                    playerUrl: `/player/crate/${doc.id}`,
                };
            });

            const handle = d.handle || cleanHandle;
            res.json({
                uid,
                handle,
                bio: d.bio || '',
                location: d.location || null,
                photoURL: norm(d.photoURL, `${CDN_URL}/assets/default-avatar.jpg`),
                coverURL: norm(d.coverURL, null),
                joinDate: d.joinDate || null,
                role: d.role || 'member',
                crates,
                playerUrl: `/player/u/${handle.replace('@', '')}`,
            });

        } catch (e) {
            console.error('Public user API error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};