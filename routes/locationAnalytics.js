/* routes/locationAnalytics.js */
// =========================================
// LOCATION ANALYTICS & DATABASE BUILDER
// =========================================
// This route tracks user location selections to build our own location API
// over time, reducing dependency on external services like Photon.

const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");

const db = admin.firestore();

// =========================================
// TRACK LOCATION SELECTION
// =========================================
// Called every time a user selects a location during signup
router.post('/api/track-location', async (req, res) => {
    try {
        const { city, state, country, source, lat, lng } = req.body;

        if (!city || !country) {
            return res.status(400).json({ error: "City and country required" });
        }

        // Create unique location key
        const locationKey = state 
            ? `${city}, ${state}, ${country}` 
            : `${city}, ${country}`;

        // Reference to location analytics collection
        const locationRef = db.collection('locationAnalytics').doc(locationKey);

        // Get current document
        const doc = await locationRef.get();

        if (doc.exists) {
            // Increment selection count
            await locationRef.update({
                selectionCount: admin.firestore.FieldValue.increment(1),
                lastSelected: admin.firestore.FieldValue.serverTimestamp(),
                // Update coordinates if provided and not already set
                ...(lat && lng && !doc.data().lat && {
                    lat: parseFloat(lat),
                    lng: parseFloat(lng)
                })
            });
        } else {
            // Create new location record
            await locationRef.set({
                city,
                state: state || null,
                country,
                source, // 'curated_us', 'curated_international', or 'photon_api'
                selectionCount: 1,
                firstSelected: admin.firestore.FieldValue.serverTimestamp(),
                lastSelected: admin.firestore.FieldValue.serverTimestamp(),
                lat: lat ? parseFloat(lat) : null,
                lng: lng ? parseFloat(lng) : null,
                verified: source.includes('curated'), // Auto-verify curated locations
                needsReview: !source.includes('curated') // Flag Photon results for review
            });
        }

        res.json({ success: true, tracked: locationKey });

    } catch (error) {
        console.error("Location tracking error:", error);
        res.status(500).json({ error: "Failed to track location" });
    }
});

// =========================================
// GET POPULAR LOCATIONS
// =========================================
// Returns top N most-selected locations for autocomplete suggestions
router.get('/api/popular-locations', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const country = req.query.country; // Optional country filter

        let query = db.collection('locationAnalytics')
            .where('verified', '==', true)
            .orderBy('selectionCount', 'desc')
            .limit(limit);

        if (country) {
            query = query.where('country', '==', country);
        }

        const snapshot = await query.get();
        const locations = [];

        snapshot.forEach(doc => {
            locations.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.json({ locations });

    } catch (error) {
        console.error("Popular locations fetch error:", error);
        res.status(500).json({ error: "Failed to fetch popular locations" });
    }
});

// =========================================
// GET LOCATIONS NEEDING REVIEW
// =========================================
// Admin endpoint to review Photon API results
router.get('/api/locations-review', async (req, res) => {
    try {
        // TODO: Add admin authentication middleware here
        
        const snapshot = await db.collection('locationAnalytics')
            .where('needsReview', '==', true)
            .orderBy('selectionCount', 'desc')
            .limit(100)
            .get();

        const locations = [];
        snapshot.forEach(doc => {
            locations.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.json({ locations });

    } catch (error) {
        console.error("Review locations fetch error:", error);
        res.status(500).json({ error: "Failed to fetch review locations" });
    }
});

// =========================================
// APPROVE LOCATION
// =========================================
// Admin endpoint to approve a Photon result and add to curated list
router.post('/api/approve-location/:locationId', async (req, res) => {
    try {
        // TODO: Add admin authentication middleware here
        
        const { locationId } = req.params;
        const { emoji, color } = req.body; // Optional customization

        await db.collection('locationAnalytics').doc(locationId).update({
            verified: true,
            needsReview: false,
            approvedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(emoji && { emoji }),
            ...(color && { color })
        });

        res.json({ success: true, message: "Location approved" });

    } catch (error) {
        console.error("Location approval error:", error);
        res.status(500).json({ error: "Failed to approve location" });
    }
});

// =========================================
// EXPORT CURATED DATA
// =========================================
// Admin endpoint to export approved locations for states.js update
router.get('/api/export-curated', async (req, res) => {
    try {
        // TODO: Add admin authentication middleware here
        
        const snapshot = await db.collection('locationAnalytics')
            .where('verified', '==', true)
            .orderBy('country')
            .orderBy('selectionCount', 'desc')
            .get();

        const locationsByCountry = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            const country = data.country;

            if (!locationsByCountry[country]) {
                locationsByCountry[country] = [];
            }

            // Generate ID from city name
            const id = data.city.toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .substring(0, 3);

            locationsByCountry[country].push({
                id,
                name: data.city,
                emoji: data.emoji || '🏙️',
                color: data.color || 200,
                selectionCount: data.selectionCount
            });
        });

        // Format as JavaScript object for easy copy-paste into states.js
        let jsExport = "export const UPDATED_CITIES = {\n";
        
        Object.entries(locationsByCountry).forEach(([country, cities]) => {
            jsExport += `    '${country}': [\n`;
            cities.forEach(city => {
                jsExport += `        { id: '${city.id}', name: '${city.name}', emoji: '${city.emoji}', color: ${city.color} },\n`;
            });
            jsExport += `    ],\n`;
        });
        
        jsExport += "};\n";

        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Content-Disposition', 'attachment; filename="updated_cities.js"');
        res.send(jsExport);

    } catch (error) {
        console.error("Export error:", error);
        res.status(500).json({ error: "Failed to export data" });
    }
});

// =========================================
// GET LOCATION STATISTICS
// =========================================
// Dashboard stats for monitoring
router.get('/api/location-stats', async (req, res) => {
    try {
        const [totalSnapshot, verifiedSnapshot, reviewSnapshot] = await Promise.all([
            db.collection('locationAnalytics').count().get(),
            db.collection('locationAnalytics').where('verified', '==', true).count().get(),
            db.collection('locationAnalytics').where('needsReview', '==', true).count().get()
        ]);

        const stats = {
            totalLocations: totalSnapshot.data().count,
            verifiedLocations: verifiedSnapshot.data().count,
            needingReview: reviewSnapshot.data().count,
            coveragePercent: ((verifiedSnapshot.data().count / totalSnapshot.data().count) * 100).toFixed(1)
        };

        res.json(stats);

    } catch (error) {
        console.error("Stats fetch error:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

module.exports = router;