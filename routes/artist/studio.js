/* routes/artist/studio.js */
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
        res.status(403).json({ error: "Invalid or expired session. Please log in again." }); 
    }
}

// ==========================================
// PAGE RENDER ROUTES
// ==========================================
router.get('/studio', (req, res) => {
    res.render('artist_studio', { title: 'Artist Studio | Eporia' });
});

router.get('/pending-status', async (req, res) => {
    try {
        const db = admin.firestore();
        const artistId = req.query.id;
        if (!artistId) return res.redirect('/artist/login');

        const artistDoc = await db.collection('artists').doc(artistId).get();
        if (!artistDoc.exists) return res.redirect('/artist/login');

        const artistData = artistDoc.data();
        
        // NOTE: Change this to 'artist/pending_approval' if your file is in a subfolder
        res.render('pending_approval', { 
            status: artistData.status,
            appliedAt: artistData.appliedAt?.toDate(),
            rejectionReason: artistData.rejectionReason,
            artistId: artistId
        });
    } catch (error) {
        res.redirect('/artist/login');
    }
});

// ==========================================
// STUDIO DASHBOARD API
// ==========================================
router.get('/api/studio/dashboard', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
        
        if (snapshot.empty) return res.status(404).json({ error: "No artist profile linked to this login." });
        
        const doc = snapshot.docs[0];
        const data = doc.data();

        if (!data.dashboardAccess || data.status !== 'approved') {
            return res.json({ isPending: true, status: data.status, artistId: doc.id });
        }
        
        res.json({
            artistId: doc.id, 
            profile: { name: data.name, image: data.profileImage, handle: data.handle },
            stats: { listeners: data.stats?.monthlyListeners || 0, followers: data.stats?.followers || 0, tipsTotal: 0.00 },
            recentActivity: [],
            catalog: { albums: 0, tracks: 0, merch: 0 }
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// SECURITY & SETUP API
// ==========================================
router.get('/api/studio/check-status/:artistId', async (req, res) => {
    try {
        const db = admin.firestore();
        const doc = await db.collection('artists').doc(req.params.artistId).get();
        if (!doc.exists) return res.status(404).json({ error: "Artist not found" });
        const data = doc.data();
        res.json({ needsSetup: !data.ownerEmail, artistName: data.name, artistHandle: data.handle });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/studio/setup-credentials', async (req, res) => {
    try {
        const db = admin.firestore();
        const { artistId, email, password } = req.body;
        
        const userRecord = await admin.auth().createUser({ email, password, displayName: `Artist: ${artistId}` });
        await db.collection('artists').doc(artistId).update({
            ownerUid: userRecord.uid, ownerEmail: email, status: 'active',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const customToken = await admin.auth().createCustomToken(userRecord.uid);
        res.json({ success: true, token: customToken });
    } catch (e) { res.status(500).json({ error: e.message }); }
});



module.exports = router;