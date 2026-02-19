/* routes/player_routes/profile.js */
const express = require('express');
const admin = require('firebase-admin');

module.exports = (db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL) => {
    const router = express.Router();

    // Normalizes any image URL to use the canonical CDN_URL.
    // Handles three cases:
    //   1. Raw R2 dev URLs (pub-xxx.r2.dev) saved before a custom domain was set
    //   2. Relative paths (no http prefix)
    //   3. Already-correct CDN URLs (passed through unchanged)
    const R2_DEV_PATTERN = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;
    function normalizeUrl(url) {
        if (!url) return null;
        // Relative path — prepend CDN
        if (!url.startsWith('http')) return `${CDN_URL}/${url.replace(/^\//, '')}`;
        // Raw R2 dev URL — swap domain for CDN
        if (R2_DEV_PATTERN.test(url)) return url.replace(R2_DEV_PATTERN, CDN_URL);
        // Already an http URL (correct CDN or external placeholder) — pass through
        return url;
    }

    // --- Upload Avatar ---
    router.post('/api/profile/upload', verifyUser, upload.single('avatar'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const uid = req.uid;
            const timestamp = Date.now();
            const filename = `users/${uid}/avatar_${timestamp}.jpg`;

            await r2.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: filename,
                Body: req.file.buffer,
                ContentType: req.file.mimetype
            }));

            const finalUrl = `${CDN_URL}/${filename}`;
            await db.collection('users').doc(uid).update({ photoURL: finalUrl });

            res.json({ success: true, url: finalUrl });
        } catch (e) {
            console.error('Avatar upload error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // --- Upload Avatar (alias) ---
    router.post('/api/profile/upload-avatar', verifyUser, upload.single('avatar'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const uid = req.uid;
            const timestamp = Date.now();
            const filename = `users/${uid}/avatar_${timestamp}.jpg`;

            await r2.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: filename,
                Body: req.file.buffer,
                ContentType: req.file.mimetype
            }));

            const finalUrl = `${CDN_URL}/${filename}`;
            await db.collection('users').doc(uid).update({ photoURL: finalUrl });
            res.json({ success: true, url: finalUrl });
        } catch (e) {
            console.error('Avatar upload error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // --- Upload Cover Photo ---
    router.post('/api/profile/upload-cover', verifyUser, upload.single('cover'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const uid = req.uid;
            const timestamp = Date.now();
            const filename = `users/${uid}/cover_${timestamp}.jpg`;

            await r2.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: filename,
                Body: req.file.buffer,
                ContentType: req.file.mimetype
            }));

            const finalUrl = `${CDN_URL}/${filename}`;
            await db.collection('users').doc(uid).update({ coverURL: finalUrl });

            res.json({ success: true, url: finalUrl });
        } catch (e) {
            console.error('Cover upload error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // --- Update Profile Data ---
    router.post('/api/profile/update', verifyUser, express.json(), async (req, res) => {
        try {
            const { handle, bio, location, avatar, coverURL, anthem } = req.body;
            const updateData = {};

            if (handle)            updateData.handle     = handle;
            if (bio !== undefined) updateData.bio        = bio;
            if (location)          updateData.location   = location;
            if (avatar)            updateData.photoURL   = avatar;
            if (anthem !== undefined) updateData.profileSong = anthem;
            if (coverURL)          updateData.coverURL   = coverURL;

            updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

            await db.collection('users').doc(req.uid).update(updateData);

            res.json({ success: true, data: updateData });
        } catch (e) {
            console.error('Profile update error:', e);
            res.status(500).json({ error: e.message });
        }
    });
  // ✅ SPECIFIC route FIRST
router.get('/api/profile/following/:uid', verifyUser, async (req, res) => {
    const targetUid = req.params.uid;
    try {
        const userRef = db.collection('users').doc(targetUid);
        const followingSnap = await userRef.collection('following').orderBy('followedAt', 'desc').get();

        const artists = [];
        const users = [];

        followingSnap.forEach(doc => {
            const data = doc.data();
            const item = { id: doc.id, ...data };
            if (data.type === 'artist') artists.push(item);
            else users.push(item);
        });

        res.json({ artists, users });
    } catch (e) {
        res.status(500).json({ error: "Could not fetch connections" });
    }
});

// ✅ GENERIC :uid route SECOND
router.get('/api/profile/:uid', verifyUser, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        const userDoc = await db.collection('users').doc(targetUid).get();
        
        if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
        
        const userData = userDoc.data();
        
        res.json({
            uid: targetUid,
            handle: userData.handle || '',
            bio: userData.bio || '',
            role: userData.role || 'member',
            photoURL: userData.photoURL || '',           
            coverURL: userData.coverURL || '',         
            joinDate: userData.joinDate || null,      
            profileSong: userData.profileSong || null       
        });
    } catch (e) {
        console.error('Get Profile Error:', e);
        res.status(500).json({ error: e.message });
    }
});

    // --- Lookup user by handle (used by public profile pages) ---
    router.get('/api/user/by-handle', verifyUser, async (req, res) => {
        try {
            const { handle } = req.query;
            if (!handle) return res.status(400).json({ error: 'Handle required' });

            const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
            const snap = await db.collection('users')
                .where('handle', '==', cleanHandle)
                .limit(1)
                .get();

            if (snap.empty) return res.status(404).json({ error: 'User not found' });

            const doc = snap.docs[0];
            res.json({ uid: doc.id });
        } catch (e) {
            console.error('By-handle lookup error:', e);
            res.status(500).json({ error: e.message });
        }
    });

   
    return router;
};