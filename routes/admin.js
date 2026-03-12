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
            const lic = data.licensing || {};

            // Priority: ISRC = high, licensing follow-up needed = medium, else normal
            let priority = 'normal';
            if (data.verification?.isrc) {
                priority = 'high';
            } else if (
                lic.adminFlags?.requiresProFollowUp ||
                lic.adminFlags?.requiresMlcFollowUp ||
                lic.adminFlags?.requiresPublisherCheck
            ) {
                priority = 'medium'; // needs rights discussion before approval
            }

            if (priorityFilter && priority !== priorityFilter) return;

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
                priority,
                bio: data.bio,
                location: data.location,
                submittedAt: data.appliedAt?.toDate(),
                goals: data.goals || [],

                // ── LICENSING / RIGHTS DATA ─────────────────────────────
                // Submitted by the artist on the signup form.
                // Use this to decide what follow-up emails you need to send
                // before approving. See adminFlags for quick booleans.
                licensing: {
                    proMembership:   lic.proMembership   || 'none',
                    mlcRegistered:   lic.mlcRegistered   || 'no',
                    hasPublisher:    lic.hasPublisher     || 'self',
                    publisherName:   lic.publisherName   || null,
                    adminFlags: {
                        requiresProFollowUp:    lic.adminFlags?.requiresProFollowUp    || false,
                        requiresMlcFollowUp:    lic.adminFlags?.requiresMlcFollowUp    || false,
                        requiresPublisherCheck: lic.adminFlags?.requiresPublisherCheck || false,
                        // One-liner for your review panel display
                        summary: lic.adminFlags?.summary || 'No licensing data submitted'
                    },
                    // Any notes you added via the PATCH /licensing-notes endpoint
                    adminNotes: lic.adminNotes || null,
                    adminNotesAt: lic.adminNotesAt?.toDate?.() || null
                }
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

        // 3. Link the Auth UID to the artist profile — NO users/ doc is created.
        //    Artists are not fan subscribers. Their identity lives exclusively in
        //    artists/{artistId}. Writing to users/ would let them load the player
        //    app as a ghost account with no fan data.
        //
        //    CRITICAL: field must be `ownerUid` — this is what verifyArtist in
        //    merch.js, the studio dashboard query, and upload.js all check against.
        //    A different field name (e.g. userId) causes every authenticated artist
        //    request to silently fail with 403 or return an empty result set,
        //    meaning merch items can never be saved or read back.
        //
        //    LOCATION FLATTENING: signup stores location as a nested object
        //    { city, state, country, coordinates }. The dashboard and city soundscape
        //    map query TOP-LEVEL fields via Firestore .where('city', '==', ...) and
        //    .select('city', 'state', ...). Nested fields are invisible to those
        //    queries, so we flatten them at approval time.
        // Resolve location object regardless of how signup stored it.
        // The Photon autocomplete on the artist application stores location as an object
        // { city, state, country, coordinates } but plain text inputs store it as a
        // comma-separated string "San Diego, California, United States".
        // Either way we want top-level city/state/country fields on the artist doc so
        // Firestore .where('city', '==', ...) queries work.
        let loc = {};
        if (artistData.location && typeof artistData.location === 'object') {
            // Already a structured object from the autocomplete widget
            loc = artistData.location;
        } else if (artistData.location && typeof artistData.location === 'string') {
            // Plain string — parse "City, State, Country" (same logic as dashboard.js)
            const parts = artistData.location.split(',').map(p => p.trim()).filter(Boolean);
            loc = {
                city:    parts[0] || null,
                state:   parts[1] || null,
                country: parts[2] || null,
            };
        }

        const approvalUpdate = {
            status:          'approved',
            reviewApproved:  true,
            dashboardAccess: true,
            approvedAt:      admin.firestore.FieldValue.serverTimestamp(),
            approvedBy:      req.uid,
            adminNotes:      adminNotes || "Approved",
            ownerUid:        userRecord.uid,  // ← must match what verifyArtist checks
        };

        // Flatten location → top-level fields so Firestore equality queries work.
        // Only write if not already present (idempotent for re-approvals).
        if (loc.city        && !artistData.city)        approvalUpdate.city        = loc.city.trim();
        if (loc.state       && !artistData.state)       approvalUpdate.state       = loc.state.trim();
        if (loc.country     && !artistData.country)     approvalUpdate.country     = loc.country.trim();
        if (loc.coordinates && !artistData.coordinates) approvalUpdate.coordinates = loc.coordinates;

        await db.collection('artists').doc(artistId).update(approvalUpdate);

        // 3a. Initialize the merch subcollection so Firestore's composite index
        //     (status ASC, createdAt DESC) is queryable immediately and the public
        //     storefront doesn't throw on a brand-new artist with zero items.
        //     Write a placeholder then immediately delete it — primes the path
        //     without leaving junk data visible in the store.
        try {
            const placeholderRef = db
                .collection('artists').doc(artistId)
                .collection('merch').doc('_init');
            await placeholderRef.set({
                _placeholder: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            await placeholderRef.delete();
        } catch (initErr) {
            // Non-fatal — subcollection will be created on first real item write
            console.warn(`[admin] merch subcollection init warning for ${artistId}:`, initErr.message);
        }

        // 4. Clean up any stale users/ doc that may exist for this UID
        //    (e.g. if the artist previously signed up as a fan with the same email)
        const existingUserDoc = await db.collection('users').doc(userRecord.uid).get();
        if (existingUserDoc.exists) {
            const existingData = existingUserDoc.data();
            if (existingData.role === 'artist') {
                await db.collection('users').doc(userRecord.uid).delete();
            } else {
                // Was a fan account — keep their subscription but note the artistId
                await db.collection('users').doc(userRecord.uid).set(
                    { artistId: artistId },
                    { merge: true }
                );
            }
        }

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

        // 6. Bust the Firestore dashboard cache for this artist's city so fans
        //    in that city see the newly approved artist immediately rather than
        //    waiting up to 30 minutes for the TTL to expire.
        //    dashboardCache docs are keyed by `${uid}__${cityKey}` and store the
        //    cityKey as a top-level field so we can query by it.
        const approvedCity  = approvalUpdate.city  || loc.city;
        const approvedState = approvalUpdate.state || loc.state;
        if (approvedCity && approvedState) {
            try {
                const bustCityKey = `${approvedCity.trim().toLowerCase().replace(/\s+/g,'_')}__${approvedState.trim().toLowerCase().replace(/\s+/g,'_')}`;
                const staleCache  = await db.collection('dashboardCache')
                    .where('cityKey', '==', bustCityKey)
                    .get();
                if (!staleCache.empty) {
                    const bustBatch = db.batch();
                    staleCache.docs.forEach(d => bustBatch.delete(d.ref));
                    await bustBatch.commit();
                    console.log(`[admin] Busted ${staleCache.size} dashboardCache doc(s) for ${approvedCity}`);
                }
            } catch (cacheErr) {
                // Non-fatal — cache will expire naturally
                console.warn('[admin] dashboardCache bust warning:', cacheErr.message);
            }
        }

        // 7. Log the admin action
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
// API: SAVE ADMIN LICENSING FOLLOW-UP NOTES
//
// Called from your admin review panel when you've emailed an artist about
// their PRO/MLC/publisher situation and want to record what was discussed.
// Stored under licensing.adminNotes on the artist doc so it shows up
// in the review panel alongside the original answers.
//
// PATCH /admin/api/artists/:artistId/licensing-notes
// Body: { notes: "Confirmed BMI member - waiver email sent 2025-03-11" }
// ==========================================
router.patch('/api/artists/:artistId/licensing-notes', verifyAdmin, express.json(), async (req, res) => {
    try {
        const { artistId } = req.params;
        const { notes } = req.body;

        if (!notes || !notes.trim()) {
            return res.status(400).json({ error: 'Notes text is required' });
        }

        const artistDoc = await db.collection('artists').doc(artistId).get();
        if (!artistDoc.exists) {
            return res.status(404).json({ error: 'Artist not found' });
        }

        // Merge into the existing licensing object — preserves all artist-submitted answers
        await db.collection('artists').doc(artistId).update({
            'licensing.adminNotes':   notes.trim(),
            'licensing.adminNotesBy': req.uid,
            'licensing.adminNotesAt': admin.firestore.FieldValue.serverTimestamp()
        });

        // Log it so you have an audit trail
        await db.collection('admin_actions').add({
            type:       'licensing_notes_saved',
            artistId:   artistId,
            artistName: artistDoc.data().name,
            performedBy: req.uid,
            timestamp:  admin.firestore.FieldValue.serverTimestamp(),
            notes:      notes.trim()
        });

        res.json({ success: true, message: 'Licensing notes saved' });

    } catch (error) {
        console.error('Licensing Notes Error:', error);
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
        const highPriority   = allPending.filter(a => a.verification?.isrc).length;
        const needsLicensingFollowUp = allPending.filter(a =>
            a.licensing?.adminFlags?.requiresProFollowUp    ||
            a.licensing?.adminFlags?.requiresMlcFollowUp    ||
            a.licensing?.adminFlags?.requiresPublisherCheck
        ).length;
        
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
            pendingCount:             pendingArtists.size,
            highPriorityCount:        highPriority,
            needsLicensingFollowUp,   // artists whose PRO/MLC/publisher status needs discussion
            approvedTodayCount:       approvedToday.size,
            totalUsers:               totalUsers.size,
            avgReviewTime:            avgReviewTime
        });
        
    } catch (error) {
        console.error("Stats Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// API: ONE-TIME MIGRATION — flatten location fields for existing approved artists
//
// Approved artists stored location as a nested object { city, state, country, coordinates }.
// The dashboard and soundscape map query top-level city/state fields, so artists approved
// before this fix have no city on the map.
//
// Call once: POST /admin/api/migrate/fix-artist-locations
// Safe to call multiple times (idempotent — only updates docs missing top-level city).
// ==========================================
router.post('/api/migrate/fix-artist-locations', verifyAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('artists')
            .where('status', '==', 'approved')
            .get();

        let batch   = db.batch();
        let opCount = 0;
        let fixed   = 0;
        let skipped = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();

            // Parse location whether it was stored in `geo`, `location` (object), or `location` (string)
            let loc = {};
            
            if (data.geo && typeof data.geo === 'object') {
                // Map the `geo` object from the screenshot
                loc = {
                    city: data.geo.city || null,
                    state: data.geo.state || null,
                    country: data.geo.country || null,
                    coordinates: (data.geo.lat != null && data.geo.lng != null) 
                        ? { lat: data.geo.lat, lng: data.geo.lng } 
                        : null
                };
            } else if (data.location && typeof data.location === 'object') {
                // Handle the old `location` object structure
                loc = data.location;
            } else if (data.location && typeof data.location === 'string') {
                // Handle the old plain string format
                const parts = data.location.split(',').map(p => p.trim()).filter(Boolean);
                loc = { city: parts[0] || null, state: parts[1] || null, country: parts[2] || null };
            }

            // Only patch if top-level city is missing but we have a parsed city
            if (!data.city && loc.city) {
                const patch = {};
                if (loc.city)        patch.city        = loc.city.trim();
                if (loc.state)       patch.state       = loc.state.trim();
                if (loc.country)     patch.country     = loc.country.trim();
                if (loc.coordinates) patch.coordinates = loc.coordinates;

                batch.update(doc.ref, patch);
                opCount++;
                fixed++;

                // Firestore batch limit
                if (opCount === 499) {
                    await batch.commit();
                    batch   = db.batch();
                    opCount = 0;
                }
            } else {
                skipped++;
            }
        }

        if (opCount > 0) await batch.commit();

        console.log(`[migrate] artist locations: ${fixed} patched, ${skipped} already had top-level city`);
        res.json({ success: true, fixed, skipped });

    } catch (error) {
        console.error('Location migration error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
// ==========================================
// API: ONE-TIME MIGRATION — userId → ownerUid
// Fixes artists approved before the ownerUid rename.
// Safe to call multiple times (idempotent).
// DELETE this route once migration is confirmed complete.
// ==========================================
router.post('/api/migrate/fix-owner-uid', verifyAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('artists')
            .where('status', '==', 'approved')
            .get();

        const batch   = db.batch();
        let   fixed   = 0;
        let   skipped = 0;

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            // Only patch docs that have userId but no ownerUid
            if (data.userId && !data.ownerUid) {
                batch.update(doc.ref, {
                    ownerUid: data.userId,
                    // Leave userId in place for any code that may still reference it
                });
                fixed++;
            } else {
                skipped++;
            }
        });

        if (fixed > 0) await batch.commit();

        console.log(`[migrate] ownerUid fix: ${fixed} patched, ${skipped} already correct`);
        res.json({ success: true, fixed, skipped });

    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({ error: error.message });
    }
});