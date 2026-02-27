/* routes/admin.js - FIXED VERSION */
var express = require('express');
var router = express.Router();
var admin = require("firebase-admin");

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
    try {
        var serviceAccount = require("../serviceAccountKey.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.warn("Attempting default init...", e);
        try {
            admin.initializeApp({
                projectId: process.env.FIREBASE_PROJECT_ID
            });
        } catch (err) {
            console.error("Firebase Init Failed:", err);
        }
    }
}

const db = admin.firestore();

// ==========================================
// MIDDLEWARE: VERIFY ADMIN ROLE (For API Routes)
// ==========================================
async function verifyAdmin(req, res, next) {
    const idToken = req.headers.authorization;
    
    if (!idToken) {
        return res.status(401).json({ 
            error: "Unauthorized", 
            message: "No authentication token provided" 
        });
    }
    
    try {
        const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        
        // Get user document from Firestore to check role
        const userDoc = await db.collection('users').doc(decoded.uid).get();
        
        if (!userDoc.exists) {
            return res.status(403).json({ 
                error: "Forbidden", 
                message: "User profile not found" 
            });
        }
        
        const userData = userDoc.data();
        
        // Check if user has admin role
        if (userData.role !== 'admin') {
            console.log(`Access denied for user ${decoded.uid} with role: ${userData.role}`);
            return res.status(403).json({ 
                error: "Forbidden", 
                message: "Admin access required" 
            });
        }
        
        // Admin verified
        req.uid = decoded.uid;
        req.userRole = userData.role;
        next();
        
    } catch (error) {
        console.error("Admin verification error:", error);
        return res.status(403).json({ 
            error: "Invalid Token", 
            message: error.message 
        });
    }
}

// ==========================================
// ADMIN LOGIN PAGE
// ==========================================
router.get('/login', (req, res) => {
    res.render('admin/login', {
        title: 'Admin Login | Eporia'
    });
});

// ==========================================
// ADMIN DASHBOARD (HOME) - NO AUTH REQUIRED ON PAGE LOAD
// ==========================================
router.get('/dashboard', (req, res) => {
    // Just render the page - authentication happens client-side via API calls
    res.render('admin/dashboard', {
        title: 'Admin Dashboard | Eporia'
    });
});

// ==========================================
// ARTIST REVIEW PANEL - NO AUTH REQUIRED ON PAGE LOAD
// ==========================================
router.get('/artists/review', (req, res) => {
    res.render('admin/review_panel', {
        title: 'Artist Applications | Eporia Admin'
    });
});

// ==========================================
// API: VERIFY ADMIN SESSION (NEW)
// ==========================================
router.get('/api/verify', verifyAdmin, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.uid).get();
        const userData = userDoc.data();
        
        res.json({
            success: true,
            user: {
                uid: req.uid,
                email: userData.email,
                handle: userData.handle,
                role: userData.role
            }
        });
    } catch (error) {
        console.error("Verify error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// API: GET PENDING ARTIST REVIEWS
// ==========================================
router.get('/api/artists/pending', verifyAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const priorityFilter = req.query.priority;
        
        // Get pending artists from main collection
        let artistQuery = db.collection('artists')
            .where('status', '==', 'pending_review')
            .orderBy('appliedAt', 'desc')
            .limit(limit);
        
        const artistsSnapshot = await artistQuery.get();
        
        const reviews = [];
        artistsSnapshot.forEach(doc => {
            const data = doc.data();
            
            // Filter by priority if specified
            const hasPriority = data.verification?.isrc ? 'high' : 'normal';
            if (priorityFilter && hasPriority !== priorityFilter) {
                return;
            }
            
            reviews.push({
                id: doc.id,
                artistName: data.name,
                handle: data.handle,
                contactEmail: data.verification?.contactEmail,
                contactMethod: data.verification?.contactMethod,
                artistType: data.verification?.artistType || 'solo',
                memberCount: data.verification?.members?.length || 1,
                members: data.verification?.members || [],
                musicLinks: data.verification?.links || {},
                isrc: data.verification?.isrc,
                status: data.status,
                priority: hasPriority,
                bio: data.bio,
                location: data.location,
                submittedAt: data.appliedAt?.toDate(),
                goals: data.goals || []
            });
        });
        
        res.json({ reviews });
        
    } catch (error) {
        console.error("Fetch Reviews Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// API: GET SINGLE ARTIST APPLICATION DETAILS
// ==========================================
router.get('/api/artists/:artistId', verifyAdmin, async (req, res) => {
    try {
        const { artistId } = req.params;
        
        const artistDoc = await db.collection('artists').doc(artistId).get();
        
        if (!artistDoc.exists) {
            return res.status(404).json({ error: "Artist not found" });
        }
        
        const data = artistDoc.data();
        
        res.json({
            id: artistDoc.id,
            ...data,
            appliedAt: data.appliedAt?.toDate(),
            approvedAt: data.approvedAt?.toDate(),
            rejectedAt: data.rejectedAt?.toDate()
        });
        
    } catch (error) {
        console.error("Get Artist Error:", error);
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// API: APPROVE ARTIST & CREATE AUTH ACCOUNT
// ==========================================
router.post('/api/artists/:artistId/approve', verifyAdmin, express.json(), async (req, res) => {
    try {
        const { artistId } = req.params;
        const { adminNotes, tempPassword } = req.body; // Capture the temp password
        
        if (!tempPassword || tempPassword.length < 6) {
            return res.status(400).json({ error: "A temporary password of at least 6 characters is required." });
        }

        // 1. Get artist document
        const artistDoc = await db.collection('artists').doc(artistId).get();
        
        if (!artistDoc.exists) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistData = artistDoc.data();
        const email = artistData.verification?.contactEmail;

        if (!email) {
            return res.status(400).json({ error: "Artist profile is missing a contact email." });
        }

        // 2. Create the Firebase Auth User
        let userRecord;
        try {
            userRecord = await admin.auth().createUser({
                email: email,
                password: tempPassword,
                displayName: artistData.name,
            });
        } catch (authError) {
            // If they already created a "fan" account with this email, grab that user instead
            if (authError.code === 'auth/email-already-exists') {
                userRecord = await admin.auth().getUserByEmail(email);
                // Update their password to the temp one so your email to them makes sense
                await admin.auth().updateUser(userRecord.uid, { password: tempPassword });
            } else {
                throw authError; // Re-throw if it's a different error
            }
        }

        // 3. Create/Update user document in the main 'users' collection
        await db.collection('users').doc(userRecord.uid).set({
            email: email,
            role: 'artist', // Elevate their role
            handle: artistData.handle,
            artistId: artistId, // Link back to the artist profile
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // 4. Update the artist profile
        await db.collection('artists').doc(artistId).update({
            status: 'approved',
            reviewApproved: true,
            dashboardAccess: true,
            approvedAt: admin.firestore.FieldValue.serverTimestamp(),
            approvedBy: req.uid,
            adminNotes: adminNotes || "Approved",
            ownerUid: userRecord.uid // Tie the auth account to the profile
        });

        // 5. Update the review queue (if you are querying it elsewhere)
        const queueSnapshot = await db.collection('artist_review_queue')
            .where('artistId', '==', artistId)
            .get();
            
        if (!queueSnapshot.empty) {
            const batch = db.batch();
            queueSnapshot.docs.forEach(doc => {
                batch.update(doc.ref, {
                    status: 'approved',
                    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
                    reviewedBy: req.uid
                });
            });
            await batch.commit();
        }

        // 6. Log the admin action
        await db.collection('admin_actions').add({
            type: 'artist_approval',
            artistId: artistId,
            artistName: artistData.name,
            performedBy: req.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            notes: adminNotes || "Approved",
            accountCreatedFor: email
        });
        
        console.log(`Artist ${artistData.name} approved. Account created for ${email}`);
        
        res.json({ 
            success: true, 
            message: "Artist approved and account created successfully!",
            email: email
        });
        
    } catch (error) {
        console.error("Approve Artist Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// API: REJECT ARTIST
// ==========================================
router.post('/api/artists/:artistId/reject', verifyAdmin, express.json(), async (req, res) => {
    try {
        const { artistId } = req.params;
        const { reason } = req.body;
        
        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: "Rejection reason is required" });
        }
        
        // 1. Get artist document
        const artistDoc = await db.collection('artists').doc(artistId).get();
        
        if (!artistDoc.exists) {
            return res.status(404).json({ error: "Artist not found" });
        }
        
        // 2. Update artist profile
        await db.collection('artists').doc(artistId).update({
            status: 'rejected',
            reviewApproved: false,
            dashboardAccess: false,
            rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
            rejectedBy: req.uid,
            rejectionReason: reason
        });
        
        // 3. Log the rejection action
        await db.collection('admin_actions').add({
            type: 'artist_rejection',
            artistId: artistId,
            artistName: artistDoc.data().name,
            performedBy: req.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            reason: reason
        });
        
        // 4. TODO: Send rejection email to artist
        console.log(`Artist ${artistDoc.data().name} rejected by ${req.uid}: ${reason}`);
        
        res.json({ 
            success: true, 
            message: "Artist rejected" 
        });
        
    } catch (error) {
        console.error("Reject Artist Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// API: GET ADMIN ACTIVITY LOG
// ==========================================
router.get('/api/activity-log', verifyAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        
        const actionsSnapshot = await db.collection('admin_actions')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        
        const actions = [];
        actionsSnapshot.forEach(doc => {
            const data = doc.data();
            actions.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp?.toDate()
            });
        });
        
        res.json({ actions });
        
    } catch (error) {
        console.error("Activity Log Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// API: GET DASHBOARD STATS
// ==========================================
router.get('/api/stats', verifyAdmin, async (req, res) => {
    try {
        // Pending artists
        const pendingArtists = await db.collection('artists')
            .where('status', '==', 'pending_review')
            .get();
        
        // High priority (with ISRC)
        const allPending = [];
        pendingArtists.forEach(doc => {
            allPending.push(doc.data());
        });
        const highPriority = allPending.filter(a => a.verification?.isrc).length;
        
        // Approved today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const approvedToday = await db.collection('artists')
            .where('status', '==', 'approved')
            .where('approvedAt', '>=', admin.firestore.Timestamp.fromDate(today))
            .get();
        
        // Total users
        const totalUsers = await db.collection('users').get();
        
        // Calculate average review time (from last 10 approved)
        const recentApproved = await db.collection('artists')
            .where('status', '==', 'approved')
            .orderBy('approvedAt', 'desc')
            .limit(10)
            .get();
        
        let totalReviewTime = 0;
        let reviewCount = 0;
        recentApproved.forEach(doc => {
            const data = doc.data();
            if (data.appliedAt && data.approvedAt) {
                const appliedTime = data.appliedAt.toDate();
                const approvedTime = data.approvedAt.toDate();
                const diffDays = (approvedTime - appliedTime) / (1000 * 60 * 60 * 24);
                totalReviewTime += diffDays;
                reviewCount++;
            }
        });
        
        const avgReviewTime = reviewCount > 0 
            ? (totalReviewTime / reviewCount).toFixed(1) 
            : '0.0';
        
        res.json({
            pendingCount: pendingArtists.size,
            highPriorityCount: highPriority,
            approvedTodayCount: approvedToday.size,
            totalUsers: totalUsers.size,
            avgReviewTime: avgReviewTime
        });
        
    } catch (error) {
        console.error("Stats Error:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;