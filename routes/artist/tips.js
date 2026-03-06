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
router.get('/api/studio/tips', verifyUser, async (req, res) => {
    try {
        const db       = admin.firestore();
        const artistId = await getArtistIdForUid(req.uid);
        const limit    = Math.min(parseInt(req.query.limit) || 30, 100);
        const unreadOnly = req.query.unread === 'true';

        // Build the list of month subcollection names to query
        // (current month + 2 prior months so tips survive rollover)
        const monthKeys = [];
        const now = new Date();
        for (let i = 0; i < 3; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthKeys.push({
                year:  d.getFullYear().toString(),
                month: String(d.getMonth() + 1).padStart(2, '0')
            });
        }

        // Fetch read-state map for this artist
        const readSnap = await db.collection('artists')
            .doc(artistId)
            .collection('tipNotifications')
            .get();

        const readMap = {};
        readSnap.forEach(doc => { readMap[doc.id] = doc.data(); });

        // Query each month's subcollection for tip records
        const rawTips = [];
        for (const { year, month } of monthKeys) {
            try {
                const snap = await db
                    .collection('earnings')
                    .doc(year)
                    .collection('artists')
                    .doc(artistId)
                    .collection(month)
                    .where('type', '==', 'tip')
                    .orderBy('timestamp', 'desc')
                    .limit(limit)
                    .get();

                snap.forEach(doc => {
                    const d    = doc.data();
                    const read = readMap[doc.id]?.read || false;
                    if (unreadOnly && read) return;
                    rawTips.push({
                        id:        doc.id,
                        fromUser:  d.fromUser    || null,
                        handle:    d.userHandle  || 'A fan',
                        amount:    d.amount      || 0,
                        message:   d.message     || null,  // optional tip message (future)
                        timestamp: d.timestamp?.toDate()?.toISOString() || null,
                        read
                    });
                });
            } catch (monthErr) {
                // Month subcollection may not exist yet — non-fatal
                if (!monthErr.message?.includes('NOT_FOUND')) {
                    console.warn(`[tips] query warn ${year}/${month}:`, monthErr.message);
                }
            }
        }

        // Sort all results by timestamp desc and apply overall limit
        rawTips.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const tips = rawTips.slice(0, limit);

        // Unread count across all fetched tips (regardless of unreadOnly filter)
        const unreadCount = Object.values(readMap).filter(v => !v.read).length +
            rawTips.filter(t => !t.read && !readMap[t.id]).length;

        res.json({
            tips,
            total:       tips.length,
            unreadCount: Math.max(0, unreadCount)
        });

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

        // Re-fetch unread tip IDs from the last 3 months
        const monthKeys = [];
        const now = new Date();
        for (let i = 0; i < 3; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthKeys.push({
                year:  d.getFullYear().toString(),
                month: String(d.getMonth() + 1).padStart(2, '0')
            });
        }

        const readSnap = await db.collection('artists')
            .doc(artistId)
            .collection('tipNotifications')
            .get();
        const alreadyRead = new Set(
            readSnap.docs.filter(d => d.data().read).map(d => d.id)
        );

        const tipIds = [];
        for (const { year, month } of monthKeys) {
            try {
                const snap = await db
                    .collection('earnings').doc(year)
                    .collection('artists').doc(artistId)
                    .collection(month)
                    .where('type', '==', 'tip')
                    .get();
                snap.forEach(doc => {
                    if (!alreadyRead.has(doc.id)) tipIds.push(doc.id);
                });
            } catch { /* non-fatal */ }
        }

        if (tipIds.length > 0) {
            const batch     = db.batch();
            const notifRef  = db.collection('artists').doc(artistId).collection('tipNotifications');
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            tipIds.forEach(id => {
                batch.set(notifRef.doc(id), { read: true, readAt: timestamp }, { merge: true });
            });
            await batch.commit();
        }

        res.json({ success: true, marked: tipIds.length });
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

        const now = new Date();
        const year  = now.getFullYear().toString();
        const month = String(now.getMonth() + 1).padStart(2, '0');

        // Count total tips this month
        const [tipsSnap, readSnap] = await Promise.all([
            db.collection('earnings').doc(year)
              .collection('artists').doc(artistId)
              .collection(month)
              .where('type', '==', 'tip')
              .get(),
            db.collection('artists').doc(artistId)
              .collection('tipNotifications')
              .where('read', '==', true)
              .get()
        ]);

        const readIds   = new Set(readSnap.docs.map(d => d.id));
        const unread    = tipsSnap.docs.filter(d => !readIds.has(d.id)).length;

        res.json({ unreadCount: unread });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

module.exports = router;