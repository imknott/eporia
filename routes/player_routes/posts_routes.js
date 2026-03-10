/* routes/player_routes/posts_routes.js
 *
 * Handles all artist post creation, retrieval, likes, and comments.
 * Subcollection structure:
 *   artists/{artistId}/posts/{postId}
 *   artists/{artistId}/posts/{postId}/likes/{userId}
 *   artists/{artistId}/posts/{postId}/comments/{commentId}
 *
 * MOUNT in player.js (studio side) and studio.js (artist side):
 *   const postsRoutes = require('./player_routes/posts_routes')(db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL);
 *   router.use('/', postsRoutes);
 */

const express = require('express');

module.exports = (db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL) => {
    const router = express.Router();

    // ─────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────

    // Resolve the artistId that belongs to a verified uid
    async function getArtistIdForUid(uid) {
        // Try 'userId' first (current schema), fall back to 'ownerUid' for legacy docs
        let snap = await db.collection('artists').where('userId', '==', uid).limit(1).get();
        if (snap.empty) snap = await db.collection('artists').where('ownerUid', '==', uid).limit(1).get();
        return snap.empty ? null : snap.docs[0].id;
    }

    // Verify the caller owns the artistId being acted on
    async function verifyArtistOwner(req, res, next) {
        const artistId = req.params.artistId || req.body?.artistId;
        if (!artistId) return res.status(400).json({ error: 'Missing artistId' });

        const ownedId = await getArtistIdForUid(req.uid);
        if (ownedId !== artistId) {
            return res.status(403).json({ error: 'You do not own this artist profile' });
        }
        req.artistId = artistId;
        next();
    }

    // ==========================================
    // STUDIO — CREATE POST (artist only)
    // POST /api/studio/posts/create
    // Body: multipart — image file + caption field
    // ==========================================
    router.post(
        '/api/studio/posts/create',
        verifyUser,
        upload.single('postImage'),
        async (req, res) => {
            try {
                const { caption } = req.body;
                const uid = req.uid;

                const artistId = await getArtistIdForUid(uid);
                if (!artistId) return res.status(404).json({ error: 'Artist profile not found' });

                if (!req.file) return res.status(400).json({ error: 'An image is required for a post' });
                if (!caption || caption.trim().length === 0) {
                    return res.status(400).json({ error: 'Caption cannot be empty' });
                }
                if (caption.length > 1000) return res.status(400).json({ error: 'Caption too long (max 1000 chars)' });

                // Upload image to R2
                const ext       = req.file.originalname.split('.').pop().toLowerCase() || 'jpg';
                const key       = `artist-posts/${artistId}/${Date.now()}.${ext}`;
                await r2.send(new PutObjectCommand({
                    Bucket:      BUCKET_NAME,
                    Key:         key,
                    Body:        req.file.buffer,
                    ContentType: req.file.mimetype,
                    ACL:         'public-read',
                }));
                const imageUrl = `${CDN_URL}/${key}`;

                // Save post document
                const postRef  = db.collection('artists').doc(artistId).collection('posts').doc();
                const postData = {
                    id:           postRef.id,
                    artistId,
                    imageUrl,
                    caption:      caption.trim(),
                    createdAt:    require('firebase-admin').firestore.FieldValue.serverTimestamp(),
                    likes:        0,
                    commentCount: 0,
                };
                await postRef.set(postData);

                console.log(`📸 New post created: ${postRef.id} by artist ${artistId}`);
                res.json({ success: true, postId: postRef.id, post: { ...postData, createdAt: new Date() } });

            } catch (e) {
                console.error('Create Post Error:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    // ==========================================
    // STUDIO — GET OWN POSTS WITH STATS
    // GET /api/studio/posts
    // ==========================================
    router.get('/api/studio/posts', verifyUser, async (req, res) => {
        try {
            const artistId = await getArtistIdForUid(req.uid);
            if (!artistId) return res.status(404).json({ error: 'Artist not found' });

            const limit = parseInt(req.query.limit) || 20;
            const snap  = await db.collection('artists').doc(artistId)
                .collection('posts')
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();

            const posts = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id:           doc.id,
                    imageUrl:     d.imageUrl,
                    caption:      d.caption,
                    createdAt:    d.createdAt?.toDate() || new Date(),
                    likes:        d.likes        || 0,
                    commentCount: d.commentCount || 0,
                };
            });

            res.json({ posts });
        } catch (e) {
            console.error('Studio Get Posts Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // STUDIO — DELETE POST (artist only)
    // DELETE /api/studio/posts/:postId
    // ==========================================
    router.delete('/api/studio/posts/:postId', verifyUser, async (req, res) => {
        try {
            const artistId = await getArtistIdForUid(req.uid);
            if (!artistId) return res.status(404).json({ error: 'Artist not found' });

            const postRef = db.collection('artists').doc(artistId).collection('posts').doc(req.params.postId);
            const postDoc = await postRef.get();
            if (!postDoc.exists) return res.status(404).json({ error: 'Post not found' });

            // Delete post (comments/likes subcollections are cleaned up async — acceptable for now)
            await postRef.delete();
            res.json({ success: true });
        } catch (e) {
            console.error('Delete Post Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // PUBLIC — GET ARTIST POSTS (fan-facing)
    // GET /api/artist/:artistId/posts
    // ==========================================
    router.get('/api/artist/:artistId/posts', verifyUser, async (req, res) => {
        try {
            const { artistId } = req.params;
            const limit         = parseInt(req.query.limit)  || 12;
            const lastCreatedAt = req.query.lastCreatedAt;
            const uid           = req.uid;

            let query = db.collection('artists').doc(artistId)
                .collection('posts')
                .orderBy('createdAt', 'desc')
                .limit(limit);

            if (lastCreatedAt) query = query.startAfter(new Date(lastCreatedAt));

            const snap = await query.get();

            // Batch-check which posts this user has liked
            const likedSet = new Set();
            if (uid) {
                await Promise.all(snap.docs.map(async doc => {
                    const likeDoc = await doc.ref.collection('likes').doc(uid).get();
                    if (likeDoc.exists) likedSet.add(doc.id);
                }));
            }

            const posts = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id:           doc.id,
                    imageUrl:     d.imageUrl,
                    caption:      d.caption,
                    createdAt:    d.createdAt?.toDate() || new Date(),
                    likes:        d.likes        || 0,
                    commentCount: d.commentCount || 0,
                    likedByMe:    likedSet.has(doc.id),
                };
            });

            res.json({ posts, hasMore: posts.length === limit });
        } catch (e) {
            console.error('Get Posts Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // PUBLIC — TOGGLE LIKE ON A POST
    // POST /api/artist/:artistId/post/:postId/like
    // ==========================================
    router.post('/api/artist/:artistId/post/:postId/like', verifyUser, async (req, res) => {
        try {
            const { artistId, postId } = req.params;
            const uid = req.uid;
            const admin = require('firebase-admin');

            const postRef = db.collection('artists').doc(artistId).collection('posts').doc(postId);
            const likeRef = postRef.collection('likes').doc(uid);

            const likeDoc = await likeRef.get();
            const isLiked = likeDoc.exists;

            if (isLiked) {
                await likeRef.delete();
                await postRef.update({ likes: admin.firestore.FieldValue.increment(-1) });
            } else {
                await likeRef.set({ likedAt: admin.firestore.FieldValue.serverTimestamp(), userId: uid });
                await postRef.update({ likes: admin.firestore.FieldValue.increment(1) });
            }

            const updatedPost = await postRef.get();
            res.json({ success: true, liked: !isLiked, likes: updatedPost.data()?.likes || 0 });
        } catch (e) {
            console.error('Like Post Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // PUBLIC — ADD COMMENT TO POST (followers only)
    // POST /api/artist/:artistId/post/:postId/comment
    // ==========================================
    router.post('/api/artist/:artistId/post/:postId/comment', verifyUser, express.json(), async (req, res) => {
        try {
            const { artistId, postId } = req.params;
            const { comment } = req.body;
            const uid = req.uid;
            const admin = require('firebase-admin');

            if (!comment || comment.trim().length === 0) return res.status(400).json({ error: 'Comment cannot be empty' });
            if (comment.length > 500) return res.status(400).json({ error: 'Comment too long (max 500 chars)' });

            // Followers-only gate
            const followDoc = await db.collection('users').doc(uid).collection('following').doc(artistId).get();
            if (!followDoc.exists) {
                return res.status(403).json({ error: 'You must follow this artist to comment', requiresFollow: true });
            }

            const userDoc = await db.collection('users').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const u = userDoc.data();

            const postRef    = db.collection('artists').doc(artistId).collection('posts').doc(postId);
            const commentRef = postRef.collection('comments').doc();

            const commentData = {
                id:          commentRef.id,
                userId:      uid,
                userName:    u.displayName || u.handle || 'Anonymous',
                userHandle:  u.handle      || null,
                userAvatar:  u.photoURL    || null,
                comment:     comment.trim(),
                createdAt:   admin.firestore.FieldValue.serverTimestamp(),
                likes:       0,
                hidden:      false,
            };

            await commentRef.set(commentData);
            await postRef.update({ commentCount: admin.firestore.FieldValue.increment(1) });

            res.json({ success: true, commentId: commentRef.id, comment: { ...commentData, createdAt: new Date() } });
        } catch (e) {
            console.error('Post Comment Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // PUBLIC — GET COMMENTS FOR A POST
    // GET /api/artist/:artistId/post/:postId/comments
    // Returns artistReply bubble + likedByMe for the calling user
    // ==========================================
    router.get('/api/artist/:artistId/post/:postId/comments', verifyUser, async (req, res) => {
        try {
            const { artistId, postId } = req.params;
            const limit = parseInt(req.query.limit) || 20;
            const uid   = req.uid;

            const snap = await db.collection('artists').doc(artistId)
                .collection('posts').doc(postId)
                .collection('comments')
                .where('hidden', '==', false)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();

            // Batch-check which comments the caller has liked
            const likedSet = new Set();
            if (uid && snap.docs.length > 0) {
                await Promise.all(snap.docs.map(async doc => {
                    const l = await doc.ref.collection('commentLikes').doc(uid).get();
                    if (l.exists) likedSet.add(doc.id);
                }));
            }

            const comments = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id:          doc.id,
                    userId:      d.userId,
                    userName:    d.userName,
                    userHandle:  d.userHandle,
                    userAvatar:  d.userAvatar,
                    comment:     d.comment,
                    createdAt:   d.createdAt?.toDate() || new Date(),
                    likes:       d.likes       || 0,
                    likedByMe:   likedSet.has(doc.id),
                    artistReply: d.artistReply || null,
                    isOwn:       d.userId === uid,
                };
            });

            res.json({ comments, hasMore: comments.length === limit });
        } catch (e) {
            console.error('Get Post Comments Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // PUBLIC — TOGGLE LIKE ON A COMMENT
    // POST /api/artist/:artistId/post/:postId/comment/:commentId/like
    // ==========================================
    router.post('/api/artist/:artistId/post/:postId/comment/:commentId/like', verifyUser, async (req, res) => {
        try {
            const { artistId, postId, commentId } = req.params;
            const uid   = req.uid;
            const admin = require('firebase-admin');

            const commentRef = db.collection('artists').doc(artistId)
                .collection('posts').doc(postId)
                .collection('comments').doc(commentId);
            const likeRef = commentRef.collection('commentLikes').doc(uid);

            const isLiked = (await likeRef.get()).exists;
            if (isLiked) {
                await likeRef.delete();
                await commentRef.update({ likes: admin.firestore.FieldValue.increment(-1) });
            } else {
                await likeRef.set({ likedAt: admin.firestore.FieldValue.serverTimestamp(), userId: uid });
                await commentRef.update({ likes: admin.firestore.FieldValue.increment(1) });
            }
            const updated = await commentRef.get();
            res.json({ success: true, liked: !isLiked, likes: updated.data()?.likes || 0 });
        } catch (e) {
            console.error('Like Comment Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // STUDIO — GET ALL COMMENTS FOR A POST (artist inbox)
    // GET /api/studio/post/:postId/comments
    // Returns all comments (incl. hidden) for moderation
    // ==========================================
    router.get('/api/studio/post/:postId/comments', verifyUser, async (req, res) => {
        try {
            const artistId = await getArtistIdForUid(req.uid);
            if (!artistId) return res.status(403).json({ error: 'Artist account required' });

            const { postId } = req.params;
            const limit = parseInt(req.query.limit) || 50;

            const snap = await db.collection('artists').doc(artistId)
                .collection('posts').doc(postId)
                .collection('comments')
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();

            const comments = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id:          doc.id,
                    userId:      d.userId,
                    userName:    d.userName,
                    userHandle:  d.userHandle,
                    userAvatar:  d.userAvatar,
                    comment:     d.comment,
                    createdAt:   d.createdAt?.toDate() || new Date(),
                    likes:       d.likes       || 0,
                    artistReply: d.artistReply || null,
                    hidden:      d.hidden      || false,
                };
            });
            res.json({ comments });
        } catch (e) {
            console.error('Studio Get Comments Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // STUDIO — ARTIST REPLY TO A COMMENT
    // POST /api/studio/post/:postId/comment/:commentId/reply
    // Stored as artistReply field — one reply per comment (upsert)
    // ==========================================
    router.post('/api/studio/post/:postId/comment/:commentId/reply', verifyUser, express.json(), async (req, res) => {
        try {
            const { postId, commentId } = req.params;
            const { text } = req.body;
            const admin = require('firebase-admin');

            const artistId = await getArtistIdForUid(req.uid);
            if (!artistId) return res.status(403).json({ error: 'Artist account required' });

            if (!text || text.trim().length === 0) return res.status(400).json({ error: 'Reply cannot be empty' });
            if (text.length > 500) return res.status(400).json({ error: 'Reply too long (max 500 chars)' });

            const artistDoc  = await db.collection('artists').doc(artistId).get();
            const a          = artistDoc.data() || {};

            const reply = {
                text:         text.trim(),
                artistName:   a.name                            || 'Artist',
                artistAvatar: a.profileImage || a.avatarUrl    || null,
                createdAt:    admin.firestore.FieldValue.serverTimestamp(),
            };

            const commentRef = db.collection('artists').doc(artistId)
                .collection('posts').doc(postId)
                .collection('comments').doc(commentId);

            if (!(await commentRef.get()).exists) return res.status(404).json({ error: 'Comment not found' });

            await commentRef.update({ artistReply: reply });
            res.json({ success: true, reply: { ...reply, createdAt: new Date() } });
        } catch (e) {
            console.error('Artist Reply Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // STUDIO — DELETE ARTIST REPLY
    // DELETE /api/studio/post/:postId/comment/:commentId/reply
    // ==========================================
    router.delete('/api/studio/post/:postId/comment/:commentId/reply', verifyUser, async (req, res) => {
        try {
            const { postId, commentId } = req.params;
            const admin    = require('firebase-admin');
            const artistId = await getArtistIdForUid(req.uid);
            if (!artistId) return res.status(403).json({ error: 'Artist account required' });

            await db.collection('artists').doc(artistId)
                .collection('posts').doc(postId)
                .collection('comments').doc(commentId)
                .update({ artistReply: admin.firestore.FieldValue.delete() });

            res.json({ success: true });
        } catch (e) {
            console.error('Delete Reply Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // STUDIO — ARTIST LIKES A COMMENT (heart from inbox)
    // POST /api/studio/post/:postId/comment/:commentId/like
    // Same toggle logic as public like, but callable by artist on own posts
    // ==========================================
    router.post('/api/studio/post/:postId/comment/:commentId/like', verifyUser, async (req, res) => {
        try {
            const { postId, commentId } = req.params;
            const admin    = require('firebase-admin');
            const artistId = await getArtistIdForUid(req.uid);
            if (!artistId) return res.status(403).json({ error: 'Artist account required' });

            const commentRef = db.collection('artists').doc(artistId)
                .collection('posts').doc(postId)
                .collection('comments').doc(commentId);
            const likeRef = commentRef.collection('commentLikes').doc(req.uid);

            const isLiked = (await likeRef.get()).exists;
            if (isLiked) {
                await likeRef.delete();
                await commentRef.update({ likes: admin.firestore.FieldValue.increment(-1) });
            } else {
                await likeRef.set({ likedAt: admin.firestore.FieldValue.serverTimestamp(), userId: req.uid, isArtist: true });
                await commentRef.update({ likes: admin.firestore.FieldValue.increment(1) });
            }
            const updated = await commentRef.get();
            res.json({ success: true, liked: !isLiked, likes: updated.data()?.likes || 0 });
        } catch (e) {
            console.error('Studio Like Comment Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // PUBLIC — DELETE COMMENT (commenter or artist)
    // DELETE /api/artist/:artistId/post/:postId/comment/:commentId
    // ==========================================
    router.delete('/api/artist/:artistId/post/:postId/comment/:commentId', verifyUser, async (req, res) => {
        try {
            const { artistId, postId, commentId } = req.params;
            const uid = req.uid;
            const admin = require('firebase-admin');

            const commentRef = db.collection('artists').doc(artistId)
                .collection('posts').doc(postId)
                .collection('comments').doc(commentId);

            const commentDoc = await commentRef.get();
            if (!commentDoc.exists) return res.status(404).json({ error: 'Comment not found' });

            const artistOwner = await getArtistIdForUid(uid);
            const isArtist    = artistOwner === artistId;
            const isAuthor    = commentDoc.data().userId === uid;

            if (!isArtist && !isAuthor) return res.status(403).json({ error: 'Unauthorized' });

            await commentRef.delete();
            await db.collection('artists').doc(artistId).collection('posts').doc(postId)
                .update({ commentCount: admin.firestore.FieldValue.increment(-1) });

            res.json({ success: true });
        } catch (e) {
            console.error('Delete Post Comment Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};