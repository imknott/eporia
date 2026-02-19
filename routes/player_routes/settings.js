const express = require('express');
const admin = require('firebase-admin');

module.exports = (db, verifyUser) => {
    const router = express.Router();

    // --- Get User Settings ---
    router.get('/api/settings', verifyUser, async (req, res) => {
        try {
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
            
            const data = userDoc.data();
            res.json({
                handle: data.handle || '',
                bio: data.bio || '',
                settings: data.settings || {}
            });
        } catch (e) {
            console.error("Settings GET Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // --- Save User Settings ---
    router.post('/api/settings/save', verifyUser, express.json(), async (req, res) => {
        try {
            await db.collection('users').doc(req.uid).update({
                settings: req.body,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            res.json({ success: true });
        } catch (e) {
            console.error("Settings SAVE Error:", e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};