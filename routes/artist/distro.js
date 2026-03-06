/* routes/artist/distro.js
 * ─────────────────────────────────────────────────────────────
 * Distribution Management API
 *
 * Mounts under /artist — register in your main app as:
 *   app.use('/artist', require('./routes/artist/distro'));
 * ─────────────────────────────────────────────────────────────
 */

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const { DistributionController, DISTRO_STATUS } = require('../../services/distroService');

// Default provider — override per request via ?provider=revelator
const DEFAULT_PROVIDER = process.env.DISTRO_PROVIDER || 'sonosuite';

// ==========================================
// MIDDLEWARE: VERIFY USER
// (same pattern as studio.js / upload.js)
// ==========================================
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).json({ error: 'No authentication token provided' });
    try {
        const token   = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch {
        res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
    }
}

// ==========================================
// HELPER: VERIFY ARTIST OWNERSHIP
// Returns { artistDoc, artistData } or throws 403
// ==========================================
async function verifyArtistOwnership(uid, artistId) {
    const db  = admin.firestore();
    const doc = await db.collection('artists').doc(artistId).get();
    if (!doc.exists) throw Object.assign(new Error('Artist not found'), { status: 404 });
    if (doc.data().ownerUid !== uid) throw Object.assign(new Error('Forbidden'), { status: 403 });
    return { artistDoc: doc, artistData: doc.data() };
}

// ==========================================
// HELPER: VERIFY SONG OWNERSHIP
// ==========================================
async function verifySongOwnership(uid, songId) {
    const db      = admin.firestore();
    const songDoc = await db.collection('songs').doc(songId).get();
    if (!songDoc.exists) throw Object.assign(new Error('Song not found'), { status: 404 });

    const song       = songDoc.data();
    const artistDoc  = await db.collection('artists').doc(song.artistId).get();
    if (!artistDoc.exists || artistDoc.data().ownerUid !== uid) {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return { songDoc, song };
}

// ──────────────────────────────────────────────────────────────
// GET /api/studio/distribution/status/:songId
// Returns current distribution metadata for a single track.
// ──────────────────────────────────────────────────────────────
router.get('/api/studio/distribution/status/:songId', verifyUser, async (req, res) => {
    try {
        const { songDoc, song } = await verifySongOwnership(req.uid, req.params.songId);

        res.json({
            songId:      songDoc.id,
            title:       song.title,
            isrc:        song.isrc        || null,
            upc:         song.upc         || null,
            distroStatus: song.distroStatus || DISTRO_STATUS.NONE,
            distroProvider: song.distroProvider || null,
            externalIds: song.externalIds || {},
            distroQueuedAt:    song.distroQueuedAt?.toDate()    || null,
            distroSubmittedAt: song.distroSubmittedAt?.toDate() || null,
            distroLastCheck:   song.distroLastCheck?.toDate()   || null,
            error: song.distroError || null
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// GET /api/studio/distribution/catalog/:artistId
// Lists all tracks with their distribution status for an artist.
// ──────────────────────────────────────────────────────────────
router.get('/api/studio/distribution/catalog/:artistId', verifyUser, async (req, res) => {
    try {
        await verifyArtistOwnership(req.uid, req.params.artistId);

        const db       = admin.firestore();
        const snapshot = await db.collection('songs')
            .where('artistId', '==', req.params.artistId)
            .orderBy('uploadedAt', 'desc')
            .get();

        const tracks = snapshot.docs.map(doc => {
            const d = doc.data();
            return {
                songId:       doc.id,
                title:        d.title,
                artUrl:       d.artUrl   || null,
                isrc:         d.isrc     || null,
                upc:          d.upc      || null,
                distroStatus: d.distroStatus || DISTRO_STATUS.NONE,
                externalIds:  d.externalIds  || {},
                uploadedAt:   d.uploadedAt?.toDate() || null
            };
        });

        // Tally counts per status for the dashboard summary card
        const summary = Object.values(DISTRO_STATUS).reduce((acc, s) => {
            if (s) acc[s] = tracks.filter(t => t.distroStatus === s).length;
            return acc;
        }, { not_queued: tracks.filter(t => !t.distroStatus).length });

        res.json({ tracks, summary, total: tracks.length });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /api/studio/distribution/submit
// Manually submit a queued track to the distribution provider.
// Body: { songId, provider? }
// ──────────────────────────────────────────────────────────────
router.post('/api/studio/distribution/submit', verifyUser, express.json(), async (req, res) => {
    try {
        const { songId, provider } = req.body;
        if (!songId) return res.status(400).json({ error: 'songId required' });

        const { song } = await verifySongOwnership(req.uid, songId);

        // Guard: must have ISRC before submitting
        if (!song.isrc) {
            return res.status(400).json({
                error: 'Track has no ISRC. Re-upload or assign one before distributing.'
            });
        }

        // Guard: don't double-submit live tracks
        if (song.distroStatus === DISTRO_STATUS.LIVE) {
            return res.status(409).json({ error: 'Track is already live on DSPs.' });
        }

        const ctrl   = new DistributionController(provider || DEFAULT_PROVIDER);
        const result = await ctrl.submitTrack(songId);

        res.json({ success: true, ...result });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /api/studio/distribution/refresh/:songId
// Poll the provider for a status update on an in-flight track.
// ──────────────────────────────────────────────────────────────
router.post('/api/studio/distribution/refresh/:songId', verifyUser, async (req, res) => {
    try {
        const { songDoc, song } = await verifySongOwnership(req.uid, req.params.songId);

        if (!song.distroProvider) {
            return res.status(400).json({ error: 'Track has not been submitted to a provider yet.' });
        }

        const ctrl   = new DistributionController(song.distroProvider);
        const result = await ctrl.refreshStatus(songDoc.id);

        res.json({ success: true, ...result });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /api/studio/distribution/takedown
// Request a DSP takedown for a live track.
// Body: { songId, reason? }
// ──────────────────────────────────────────────────────────────
router.post('/api/studio/distribution/takedown', verifyUser, express.json(), async (req, res) => {
    try {
        const { songId, reason = 'artist_request' } = req.body;
        if (!songId) return res.status(400).json({ error: 'songId required' });

        const { song } = await verifySongOwnership(req.uid, songId);

        if (song.distroStatus !== DISTRO_STATUS.LIVE) {
            return res.status(400).json({
                error: `Cannot take down a track that is not live. Current status: ${song.distroStatus}`
            });
        }

        const ctrl = new DistributionController(song.distroProvider || DEFAULT_PROVIDER);
        await ctrl.requestTakedown(songId, reason);

        res.json({ success: true, status: DISTRO_STATUS.TAKEDOWN });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /api/studio/distribution/webhook
// Receive status-update callbacks from the active provider.
// Providers call this URL when a release goes live, fails, etc.
//
// IMPORTANT: Register this URL in your provider dashboard as:
//   https://yourdomain.com/artist/api/studio/distribution/webhook
// ──────────────────────────────────────────────────────────────
router.post('/api/studio/distribution/webhook', express.json(), async (req, res) => {
    // Verify the webhook came from your provider using a shared secret
    const webhookSecret = process.env.DISTRO_WEBHOOK_SECRET;
    const incomingSecret = req.headers['x-webhook-secret'] || req.headers['x-api-key'];

    if (webhookSecret && incomingSecret !== webhookSecret) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    try {
        const db      = admin.firestore();
        const payload = req.body;

        // Expected payload shape (normalize from your provider's actual format):
        // { songId, providerId, providerStatus, dsps: { spotify, apple, tidal } }
        const { songId, providerStatus, dsps = {} } = payload;

        if (!songId || !providerStatus) {
            return res.status(400).json({ error: 'Missing songId or providerStatus' });
        }

        // Determine which provider sent this (via header or body field)
        const providerName = req.headers['x-provider'] || payload.provider || DEFAULT_PROVIDER;
        const ctrl         = new DistributionController(providerName);
        const internalStatus = ctrl.adapter.mapStatus(providerStatus);

        await db.collection('songs').doc(songId).update({
            distroStatus:    internalStatus,
            externalIds:     dsps,
            distroLastCheck: admin.firestore.FieldValue.serverTimestamp()
        });

        await db.collection('distribution_queue').doc(songId).update({
            status:    internalStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`🔔 Webhook received for [${songId}]: ${providerStatus} → ${internalStatus}`);
        res.json({ received: true });

    } catch (err) {
        console.error('Webhook processing error:', err.message);
        // Always respond 200 to provider so they don't retry indefinitely
        res.json({ received: true, error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// PATCH /api/studio/distribution/identifiers
// Manually assign ISRC/UPC to a track (e.g. if artist already
// owns registered codes from a prior deal).
// Body: { songId, isrc?, upc? }
// ──────────────────────────────────────────────────────────────
router.patch('/api/studio/distribution/identifiers', verifyUser, express.json(), async (req, res) => {
    try {
        const { songId, isrc, upc } = req.body;
        if (!songId)        return res.status(400).json({ error: 'songId required' });
        if (!isrc && !upc)  return res.status(400).json({ error: 'Provide at least one of: isrc, upc' });

        const { song } = await verifySongOwnership(req.uid, songId);

        // Prevent overwriting an ISRC on a live track
        if (song.distroStatus === DISTRO_STATUS.LIVE) {
            return res.status(409).json({
                error: 'Cannot modify identifiers on a live track. Request a takedown first.'
            });
        }

        // Basic ISRC format validation: CC-XXX-YY-NNNNN (17 chars with dashes)
        if (isrc) {
            const isrcRegex = /^[A-Z]{2}-[A-Z0-9]{3}-\d{2}-\d{5}$/;
            if (!isrcRegex.test(isrc)) {
                return res.status(400).json({ error: 'Invalid ISRC format. Expected: CC-XXX-YY-NNNNN' });
            }
        }

        // Basic UPC validation: 12 digits
        if (upc) {
            if (!/^\d{12}$/.test(upc)) {
                return res.status(400).json({ error: 'Invalid UPC format. Expected: 12 digits' });
            }
        }

        const updates = {};
        if (isrc) updates.isrc = isrc;
        if (upc)  updates.upc  = upc;
        updates.distroIdentifiersUpdatedAt = admin.firestore.FieldValue.serverTimestamp();

        await admin.firestore().collection('songs').doc(songId).update(updates);

        res.json({ success: true, songId, ...updates });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

module.exports = router;