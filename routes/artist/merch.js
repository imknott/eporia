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
        const artistId = req.body?.artistId || req.query?.artistId || req.params?.artistId;

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
        const q = (req.query.q || '').toLowerCase().trim();

        const snap = await db.collection('songs')
            .where('artistId', '==', req.artistId)
            .orderBy('uploadedAt', 'desc')
            .limit(100)
            .get();

        let songs = snap.docs.map(d => {
            const data = d.data();
            return {
                id:        d.id,
                title:     data.title     || 'Untitled',
                artUrl:    data.artUrl    || null,
                streamUrl: data.audioUrl  || null,
                duration:  data.duration  || null,
                album:     data.album     || null,
            };
        });

        // Client-side text filter (Firestore full-text search requires index)
        if (q) {
            songs = songs.filter(s =>
                s.title.toLowerCase().includes(q) ||
                (s.album || '').toLowerCase().includes(q)
            );
        }

        res.json({ songs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// AUTHENTICATED — list all items including drafts
// GET /artist/api/merch?artistId=xxx
// ─────────────────────────────────────────────────────────────
router.get('/api/merch', verifyArtist, async (req, res) => {
    try {
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
    try {
        const slot  = parseInt(req.body.slot || '0');
        const ext   = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
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