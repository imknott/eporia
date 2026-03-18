/* routes/artist/studio_theme.js
 *
 * Page-theme customisation + image upload routes for the Artist Studio.
 *
 * Mount in artist.js:
 *   const themeRouter = require('./artist/studio_theme');
 *   router.use('/', themeRouter);
 *
 * Routes
 * ──────
 *   GET  /api/studio/page-theme        — load current theme + image URLs
 *   POST /api/studio/page-theme        — save theme JSON (colours, style, focal point)
 *   POST /api/studio/upload-avatar     — Cropper.js output → R2 → avatarUrl
 *   POST /api/studio/upload-banner     — Cropper.js output → R2 → bannerUrl + focal point
 *   POST /api/studio/upload-bg-image   — optional full-page background texture → R2
 *   DELETE /api/studio/bg-image        — remove page background image
 *
 * Firestore shape written:
 *   artists/{artistId}.publicProfile.theme  = { accentColor, bgColor, cardColor,
 *     textColor, textMutedColor, btnBgColor, btnTextColor, buttonStyle,
 *     bgImageUrl, bgImageStyle, bannerFocalX, bannerFocalY }
 *   artists/{artistId}.avatarUrl  = CDN URL
 *   artists/{artistId}.bannerUrl  = CDN URL
 */

'use strict';

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const multer  = require('multer');
const r2      = require('../../config/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

// ── CDN / bucket config (mirrors studio.js) ──────────────────────────────────
const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || 'https://cdn.eporiamusic.com';
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// Images only, max 10 MB
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are accepted'), false);
        }
        cb(null, true);
    },
});

// ── Auth middleware ───────────────────────────────────────────────────────────
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).json({ error: 'No authentication token provided' });
    try {
        const token   = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch {
        res.status(403).json({ error: 'Invalid or expired session.' });
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getArtistDoc(uid) {
    const snap = await admin.firestore()
        .collection('artists')
        .where('ownerUid', '==', uid)
        .limit(1)
        .get();
    return snap.empty ? null : snap.docs[0];
}

async function uploadToR2(buffer, mimeType, key) {
    await r2.send(new PutObjectCommand({
        Bucket:       BUCKET_NAME,
        Key:          key,
        Body:         buffer,
        ContentType:  mimeType,
        CacheControl: 'public, max-age=31536000',
    }));
    return `${CDN_URL}/${key}`;
}

// ── Theme whitelist & defaults ────────────────────────────────────────────────
const THEME_DEFAULTS = {
    accentColor:    '#00FFD1',
    bgColor:        '#050505',
    cardColor:      '#111111',
    textColor:      '#FFFFFF',
    textMutedColor: '#888888',
    btnBgColor:     '#00FFD1',
    btnTextColor:   '#000000',
    buttonStyle:    'neon',     // 'neon' | 'solid' | 'minimal'
    bgImageUrl:     null,
    bgImageStyle:   'cover',    // 'cover' | 'tile'
    bannerFocalX:   50,         // 0–100, → background-position X%
    bannerFocalY:   50,         // 0–100, → background-position Y%
};

const COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/;

function sanitizeTheme(raw = {}) {
    const hex = (v, def) => (typeof v === 'string' && COLOR_RE.test(v.trim())) ? v.trim().toLowerCase() : def;
    const pct = (v, def) => {
        const n = parseFloat(v);
        return (!isNaN(n) && n >= 0 && n <= 100) ? n : def;
    };
    const pick = (v, list, def) => list.includes(v) ? v : def;
    const safeUrl = v => (typeof v === 'string' && v.startsWith('https://')) ? v : null;

    return {
        accentColor:    hex(raw.accentColor,    THEME_DEFAULTS.accentColor),
        bgColor:        hex(raw.bgColor,        THEME_DEFAULTS.bgColor),
        cardColor:      hex(raw.cardColor,      THEME_DEFAULTS.cardColor),
        textColor:      hex(raw.textColor,      THEME_DEFAULTS.textColor),
        textMutedColor: hex(raw.textMutedColor, THEME_DEFAULTS.textMutedColor),
        btnBgColor:     hex(raw.btnBgColor,     THEME_DEFAULTS.btnBgColor),
        btnTextColor:   hex(raw.btnTextColor,   THEME_DEFAULTS.btnTextColor),
        buttonStyle:    pick(raw.buttonStyle,   ['neon', 'solid', 'minimal'], THEME_DEFAULTS.buttonStyle),
        bgImageUrl:     safeUrl(raw.bgImageUrl),
        bgImageStyle:   pick(raw.bgImageStyle,  ['cover', 'tile'],            THEME_DEFAULTS.bgImageStyle),
        bannerFocalX:   pct(raw.bannerFocalX,   THEME_DEFAULTS.bannerFocalX),
        bannerFocalY:   pct(raw.bannerFocalY,   THEME_DEFAULTS.bannerFocalY),
    };
}

// ── Normalise a CDN URL stored with old/missing protocol ─────────────────────
function normalizeUrl(url) {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
}

// =============================================================================
// GET /api/studio/page-theme
// Returns the artist's saved theme plus their current avatar / banner URLs.
// =============================================================================
router.get('/api/studio/page-theme', verifyUser, async (req, res) => {
    try {
        const artistDoc = await getArtistDoc(req.uid);
        if (!artistDoc) return res.status(404).json({ error: 'Artist not found' });

        const data  = artistDoc.data();
        const pp    = data.publicProfile || {};
        const theme = { ...THEME_DEFAULTS, ...(pp.theme || {}) };

        res.json({
            theme,
            avatarUrl: normalizeUrl(data.avatarUrl || data.profileImage) || null,
            bannerUrl: normalizeUrl(data.bannerUrl  || data.bannerImage)  || null,
        });
    } catch (e) {
        console.error('[page-theme] GET error:', e);
        res.status(500).json({ error: e.message });
    }
});

// =============================================================================
// POST /api/studio/page-theme
// Saves colour swatches, button style, background image style, and focal point.
// Does NOT handle binary image uploads (those live in the dedicated endpoints
// below so we can stream them to R2 without JSON size limits).
// =============================================================================
router.post('/api/studio/page-theme', verifyUser, express.json(), async (req, res) => {
    try {
        const artistDoc = await getArtistDoc(req.uid);
        if (!artistDoc) return res.status(404).json({ error: 'Artist not found' });

        const theme = sanitizeTheme(req.body.theme || {});

        await artistDoc.ref.update({
            'publicProfile.theme':     theme,
            'publicProfile.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ success: true, theme });
    } catch (e) {
        console.error('[page-theme] POST error:', e);
        res.status(500).json({ error: e.message });
    }
});

// =============================================================================
// POST /api/studio/upload-avatar
// Accepts a 1:1-cropped JPEG/PNG blob from Cropper.js.
// Stores to R2 under artists/{id}/avatar_{timestamp}.{ext}
// and writes the resulting CDN URL to artists/{id}.avatarUrl.
// =============================================================================
router.post('/api/studio/upload-avatar', verifyUser, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file provided' });

        const artistDoc = await getArtistDoc(req.uid);
        if (!artistDoc) return res.status(404).json({ error: 'Artist not found' });

        const ext = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
        const key = `artists/${artistDoc.id}/avatar_${Date.now()}.${ext}`;
        const url = await uploadToR2(req.file.buffer, req.file.mimetype, key);

        await artistDoc.ref.update({
            avatarUrl:  url,
            updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[upload-avatar] ${artistDoc.id} → ${url}`);
        res.json({ success: true, url });
    } catch (e) {
        console.error('[upload-avatar] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// =============================================================================
// POST /api/studio/upload-banner
// Accepts a banner image from Cropper.js (any aspect ratio the artist chose).
// Also accepts optional form fields:
//   bannerFocalX  (float 0–100)  — background-position X
//   bannerFocalY  (float 0–100)  — background-position Y
// Both focal-point values are persisted into publicProfile.theme so the
// public profile page can render background-position: X% Y% without an
// extra Firestore round-trip.
// =============================================================================
router.post('/api/studio/upload-banner', verifyUser, upload.single('banner'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file provided' });

        const artistDoc = await getArtistDoc(req.uid);
        if (!artistDoc) return res.status(404).json({ error: 'Artist not found' });

        const ext = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
        const key = `artists/${artistDoc.id}/banner_${Date.now()}.${ext}`;
        const url = await uploadToR2(req.file.buffer, req.file.mimetype, key);

        const focalX = parseFloat(req.body.bannerFocalX);
        const focalY = parseFloat(req.body.bannerFocalY);
        const safeX  = (!isNaN(focalX) && focalX >= 0 && focalX <= 100) ? focalX : 50;
        const safeY  = (!isNaN(focalY) && focalY >= 0 && focalY <= 100) ? focalY : 50;

        await artistDoc.ref.update({
            bannerUrl:                          url,
            'publicProfile.theme.bannerFocalX': safeX,
            'publicProfile.theme.bannerFocalY': safeY,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[upload-banner] ${artistDoc.id} → ${url} fp=(${safeX}%, ${safeY}%)`);
        res.json({ success: true, url, focalX: safeX, focalY: safeY });
    } catch (e) {
        console.error('[upload-banner] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// =============================================================================
// POST /api/studio/upload-bg-image
// Optional full-page background texture / atmospheric image.
// =============================================================================
router.post('/api/studio/upload-bg-image', verifyUser, upload.single('bgImage'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file provided' });

        const artistDoc = await getArtistDoc(req.uid);
        if (!artistDoc) return res.status(404).json({ error: 'Artist not found' });

        const ext = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
        const key = `artists/${artistDoc.id}/page_bg_${Date.now()}.${ext}`;
        const url = await uploadToR2(req.file.buffer, req.file.mimetype, key);

        await artistDoc.ref.update({
            'publicProfile.theme.bgImageUrl': url,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ success: true, url });
    } catch (e) {
        console.error('[upload-bg-image] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// =============================================================================
// DELETE /api/studio/bg-image
// Clears the page background image (sets bgImageUrl to null).
// Does NOT delete the R2 object — keep it in case they want to re-enable.
// =============================================================================
router.delete('/api/studio/bg-image', verifyUser, async (req, res) => {
    try {
        const artistDoc = await getArtistDoc(req.uid);
        if (!artistDoc) return res.status(404).json({ error: 'Artist not found' });

        await artistDoc.ref.update({
            'publicProfile.theme.bgImageUrl': null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[delete-bg-image] error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;