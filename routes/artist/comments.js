const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');

async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).json({ error: 'No authentication token provided' });
    try {
        const token   = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch (e) {
        res.status(403).json({ error: 'Invalid or expired session.' });
    }
}

// Resolve the artist ID for the authenticated user
async function getArtistIdForUid(uid) {
    const db   = admin.firestore();
    let snap   = await db.collection('artists').where('userId',    '==', uid).limit(1).get();
    if (snap.empty) snap = await db.collection('artists').where('ownerUid', '==', uid).limit(1).get();
    return snap.empty ? null : snap.docs[0].id;
}

// ──────────────────────────────────────────────────────────────────
// GET /api/studio/comments
// Aggregates recent comments across ALL posts for the dashboard inbox.
// Returns up to `limit` comments sorted newest-first.
// ──────────────────────────────────────────────────────────────────
router.get('/api/studio/comments', verifyUser, async (req, res) => {
    try {
        const db       = admin.firestore();
        const artistId = await getArtistIdForUid(req.uid);
        if (!artistId) return res.status(404).json({ error: 'Artist not found' });

        const limit         = parseInt(req.query.limit) || 20;
        const lastTimestamp = req.query.lastTimestamp;

        // Fetch the artist's posts (newest first, capped so we don't over-read)
        const postsSnap = await db.collection('artists').doc(artistId)
            .collection('posts')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        if (postsSnap.empty) return res.json({ comments: [], hasMore: false });

        // Pull comments from every post in parallel
        const allComments = [];
        await Promise.all(postsSnap.docs.map(async postDoc => {
            let q = postDoc.ref.collection('comments')
                .where('hidden', '==', false)
                .orderBy('createdAt', 'desc')
                .limit(limit);                     // per-post ceiling — prevents huge posts dominating

            if (lastTimestamp) q = q.startAfter(new Date(lastTimestamp));

            const snap = await q.get();
            snap.docs.forEach(doc => {
                const d = doc.data();
                allComments.push({
                    id:          doc.id,
                    postId:      postDoc.id,
                    postCaption: postDoc.data().caption || '',
                    postImage:   postDoc.data().imageUrl || '',
                    userId:      d.userId,
                    userName:    d.userName,
                    userHandle:  d.userHandle,
                    userAvatar:  d.userAvatar,
                    comment:     d.comment,
                    timestamp:   d.createdAt?.toDate() || new Date(),
                    likes:       d.likes       || 0,
                    artistReply: d.artistReply || null,
                    hidden:      d.hidden      || false,
                    read:        d.read        || false,
                });
            });
        }));

        // Sort all collected comments newest-first and page
        allComments.sort((a, b) => b.timestamp - a.timestamp);
        const page   = allComments.slice(0, limit);
        const hasMore = allComments.length > limit;

        res.json({ comments: page, hasMore });
    } catch (e) {
        console.error('Fetch Comments Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ──────────────────────────────────────────────────────────────────
// POST /api/studio/comments/mark-read
// Mark a specific comment as read.
// ──────────────────────────────────────────────────────────────────
router.post('/api/studio/comments/mark-read', verifyUser, express.json(), async (req, res) => {
    try {
        const db       = admin.firestore();
        const { commentId, postId } = req.body;
        if (!commentId || !postId) return res.status(400).json({ error: 'Missing commentId or postId' });

        const artistId = await getArtistIdForUid(req.uid);
        if (!artistId) return res.status(404).json({ error: 'Artist not found' });

        await db.collection('artists').doc(artistId)
            .collection('posts').doc(postId)
            .collection('comments').doc(commentId)
            .update({ read: true, readAt: admin.firestore.FieldValue.serverTimestamp() });

        res.json({ success: true });
    } catch (e) {
        console.error('Mark Read Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ──────────────────────────────────────────────────────────────────
// POST /api/studio/comments/flag
// Flag a comment as offensive.
// ──────────────────────────────────────────────────────────────────
router.post('/api/studio/comments/flag', verifyUser, express.json(), async (req, res) => {
    try {
        const db       = admin.firestore();
        const { commentId, postId, reason } = req.body;
        if (!commentId || !postId) return res.status(400).json({ error: 'Missing commentId or postId' });

        const artistId = await getArtistIdForUid(req.uid);
        if (!artistId) return res.status(404).json({ error: 'Artist not found' });

        const commentRef = db.collection('artists').doc(artistId)
            .collection('posts').doc(postId)
            .collection('comments').doc(commentId);

        if (!(await commentRef.get()).exists) return res.status(404).json({ error: 'Comment not found' });

        await commentRef.collection('reports').add({
            reportedBy:     req.uid,
            reportedByType: 'artist',
            reason:         reason || 'Offensive content',
            timestamp:      admin.firestore.FieldValue.serverTimestamp(),
        });
        await commentRef.update({ reported: true, reportedAt: admin.firestore.FieldValue.serverTimestamp() });

        res.json({ success: true });
    } catch (e) {
        console.error('Flag Comment Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ──────────────────────────────────────────────────────────────────
// DELETE /api/studio/comments/:commentId?postId=xxx
// Hide a comment (soft-delete, preserves record).
// ──────────────────────────────────────────────────────────────────
router.delete('/api/studio/comments/:commentId', verifyUser, async (req, res) => {
    try {
        const db       = admin.firestore();
        const { commentId } = req.params;
        const postId        = req.query.postId;
        if (!postId) return res.status(400).json({ error: 'Missing postId query param' });

        const artistId = await getArtistIdForUid(req.uid);
        if (!artistId) return res.status(404).json({ error: 'Artist not found' });

        const commentRef = db.collection('artists').doc(artistId)
            .collection('posts').doc(postId)
            .collection('comments').doc(commentId);

        if (!(await commentRef.get()).exists) return res.status(404).json({ error: 'Comment not found' });

        await commentRef.update({
            hidden:   true,
            hiddenAt: admin.firestore.FieldValue.serverTimestamp(),
            hiddenBy: req.uid,
        });

        res.json({ success: true });
    } catch (e) {
        console.error('Hide Comment Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ──────────────────────────────────────────────────────────────────
// GET /api/studio/comments/unread-count
// Count comments without artistReply across all posts.
// ──────────────────────────────────────────────────────────────────
router.get('/api/studio/comments/unread-count', verifyUser, async (req, res) => {
    try {
        const db       = admin.firestore();
        const artistId = await getArtistIdForUid(req.uid);
        if (!artistId) return res.status(404).json({ error: 'Artist not found' });

        // Fetch recent posts and count unreplied comments in parallel
        const postsSnap = await db.collection('artists').doc(artistId)
            .collection('posts')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        if (postsSnap.empty) return res.json({ count: 0 });

        let total = 0;
        await Promise.all(postsSnap.docs.map(async postDoc => {
            const snap = await postDoc.ref.collection('comments')
                .where('hidden', '==', false)
                .get();
            // Count comments that have no artist reply yet
            snap.docs.forEach(doc => {
                if (!doc.data().artistReply) total++;
            });
        }));

        res.json({ count: total });
    } catch (e) {
        console.error('Unread Count Error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;