const express = require('express');
const admin = require('firebase-admin');

module.exports = (db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL) => {
    const router = express.Router();

    // ==========================================
    // CRATE CREATION & MANAGEMENT
    // ==========================================

    router.post('/api/crate/create', verifyUser, upload.single('coverImage'), async (req, res) => {
        try {
            const { title, tracks, privacy, metadata, existingCoverUrl } = req.body;
            
            if (!title || !tracks) {
                return res.status(400).json({ error: "Missing title or tracks" });
            }

            let coverImageUrl = existingCoverUrl || null;
            if (req.file) {
                const filename = `crates/${req.uid}_${Date.now()}.jpg`;
                const command = new PutObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: filename,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype
                });
                await r2.send(command);
                coverImageUrl = `${CDN_URL}/${filename}`;
            }

            const tracksArray = typeof tracks === 'string' ? JSON.parse(tracks) : tracks;
            const metadataObj = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

            const userDoc = await db.collection('users').doc(req.uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};

            const crateData = {
                id: null, 
                title,
                coverImage: coverImageUrl,
                privacy,
                tracks: tracksArray, 
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                stats: { plays: 0, likes: 0 },
                metadata: {
                    trackCount: tracksArray.length,
                    genres: metadataObj?.genres || [],
                    totalDuration: metadataObj?.totalDuration || 0
                }
            };

            const userRef = db.collection('users').doc(req.uid);
            const crateRef = await userRef.collection('crates').add(crateData);
            const crateId = crateRef.id;
            
            await crateRef.update({ id: crateId });

            if (privacy === 'public') {
                const batch = db.batch();

                const discoveryData = {
                    id: crateId,
                    title,
                    coverImage: coverImageUrl,
                    creatorId: req.uid, 
                    creatorHandle: userData.handle || 'Anonymous',
                    creatorAvatar: userData.photoURL || null,
                    tracks: tracksArray,
                    metadata: {
                        trackCount: tracksArray.length,
                        genres: metadataObj?.genres || [],
                        totalDuration: metadataObj?.totalDuration || 0
                    },
                    city: userData.city || 'Unknown',
                    state: userData.state || null,
                    stats: { plays: 0, likes: 0 },
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                };

                if (userData.city) {
                    const cityRef = db.collection('discovery').doc('crates_by_city').collection(userData.city).doc(crateId);
                    batch.set(cityRef, discoveryData);
                }
                if (userData.state) {
                    const stateRef = db.collection('discovery').doc('crates_by_state').collection(userData.state).doc(crateId);
                    batch.set(stateRef, discoveryData);
                }

                await batch.commit();
            }

            res.json({ 
                success: true, 
                crateId,
                crate: {
                    id: crateId,
                    title,
                    coverImage: coverImageUrl,
                    trackCount: tracksArray.length
                }
            });

        } catch (e) {
            console.error("Crate Creation Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    router.patch('/api/crate/:crateId', verifyUser, upload.single('coverImage'), async (req, res) => {
        try {
            const { crateId } = req.params;
            const { title, tracks, privacy, metadata, existingCoverUrl } = req.body;

            const crateRef = db.collection('users').doc(req.uid).collection('crates').doc(crateId);
            const crateDoc = await crateRef.get();

            if (!crateDoc.exists) {
                return res.status(404).json({ error: 'Crate not found' });
            }

            const currentData = crateDoc.data();

            let coverImageUrl = existingCoverUrl || currentData.coverImage;
            if (req.file) {
                const filename = `crates/${req.uid}_${Date.now()}.jpg`;
                const command = new PutObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: filename,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype
                });
                await r2.send(command);
                coverImageUrl = `${CDN_URL}/${filename}`;
            }

            const tracksArray = tracks ? (typeof tracks === 'string' ? JSON.parse(tracks) : tracks) : currentData.tracks;
            const metadataObj = metadata ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : currentData.metadata;
            const newPrivacy = privacy || currentData.privacy;

            const updateData = {
                title: title || currentData.title,
                coverImage: coverImageUrl,
                privacy: newPrivacy,
                tracks: tracksArray,
                metadata: {
                    trackCount: tracksArray.length,
                    genres: metadataObj?.genres || [],
                    totalDuration: metadataObj?.totalDuration || 0
                }
            };

            await crateRef.update(updateData);

            if (newPrivacy === 'public') {
                const userDoc = await db.collection('users').doc(req.uid).get();
                const userData = userDoc.data() || {};

                const discoveryData = {
                    ...updateData,
                    id: crateId,
                    creatorId: req.uid,
                    creatorHandle: userData.handle || 'Anonymous',
                    creatorAvatar: userData.photoURL || null,
                    city: userData.city || 'Unknown',
                    state: userData.state || null
                };

                const batch = db.batch();
                if (userData.city) {
                    const cityRef = db.collection('discovery').doc('crates_by_city').collection(userData.city).doc(crateId);
                    batch.set(cityRef, discoveryData, { merge: true });
                }
                if (userData.state) {
                    const stateRef = db.collection('discovery').doc('crates_by_state').collection(userData.state).doc(crateId);
                    batch.set(stateRef, discoveryData, { merge: true });
                }
                await batch.commit();

            } else if (currentData.privacy === 'public' && newPrivacy === 'private') {
                const userDoc = await db.collection('users').doc(req.uid).get();
                const userData = userDoc.data() || {};
                const batch = db.batch();

                if (userData.city) {
                    const cityRef = db.collection('discovery').doc('crates_by_city').collection(userData.city).doc(crateId);
                    batch.delete(cityRef);
                }
                if (userData.state) {
                    const stateRef = db.collection('discovery').doc('crates_by_state').collection(userData.state).doc(crateId);
                    batch.delete(stateRef);
                }
                await batch.commit();
            }

            res.json({ success: true });

        } catch (e) {
            console.error("Crate Update Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/crate/:crateId', verifyUser, async (req, res) => {
        try {
            const { crateId } = req.params;

            const crateRef = db.collection('users').doc(req.uid).collection('crates').doc(crateId);
            const crateDoc = await crateRef.get();

            if (!crateDoc.exists) {
                return res.status(404).json({ error: 'Crate not found' });
            }

            const crateData = crateDoc.data();
            await crateRef.delete();

            if (crateData.privacy === 'public') {
                const userDoc = await db.collection('users').doc(req.uid).get();
                const userData = userDoc.data() || {};
                const batch = db.batch();

                if (userData.city) {
                    const cityRef = db.collection('discovery').doc('crates_by_city').collection(userData.city).doc(crateId);
                    batch.delete(cityRef);
                }
                if (userData.state) {
                    const stateRef = db.collection('discovery').doc('crates_by_state').collection(userData.state).doc(crateId);
                    batch.delete(stateRef);
                }
                await batch.commit();
            }

            res.json({ success: true });

        } catch (e) {
            console.error("Crate Delete Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // CRATE FETCHING
    // ==========================================

    router.get('/api/crates/user/:uid', verifyUser, async (req, res) => {
        try {
            const targetUid = req.params.uid;
            const isOwnProfile = req.uid === targetUid;
            
            let query = db.collection('users')
                .doc(targetUid)
                .collection('crates')
                .orderBy('createdAt', 'desc');
            
            if (!isOwnProfile) {
                query = query.where('privacy', '==', 'public');
            }

            const cratesSnap = await query.get();

            const crates = [];
            cratesSnap.forEach(doc => {
                const data = doc.data();
                crates.push({
                    id: doc.id,
                    userId: targetUid,
                    title: data.title,
                    coverImage: data.coverImage, 
                    trackCount: data.metadata?.trackCount || 0,
                    privacy: data.privacy,
                    createdAt: data.createdAt?.toDate() || new Date(),
                    stats: data.stats || { plays: 0, likes: 0 }
                });
            });

            res.json({ crates });

        } catch (e) {
            console.error("User Crates Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/crate/:crateId
    // Accepts an optional ?creatorId= query param as a fast-path hint
    // (e.g. when a dashboard card already knows who made the crate).
    // Lookup order:
    //   1. creatorId subcollection (if hint provided and differs from viewer)
    //   2. Requesting user's own subcollection
    //   3. Discovery by viewer's city
    //   4. Discovery by viewer's state
    //   5. Broad scan across all discovery city/state collections
    router.get('/api/crate/:crateId', verifyUser, async (req, res) => {
        try {
            const { crateId } = req.params;
            const userId = req.uid;
            const creatorId = req.query.creatorId || null;

            const userDoc = await db.collection('users').doc(userId).get();
            const userData = userDoc.exists ? userDoc.data() : {};

            // 1. Fast path: known creator who is NOT the requesting user
            if (creatorId && creatorId !== userId) {
                const creatorCrateDoc = await db.collection('users')
                    .doc(creatorId).collection('crates').doc(crateId).get();
                if (creatorCrateDoc.exists) {
                    const data = creatorCrateDoc.data();
                    if (data.privacy !== 'public') {
                        return res.status(403).json({ error: 'This crate is private' });
                    }
                    const creatorDoc = await db.collection('users').doc(creatorId).get();
                    const creatorData = creatorDoc.exists ? creatorDoc.data() : {};
                    return res.json({
                        ...data,
                        id: crateId,
                        creatorHandle: creatorData.handle || 'Unknown',
                        creatorAvatar: creatorData.photoURL || null,
                        creatorId
                    });
                }
            }

            // 2. Check requesting user's own subcollection (private or public)
            const userCrateDoc = await db.collection('users')
                .doc(userId).collection('crates').doc(crateId).get();
            if (userCrateDoc.exists) {
                return res.json({
                    ...userCrateDoc.data(),
                    id: crateId,
                    creatorHandle: userData.handle || 'You',
                    creatorAvatar: userData.photoURL || null,
                    creatorId: userId
                });
            }

            // 3. Discovery — viewer's city
            if (userData.city) {
                const cityDoc = await db.collection('discovery')
                    .doc('crates_by_city').collection(userData.city).doc(crateId).get();
                if (cityDoc.exists) return res.json({ ...cityDoc.data(), id: crateId });
            }

            // 4. Discovery — viewer's state
            if (userData.state) {
                const stateDoc = await db.collection('discovery')
                    .doc('crates_by_state').collection(userData.state).doc(crateId).get();
                if (stateDoc.exists) return res.json({ ...stateDoc.data(), id: crateId });
            }

            // 5. Broad scan across all cities then all states
            const cityCollections = await db.collection('discovery')
                .doc('crates_by_city').listCollections();
            for (const col of cityCollections) {
                const doc = await col.doc(crateId).get();
                if (doc.exists) return res.json({ ...doc.data(), id: crateId });
            }

            const stateCollections = await db.collection('discovery')
                .doc('crates_by_state').listCollections();
            for (const col of stateCollections) {
                const doc = await col.doc(crateId).get();
                if (doc.exists) return res.json({ ...doc.data(), id: crateId });
            }

            return res.status(404).json({ error: 'Crate not found or you do not have permission to view it' });

        } catch (e) {
            console.error('[CRATE API] Error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // ADMIN / MAINTENANCE
    // ==========================================

    router.get('/api/admin/fix-crates', verifyUser, async (req, res) => {
        try {
            const snapshot = await db.collectionGroup('crates').get();
            const batch = db.batch();
            let count = 0;
            
            snapshot.forEach(doc => {
                const data = doc.data();
                if (!data.id) {
                    batch.update(doc.ref, { id: doc.id }); 
                    count++;
                }
            });
            
            if (count > 0) await batch.commit();
            res.json({ success: true, fixed: count, message: "IDs added to subcollections" });
        } catch (e) {
            console.error("Fix Crates Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // WORKBENCH DRAFTS
    // ==========================================

    router.post('/api/draft/save', verifyUser, express.json(), async (req, res) => {
        try {
            const { title, tracks, genreMap, coverImage } = req.body;
            
            const draftData = {
                title: title || '',
                tracks: tracks || [],
                genreMap: genreMap || {},
                coverImage: coverImage || null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) 
                )
            };

            const draftRef = db.collection('users').doc(req.uid).collection('drafts').doc('workbench');
            const draftDoc = await draftRef.get();

            if (draftDoc.exists) {
                await draftRef.update(draftData);
            } else {
                draftData.createdAt = admin.firestore.FieldValue.serverTimestamp();
                await draftRef.set(draftData);
            }

            res.json({ success: true, message: 'Draft saved' });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/draft/get', verifyUser, async (req, res) => {
        try {
            const draftDoc = await db.collection('users').doc(req.uid).collection('drafts').doc('workbench').get();
            if (!draftDoc.exists) return res.json({ hasDraft: false });

            const draft = draftDoc.data();
            const now = new Date();
            if (draft.expiresAt && draft.expiresAt.toDate() < now) {
                await draftDoc.ref.delete();
                return res.json({ hasDraft: false });
            }

            res.json({ 
                hasDraft: true, 
                draft: {
                    title: draft.title,
                    tracks: draft.tracks,
                    genreMap: draft.genreMap,
                    coverImage: draft.coverImage,
                    updatedAt: draft.updatedAt
                }
            });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.delete('/api/draft/delete', verifyUser, async (req, res) => {
        try {
            await db.collection('users').doc(req.uid).collection('drafts').doc('workbench').delete();
            res.json({ success: true, message: 'Draft deleted' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // PLAYBACK LOGGING
    // ==========================================

    router.post('/api/crate/play/:id', verifyUser, async (req, res) => {
        try {
            // Play count lives on the user's subcollection doc, not a top-level collection
            // Try to find and update the crate across discovery; best-effort, non-blocking.
            const crateId = req.params.id;

            // We don't know the owner here so update discovery copies only
            const cityCollections = await db.collection('discovery')
                .doc('crates_by_city').listCollections();
            const batch = db.batch();
            let found = false;

            for (const col of cityCollections) {
                const doc = await col.doc(crateId).get();
                if (doc.exists) {
                    batch.update(doc.ref, { 'stats.plays': admin.firestore.FieldValue.increment(1) });
                    found = true;
                    break;
                }
            }

            if (!found) {
                const stateCollections = await db.collection('discovery')
                    .doc('crates_by_state').listCollections();
                for (const col of stateCollections) {
                    const doc = await col.doc(crateId).get();
                    if (doc.exists) {
                        batch.update(doc.ref, { 'stats.plays': admin.firestore.FieldValue.increment(1) });
                        break;
                    }
                }
            }

            await batch.commit();
            res.json({ success: true });
        } catch (e) {
            // Non-critical — don't error out the client over a play count
            console.error("Play Log Error:", e);
            res.json({ success: false, error: e.message });
        }
    });

    return router;
};