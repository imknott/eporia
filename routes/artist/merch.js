/**
 * routes/artist/merch.js
 *
 * Artist-facing merch CRUD + photo upload.
 *
 * FIXES:
 *   1. express.json() at router level — req.body always parsed before verifyArtist.
 *   2. Ownership check uses ownerUid (matches studio.js setup-credentials).
 *   3. multer before verifyArtist on multipart routes.
 *
 * ADDED:
 *   4. sampleTrack field on merch items — links to a song from the artist's
 *      catalog OR a standalone merch-sample audio file uploaded via
 *      POST /artist/api/upload-merch-sample (in upload.js).
 *   5. GET /artist/api/merch/my-songs — returns artist's catalog for the
 *      "link existing song" picker in the merch studio UI.
 *
 * Firestore schema  artists/{artistId}/merch/{itemId}:
 *   id              string
 *   artistId        string
 *   category        'clothing'|'vinyl'|'digital'|'artwork'|'bundle'|'other'
 *   name            string
 *   description     string
 *   price           number
 *   stock           number | null
 *   status          'active'|'draft'|'sold_out'
 *   fulfillment     'self'|'digital_auto'
 *   photos          string[]   (CDN URLs, up to 4)
 *   sampleTrack     object | null
 *     songId        string | null   (songs/{songId} ref if linked from catalog)
 *     streamUrl     string | null   (audio URL for the mini player)
 *     title         string | null
 *     artUrl        string | null
 *     duration      number | null   (seconds)
 *   clothingType    string | null
 *   sizes           string[]
 *   vinylFormat     string | null
 *   digitalFormat   string | null
 *   shipFromAddress string | null
 *   shippingRates   object | null
 *   createdAt       timestamp
 *   updatedAt       timestamp
 */

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const multer  = require('multer');
const r2      = require('../../config/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || 'https://cdn.eporiamusic.com';
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const db     = admin.apps.length ? admin.firestore() : null;

// ─────────────────────────────────────────────────────────────
// Parse JSON at router level — must be before verifyArtist
// ─────────────────────────────────────────────────────────────
router.use(express.json());

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────
async function verifyArtist(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded  = await admin.auth().verifyIdToken(token);
        req.uid        = decoded.uid;
        // Treat empty string the same as missing — empty string passes || but is invalid
        const _raw     = req.body?.artistId || req.query?.artistId || req.params?.artistId;
        const artistId = (_raw && typeof _raw === 'string' && _raw.trim()) ? _raw.trim() : null;

        if (artistId) {
            const artistDoc = await db.collection('artists').doc(artistId).get();
            if (!artistDoc.exists) return res.status(404).json({ error: 'Artist not found' });
            if (artistDoc.data().ownerUid !== req.uid) {
                return res.status(403).json({ error: 'Forbidden: not your artist account' });
            }
        }

        req.artistId = artistId;
        next();
    } catch (e) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}

function merchRef(artistId) {
    return db.collection('artists').doc(artistId).collection('merch');
}

// ─────────────────────────────────────────────────────────────
// PUBLIC — active items for storefront (no auth)
// GET /artist/api/merch/public?artistId=xxx
// ─────────────────────────────────────────────────────────────
router.get('/api/merch/public', async (req, res) => {
    const { artistId } = req.query;
    if (!artistId) return res.status(400).json({ error: 'artistId required' });
    try {
        const snap = await merchRef(artistId)
            .where('status', '==', 'active')
            .orderBy('createdAt', 'desc')
            .get();
        res.json({ items: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// CATALOG SEARCH — for the "link existing song" picker
// GET /artist/api/merch/my-songs?artistId=xxx&q=searchterm
//
// Returns the artist's own songs collection so they can pick
// one to use as a merch item sample track.
// ─────────────────────────────────────────────────────────────
router.get('/api/merch/my-songs', verifyArtist, async (req, res) => {
    try {
        // verifyArtist sets req.artistId — but double-check so Firestore
        // never receives undefined/null as a where() value.
        if (!req.artistId) {
            return res.status(400).json({ error: 'artistId is required' });
        }
        const q = (req.query.q || '').toLowerCase().trim();

        // NOTE: Do NOT use .orderBy() here — combining where() on 'artistId'
        // with orderBy() on 'uploadedAt' requires a composite Firestore index.
        // Without it the query silently returns zero results or throws 400.
        // We sort in JS after fetching instead.
        const snap = await db.collection('songs')
            .where('artistId', '==', req.artistId)
            .limit(200)
            .get();

        let songs = snap.docs.map(d => {
            const data = d.data();
            return {
                id:        d.id,
                title:     data.title          || 'Untitled',
                artUrl:    data.artUrl         || null,
                // upload.js saves the playback URL as 'audioUrl' — map it here
                streamUrl: data.audioUrl       || data.streamUrl || null,
                duration:  data.duration       || null,
                // Show album name for album tracks so the picker is informative
                album:     (!data.isSingle && data.album) ? data.album : null,
                uploadedAt: data.uploadedAt?.toMillis?.() || 0,
            };
        });

        // Sort newest first in memory
        songs.sort((a, b) => b.uploadedAt - a.uploadedAt);

        // Text filter across title and album
        if (q) {
            songs = songs.filter(s =>
                s.title.toLowerCase().includes(q) ||
                (s.album || '').toLowerCase().includes(q)
            );
        }

        // Strip internal sort field before sending
        songs = songs.map(({ uploadedAt, ...rest }) => rest);

        res.json({ songs });
    } catch (e) {
        console.error('[merch] my-songs error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// AUTHENTICATED — list all items including drafts
// GET /artist/api/merch?artistId=xxx
// ─────────────────────────────────────────────────────────────
router.get('/api/merch', verifyArtist, async (req, res) => {
    try {
        if (!req.artistId) return res.status(400).json({ error: 'artistId is required' });
        const snap = await merchRef(req.artistId)
            .orderBy('createdAt', 'desc')
            .get();
        res.json({ items: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// GET single item
// GET /artist/api/merch/:itemId?artistId=xxx
// ─────────────────────────────────────────────────────────────
router.get('/api/merch/:itemId', verifyArtist, async (req, res) => {
    try {
        const doc = await merchRef(req.artistId).doc(req.params.itemId).get();
        if (!doc.exists) return res.status(404).json({ error: 'Item not found' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// CREATE
// POST /artist/api/merch
// Body (JSON): { artistId, category, name, price, sampleTrack?, ... }
// ─────────────────────────────────────────────────────────────
router.post('/api/merch', verifyArtist, async (req, res) => {
    try {
        const itemData = sanitizeMerchPayload(req.body);
        itemData.artistId  = req.artistId;
        itemData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        itemData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        const ref = await merchRef(req.artistId).add(itemData);
        await ref.update({ id: ref.id });

        res.json({ success: true, id: ref.id });
    } catch (e) {
        console.error('[merch] create error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// UPDATE
// PUT /artist/api/merch/:itemId
// ─────────────────────────────────────────────────────────────
router.put('/api/merch/:itemId', verifyArtist, async (req, res) => {
    try {
        const itemData    = sanitizeMerchPayload(req.body);
        itemData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await merchRef(req.artistId).doc(req.params.itemId).update(itemData);
        res.json({ success: true });
    } catch (e) {
        console.error('[merch] update error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// DELETE
// DELETE /artist/api/merch/:itemId?artistId=xxx
// ─────────────────────────────────────────────────────────────
router.delete('/api/merch/:itemId', verifyArtist, async (req, res) => {
    try {
        await merchRef(req.artistId).doc(req.params.itemId).delete();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// PHOTO UPLOAD
// POST /artist/api/merch/upload-photo
// multipart/form-data: photo (file), artistId, slot (0-3)
// multer before verifyArtist so multipart body is ready
// ─────────────────────────────────────────────────────────────
router.post('/api/merch/upload-photo', upload.single('photo'), verifyArtist, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    // Reject non-image files — prevents audio/video blobs rendering as blank images
    if (!req.file.mimetype.startsWith('image/')) {
        return res.status(400).json({ error: 'File must be an image (jpg, png, webp, gif)' });
    }
    try {
        const slot  = parseInt(req.body.slot || '0');
        const ext   = req.file.mimetype === 'image/png'  ? 'png'
                    : req.file.mimetype === 'image/webp' ? 'webp'
                    : req.file.mimetype === 'image/gif'  ? 'gif'
                    : 'jpg';
        const r2Key = `artists/${req.artistId}/merch/${Date.now()}_slot${slot}.${ext}`;

        await r2.send(new PutObjectCommand({
            Bucket:      BUCKET_NAME,
            Key:         r2Key,
            Body:        req.file.buffer,
            ContentType: req.file.mimetype
        }));

        res.json({ success: true, url: `${CDN_URL}/${r2Key}` });
    } catch (e) {
        console.error('[merch] photo upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// SAMPLE AUDIO UPLOAD
// POST /artist/api/upload-merch-sample
// multipart/form-data: audioFile (file), artistId, title
//
// Stores a short audio clip to R2 and returns a streamUrl the
// merch item's sampleTrack field. Duration is passed from the
// client (measured via Web Audio API before upload).
//
// Returns: { success, streamUrl, title, duration }
// ─────────────────────────────────────────────────────────────
const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 30 * 1024 * 1024 }   // 30 MB max for a sample clip
});

router.post('/api/upload-merch-sample',
    audioUpload.single('audioFile'),
    verifyArtist,
    async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

        // Validate it is actually an audio file
        if (!req.file.mimetype.startsWith('audio/')) {
            return res.status(400).json({ error: 'File must be an audio file (mp3, wav, flac, aac, ogg)' });
        }

        try {
            const title    = (req.body.title || '').trim().slice(0, 200) || 'Untitled Sample';
            const duration = req.body.duration ? (parseFloat(req.body.duration) || null) : null;

            // Pick a clean extension from the mimetype
            const mimeExtMap = {
                'audio/mpeg':  'mp3',
                'audio/mp3':   'mp3',
                'audio/wav':   'wav',
                'audio/x-wav': 'wav',
                'audio/flac':  'flac',
                'audio/x-flac':'flac',
                'audio/aac':   'aac',
                'audio/ogg':   'ogg',
                'audio/webm':  'webm',
            };
            const ext   = mimeExtMap[req.file.mimetype] || 'mp3';
            const r2Key = `artists/${req.artistId}/merch-samples/${Date.now()}_${title.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.${ext}`;

            await r2.send(new PutObjectCommand({
                Bucket:      BUCKET_NAME,
                Key:         r2Key,
                Body:        req.file.buffer,
                ContentType: req.file.mimetype
            }));

            const streamUrl = `${CDN_URL}/${r2Key}`;

            res.json({ success: true, streamUrl, title, duration });
        } catch (e) {
            console.error('[merch] sample audio upload error:', e);
            res.status(500).json({ error: e.message });
        }
    }
);

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const VALID_CATEGORIES = ['clothing', 'vinyl', 'digital', 'artwork', 'bundle', 'other'];
const VALID_STATUSES   = ['active', 'draft', 'sold_out'];

function sanitizeMerchPayload(body) {
    const {
        category, name, description, price, stock, status,
        photos, clothingType, sizes, vinylFormat, digitalFormat,
        shipFromAddress, shippingRates, sampleTrack
    } = body;

    if (!VALID_CATEGORIES.includes(category)) throw new Error('Invalid category');
    if (!name?.trim())                         throw new Error('Name is required');
    if (!price || isNaN(price) || Number(price) <= 0) throw new Error('Invalid price');

    const isDigital = category === 'digital';

    // ── Shipping rates ──────────────────────────────────────────
    let sanitizedRates = null;
    if (!isDigital && shippingRates) {
        const sr = (r) => ({
            first:      Math.max(0, parseFloat(r?.first)      || 0),
            additional: Math.max(0, parseFloat(r?.additional) || 0)
        });
        sanitizedRates = {
            usDomestic:            sr(shippingRates.usDomestic),
            canada:                sr(shippingRates.canada),
            europe:                sr(shippingRates.europe),
            restOfWorld:           sr(shippingRates.restOfWorld),
            freeShippingEnabled:   !!shippingRates.freeShippingEnabled,
            freeShippingThreshold: shippingRates.freeShippingEnabled
                ? (parseFloat(shippingRates.freeShippingThreshold) || null)
                : null
        };
    }

    // ── Sample track ────────────────────────────────────────────
    // Accepts either a linked catalog song or a standalone upload URL.
    // If neither songId nor streamUrl is present, store null.
    let sanitizedSample = null;
    if (sampleTrack && (sampleTrack.songId || sampleTrack.streamUrl)) {
        sanitizedSample = {
            songId:    sampleTrack.songId    || null,
            streamUrl: sampleTrack.streamUrl || null,
            title:     sampleTrack.title
                ? String(sampleTrack.title).trim().slice(0, 200)
                : null,
            artUrl:    sampleTrack.artUrl  || null,
            duration:  sampleTrack.duration != null
                ? Number(sampleTrack.duration) || null
                : null
        };
    }

    return {
        category,
        name:            String(name).trim().slice(0, 120),
        description:     String(description || '').trim().slice(0, 1000),
        price:           Number(parseFloat(price).toFixed(2)),
        stock:           stock ? parseInt(stock) : null,
        status:          VALID_STATUSES.includes(status) ? status : 'draft',
        fulfillment:     isDigital ? 'digital_auto' : 'self',
        photos:          Array.isArray(photos) ? photos.filter(Boolean).slice(0, 4) : [],
        sampleTrack:     sanitizedSample,
        clothingType:    clothingType  || null,
        sizes:           Array.isArray(sizes) ? sizes : [],
        vinylFormat:     vinylFormat   || null,
        digitalFormat:   digitalFormat || null,
        shipFromAddress: !isDigital && shipFromAddress
            ? String(shipFromAddress).trim().slice(0, 200)
            : null,
        shippingRates:   sanitizedRates
    };
}

module.exports = router;