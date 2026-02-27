
const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");


async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).json({ error: "No authentication token provided" });

    try {
        const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch (error) { 
        res.status(403).json({ error: "Invalid or expired session." }); 
    }
}

// ==========================================
// ARTIST COMMENT MANAGEMENT API
// (Artists READ comments created by players, don't create them)
// ==========================================

// GET: Fetch comments for the artist (from their wall)
router.get('/api/studio/comments', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();
        // Find artist profile for this user
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;
        const limit = parseInt(req.query.limit) || 20;
        const lastTimestamp = req.query.lastTimestamp;

        // Fetch comments from the artist's subcollection
        let query = db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .where('hidden', '==', false)
            .orderBy('timestamp', 'desc')
            .limit(limit);

        if (lastTimestamp) {
            query = query.startAfter(new Date(lastTimestamp));
        }

        const commentsSnap = await query.get();

        const comments = [];
        commentsSnap.forEach(doc => {
            const data = doc.data();
            comments.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp ? data.timestamp.toDate() : new Date()
            });
        });

        res.json({ 
            comments,
            hasMore: comments.length === limit
        });

    } catch (e) {
        console.error("Fetch Comments Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// POST: Mark comment as read
router.post('/api/studio/comments/mark-read', verifyUser, express.json(), async (req, res) => {
    try {
        const { commentId } = req.body;
        if (!commentId) return res.status(400).json({ error: "Missing comment ID" });

        // Find artist profile
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;

        // Update the comment to mark as read
        await db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .doc(commentId)
            .update({ 
                read: true,
                readAt: admin.firestore.FieldValue.serverTimestamp()
            });

        res.json({ success: true });

    } catch (e) {
        console.error("Mark Read Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// POST: Flag comment as offensive
router.post('/api/studio/comments/flag', verifyUser, express.json(), async (req, res) => {
    try {
        const { commentId, reason } = req.body;
        if (!commentId) return res.status(400).json({ error: "Missing comment ID" });

        // Find artist profile
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;

        const commentRef = db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .doc(commentId);

        const commentDoc = await commentRef.get();
        if (!commentDoc.exists) {
            return res.status(404).json({ error: "Comment not found" });
        }

        // Add to reports subcollection
        await commentRef.collection('reports').add({
            reportedBy: req.uid,
            reportedByType: 'artist',
            reason: reason || 'Offensive content',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mark comment as reported
        await commentRef.update({ 
            reported: true,
            reportedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true });

    } catch (e) {
        console.error("Flag Comment Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// DELETE: Hide/delete a comment from artist's wall
router.delete('/api/studio/comments/:commentId', verifyUser, async (req, res) => {
    try {
        const { commentId } = req.params;

        // Find artist profile
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;

        const commentRef = db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .doc(commentId);

        const commentDoc = await commentRef.get();
        if (!commentDoc.exists) {
            return res.status(404).json({ error: "Comment not found" });
        }

        // Hide the comment (don't delete to maintain records)
        await commentRef.update({ 
            hidden: true,
            hiddenAt: admin.firestore.FieldValue.serverTimestamp(),
            hiddenBy: req.uid
        });

        // Update comment count
        await db.collection('artists').doc(artistId).update({
            'stats.comments': admin.firestore.FieldValue.increment(-1)
        });

        res.json({ success: true });

    } catch (e) {
        console.error("Hide Comment Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET: Get unread comment count
router.get('/api/studio/comments/unread-count', verifyUser, async (req, res) => {
    try {
        // Find artist profile
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;

        // Count unread comments
        const unreadSnap = await db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .where('hidden', '==', false)
            .where('read', '==', false)
            .get();

        res.json({ count: unreadSnap.size });

    } catch (e) {
        console.error("Unread Count Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;