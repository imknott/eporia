/* routes/artist/followers.js */
const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");

// ==========================================
// MIDDLEWARE: VERIFY USER
// ==========================================
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
// API: GET RECENT FOLLOWERS (Activity Feed)
// ==========================================
router.get('/api/studio/followers', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();
        
        // 1. Find the artist profile owned by this user
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) return res.status(404).json({ error: "Artist not found" });
        const artistId = artistSnap.docs[0].id;
        const limit = parseInt(req.query.limit) || 20;

        // 2. Fetch the raw follower documents
        const followersSnap = await db.collection('artists')
            .doc(artistId)
            .collection('followers')
            .orderBy('followedAt', 'desc')
            .limit(limit)
            .get();

        // 3. Hydrate the data with Listener profiles (Names & Avatars)
        const fetchUserPromises = [];

        followersSnap.forEach(doc => {
            const data = doc.data();
            
            // Create a promise to fetch the listener's public profile
            const userPromise = db.collection('users').doc(data.uid).get().then(userDoc => {
                const userData = userDoc.exists ? userDoc.data() : {};
                
                return {
                    id: doc.id, // The listener's UID
                    uid: data.uid,
                    name: userData.displayName || userData.name || userData.handle || 'New Listener',
                    avatar: userData.photoURL || userData.img || '/images/default-avatar.png',
                    followedAt: data.followedAt ? data.followedAt.toDate() : new Date(),
                    read: data.read || false
                };
            });
            
            fetchUserPromises.push(userPromise);
        });

        // Wait for all user profiles to be fetched
        const resolvedFollowers = await Promise.all(fetchUserPromises);

        res.json({ followers: resolvedFollowers });

    } catch (e) {
        console.error("Fetch Followers Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// API: MARK FOLLOWER NOTIFICATION AS READ
// ==========================================
router.post('/api/studio/followers/mark-read', verifyUser, express.json(), async (req, res) => {
    try {
        const db = admin.firestore();
        const { followerUid } = req.body;
        
        if (!followerUid) return res.status(400).json({ error: "Missing follower UID" });

        const artistSnap = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: "Artist not found" });

        // Add a "read" flag to the follower document so it doesn't show as a new notification
        await db.collection('artists')
            .doc(artistSnap.docs[0].id)
            .collection('followers')
            .doc(followerUid)
            .update({ 
                read: true,
                readAt: admin.firestore.FieldValue.serverTimestamp()
            });

        res.json({ success: true });

    } catch (e) {
        console.error("Mark Follower Read Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// API: GET UNREAD FOLLOWER COUNT
// ==========================================
router.get('/api/studio/followers/unread-count', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();
        const artistSnap = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: "Artist not found" });

        const unreadSnap = await db.collection('artists')
            .doc(artistSnap.docs[0].id)
            .collection('followers')
            .where('read', '==', false)
            .get();

        res.json({ count: unreadSnap.size });

    } catch (e) {
        console.error("Unread Follower Count Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;