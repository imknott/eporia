/* routes/artist/settings.js */
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
// ROUTE: UPDATE PROFILE DATA
// ==========================================
router.post('/api/settings/update-profile', verifyUser, express.json(), async (req, res) => {
    try {
        const db = admin.firestore();
        const { bio, profileImage, bannerImage } = req.body;

        const artistSnap = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: "Artist not found" });

        const artistId = artistSnap.docs[0].id;
        const updateData = {};

        // Only update fields that were actually sent
        if (bio !== undefined) updateData.bio = bio;
        if (profileImage) updateData.avatarUrl = profileImage;
        if (bannerImage) updateData.bannerUrl = bannerImage;
        
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('artists').doc(artistId).update(updateData);

        res.json({ success: true, message: "Profile updated" });

    } catch (error) {
        console.error("Profile Update Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ROUTE: DELETE ACCOUNT & ALL ASSOCIATED DATA
// ==========================================
router.delete('/api/settings/delete-account', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();
        const uid = req.uid;

        // 1. Find the Artist Profile
        const artistSnap = await db.collection('artists').where('ownerUid', '==', uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: "Artist not found" });

        const artistDoc = artistSnap.docs[0];
        const artistId = artistDoc.id;

        // Initialize a batch for bulk deletion
        const batch = db.batch();

        // 2. Queue Deletion of all Songs by this Artist
        const songsSnap = await db.collection('songs').where('artistId', '==', artistId).get();
        songsSnap.forEach(song => {
            batch.delete(song.ref);
            // NOTE: In the future, you can also add logic here to trigger 
            // AWS S3 / R2 deletions for the physical audio files to save server space.
        });

        // 3. Queue Deletion of the Artist Profile itself
        batch.delete(artistDoc.ref);

        // Commit the Firestore deletions
        await batch.commit();

        // 4. Delete the user from Firebase Auth System
        await admin.auth().deleteUser(uid);

        console.log(`🗑️ Artist Account Deleted: ${artistId} (${uid})`);

        res.json({ success: true, message: "Account and data deleted." });

    } catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;