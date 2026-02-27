/* routes/artist/signup.js */
const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");

// Render Onboarding Page
router.get('/onboarding', (req, res) => {
    res.render('artist_signup', { title: 'Artist Setup | Eporia' });
});

// API: Check Handle Availability
router.get('/api/check-handle/:handle', async (req, res) => {
    try {
        const db = admin.firestore();
        const rawHandle = req.params.handle.toLowerCase();
        const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
        const snapshot = await db.collection('artists')
            .where('handle', '==', handle)
            .limit(1)
            .get();

        res.json({ available: snapshot.empty });
    } catch (error) {
        console.error("Handle Check Error:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// API: Create Profile & Add to Review Queue
router.post('/api/create-profile', express.json(), async (req, res) => {
    try {
        const { identity, verification, music, goals, legalAgreedAt, status } = req.body;

        // 1. VALIDATION
        if (!identity?.artistName || !identity?.handle) {
            return res.status(400).json({ 
                success: false, 
                error: "Missing required fields: Artist Name and Handle" 
            });
        }

        if (!verification?.contactEmail) {
            return res.status(400).json({ 
                success: false, 
                error: "Contact email is required for verification" 
            });
        }

        if (!verification?.contactMethod) {
            return res.status(400).json({ 
                success: false, 
                error: "Preferred contact method is required" 
            });
        }

        // Check if at least one music platform link is provided
        const links = verification?.links || {};
        const hasMusicLink = links.spotify || links.youtube || links.apple || links.other;
        
        if (!hasMusicLink) {
            return res.status(400).json({ 
                success: false, 
                error: "At least one music platform link is required for verification" 
            });
        }

        // 2. CHECK IF HANDLE IS AVAILABLE
        const cleanHandle = identity.handle.toLowerCase().replace('@', '');
        const existingArtist = await db.collection('artists')
            .where('handle', '==', cleanHandle)
            .limit(1)
            .get();

        if (!existingArtist.empty) {
            return res.status(409).json({ 
                success: false, 
                error: "Handle already taken" 
            });
        }

        // 3. CREATE ARTIST PROFILE WITH PENDING REVIEW STATUS
        const artistData = {
            // Identity
            name: identity.artistName,
            handle: cleanHandle,
            bio: identity.bio || "",
            location: identity.location || "",
            geo: identity.geo || {},
            
            // Verification Info (stored for review team)
            verification: {
                contactEmail: verification.contactEmail,
                contactMethod: verification.contactMethod,
                artistType: verification.artistType || 'solo',
                members: verification.members || [],
                links: verification.links || {},
                isrc: verification.isrc || null,
                submittedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            
            // Music Profile
            primaryGenre: music?.primaryGenre || "General",
            subgenres: music?.subgenres || [],
            moods: music?.moods || [],
            
            // Feature Goals
            goals: goals || [],
            
            // Review Status Flags
            status: 'pending_review',  // CRITICAL: Artist cannot access dashboard until 'approved'
            reviewApproved: false,
            dashboardAccess: false,
            
            // Timestamps
            appliedAt: admin.firestore.FieldValue.serverTimestamp(),
            legalAgreedAt: legalAgreedAt || new Date().toISOString(),
            
            // Placeholder fields (to be filled during artist studio setup after approval)
            avatarUrl: null,
            bannerUrl: null,
            
            // Stats
            stats: {
                followers: 0,
                monthlyListeners: 0,
                comments: 0
            },
            
            // Will be set when they claim account after approval
            ownerUid: null,
            claimedAt: null
        };

        // 4. SAVE TO DATABASE
        const artistRef = await db.collection('artists').add(artistData);

        // 5. CREATE REVIEW QUEUE ENTRY
        await db.collection('artist_review_queue').add({
            artistId: artistRef.id,
            artistName: identity.artistName,
            handle: cleanHandle,
            contactEmail: verification.contactEmail,
            contactMethod: verification.contactMethod,
            artistType: verification.artistType || 'solo',
            memberCount: verification.members?.length || 1,
            musicLinks: verification.links,
            isrc: verification.isrc || null,
            status: 'pending',
            priority: verification.isrc ? 'high' : 'normal', // ISRC gets priority
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            reviewedAt: null,
            reviewedBy: null,
            notes: []
        });

        // 6. SEND NOTIFICATION EMAIL TO ADMIN TEAM (Optional)
        // You can integrate email service here to notify review team
        console.log(`New artist application: ${identity.artistName} (${cleanHandle})`);
        console.log(`Contact: ${verification.contactEmail} via ${verification.contactMethod}`);

        // 7. RETURN SUCCESS
        res.json({
            success: true,
            artistId: artistRef.id,
            message: "Application submitted successfully. We'll contact you soon!"
        });

    } catch (error) {
        console.error("Create Profile Error:", error);
        res.status(500).json({ 
            success: false, 
            error: error.message || "Failed to submit application" 
        });
    }
});

module.exports = router;