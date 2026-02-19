const express = require('express');
const admin = require('firebase-admin');

module.exports = (db, verifyUser) => {
    const router = express.Router();

    // ==========================================
    // NOTIFICATIONS
    // ==========================================

    router.get('/api/notifications', verifyUser, async (req, res) => {
        try {
            const notifsSnap = await db.collection('users')
                .doc(req.uid)
                .collection('notifications')
                .where('read', '==', false) 
                .orderBy('timestamp', 'desc')
                .limit(5)
                .get();

            const notifications = [];
            notifsSnap.forEach(doc => {
                const data = doc.data();
                notifications.push({
                    id: doc.id,
                    ...data,
                    timestamp: data.timestamp ? data.timestamp.toDate() : new Date()
                });
            });

            res.json({ notifications });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/notifications/mark-read', verifyUser, express.json(), async (req, res) => {
        try {
            const { notificationId } = req.body;
            if (!notificationId) return res.status(400).json({ error: "Missing ID" });

            await db.collection('users')
                .doc(req.uid)
                .collection('notifications')
                .doc(notificationId)
                .update({ read: true });

            res.json({ success: true });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // ARTIST WALL COMMENTS API
    // ==========================================

    router.post('/api/artist/:artistId/comment', verifyUser, express.json(), async (req, res) => {
        try {
            const { artistId } = req.params;
            const { comment } = req.body;
            const uid = req.uid;

            if (!comment || comment.trim().length === 0) return res.status(400).json({ error: "Comment cannot be empty" });
            if (comment.length > 500) return res.status(400).json({ error: "Comment too long" });

            const followDoc = await db.collection('users').doc(uid)
                                      .collection('following').doc(artistId)
                                      .get();

            if (!followDoc.exists) {
                return res.status(403).json({ 
                    error: "You must be following this artist to comment",
                    requiresFollow: true 
                });
            }

            const userDoc = await db.collection('users').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
            const userData = userDoc.data();

            const commentData = {
                userId: uid,
                userName: userData.displayName || userData.handle || 'Anonymous',
                userHandle: userData.handle || null,
                userAvatar: userData.photoURL || null, 
                artistId: artistId,
                comment: comment.trim(),
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                likes: 0,
                reported: false,
                hidden: false
            };

            const commentRef = await db.collection('artists').doc(artistId).collection('comments').add(commentData);

            await db.collection('artists').doc(artistId).update({
                'stats.comments': admin.firestore.FieldValue.increment(1)
            });

            res.json({ 
                success: true, 
                commentId: commentRef.id,
                comment: { id: commentRef.id, ...commentData, timestamp: new Date() }
            });

        } catch (e) {
            console.error("Comment Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/artist/:artistId/comments', verifyUser, async (req, res) => {
        try {
            const { artistId } = req.params;
            const limit = parseInt(req.query.limit) || 20;
            const lastTimestamp = req.query.lastTimestamp;

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
                    userId: data.userId,
                    userName: data.userName,
                    userHandle: data.userHandle,
                    userAvatar: data.userAvatar,
                    comment: data.comment,
                    timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
                    likes: data.likes || 0,
                    isOwn: data.userId === req.uid
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

    router.delete('/api/artist/:artistId/comment/:commentId', verifyUser, async (req, res) => {
        try {
            const { artistId, commentId } = req.params;
            const uid = req.uid;

            const commentRef = db.collection('artists')
                .doc(artistId)
                .collection('comments')
                .doc(commentId);

            const commentDoc = await commentRef.get();
            
            if (!commentDoc.exists) {
                return res.status(404).json({ error: "Comment not found" });
            }

            const commentData = commentDoc.data();

            const artistDoc = await db.collection('artists').doc(artistId).get();
            const isArtistOwner = artistDoc.exists && artistDoc.data().userId === uid;

            if (commentData.userId !== uid && !isArtistOwner) {
                return res.status(403).json({ error: "Unauthorized to delete this comment" });
            }

            await commentRef.delete();

            await db.collection('artists').doc(artistId).update({
                'stats.comments': admin.firestore.FieldValue.increment(-1)
            });

            res.json({ success: true });

        } catch (e) {
            console.error("Delete Comment Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/artist/:artistId/comment/:commentId/report', verifyUser, express.json(), async (req, res) => {
        try {
            const { artistId, commentId } = req.params;
            const { reason } = req.body;

            if (!reason) {
                return res.status(400).json({ error: "Report reason required" });
            }

            const commentRef = db.collection('artists')
                .doc(artistId)
                .collection('comments')
                .doc(commentId);

            const commentDoc = await commentRef.get();
            if (!commentDoc.exists) {
                return res.status(404).json({ error: "Comment not found" });
            }

            await commentRef.collection('reports').add({
                reportedBy: req.uid,
                reason: reason,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            await commentRef.update({ reported: true });

            res.json({ success: true });

        } catch (e) {
            console.error("Report Comment Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/artist/:artistId/can-comment', verifyUser, async (req, res) => {
        try {
            const { artistId } = req.params;
            const uid = req.uid;

            const followDoc = await db.collection('users').doc(uid)
                                      .collection('following').doc(artistId)
                                      .get();

            const isFollowing = followDoc.exists;

            res.json({ 
                canComment: isFollowing,
                reason: isFollowing ? null : 'Must follow artist to comment'
            });

        } catch (e) {
            console.error("Can Comment Check Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};