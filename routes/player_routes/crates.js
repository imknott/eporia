// routes/player_routes/crates.js
//
// Crate storage schema (as of this revision):
//
//   users/{uid}/crates/{crateId}          — user's own library (private + public)
//   discovery/{cityKey}/crates/{crateId}  — public crates indexed by city
//   cityMap/{cityKey}                     — aggregate counters for citySoundscapeMap.js
//
// cityKey format: "San_Diego__CA__US"
// (double-underscore as field separator so single spaces within names stay unambiguous)

module.exports = (db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL) => {
    const express = require('express');
    const router  = express.Router();
    const admin   = require('firebase-admin');

    // ── Helpers ──────────────────────────────────────────────────────────────

    function normalizeUrl(url, fallback = 'https://via.placeholder.com/150') {
        if (!url) return fallback;
        const R2_DEV = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return R2_DEV.test(url) ? url.replace(R2_DEV, CDN_URL) : url;
        }
        const cdnHost = CDN_URL.replace(/^https?:\/\//, '');
        if (url.startsWith(cdnHost)) return `https://${url}`;
        return `${CDN_URL}/${url.replace(/^\//, '')}`;
    }

    function makeCityKey(city, state, country) {
        if (!city) return null;
        const c = city.trim().replace(/\s+/g, '_');
        const s = (state   || 'Global').trim().replace(/\s+/g, '_');
        const n = (country || 'US').trim().replace(/\s+/g, '_');
        return `${c}__${s}__${n}`;
    }

    function parseCityKey(key = '') {
        const [city, state, country] = key.split('__').map(p => p.replace(/_/g, ' '));
        return { city: city || '', state: state || '', country: country || '' };
    }

    // Upload crate cover to R2
    async function uploadCoverToR2(fileBuffer, uid, crateId, mimetype) {
        const ext = (mimetype || 'image/jpeg').split('/')[1] || 'jpg';
        const key = `users/${uid}/crates/${crateId}_cover.${ext}`;
        await r2.send(new PutObjectCommand({
            Bucket:      BUCKET_NAME,
            Key:         key,
            Body:        fileBuffer,
            ContentType: mimetype,
        }));
        return `${CDN_URL}/${key}`;
    }

    // ── City Soundscape Update ────────────────────────────────────────────────
    //
    // Maintains the cityMap/{cityKey} aggregate document that citySoundscapeMap.js
    // reads to render the glowing orbs. Every crate create/update/delete calls this.
    // Wrapped in a transaction so concurrent saves don't race.
    // Non-fatal: a failed update never aborts the crate save.
    //
    async function updateCitySoundscape(cityKey, crateData, operation) {
        if (!cityKey) return;

        const cityRef          = db.collection('cityMap').doc(cityKey);
        const { city, state, country } = parseCityKey(cityKey);

        // Collect genres from track array and metadata
        const crateGenres = [
            ...(crateData?.metadata?.genres || []),
            ...(crateData?.tracks || []).flatMap(t => [t.genre, t.subgenre].filter(Boolean)),
        ].filter(Boolean);

        try {
            await db.runTransaction(async tx => {
                const snap    = await tx.get(cityRef);
                const current = snap.exists ? snap.data() : null;

                if (operation === 'delete') {
                    if (!current) return;
                    const newCount = Math.max(0, (current.crateCount || 1) - 1);
                    if (newCount === 0) {
                        tx.delete(cityRef);
                    } else {
                        tx.update(cityRef, {
                            crateCount: newCount,
                            updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
                        });
                    }
                    return;
                }

                const genreCounts = { ...(current?.genreCounts || {}) };
                crateGenres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
                const topGenres = Object.entries(genreCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([g]) => g);

                if (!current) {
                    // New city — create the map entry for the first time
                    tx.set(cityRef, {
                        city, state, country, cityKey,
                        crateCount:  1,
                        genreCounts,
                        topGenres,
                        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
                    });
                } else {
                    tx.update(cityRef, {
                        crateCount:  (current.crateCount || 0) + (operation === 'create' ? 1 : 0),
                        genreCounts,
                        topGenres,
                        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
            });
            console.log(`🗺️  cityMap updated: ${cityKey} [${operation}]`);
        } catch (err) {
            console.error('⚠ updateCitySoundscape failed (non-fatal):', err.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/crates/user/:uid  — load the authenticated user's crates
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/api/crates/user/:uid', verifyUser, async (req, res) => {
        try {
            if (req.params.uid !== req.uid) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const snap = await db.collection('users').doc(req.uid)
                .collection('crates')
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get();

            const crates = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id:         doc.id,
                    title:      d.title       || 'Untitled',
                    trackCount: d.trackCount  || 0,
                    likes:      d.likes       || 0,
                    coverImage: d.coverImage  ? normalizeUrl(d.coverImage) : null,
                    createdAt:  d.createdAt,
                    updatedAt:  d.updatedAt,
                    privacy:    d.privacy     || 'public',
                    genres:     d.metadata?.genres || [],
                };
            });

            res.json({ crates });
        } catch (e) {
            console.error('loadUserCrates error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/crate/:crateId  — fetch a single crate for editing
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/api/crate/:crateId', verifyUser, async (req, res) => {
        try {
            const doc = await db.collection('users').doc(req.uid)
                .collection('crates').doc(req.params.crateId)
                .get();

            if (!doc.exists) {
                return res.status(404).json({ error: 'Crate not found' });
            }

            const d      = doc.data();
            const tracks = (d.tracks || []).map(t => ({
                ...t,
                img:    normalizeUrl(t.img    || t.artUrl),
                artUrl: normalizeUrl(t.artUrl || t.img),
            }));

            res.json({
                id:         doc.id,
                title:      d.title      || 'Untitled',
                tracks,
                coverImage: d.coverImage ? normalizeUrl(d.coverImage) : null,
                metadata:   d.metadata   || {},
                privacy:    d.privacy    || 'public',
                createdAt:  d.createdAt,
            });
        } catch (e) {
            console.error('getCrate error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/crate/create
    // ─────────────────────────────────────────────────────────────────────────
    router.post('/api/crate/create', verifyUser, upload.single('coverImage'), async (req, res) => {
        try {
            const { title, tracks: tracksJson, privacy, metadata: metaJson, existingCoverUrl } = req.body;
            if (!title) return res.status(400).json({ error: 'Title is required' });

            const tracks   = JSON.parse(tracksJson || '[]');
            const metadata = JSON.parse(metaJson   || '{}');

            const normalizedTracks = tracks.map(t => ({
                ...t,
                img:    normalizeUrl(t.img    || t.artUrl),
                artUrl: normalizeUrl(t.artUrl || t.img),
            }));

            // Get user location for city soundscape indexing
            const userDoc  = await db.collection('users').doc(req.uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            const cityKey  = makeCityKey(userData.city, userData.state, userData.country);

            const newRef = db.collection('users').doc(req.uid).collection('crates').doc();

            let coverImageUrl = existingCoverUrl ? normalizeUrl(existingCoverUrl) : null;
            if (req.file) {
                coverImageUrl = await uploadCoverToR2(req.file.buffer, req.uid, newRef.id, req.file.mimetype);
            }

            const now       = admin.firestore.FieldValue.serverTimestamp();
            const crateData = {
                id:            newRef.id,
                title,
                tracks:        normalizedTracks,
                trackCount:    normalizedTracks.length,
                privacy:       privacy || 'public',
                coverImage:    coverImageUrl || null,
                metadata:      { ...metadata, genres: metadata.genres || [] },
                city:          userData.city    || null,
                state:         userData.state   || null,
                country:       userData.country || null,
                cityKey,
                creatorHandle: userData.handle   || null,
                creatorAvatar: userData.photoURL || null,
                likes:         0,
                createdAt:     now,
                updatedAt:     now,
            };

            const batch = db.batch();

            // 1. Write to user's subcollection (always)
            batch.set(newRef, crateData);

            // 2. Mirror to discovery/{cityKey}/crates (public crates only)
            if ((privacy || 'public') === 'public' && cityKey) {
                const discRef = db.collection('discovery').doc(cityKey).collection('crates').doc(newRef.id);
                batch.set(discRef, crateData);
            }

            await batch.commit();

            // 3. Update city aggregate counter (non-blocking)
            updateCitySoundscape(cityKey, crateData, 'create').catch(() => {});

            res.json({ success: true, crateId: newRef.id });
        } catch (e) {
            console.error('createCrate error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // PUT /api/crate/update/:crateId
    // ─────────────────────────────────────────────────────────────────────────
    router.put('/api/crate/update/:crateId', verifyUser, upload.single('coverImage'), async (req, res) => {
        try {
            const { crateId } = req.params;
            const { title, tracks: tracksJson, privacy, metadata: metaJson, existingCoverUrl } = req.body;

            const userCrateRef = db.collection('users').doc(req.uid).collection('crates').doc(crateId);
            const snap         = await userCrateRef.get();
            if (!snap.exists) return res.status(404).json({ error: 'Crate not found' });

            const existing  = snap.data();
            const cityKey   = existing.cityKey || null;
            const tracks    = JSON.parse(tracksJson || '[]');
            const metadata  = JSON.parse(metaJson   || '{}');

            const normalizedTracks = tracks.map(t => ({
                ...t,
                img:    normalizeUrl(t.img    || t.artUrl),
                artUrl: normalizeUrl(t.artUrl || t.img),
            }));

            let coverImageUrl = existingCoverUrl ? normalizeUrl(existingCoverUrl) : existing.coverImage;
            if (req.file) {
                coverImageUrl = await uploadCoverToR2(req.file.buffer, req.uid, crateId, req.file.mimetype);
            }

            const updates = {
                title:       title       || existing.title,
                tracks:      normalizedTracks,
                trackCount:  normalizedTracks.length,
                privacy:     privacy     || existing.privacy || 'public',
                coverImage:  coverImageUrl || null,
                metadata:    { ...existing.metadata, ...metadata },
                updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
            };

            const batch = db.batch();
            batch.update(userCrateRef, updates);

            if (cityKey) {
                const discRef = db.collection('discovery').doc(cityKey).collection('crates').doc(crateId);
                if (updates.privacy === 'public') {
                    batch.set(discRef, { ...existing, ...updates }, { merge: true });
                } else {
                    batch.delete(discRef); // made private — remove from discovery
                }
            }

            await batch.commit();
            updateCitySoundscape(cityKey, { ...existing, ...updates }, 'update').catch(() => {});

            res.json({ success: true, crateId });
        } catch (e) {
            console.error('updateCrate error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // DELETE /api/crate/:crateId
    // ─────────────────────────────────────────────────────────────────────────
    router.delete('/api/crate/:crateId', verifyUser, async (req, res) => {
        try {
            const { crateId }  = req.params;
            const userCrateRef = db.collection('users').doc(req.uid).collection('crates').doc(crateId);
            const snap         = await userCrateRef.get();
            if (!snap.exists) return res.status(404).json({ error: 'Crate not found' });

            const existing = snap.data();
            const cityKey  = existing.cityKey || null;

            const batch = db.batch();
            batch.delete(userCrateRef);
            if (cityKey) {
                batch.delete(db.collection('discovery').doc(cityKey).collection('crates').doc(crateId));
            }
            await batch.commit();
            updateCitySoundscape(cityKey, existing, 'delete').catch(() => {});

            res.json({ success: true });
        } catch (e) {
            console.error('deleteCrate error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/crate/:crateId/like
    // ─────────────────────────────────────────────────────────────────────────
    router.post('/api/crate/:crateId/like', verifyUser, async (req, res) => {
        try {
            const { crateId } = req.params;
            const { ownerId } = req.body;
            if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

            const crateRef = db.collection('users').doc(ownerId).collection('crates').doc(crateId);
            const likeRef  = crateRef.collection('likes').doc(req.uid);
            const likeSnap = await likeRef.get();
            const inc      = admin.firestore.FieldValue.increment;

            if (likeSnap.exists) {
                await Promise.all([likeRef.delete(), crateRef.update({ likes: inc(-1) })]);
                res.json({ success: true, liked: false });
            } else {
                await Promise.all([
                    likeRef.set({ uid: req.uid, likedAt: admin.firestore.FieldValue.serverTimestamp() }),
                    crateRef.update({ likes: inc(1) }),
                ]);
                res.json({ success: true, liked: true });
            }
        } catch (e) {
            console.error('likeCrate error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/discovery — public crates for a city (dashboard feed)
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/api/discovery', verifyUser, async (req, res) => {
        try {
            const { city, state, country } = req.query;
            const cityKey = makeCityKey(city, state, country);
            if (!cityKey) return res.status(400).json({ error: 'city is required' });

            const snap = await db.collection('discovery').doc(cityKey)
                .collection('crates')
                .orderBy('createdAt', 'desc')
                .limit(30)
                .get();

            const crates = snap.docs.map(doc => {
                const d        = doc.data();
                const coverRaw = d.coverImage || d.tracks?.[0]?.artUrl || null;
                return {
                    id:            doc.id,
                    title:         d.title         || 'Untitled',
                    trackCount:    d.trackCount    || 0,
                    likes:         d.likes         || 0,
                    coverImage:    coverRaw ? normalizeUrl(coverRaw) : null,
                    genres:        d.metadata?.genres || [],
                    creatorHandle: d.creatorHandle || null,
                    creatorAvatar: d.creatorAvatar ? normalizeUrl(d.creatorAvatar) : null,
                    createdAt:     d.createdAt,
                    city:          d.city,
                    state:         d.state,
                };
            });

            res.json({ crates, cityKey, city, state, country });
        } catch (e) {
            console.error('discovery error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/citymap  — aggregate data for citySoundscapeMap.js
    // Returns all cityMap docs (max 200). Each doc is one glowing orb.
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/api/citymap', verifyUser, async (req, res) => {
        try {
            const snap = await db.collection('cityMap')
                .orderBy('updatedAt', 'desc')
                .limit(200)
                .get();

            const cities = snap.docs.map(doc => ({
                cityKey:  doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
                updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null,
            }));

            res.json({ cities });
        } catch (e) {
            console.error('citymap error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // DRAFT ENDPOINTS  (stored in users/{uid}/meta/draft)
    // ─────────────────────────────────────────────────────────────────────────
    router.post('/api/draft/save', verifyUser, async (req, res) => {
        try {
            await db.collection('users').doc(req.uid).collection('meta').doc('draft').set({
                ...req.body,
                savedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/api/draft/get', verifyUser, async (req, res) => {
        try {
            const snap = await db.collection('users').doc(req.uid)
                .collection('meta').doc('draft').get();
            if (!snap.exists) return res.json({ hasDraft: false });
            res.json({ hasDraft: true, draft: snap.data() });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/api/draft/delete', verifyUser, async (req, res) => {
        try {
            await db.collection('users').doc(req.uid)
                .collection('meta').doc('draft').delete();
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    return router;
};