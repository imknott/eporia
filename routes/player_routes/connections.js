const express = require('express');
const admin = require('firebase-admin');

module.exports = (db, verifyUser) => {
    const router = express.Router();

    // ==========================================
    // USER-TO-USER CONNECTIONS
    // ==========================================
    router.get('/api/user/following', verifyUser, async (req, res) => {
        try {
            const followingSnap = await db.collection('users').doc(req.uid).collection('following').orderBy('followedAt', 'desc').limit(6).get();
            const artists = [];
            followingSnap.forEach(doc => {
                const data = doc.data();
                artists.push({ id: doc.id, name: data.name || '', img: data.img || '' });
            });
            res.json({ artists });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/user/follow', verifyUser, express.json(), async (req, res) => {
        try {
            const { userId, handle, name, img } = req.body;
            if (!userId) return res.status(400).json({ error: "Missing userId" });

            let resolvedName = name || '';
            let resolvedImg  = img  || '';
            if (!resolvedName || !resolvedImg) {
                try {
                    const targetDoc = await db.collection('users').doc(userId).get();
                    if (targetDoc.exists) {
                        const d = targetDoc.data();
                        resolvedName = resolvedName || d.displayName || d.handle || '';
                        resolvedImg  = resolvedImg  || d.photoURL || '';
                    }
                } catch (e) {}
            }

            const batch = db.batch();
            const myFollowRef = db.collection('users').doc(req.uid).collection('following').doc(userId);
            batch.set(myFollowRef, { name: resolvedName, handle: handle || '', img: resolvedImg, type: 'user', followedAt: admin.firestore.FieldValue.serverTimestamp() });

            const theirFollowerRef = db.collection('users').doc(userId).collection('followers').doc(req.uid);
            batch.set(theirFollowerRef, { uid: req.uid, followedAt: admin.firestore.FieldValue.serverTimestamp() });

            batch.update(db.collection('users').doc(req.uid), { 'stats.following': admin.firestore.FieldValue.increment(1) });
            batch.update(db.collection('users').doc(userId),  { 'stats.followers': admin.firestore.FieldValue.increment(1) });

            await batch.commit();
            res.json({ success: true, following: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/api/user/unfollow', verifyUser, express.json(), async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: "Missing userId" });

            const batch = db.batch();
            batch.delete(db.collection('users').doc(req.uid).collection('following').doc(userId));
            batch.delete(db.collection('users').doc(userId).collection('followers').doc(req.uid));
            batch.update(db.collection('users').doc(req.uid), { 'stats.following': admin.firestore.FieldValue.increment(-1) });
            batch.update(db.collection('users').doc(userId),  { 'stats.followers': admin.firestore.FieldValue.increment(-1) });

            await batch.commit();
            res.json({ success: true, following: false });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/api/user/follow/check', verifyUser, async (req, res) => {
        try {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: "Missing userId" });
            const followDoc = await db.collection('users').doc(req.uid).collection('following').doc(userId).get();
            res.json({ following: followDoc.exists });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ==========================================
    // USER-TO-ARTIST CONNECTIONS
    // ==========================================
    router.post('/api/artist/follow', verifyUser, express.json(), async (req, res) => {
        try {
            const { artistId, artistName, artistImg, name, img } = req.body;
            if (!artistId) return res.status(400).json({ error: "Missing artistId" });

            let resolvedName = artistName || name || '';
            let resolvedImg = artistImg || img || '';

            if (!resolvedName || !resolvedImg) {
                try {
                    const artistDoc = await db.collection('artists').doc(artistId).get();
                    if (artistDoc.exists) {
                        const a = artistDoc.data();
                        resolvedName = resolvedName || a.name || a.handle || '';
                        resolvedImg  = resolvedImg  || a.profileImage || a.img || a.photoURL || '';
                    }
                } catch (lookupErr) {}
            }

            const batch = db.batch();
            const userFollowRef = db.collection('users').doc(req.uid).collection('following').doc(artistId);
            batch.set(userFollowRef, { name: resolvedName, img: resolvedImg, type: 'artist', followedAt: admin.firestore.FieldValue.serverTimestamp() });

            const artistFollowerRef = db.collection('artists').doc(artistId).collection('followers').doc(req.uid);
            batch.set(artistFollowerRef, { uid: req.uid, followedAt: admin.firestore.FieldValue.serverTimestamp() });

            batch.update(db.collection('artists').doc(artistId), { 'stats.followers': admin.firestore.FieldValue.increment(1) });
            batch.update(db.collection('users').doc(req.uid), { 'stats.following': admin.firestore.FieldValue.increment(1) });

            await batch.commit();
            res.json({ success: true, following: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/api/artist/follow/:artistId', verifyUser, async (req, res) => {
        try {
            const artistId = req.params.artistId;
            const batch = db.batch();

            batch.delete(db.collection('users').doc(req.uid).collection('following').doc(artistId));
            batch.delete(db.collection('artists').doc(artistId).collection('followers').doc(req.uid));

            batch.update(db.collection('artists').doc(artistId), { 'stats.followers': admin.firestore.FieldValue.increment(-1) });
            batch.update(db.collection('users').doc(req.uid), { 'stats.following': admin.firestore.FieldValue.increment(-1) });

            await batch.commit();
            res.json({ success: true, following: false });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/api/artist/follow/check', verifyUser, async (req, res) => {
        try {
            const artistId = req.query.artistId;
            if (!artistId) return res.status(400).json({ error: "Missing artistId" });
            const followDoc = await db.collection('users').doc(req.uid).collection('following').doc(artistId).get();
            res.json({ following: followDoc.exists });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    return router;
};