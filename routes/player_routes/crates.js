// routes/player_routes/crates.js
//
// Crate storage schema — flat top-level collection:
//
//   crates/{crateId}
//     id:            string   (same as doc ID, stored for convenience)
//     creatorId:     string   (uid — the single ownership field)
//     creatorHandle: string   (@ian)
//     creatorAvatar: string   (CDN URL)
//     title:         string
//     privacy:       'public' | 'private'
//     cityKey:       'San_Diego__CA__US'
//     city, state, country: strings
//     tracks:        array
//     trackCount:    number
//     coverImage:    string | null
//     metadata:      { genres: [] }
//     likes:         number
//     createdAt, updatedAt: timestamps
//
//   crates/{crateId}/likes/{uid}   — subcollection for per-user like tracking
//   cityMap/{cityKey}              — aggregate counters for citySoundscapeMap.js
//
// Required Firestore composite indexes (Firebase console → Indexes):
//   1. creatorId ASC  + createdAt DESC                       (user crate list)
//   2. cityKey   ASC  + privacy ASC  + createdAt DESC        (city discovery feed)
//   3. creatorId ASC  + privacy ASC  + createdAt DESC        (public profile view)

module.exports = (db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL) => {
    const express = require('express');
    const router  = express.Router();
    const admin   = require('firebase-admin');
    const { awardPoints } = require('./artistPoolHelper');

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

    // Normalize all URL fields on every track in one place
    function normalizeTracks(tracks) {
        return (tracks || []).map(t => ({
            ...t,
            img:      normalizeUrl(t.img    || t.artUrl),
            artUrl:   normalizeUrl(t.artUrl || t.img),
            audioUrl: normalizeUrl(t.audioUrl || null, null),
        }));
    }

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
    // Maintains cityMap/{cityKey} aggregate doc that citySoundscapeMap.js reads.
    // Non-fatal: a failed update never aborts the crate save.
    async function updateCitySoundscape(cityKey, crateData, operation) {
        if (!cityKey) return;

        const cityRef = db.collection('cityMap').doc(cityKey);
        const { city, state, country } = parseCityKey(cityKey);

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
                    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);

                if (!current) {
                    tx.set(cityRef, {
                        city, state, country, cityKey,
                        crateCount:  1,
                        genreCounts, topGenres,
                        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
                    });
                } else {
                    tx.update(cityRef, {
                        crateCount:  (current.crateCount || 0) + (operation === 'create' ? 1 : 0),
                        genreCounts, topGenres,
                        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
            });
        } catch (err) {
            console.error('⚠ updateCitySoundscape failed (non-fatal):', err.message);
        }
    }

    // ── Proof of Fandom points ────────────────────────────────────────────────
    async function awardCratePoints(uid, tracks, previousTrackIds = []) {
        const prevSet   = new Set(previousTrackIds);
        const newTracks = tracks.filter(t => t.songId && !prevSet.has(t.songId) && t.artistId);
        if (newTracks.length === 0) return;
        await Promise.allSettled(
            newTracks.map(t =>
                awardPoints(db, uid, t.artistId, 'CRATE_ADD', {
                    name:   t.artist || t.artistName || null,
                    handle: t.artistHandle || null,
                    img:    t.img    || t.artUrl     || null,
                })
            )
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/crates/user/:uid  — crates by a user (profile Signature Stack)
    //
    // Index needed: creatorId ASC + createdAt DESC
    // For other users also needs: creatorId ASC + privacy ASC + createdAt DESC
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/api/crates/user/:uid', verifyUser, async (req, res) => {
        try {
            const targetUid    = req.params.uid;
            const isOwnProfile = targetUid === req.uid;

            // Own profile sees all crates; others only see public ones
            let q = db.collection('crates')
                .where('creatorId', '==', targetUid)
                .orderBy('createdAt', 'desc')
                .limit(50);

            if (!isOwnProfile) {
                q = db.collection('crates')
                    .where('creatorId', '==', targetUid)
                    .where('privacy',   '==', 'public')
                    .orderBy('createdAt', 'desc')
                    .limit(50);
            }

            const snap = await q.get();

            const crates = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id:            doc.id,
                    title:         d.title         || 'Untitled',
                    trackCount:    d.trackCount    || 0,
                    likes:         d.likes         || 0,
                    coverImage:    d.coverImage    ? normalizeUrl(d.coverImage) : null,
                    creatorHandle: d.creatorHandle || null,
                    createdAt:     d.createdAt,
                    updatedAt:     d.updatedAt,
                    privacy:       d.privacy       || 'public',
                    genres:        d.metadata?.genres || [],
                };
            });

            res.json({ crates });
        } catch (e) {
            console.error('loadUserCrates error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/crate/:crateId  — single crate by ID
    //
    // Flat collection = one document read. No collectionGroup, no path parsing.
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/api/crate/:crateId', verifyUser, async (req, res) => {
        try {
            const snap = await db.collection('crates').doc(req.params.crateId).get();

            if (!snap.exists) return res.status(404).json({ error: 'Crate not found' });

            const d = snap.data();

            if (d.privacy === 'private' && d.creatorId !== req.uid) {
                return res.status(403).json({ error: 'Private crate' });
            }

            // Back-fill creatorHandle for docs that predate the field
            let creatorHandle = d.creatorHandle || null;
            let creatorAvatar = d.creatorAvatar ? normalizeUrl(d.creatorAvatar) : null;
            if (!creatorHandle && d.creatorId) {
                const ownerDoc = await db.collection('users').doc(d.creatorId).get();
                if (ownerDoc.exists) {
                    creatorHandle = ownerDoc.data().handle || null;
                    creatorAvatar = creatorAvatar || (ownerDoc.data().photoURL ? normalizeUrl(ownerDoc.data().photoURL) : null);
                }
            }

            res.json({
                id:            snap.id,
                title:         d.title      || 'Untitled',
                tracks:        normalizeTracks(d.tracks),
                coverImage:    d.coverImage ? normalizeUrl(d.coverImage) : null,
                metadata:      d.metadata   || {},
                privacy:       d.privacy    || 'public',
                likes:         d.likes      || 0,
                creatorHandle,
                creatorAvatar,
                creatorId:     d.creatorId  || null,
                createdAt:     d.createdAt,
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

            const normalizedTracks = normalizeTracks(JSON.parse(tracksJson || '[]'));
            const metadata         = JSON.parse(metaJson || '{}');

            const userDoc  = await db.collection('users').doc(req.uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            const cityKey  = makeCityKey(userData.city, userData.state, userData.country);

            const newRef = db.collection('crates').doc();

            let coverImageUrl = existingCoverUrl ? normalizeUrl(existingCoverUrl) : null;
            if (req.file) {
                coverImageUrl = await uploadCoverToR2(req.file.buffer, req.uid, newRef.id, req.file.mimetype);
            }

            const now       = admin.firestore.FieldValue.serverTimestamp();
            const crateData = {
                id:            newRef.id,
                creatorId:     req.uid,
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

            await newRef.set(crateData);

            updateCitySoundscape(cityKey, crateData, 'create').catch(() => {});
            awardCratePoints(req.uid, normalizedTracks, []).catch(() => {});

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

            const crateRef = db.collection('crates').doc(crateId);
            const snap     = await crateRef.get();

            if (!snap.exists)                       return res.status(404).json({ error: 'Crate not found' });
            if (snap.data().creatorId !== req.uid)  return res.status(403).json({ error: 'Forbidden' });

            const existing         = snap.data();
            const prevTrackIds     = (existing.tracks || []).map(t => t.songId).filter(Boolean);
            const normalizedTracks = normalizeTracks(JSON.parse(tracksJson || '[]'));
            const metadata         = JSON.parse(metaJson || '{}');

            let coverImageUrl = existingCoverUrl ? normalizeUrl(existingCoverUrl) : existing.coverImage;
            if (req.file) {
                coverImageUrl = await uploadCoverToR2(req.file.buffer, req.uid, crateId, req.file.mimetype);
            }

            const updates = {
                title:      title    || existing.title,
                tracks:     normalizedTracks,
                trackCount: normalizedTracks.length,
                privacy:    privacy  || existing.privacy || 'public',
                coverImage: coverImageUrl || null,
                metadata:   { ...existing.metadata, ...metadata },
                updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
            };

            await crateRef.update(updates);

            updateCitySoundscape(existing.cityKey, { ...existing, ...updates }, 'update').catch(() => {});
            awardCratePoints(req.uid, normalizedTracks, prevTrackIds).catch(() => {});

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
            const crateRef = db.collection('crates').doc(req.params.crateId);
            const snap     = await crateRef.get();

            if (!snap.exists)                      return res.status(404).json({ error: 'Crate not found' });
            if (snap.data().creatorId !== req.uid) return res.status(403).json({ error: 'Forbidden' });

            await crateRef.delete();
            updateCitySoundscape(snap.data().cityKey, snap.data(), 'delete').catch(() => {});

            res.json({ success: true });
        } catch (e) {
            console.error('deleteCrate error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/crate/:crateId/like  — toggle like (legacy endpoint with ownerId body)
    // POST /api/crate/like/toggle    — toggle like (DashboardController endpoint)
    // GET  /api/crate/like/check     — check like status
    //
    // Likes live as: crates/{crateId}/likes/{uid}
    // ─────────────────────────────────────────────────────────────────────────
    async function toggleLike(crateId, uid) {
        const crateRef = db.collection('crates').doc(crateId);
        const likeRef  = crateRef.collection('likes').doc(uid);
        const likeSnap = await likeRef.get();
        const inc      = admin.firestore.FieldValue.increment;

        if (likeSnap.exists) {
            await Promise.all([likeRef.delete(), crateRef.update({ likes: inc(-1) })]);
            return false;
        } else {
            await Promise.all([
                likeRef.set({ uid, likedAt: admin.firestore.FieldValue.serverTimestamp() }),
                crateRef.update({ likes: inc(1) }),
            ]);
            return true;
        }
    }

    router.post('/api/crate/:crateId/like', verifyUser, async (req, res) => {
        try {
            const liked = await toggleLike(req.params.crateId, req.uid);
            res.json({ success: true, liked });
        } catch (e) {
            console.error('likeCrate error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/api/crate/like/toggle', verifyUser, async (req, res) => {
        try {
            const { crateId } = req.body;
            if (!crateId) return res.status(400).json({ error: 'crateId required' });
            const liked = await toggleLike(crateId, req.uid);
            res.json({ success: true, liked });
        } catch (e) {
            console.error('likeCrateToggle error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/api/crate/like/check', verifyUser, async (req, res) => {
        try {
            const { crateId } = req.query;
            if (!crateId) return res.status(400).json({ error: 'crateId required' });
            const likeSnap = await db.collection('crates').doc(crateId)
                .collection('likes').doc(req.uid).get();
            res.json({ liked: likeSnap.exists });
        } catch (e) {
            console.error('likeCheck error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/discovery  — public crates for a city (dashboard feed)
    //
    // Index needed: cityKey ASC + privacy ASC + createdAt DESC
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/api/discovery', verifyUser, async (req, res) => {
        try {
            const { city, state, country } = req.query;
            const cityKey = makeCityKey(city, state, country);
            if (!cityKey) return res.status(400).json({ error: 'city is required' });

            const snap = await db.collection('crates')
                .where('cityKey', '==', cityKey)
                .where('privacy', '==', 'public')
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
    // DRAFT ENDPOINTS  (stored in users/{uid}/meta/draft — unchanged)
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