/* routes/artist/login.js */
const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");

// Render Login Page
router.get('/login', (req, res) => {
    res.render('artist_signin', { title: 'Artist Login | Eporia' });
});

// ==========================================
// ROUTE: CHECK ARTIST APPROVAL STATUS
// ==========================================
router.get('/api/check-approval-status/:artistId', async (req, res) => {
    try {
        const { artistId } = req.params;
        
        const artistDoc = await db.collection('artists').doc(artistId).get();
        
        if (!artistDoc.exists) {
            return res.status(404).json({ error: "Artist not found" });
        }
        
        const data = artistDoc.data();
        
        res.json({
            status: data.status,
            approved: data.reviewApproved || false,
            dashboardAccess: data.dashboardAccess || false,
            approvedAt: data.approvedAt?.toDate(),
            rejectedAt: data.rejectedAt?.toDate(),
            rejectionReason: data.rejectionReason || null
        });

    } catch (error) {
        console.error("Check Status Error:", error);
        res.status(500).json({ error: error.message });
    }
});


module.exports = router;