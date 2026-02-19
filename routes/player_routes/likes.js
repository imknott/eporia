const express = require('express');
const admin = require('firebase-admin');

module.exports = (db, verifyUser) => {
    const router = express.Router();

    // ==========================================
    // SONG LIKES & FAVORITES
    // ==========================================

    router.get('/api/user/likes/ids', verifyUser, async (req, res) => {
        try {
            const likesSnap = await db.collection('users').doc(req.uid).collection('likedSongs').get();
            const likedIds = [];
            likesSnap.forEach(doc => likedIds.push(doc.id));
            res.json({ likedSongIds: likedIds });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/user/like', verifyUser, express.json(), async (req, res) => {
        try {
            const { songId, title, artist, artUrl, audioUrl, duration, artistId } = req.body;
            if (!songId) return res.status(400).json({ error: "Missing songId" });

            await db.collection('users').doc(req.uid).collection('likedSongs').doc(songId).set({
                title: title || '',
                artist: artist || '',
                artistId: artistId || null,  
                artUrl: artUrl || '',
                audioUrl: audioUrl || '',
                duration: duration || 0,
                likedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            res.json({ success: true, liked: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/user/like/:songId', verifyUser, async (req, res) => {
        try {
            await db.collection('users').doc(req.uid).collection('likedSongs').doc(req.params.songId).delete();
            res.json({ success: true, liked: false });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/favorites', verifyUser, async (req, res) => {
        try {
            const likesSnap = await db.collection('users').doc(req.uid).collection('likedSongs').orderBy('likedAt', 'desc').get();
            const songs = [];
            likesSnap.forEach(doc => {
                const data = doc.data();
                songs.push({
                    id: doc.id,
                    title: data.title || '',
                    artist: data.artist || '',
                    artistId: data.artistId || null,
                    img: data.artUrl || 'https://via.placeholder.com/150',
                    audioUrl: data.audioUrl || '',
                    duration: data.duration || 0
                });
            });
            res.json({ songs });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // CRATE LIKES
    // ==========================================

    router.get('/api/crates/liked/:uid', verifyUser, async (req, res) => {
        try {
            const targetUid = req.params.uid;
            const userDoc = await db.collection('users').doc(targetUid).get();
            if (!userDoc.exists) return res.json({ crates: [] });
            
            const likedCrateIds = userDoc.data().likedCrates || [];
            if (likedCrateIds.length === 0) return res.json({ crates: [] });
            
            const crateBatches = [];
            for (let i = 0; i < likedCrateIds.length; i += 10) {
                const batch = likedCrateIds.slice(i, i + 10);
                const cratesSnap = await db.collection('crates')
                    .where(admin.firestore.FieldPath.documentId(), 'in', batch)
                    .where('privacy', '==', 'public')
                    .get();
                crateBatches.push(cratesSnap);
            }
            
            const crates = [];
            crateBatches.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    crates.push({
                        id: doc.id,
                        title: data.title,
                        creatorHandle: data.creatorHandle,
                        creatorAvatar: data.creatorAvatar,
                        trackCount: data.metadata?.trackCount || 0,
                        genres: data.metadata?.genres || [],
                        plays: data.plays || 0,
                        likes: data.likes || 0,
                        img: data.coverImage || data.tracks?.[0]?.img || 'https://via.placeholder.com/150'
                    });
                });
            });
            
            res.json({ crates });
            
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/crate/like/toggle', verifyUser, express.json(), async (req, res) => {
        try {
            const { crateId } = req.body;
            const uid = req.uid;
            if (!crateId) return res.status(400).json({ error: "Missing crateId" });

            const userRef = db.collection('users').doc(uid);
            const crateRef = db.collection('crates').doc(crateId);

            await db.runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userRef);
                const crateDoc = await transaction.get(crateRef);

                if (!crateDoc.exists) throw new Error("Crate not found");

                const userData = userDoc.data() || {};
                const likedCrates = userData.likedCrates || [];
                const isLiked = likedCrates.includes(crateId);

                if (isLiked) {
                    transaction.update(userRef, { likedCrates: admin.firestore.FieldValue.arrayRemove(crateId) });
                    transaction.update(crateRef, { likes: admin.firestore.FieldValue.increment(-1) });
                } else {
                    transaction.update(userRef, { likedCrates: admin.firestore.FieldValue.arrayUnion(crateId) });
                    transaction.update(crateRef, { likes: admin.firestore.FieldValue.increment(1) });
                }
            });

            const userDoc = await userRef.get();
            const likedCrates = userDoc.data()?.likedCrates || [];
            res.json({ liked: likedCrates.includes(crateId) });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/crate/like/check', verifyUser, async (req, res) => {
        try {
            const { crateId } = req.query;
            if (!crateId) return res.json({ liked: false });

            const userDoc = await db.collection('users').doc(req.uid).get();
            const likedCrates = userDoc.data()?.likedCrates || [];
            res.json({ liked: likedCrates.includes(crateId) });

        } catch (e) {
            res.json({ liked: false });
        }
    });

    return router;
};