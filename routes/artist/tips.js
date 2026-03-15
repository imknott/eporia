/* routes/artist/tips.js
 * ─────────────────────────────────────────────────────────────
 * Artist Tip Notifications
 *
 * Reads tip records written by wallet.js into the hierarchical
 * earnings path: earnings/{year}/artists/{artistId}/{month}/{id}
 * where type === 'tip'.
 *
 * Tip notification read-state is tracked separately in:
 *   artists/{artistId}/tipNotifications/{earningsDocId}
 *     { read: bool, readAt: timestamp }
 *
 * This keeps the earnings records immutable (source of truth
 * for payouts) while still letting the studio mark tips read.
 * ─────────────────────────────────────────────────────────────
 */

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const turso = require('../../config/turso');

// ==========================================
// MIDDLEWARE: VERIFY USER
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
// HELPER: RESOLVE artistId FROM uid
// ==========================================
async function getArtistIdForUid(uid) {
    const db = admin.firestore();
    const snap = await db.collection('artists')
        .where('ownerUid', '==', uid)
        .limit(1)
        .get();
    if (snap.empty) throw Object.assign(new Error('No artist profile found'), { status: 404 });
    return snap.docs[0].id;
}

// ──────────────────────────────────────────────────────────────
// GET /api/studio/tips
//
// Returns recent tip notifications for the logged-in artist.
// Queries the last 3 months of earnings records so tips don't
// disappear at month rollover, annotates each with read state.
//
// Query params:
//   limit  — max results (default 30)
//   unread — 'true' to return only unread tips
// ──────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────
// GET /api/studio/tips
// ──────────────────────────────────────────────────────────────
router.get('/api/studio/tips', verifyUser, async (req, res) => {
    try {
        const db       = admin.firestore();
        const artistId = await getArtistIdForUid(req.uid);
        const limit    = Math.min(parseInt(req.query.limit) || 30, 100);
        const unreadOnly = req.query.unread === 'true';

        // 1. Fetch tip transactions from Turso
        const tipsResult = await turso.execute({
            sql: `SELECT id, amount_cents, sender_id, created_at
                  FROM transactions
                  WHERE receiver_id = ? AND transaction_type = 'artist_payout'
                  ORDER BY created_at DESC
                  LIMIT ?`,
            args: [artistId, limit]
        });

        if (tipsResult.rows.length === 0) {
            return res.json({ tips: [], total: 0, unreadCount: 0 });
        }

        // 2. Fetch read states from Firestore in one query
        const readSnap = await db.collection('artists')
            .doc(artistId)
            .collection('tipNotifications')
            .get();
        const readMap = {};
        readSnap.forEach(doc => { readMap[doc.id] = doc.data(); });

        // 3. Batch-fetch all unique fan user docs in parallel (no N+1)
        const uniqueSenderIds = [...new Set(tipsResult.rows.map(r => r.sender_id))];
        const fanDocs = await Promise.all(
            uniqueSenderIds.map(uid => db.collection('users').doc(uid).get())
        );
        const handleMap = {};
        fanDocs.forEach(doc => {
            handleMap[doc.id] = doc.exists ? (doc.data().handle || 'A fan') : 'A fan';
        });

        // 4. Combine and optionally filter
        const rawTips = tipsResult.rows
            .map(row => ({
                id:        row.id,
                fromUser:  row.sender_id,
                handle:    handleMap[row.sender_id] || 'A fan',
                amount:    row.amount_cents / 100,
                timestamp: row.created_at,
                read:      readMap[row.id]?.read || false,
            }))
            .filter(t => !unreadOnly || !t.read);

        const unreadCount = rawTips.filter(t => !t.read).length;

        res.json({ tips: rawTips, total: rawTips.length, unreadCount });

    } catch (err) {
        console.error('[tips] fetch error:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /api/studio/tips/:tipId/read
// Mark a single tip notification as read.
// ──────────────────────────────────────────────────────────────
router.post('/api/studio/tips/:tipId/read', verifyUser, async (req, res) => {
    try {
        const db       = admin.firestore();
        const artistId = await getArtistIdForUid(req.uid);

        await db.collection('artists')
            .doc(artistId)
            .collection('tipNotifications')
            .doc(req.params.tipId)
            .set({
                read:   true,
                readAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

        res.json({ success: true });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /api/studio/tips/read-all
// Mark all unread tip notifications as read in a single batch.
// ──────────────────────────────────────────────────────────────
router.post('/api/studio/tips/read-all', verifyUser, async (req, res) => {
    try {
        const db       = admin.firestore();
        const artistId = await getArtistIdForUid(req.uid);

        // Fetch unread tip IDs from Turso — source of truth for transactions
        const tipsResult = await turso.execute({
            sql: `SELECT id FROM transactions
                  WHERE receiver_id = ? AND transaction_type = 'artist_payout'
                  ORDER BY created_at DESC
                  LIMIT 200`,
            args: [artistId]
        });

        if (tipsResult.rows.length === 0) {
            return res.json({ success: true, marked: 0 });
        }

        // Find which ones aren't already marked read in Firestore
        const readSnap = await db.collection('artists')
            .doc(artistId)
            .collection('tipNotifications')
            .where('read', '==', true)
            .get();
        const alreadyRead = new Set(readSnap.docs.map(d => d.id));

        const unreadIds = tipsResult.rows
            .map(r => r.id)
            .filter(id => !alreadyRead.has(id));

        if (unreadIds.length === 0) {
            return res.json({ success: true, marked: 0 });
        }

        // Batch-mark all as read in Firestore
        const batch     = db.batch();
        const notifRef  = db.collection('artists').doc(artistId).collection('tipNotifications');
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        unreadIds.forEach(id => {
            batch.set(notifRef.doc(id), { read: true, readAt: timestamp }, { merge: true });
        });
        await batch.commit();

        res.json({ success: true, marked: unreadIds.length });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// GET /api/studio/tips/unread-count
// Lightweight endpoint for the nav badge — returns just the count.
// ──────────────────────────────────────────────────────────────
router.get('/api/studio/tips/unread-count', verifyUser, async (req, res) => {
    try {
        const db       = admin.firestore();
        const artistId = await getArtistIdForUid(req.uid);

        // Count tips from Turso (last 30 days is enough for a badge)
        const sinceTs = Math.floor(Date.now() / 1000) - (30 * 86400);
        const [tipsResult, readSnap] = await Promise.all([
            turso.execute({
                sql: `SELECT id FROM transactions
                      WHERE receiver_id = ? AND transaction_type = 'artist_payout'
                        AND created_at >= ?`,
                args: [artistId, sinceTs]
            }),
            db.collection('artists').doc(artistId)
                .collection('tipNotifications')
                .where('read', '==', true)
                .get()
        ]);

        const readIds = new Set(readSnap.docs.map(d => d.id));
        const unread  = tipsResult.rows.filter(r => !readIds.has(r.id)).length;

        res.json({ unreadCount: unread });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

module.exports = router;