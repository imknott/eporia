var express = require('express');
var router = express.Router();
var admin = require("firebase-admin");
var multer = require('multer'); 

// --- [NEW] R2 & AWS SDK SETUP ---
const r2 = require('../config/r2'); 
const { PutObjectCommand } = require("@aws-sdk/client-s3");

// Canonical CDN base — always ensure https:// prefix regardless of env var format
const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || "https://cdn.eporiamusic.com";
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// Fetch the logged-in user's basic profile for server-side template rendering
async function getCurrentUser(uid) {
    if (!uid) return null;
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (!doc.exists) return null;
        const d = doc.data();
        // Repair URLs — ensure full https:// domain is always present
        const repairUrl = (url) => {
            if (!url) return null;
            if (url.startsWith('http')) return url;
            if (url.startsWith('cdn.eporiamusic.com')) return `https://${url}`;
            // Bare path like "users/{uid}/profile.jpg"
            return `${CDN_URL}/${url.replace(/^\//, '')}`;
        };
        return {
            uid,
            handle:   d.handle   || '',
            photoURL: repairUrl(d.photoURL) || `${CDN_URL}/assets/default-avatar.jpg`,
            coverURL: repairUrl(d.coverURL) || null,
        };
    } catch (e) {
        console.error('getCurrentUser error:', e);
        return null;
    }
}

// [RESTORED] Configure Multer (Memory Storage for fast uploads to R2)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// --- 1. FIREBASE SETUP ---
if (!admin.apps.length) {
    try {
        var serviceAccount = require("../serviceAccountKey.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
            // storageBucket removed - using R2
        });
    } catch (e) {
        try {
            admin.initializeApp({
                projectId: "eporia"
            });
        } catch (initError) {
            console.error("Firebase Init Failed:", initError);
        }
    }
}

const db = admin.apps.length ? admin.firestore() : null;
// const bucket = admin.storage().bucket(); // [REMOVED] - Using R2

const PLAN_PRICES = {
    'discovery':7.99,
    'supporter': 12.99,
    'champion': 24.99
};

// --- 2. MIDDLEWARE: VERIFY USER (HYBRID MODE) ---
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    
    // A. Check for Client-Side Token (API Calls)
    if (idToken && idToken.startsWith('Bearer ')) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken.split(' ')[1]);
            req.uid = decodedToken.uid;
            return next();
        } catch (error) { 
            return res.status(403).json({ error: "Invalid Token" }); 
        }
    }

    // B. Check if this is an API Call (Strict Mode)
    if (req.originalUrl.includes('/api/')) {
        return res.status(401).json({ error: "Unauthorized: Missing Token" });
    }

    // C. Page Loads (Lenient Mode)
    if (req.method === 'GET') {
        return next();
    }

    return res.status(401).send("Unauthorized");
}

// ==========================================
// 4. PAGE ROUTES
// ==========================================

router.get('/dashboard', verifyUser, async (req, res) => {
    let userLocation = { city: 'Local', state: '' };
    const currentUser = await getCurrentUser(req.uid);

    if (req.uid && db) {
        try {
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userLocation = {
                    city: userData.city || 'Local',
                    state: userData.state || ''
                };
            }
        } catch (error) {
            console.error("Error fetching user location:", error);
        }
    }

    res.render('dashboard', { 
        title: 'The Scene | Eporia',
        path: '/player/dashboard',
        userLocation,
        currentUser
    });
});

router.get('/favorites', verifyUser, async (req, res) => {
    res.render('favorites', { title: 'My Favorites | Eporia', path: '/player/favorites', currentUser: await getCurrentUser(req.uid) });
});

router.get('/workbench', verifyUser, async (req, res) => {
    res.render('workbench', { title: 'Crate Creator | Eporia', path: '/player/workbench', currentUser: await getCurrentUser(req.uid) });
});

router.get('/wallet', verifyUser, async (req, res) => {
    res.render('wallet', { title: 'My Wallet | Eporia', path: '/player/wallet', currentUser: await getCurrentUser(req.uid) });
});

router.get('/settings', verifyUser, async (req, res) => {
    res.render('settings', { title: 'Settings | Eporia', path: '/player/settings', currentUser: await getCurrentUser(req.uid) });
});

router.get('/profile', verifyUser, async (req, res) => {
    const currentUser = await getCurrentUser(req.uid);
    res.render('profile', { 
        title: 'My Profile | Eporia',
        viewMode: 'private', 
        targetHandle: null,
        isAdminProfile: false,
        path: '/player/profile',
        currentUser
    });
});

router.get('/u/:handle', verifyUser, async (req, res) => {
    const handle = req.params.handle;
    let isAdminProfile = false;
    const currentUser = await getCurrentUser(req.uid);

    if (db) {
        try {
            const snapshot = await db.collection('users')
                                     .where('handle', '==', `@${handle}`)
                                     .limit(1)
                                     .get();
            
            if (!snapshot.empty) {
                const userData = snapshot.docs[0].data();
                if (userData.role === 'admin') isAdminProfile = true;
            }
        } catch (error) {
            console.error("Server DB Error:", error);
        }
    }
    
    res.render('profile', { 
        title: `@${handle} | Eporia`,
        viewMode: 'public', 
        targetHandle: handle,
        isAdminProfile: isAdminProfile,
        path: '/player/profile',
        currentUser
    });
});

router.get('/artist/:id', verifyUser, async (req, res) => {
    try {
        const artistId = req.params.id;
        const artistDoc = await db.collection('artists').doc(artistId).get();
        if (!artistDoc.exists) {
            return res.status(404).render('error', { message: "Artist not found" });
        }
        const artist = artistDoc.data();

        const songsSnap = await db.collection('songs')
            .where('artistId', '==', artistId)
            .orderBy('uploadedAt', 'desc') 
            .limit(20)
            .get();

        const tracks = [];
        songsSnap.forEach(doc => {
            const data = doc.data();
            tracks.push({
                id: doc.id,
                title: data.title,
                plays: data.plays || 0,
                duration: data.duration || 0,
                artUrl: data.artUrl || artist.profileImage || 'https://via.placeholder.com/150',
                audioUrl: data.audioUrl
            });
        });

        res.render('artist_profile', { 
            title: `${artist.name} | Eporia`,
            artist: artist,
            tracks: tracks,
            path: '/player/artist',
            formatTime: (seconds) => {
                if (!seconds) return "-:--";
                const m = Math.floor(seconds / 60);
                const s = Math.floor(seconds % 60);
                return `${m}:${s < 10 ? '0' : ''}${s}`;
            }
        });

    } catch (e) {
        console.error("Artist Profile Error:", e);
        res.redirect('/player/dashboard');
    }
});

router.get('/crate/:id', verifyUser, async (req, res) => {
    try {
        const crateId = req.params.id;
        const currentUserId = req.uid;
        
        console.log(`[CRATE PAGE] Loading crate ${crateId}`);
        
        // Query using collectionGroup to find the crate
        const querySnapshot = await db.collectionGroup('crates')
            .where('id', '==', crateId) 
            .limit(1)
            .get();
            
        if (querySnapshot.empty) {
            return res.status(404).render('error', { message: "Crate not found" });
        }
        
        const doc = querySnapshot.docs[0];
        const crateData = doc.data();
        
        // Resolve the owner (userId) from the document path
        // doc.ref.path is "users/{uid}/crates/{crateId}"
        const pathSegments = doc.ref.path.split('/');
        const ownerId = pathSegments[1]; 

        // Privacy Check
        if (crateData.privacy === 'private' && currentUserId !== ownerId) {
            return res.status(403).render('error', { message: "This crate is private" });
        }

        // ✅ NEW: Fetch creator info
        const ownerDoc = await db.collection('users').doc(ownerId).get();
        const ownerData = ownerDoc.exists ? ownerDoc.data() : {};

        // Helper function to fix image URLs
        const fixImageUrl = (url) => {
            if (!url) return 'https://via.placeholder.com/150';
            const R2_PUBLIC_URL = "https://pub-8159c20ed1b2482da0517a72d585b498.r2.dev";
            if (url.includes('cdn.eporiamusic.com')) {
                return url.replace('https://cdn.eporiamusic.com', R2_PUBLIC_URL);
            }
            return url;
        };

        // ✅ NEW: Build crate object with creator info and fixed image URLs
        const enrichedCrate = {
            id: crateId,
            ownerId: ownerId,
            ...crateData,
            // Fix the cover image URL
            coverImage: fixImageUrl(crateData.coverImage),
            // Fix track image URLs
            tracks: (crateData.tracks || []).map(track => ({
                ...track,
                artUrl: fixImageUrl(track.artUrl || track.img),
                img: fixImageUrl(track.img || track.artUrl)
            })),
            // Add creator info
            creatorHandle: ownerData.handle || 'Unknown',
            creatorAvatar: fixImageUrl(ownerData.photoURL),
            creatorId: ownerId
        };

        console.log(`[CRATE PAGE] Rendering with creator: ${enrichedCrate.creatorHandle}`);

        res.render('crate_view', { 
            title: `${crateData.title} | Eporia`,
            crateId: crateId,
            crate: enrichedCrate,  // ✅ Now includes creator info and fixed URLs!
            path: '/player/crate',
            formatTime: (seconds) => {
                if (!seconds) return "0:00";
                const m = Math.floor(seconds / 60);
                const s = Math.floor(seconds % 60);
                return `${m}:${s < 10 ? '0' : ''}${s}`;
            }
        });

    } catch (e) {
        console.error("Crate View Error:", e);
        res.status(500).render('error', { message: "Server Error loading crate" });
    }
});

router.get('/api/admin/fix-crates', verifyUser, async (req, res) => {
    // This searches users/{userId}/crates automatically
    const snapshot = await db.collectionGroup('crates').get();
    const batch = db.batch();
    let count = 0;
    
    snapshot.forEach(doc => {
        const data = doc.data();
        // If the 'id' field is missing, write it!
        if (!data.id) {
            // doc.ref refers to users/{userId}/crates/{crateId}
            batch.update(doc.ref, { id: doc.id }); 
            count++;
        }
    });
    
    if (count > 0) await batch.commit();
    res.json({ success: true, fixed: count, message: "Ids added to subcollections" });
});

// ==========================================
// 5. API ROUTES (Data Fetching)
// ==========================================

router.get('/api/user/likes/ids', verifyUser, async (req, res) => {
    try {
        const likesSnap = await db.collection('users').doc(req.uid).collection('likedSongs').get();
        const likedIds = [];
        likesSnap.forEach(doc => likedIds.push(doc.id));
        res.json({ likedSongIds: likedIds });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/user/like', verifyUser, express.json(), async (req, res) => {
    try {
        const { songId, title, artist, artUrl, audioUrl, duration, artistId } = req.body;
        if (!songId) return res.status(400).json({ error: "Missing songId" });

        await db.collection('users').doc(req.uid).collection('likedSongs').doc(songId).set({
            title: title || '',
            artist: artist || '',
            artistId: artistId || null,  // ADDED: Store artistId for tip functionality
            artUrl: artUrl || '',
            audioUrl: audioUrl || '',
            duration: duration || 0,
            likedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, liked: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/api/user/like/:songId', verifyUser, async (req, res) => {
    try {
        await db.collection('users').doc(req.uid).collection('likedSongs').doc(req.params.songId).delete();
        res.json({ success: true, liked: false });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/dashboard', verifyUser, async (req, res) => {
    try {
        // Helper function to fix image URLs (R2 migration)
        const fixImageUrl = (url) => {
            if (!url) return 'https://via.placeholder.com/150';
            const R2_PUBLIC_URL = "https://pub-8159c20ed1b2482da0517a72d585b498.r2.dev";
            if (url.includes('cdn.eporiamusic.com')) {
                return url.replace('https://cdn.eporiamusic.com', R2_PUBLIC_URL);
            }
            return url;
        };

        // Allow city override via query parameter for city navigation
        const requestedCity = req.query.city;
        const requestedState = req.query.state;
        const requestedCountry = req.query.country;
        
        const userDoc = await db.collection('users').doc(req.uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
        
        const userData = userDoc.data();
        
        // Use requested city or fall back to user's city
        const userCity = requestedCity || userData.city || 'Local';
        const userState = requestedState || userData.state || '';
        const userCountry = requestedCountry || userData.country || 'US';
        
        // Get user's genre preferences for personalized recommendations
        const userGenres = userData.genres || [];
        const userPrimaryGenre = userData.primaryGenre || null;
        const userSubgenres = userData.subgenres || [];

        const freshDrops = [];
        try {
        const citySnap = await db.collection('songs')
            .where('city', '==', userCity)
            .orderBy('uploadedAt', 'desc')
            .limit(12)
            .get();

        for (const doc of citySnap.docs) {
            const data = doc.data();
            if (data.albumId) continue;
            
            const artistDoc = await db.collection('artists').doc(data.artistId).get();
            const artistData = artistDoc.exists ? artistDoc.data() : {};
            
            freshDrops.push({
                id: doc.id,
                title: data.title,
                artist: artistData.name || 'Unknown',
                artistId: data.artistId,
                img: fixImageUrl(data.artUrl || artistData.profileImage),
                audioUrl: data.audioUrl,
                duration: data.duration || 0,
                type: 'song'
            });
        }
        } catch (songsErr) {
            console.warn('Songs query failed (index may be missing):', songsErr.message);
        }

                // REFACTORED: Get crates from discovery index
                const cratesSnap = await db.collection('discovery')
            .doc('crates_by_city')
            .collection(userCity)
            .orderBy('createdAt', 'desc')
            .limit(8)
            .get();

        // ✅ Discovery data already has everything we need - just map it with fixed URLs!
        const localCrates = cratesSnap.docs.map(doc => {
            const data = doc.data();
            const coverImg = data.coverImage || data.tracks?.[0]?.artUrl || 'https://via.placeholder.com/150';
            return {
                id: data.id,
                userId: data.creatorId,  // ✅ Correct field name
                title: data.title,
                artist: `by ${data.creatorHandle || 'Anonymous'}`,
                creatorHandle: data.creatorHandle || 'Anonymous',
                img: fixImageUrl(coverImg),
                coverImage: fixImageUrl(coverImg),
                trackCount: data.metadata?.trackCount || 0,
                songCount: data.metadata?.trackCount || 0,
                type: 'crate'
            };
        });

        // Fallback to state if no city crates
        if (localCrates.length === 0 && userState) {
            const stateSnap = await db.collection('discovery')
                .doc('crates_by_state')
                .collection(userState)
                .orderBy('createdAt', 'desc')
                .limit(8)
                .get();
            
            for (const doc of stateSnap.docs) {
                const indexData = doc.data();
                const crateId = doc.id;
                
                const crateDoc = await db.collection('users')
                    .doc(indexData.userId)
                    .collection('crates')
                    .doc(crateId)
                    .get();
                
                if (crateDoc.exists) {
                    const crateData = crateDoc.data();
                    const crateCoverImg = crateData.coverImage || crateData.tracks?.[0]?.img || 'https://via.placeholder.com/150';
                    localCrates.push({
                        id: crateId,
                        userId: indexData.userId,  // CRITICAL: Include userId
                        title: crateData.title,
                        artist: `by ${crateData.creatorHandle || 'Anonymous'}`,
                        creatorHandle: crateData.creatorHandle || 'Anonymous',
                        img: fixImageUrl(crateCoverImg),
                        coverImage: fixImageUrl(crateCoverImg),
                        trackCount: crateData.metadata?.trackCount || 0,
                        songCount: crateData.metadata?.trackCount || 0,
                        type: 'crate'
                    });
                }
            }
        }

        let artistsSnap = await db.collection('artists')
            .where('city', '==', userCity) 
            .limit(20)
            .get();

        if (artistsSnap.empty && userState) {
            artistsSnap = await db.collection('artists')
                .where('state', '==', userState)
                .limit(20)
                .get();
        }

        const allLocalArtists = [];
        const genreMatchedArtists = [];
        
        artistsSnap.forEach(doc => {
            const data = doc.data();
            const artistObj = {
                id: doc.id,
                name: data.name || 'Unknown Artist',
                img: fixImageUrl(data.profileImage),
                city: data.city, 
                state: data.state, 
                country: data.country,
                genres: data.genres || [],
                primaryGenre: data.primaryGenre || null
            };
            
            allLocalArtists.push(artistObj);
            
            // Check if artist's genres match user's preferences
            if (userGenres.length > 0 || userPrimaryGenre) {
                const artistGenres = data.genres || [];
                const artistPrimaryGenre = data.primaryGenre;
                
                // Match on primary genre or any overlapping genres
                const hasGenreMatch = 
                    (userPrimaryGenre && artistPrimaryGenre === userPrimaryGenre) ||
                    artistGenres.some(g => userGenres.includes(g)) ||
                    artistGenres.some(g => userSubgenres.includes(g));
                
                if (hasGenreMatch) {
                    genreMatchedArtists.push(artistObj);
                }
            }
        });

        // Take top 8 for general display
        const topLocal = allLocalArtists.slice(0, 8);
        
        // Take top 8 genre-matched for "For You" section
        const forYou = genreMatchedArtists.slice(0, 8);

        res.json({
            userName: userData.handle || 'User',
            city: userCity,
            state: userState,
            country: userCountry,
            freshDrops: freshDrops,
            localCrates: localCrates,
            topLocal: topLocal,
            forYou: forYou,
            userGenres: userGenres,
            userPrimaryGenre: userPrimaryGenre
        });

    } catch (e) {
        console.error("Dashboard API Error:", e);
        res.status(500).json({ error: "Failed to load dashboard" });
    }
});

router.get('/api/favorites', verifyUser, async (req, res) => {
    try {
        const likesSnap = await db.collection('users').doc(req.uid).collection('likedSongs').orderBy('likedAt', 'desc').get();
        const songs = [];
        likesSnap.forEach(doc => {
            const data = doc.data();
            songs.push({
                id: doc.id,
                title: data.title || '',
                artist: data.artist || '',
                artistId: data.artistId || null,  // ADDED: Include artistId for tip functionality
                img: data.artUrl || 'https://via.placeholder.com/150',
                audioUrl: data.audioUrl || '',
                duration: data.duration || 0
            });
        });
        res.json({ songs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// NEW: Get cities with active data
router.get('/api/cities/active', verifyUser, async (req, res) => {
    try {
        // Query unique cities that have artists
        const artistsSnap = await db.collection('artists')
            .select('city', 'state', 'country')
            .get();
        
        const cityMap = new Map();
        
        artistsSnap.forEach(doc => {
            const data = doc.data();
            const city = data.city;
            const state = data.state;
            const country = data.country || 'United States';
            
            if (city && !cityMap.has(city)) {
                cityMap.set(city, { city, state, country });
            }
        });
        
        // Convert to array and send
        const activeCities = Array.from(cityMap.values());
        res.json({ cities: activeCities });
        
    } catch (e) {
        console.error("Active Cities API Error:", e);
        res.status(500).json({ error: "Failed to load active cities" });
    }
});

// NEW: Get city stats for soundscape map
router.get('/api/cities/stats', verifyUser, async (req, res) => {
    try {
        // Get all cities with artists
        const artistsSnap = await db.collection('artists')
            .select('city', 'state', 'country', 'coordinates', 'primaryGenre', 'genres')
            .get();
        
        const cityStatsMap = new Map();
        
        // Aggregate data by city
        artistsSnap.forEach(doc => {
            const data = doc.data();
            const cityKey = data.city;
            
            if (!cityKey) return;
            
            if (!cityStatsMap.has(cityKey)) {
                cityStatsMap.set(cityKey, {
                    city: data.city,
                    state: data.state,
                    country: data.country || 'United States',
                    coordinates: data.coordinates || null,
                    artistCount: 0,
                    genreCount: {},
                    genres: new Set()
                });
            }
            
            const cityStats = cityStatsMap.get(cityKey);
            cityStats.artistCount++;
            
            // Track genre frequency
            if (data.primaryGenre) {
                cityStats.genreCount[data.primaryGenre] = (cityStats.genreCount[data.primaryGenre] || 0) + 1;
            }
            
            // Collect all genres
            if (data.genres) {
                data.genres.forEach(g => cityStats.genres.add(g));
            }
        });
        
        // Get track counts per city
        const songsSnap = await db.collection('songs')
            .select('city')
            .get();
        
        const trackCountMap = new Map();
        songsSnap.forEach(doc => {
            const city = doc.data().city;
            if (city) {
                trackCountMap.set(city, (trackCountMap.get(city) || 0) + 1);
            }
        });
        
        // Get crate counts per city
        const crateCountMap = new Map();
        const discoveryRef = db.collection('discovery').doc('crates_by_city');
        const cityCollections = await discoveryRef.listCollections();
        
        for (const collection of cityCollections) {
            const cityName = collection.id;
            const crateCount = (await collection.count().get()).data().count;
            crateCountMap.set(cityName, crateCount);
        }
        
        // Build final city stats array
        const cities = [];
        
        cityStatsMap.forEach((stats, cityKey) => {
            // Determine top genre
            let topGenre = 'Hip-Hop'; // Default
            let maxCount = 0;
            Object.entries(stats.genreCount).forEach(([genre, count]) => {
                if (count > maxCount) {
                    maxCount = count;
                    topGenre = genre;
                }
            });
            
            // Determine activity level based on artist count
            let activity = 'low';
            if (stats.artistCount > 50) activity = 'high';
            else if (stats.artistCount > 20) activity = 'medium';
            
            cities.push({
                city: stats.city,
                state: stats.state,
                country: stats.country,
                coordinates: stats.coordinates || null, // null if not in DB
                topGenre: topGenre,
                genres: Array.from(stats.genres).slice(0, 3), // Top 3 genres
                artistCount: stats.artistCount,
                trackCount: trackCountMap.get(cityKey) || 0,
                crateCount: crateCountMap.get(cityKey) || 0,
                activity: activity
            });
        });
        
        res.json({ cities });
        
    } catch (e) {
        console.error("City Stats API Error:", e);
        res.status(500).json({ error: "Failed to load city stats" });
    }
});

router.get('/api/user/following', verifyUser, async (req, res) => {
    try {
        const followingSnap = await db.collection('users').doc(req.uid).collection('following').orderBy('followedAt', 'desc').limit(6).get();
        const artists = [];
        followingSnap.forEach(doc => {
            const data = doc.data();
            artists.push({
                id: doc.id,
                name: data.name || '',
                img: data.img || ''
            });
        });
        res.json({ artists });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- USER-TO-USER FOLLOW ---
router.post('/api/user/follow', verifyUser, express.json(), async (req, res) => {
    try {
        const { userId, handle, name, img } = req.body;
        if (!userId) return res.status(400).json({ error: "Missing userId" });

        // Fetch fresh data from DB if name/img missing
        let resolvedName = name || '';
        let resolvedImg  = img  || '';
        if (!resolvedName || !resolvedImg) {
            try {
                const targetDoc = await db.collection('users').doc(userId).get();
                if (targetDoc.exists) {
                    const d = targetDoc.data();
                    resolvedName = resolvedName || d.displayName || d.handle || '';
                    resolvedImg  = resolvedImg  || d.photoURL || '';
                }
            } catch (e) { console.warn('User lookup failed during follow:', e.message); }
        }

        const batch = db.batch();

        // Add to current user's following subcollection
        const myFollowRef = db.collection('users').doc(req.uid)
                              .collection('following').doc(userId);
        batch.set(myFollowRef, {
            name: resolvedName,
            handle: handle || '',
            img: resolvedImg,
            type: 'user',
            followedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Add to target user's followers subcollection
        const theirFollowerRef = db.collection('users').doc(userId)
                                   .collection('followers').doc(req.uid);
        batch.set(theirFollowerRef, {
            uid: req.uid,
            followedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Increment counters
        batch.update(db.collection('users').doc(req.uid),   { 'stats.following': admin.firestore.FieldValue.increment(1) });
        batch.update(db.collection('users').doc(userId),    { 'stats.followers': admin.firestore.FieldValue.increment(1) });

        await batch.commit();
        res.json({ success: true, following: true });
    } catch (e) {
        console.error("User Follow Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/user/unfollow', verifyUser, express.json(), async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "Missing userId" });

        const batch = db.batch();
        batch.delete(db.collection('users').doc(req.uid).collection('following').doc(userId));
        batch.delete(db.collection('users').doc(userId).collection('followers').doc(req.uid));
        batch.update(db.collection('users').doc(req.uid),  { 'stats.following': admin.firestore.FieldValue.increment(-1) });
        batch.update(db.collection('users').doc(userId),   { 'stats.followers': admin.firestore.FieldValue.increment(-1) });

        await batch.commit();
        res.json({ success: true, following: false });
    } catch (e) {
        console.error("User Unfollow Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/user/follow/check', verifyUser, async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: "Missing userId" });
        const followDoc = await db.collection('users').doc(req.uid).collection('following').doc(userId).get();
        res.json({ following: followDoc.exists });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/settings/save', verifyUser, express.json(), async (req, res) => {
    try {
        await db.collection('users').doc(req.uid).update({
            settings: req.body,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/search', verifyUser, async (req, res) => {
    const query = req.query.q || '';
    const results = [];

    try {
        if (query.startsWith('@')) {
            const nameQuery = query.slice(1).toLowerCase();
            const artistSnap = await db.collection('artists')
                .orderBy('name')
                .startAt(nameQuery)
                .endAt(nameQuery + '\uf8ff')
                .limit(5)
                .get();

            artistSnap.forEach(doc => {
                const data = doc.data();
                results.push({
                    type: 'artist',
                    id: doc.id,
                    title: data.name,
                    subtitle: 'Artist',
                    img: data.profileImage || 'https://via.placeholder.com/150',
                    url: `/player/artist/${doc.id}`
                });
            });
        } 
        else if (query.startsWith('u:')) {
            const handleQuery = '@' + query.slice(2).toLowerCase();
            const userSnap = await db.collection('users')
                .orderBy('handle')
                .startAt(handleQuery)
                .endAt(handleQuery + '\uf8ff')
                .limit(5)
                .get();

            userSnap.forEach(doc => {
                const data = doc.data();
                results.push({
                    type: 'user',
                    id: doc.id,
                    title: data.handle,
                    subtitle: 'User',
                    handle: data.handle,
                    img: data.photoURL || 'https://via.placeholder.com/50',
                    url: `/player/u/${data.handle.replace('@', '')}` 
                });
            });
        }
        else if (query.startsWith('C:')) {
            const cityName = query.slice(2).toLowerCase();
            const userSnap = await db.collection('users')
                .where('city', '>=', cityName)
                .where('city', '<=', cityName + '\uf8ff')
                .limit(5)
                .get();

            const cities = new Set();
            userSnap.forEach(doc => {
                const data = doc.data();
                if (data.city) cities.add(data.city);
            });

            cities.forEach(city => {
                results.push({
                    type: 'city',
                    title: city,
                    subtitle: 'City',
                    img: null,
                    url: `/player/dashboard?city=${encodeURIComponent(city)}`
                });
            });
        }
        else {
            let searchTerm = query;
            if (searchTerm.toLowerCase().startsWith('s:')) {
                searchTerm = searchTerm.slice(2);
            }

            const songSnap = await db.collection('songs')
                .orderBy('titleLower') 
                .startAt(searchTerm.toLowerCase())
                .endAt(searchTerm.toLowerCase() + '\uf8ff')
                .limit(10)
                .get();

            songSnap.forEach(doc => {
                const data = doc.data();
                results.push({
                    type: 'song',
                    id: doc.id,
                    title: data.title,
                    subtitle: data.artistName || 'Unknown Artist',
                    img: data.artUrl || 'https://via.placeholder.com/150',
                    audioUrl: data.audioUrl,
                    duration: data.duration || 0,
                    genre: data.genre || '',
                    subgenre: data.subgenre || '' 
                });
            });
        }

        res.json({ results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/artist/follow', verifyUser, express.json(), async (req, res) => {
    try {
        const { artistId, artistName, artistImg, name, img } = req.body;
        if (!artistId) return res.status(400).json({ error: "Missing artistId" });

        // Resolve name/img — UI sends artistName/artistImg, fallback to name/img
        let resolvedName = artistName || name || '';
        let resolvedImg = artistImg || img || '';

        // If name or img are missing, fetch from artists collection to guarantee data
        if (!resolvedName || !resolvedImg) {
            try {
                const artistDoc = await db.collection('artists').doc(artistId).get();
                if (artistDoc.exists) {
                    const a = artistDoc.data();
                    resolvedName = resolvedName || a.name || a.handle || '';
                    resolvedImg  = resolvedImg  || a.profileImage || a.img || a.photoURL || '';
                }
            } catch (lookupErr) {
                console.warn('Artist lookup failed during follow:', lookupErr.message);
            }
        }

        const batch = db.batch();

        // 1. Add to User's "Following" Subcollection with full data
        const userFollowRef = db.collection('users').doc(req.uid)
                                .collection('following').doc(artistId);
        batch.set(userFollowRef, {
            name: resolvedName,
            img: resolvedImg,
            type: 'artist',
            followedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 2. Add to Artist's "Followers" Subcollection
        const artistFollowerRef = db.collection('artists').doc(artistId)
                                    .collection('followers').doc(req.uid);
        batch.set(artistFollowerRef, {
            uid: req.uid,
            followedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 3. Increment Counters
        const artistRef = db.collection('artists').doc(artistId);
        batch.update(artistRef, { 
            'stats.followers': admin.firestore.FieldValue.increment(1) 
        });

        const userRef = db.collection('users').doc(req.uid);
        batch.update(userRef, { 
            'stats.following': admin.firestore.FieldValue.increment(1) 
        });

        await batch.commit();

        res.json({ success: true, following: true });
    } catch (e) {
        console.error("Follow Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.delete('/api/artist/follow/:artistId', verifyUser, async (req, res) => {
    try {
        const artistId = req.params.artistId;
        const batch = db.batch();

        // 1. Remove from User's "Following"
        const userFollowRef = db.collection('users').doc(req.uid)
                                .collection('following').doc(artistId);
        batch.delete(userFollowRef);

        // 2. Remove from Artist's "Followers"
        const artistFollowerRef = db.collection('artists').doc(artistId)
                                    .collection('followers').doc(req.uid);
        batch.delete(artistFollowerRef);

        // 3. Decrement Counters
        const artistRef = db.collection('artists').doc(artistId);
        batch.update(artistRef, { 
            'stats.followers': admin.firestore.FieldValue.increment(-1) 
        });

        const userRef = db.collection('users').doc(req.uid);
        batch.update(userRef, { 
            'stats.following': admin.firestore.FieldValue.increment(-1) 
        });

        await batch.commit();

        res.json({ success: true, following: false });
    } catch (e) {
        console.error("Unfollow Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/artist/follow/check', verifyUser, async (req, res) => {
    try {
        const artistId = req.query.artistId;
        if (!artistId) return res.status(400).json({ error: "Missing artistId" });

        const followDoc = await db.collection('users').doc(req.uid).collection('following').doc(artistId).get();
        res.json({ following: followDoc.exists });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 7. PROFILE (UPDATED FOR R2)
// ==========================================

// --- Upload Avatar ---
router.post('/api/profile/upload', verifyUser, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const uid = req.uid;
        const filename = `users/${uid}/profile.jpg`;
        await r2.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: filename, Body: req.file.buffer, ContentType: req.file.mimetype }));
        const publicUrl = `${CDN_URL}/${filename}?t=${Date.now()}`;
        await db.collection('users').doc(uid).update({ photoURL: publicUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        res.json({ success: true, url: publicUrl });
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
        const filename = `users/${uid}/profile.jpg`;
        await r2.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: filename, Body: req.file.buffer, ContentType: req.file.mimetype }));
        const publicUrl = `${CDN_URL}/${filename}?t=${Date.now()}`;
        await db.collection('users').doc(uid).update({ photoURL: publicUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        res.json({ success: true, url: publicUrl });
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
        const filename = `users/${uid}/cover.jpg`;
        await r2.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: filename, Body: req.file.buffer, ContentType: req.file.mimetype }));
        const publicUrl = `${CDN_URL}/${filename}?t=${Date.now()}`;
        await db.collection('users').doc(uid).update({ coverURL: publicUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        res.json({ success: true, url: publicUrl });
    } catch (e) {
        console.error('Cover upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/profile/update', verifyUser, express.json(), async (req, res) => {
    try {
        const { handle, bio, location, avatar, coverURL, anthem } = req.body;
        const updateData = {};
        
        if (handle) updateData.handle = handle;
        if (bio !== undefined) updateData.bio = bio; 
        if (location) updateData.location = location;

        if (avatar) updateData.photoURL = avatar;           
        if (anthem !== undefined) updateData.profileSong = anthem; 
        if (coverURL) updateData.coverURL = coverURL;
        
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('users').doc(req.uid).update(updateData);
        
        res.json({ success: true, data: updateData });
    } catch (e) {
        console.error('Profile update error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/profile/:uid', verifyUser, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        const userDoc = await db.collection('users').doc(targetUid).get();
        
        if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
        
        const userData = userDoc.data();

        // Repair URLs that were stored without a domain (old bug)
        const repairUrl = (url) => {
            if (!url) return '';
            if (url.startsWith('http')) return url;
            // Bare path like "users/{uid}/profile.jpg" — prepend CDN
            return `${CDN_URL}/${url.replace(/^\//, '')}`;
        };
        
        res.json({
            uid: targetUid,
            handle: userData.handle || '',
            bio: userData.bio || '',
            role: userData.role || 'member',
            photoURL: repairUrl(userData.photoURL),
            coverURL: repairUrl(userData.coverURL),
            joinDate: userData.joinDate || null,
            profileSong: userData.profileSong || null
        });
        
    } catch (e) {
        console.error('Get Profile Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/user/by-handle', verifyUser, async (req, res) => {
    try {
        const handle = req.query.handle;
        if (!handle) return res.status(400).json({ error: 'Handle required' });
        
        const snapshot = await db.collection('users')
            .where('handle', '==', handle)
            .limit(1)
            .get();
        
        if (snapshot.empty) return res.status(404).json({ error: 'User not found' });
        
        const userDoc = snapshot.docs[0];
        
        res.json({
            uid: userDoc.id,
            handle: userDoc.data().handle
        });
        
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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

router.post('/api/profile/update', verifyUser, express.json(), async (req, res) => {
    try {
        const { handle, bio, location } = req.body;
        const updateData = {};
        
        if (handle) updateData.handle = handle;
        if (bio) updateData.bio = bio;
        if (location) updateData.location = location; 
        
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        await db.collection('users').doc(req.uid).update(updateData);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/overview', verifyUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

        const data = userDoc.data();
        
        res.json({
            balance: data.walletBalance || 0.00,
            monthlyAllocation: data.monthlyAllocation || 0.00,
            plan: data.plan || 'free',
            subscriptionStatus: data.subscriptionStatus || 'inactive'
        });
    } catch (e) {
        console.error("Wallet API Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/wallet', verifyUser, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.uid);
        const doc = await userRef.get();
        if (!doc.exists) return res.status(404).json({ error: "User not found" });
        
        const data = doc.data();
        const plan = data.subscription?.plan || 'individual';
        const monthlyPrice = PLAN_PRICES[plan] || 12.99;
        const fairTradeAllocation = (monthlyPrice * 0.80);
        let currentBalance = data.walletBalance;
        
        if (currentBalance === undefined) {
            currentBalance = fairTradeAllocation;
            await userRef.update({ 
                walletBalance: currentBalance,
                lastRollover: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        res.json({
            balance: currentBalance.toFixed(2),
            monthlyAllocation: fairTradeAllocation.toFixed(2),
            currency: '$',
            plan: plan
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/check-allocation', verifyUser, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.uid);
        const doc = await userRef.get();
        const data = doc.data();
        if (!data || !data.subscription) return res.json({ due: false });

        const nextPayment = new Date(); 
        nextPayment.setDate(nextPayment.getDate() - 1); 
        const now = new Date();
        const isDue = (now >= nextPayment);

        if (isDue) {
            const topArtistIds = data.topArtists || [];
            res.json({ 
                due: true, 
                balance: data.walletBalance,
                topArtists: topArtistIds 
            });
        } else {
            res.json({ due: false });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/commit-allocation', verifyUser, express.json(), async (req, res) => {
    try {
        const { action, allocations } = req.body; 
        const userRef = db.collection('users').doc(req.uid);
        
        await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error("User does not exist!");
            
            const userData = userDoc.data();
            const currentBalance = userData.walletBalance || 0;
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 30);

            if (action === 'skip') {
                t.update(userRef, { 
                    'subscription.nextPaymentDate': nextDate.toISOString(),
                    'lastRollover': admin.firestore.FieldValue.serverTimestamp()
                });
                return;
            }

            if (action === 'allocate' && allocations && allocations.length > 0) {
                const totalAttempted = allocations.reduce((sum, item) => sum + Number(item.amount), 0);
                
                if (totalAttempted > (currentBalance + 0.01)) {
                    throw new Error(`Insufficient funds. Wallet: $${currentBalance}, Tried: $${totalAttempted}`);
                }

                allocations.forEach(item => {
                    const amount = Number(item.amount);
                    const artistId = item.artistId; 

                    const allocationRef = db.collection('allocations').doc();
                    t.set(allocationRef, {
                        fromUser: req.uid,
                        toArtist: artistId,
                        amount: amount,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });

                    const artistRef = db.collection('artists').doc(artistId);
                    t.set(artistRef, { 
                        balance: admin.firestore.FieldValue.increment(amount),
                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                });

                const newBalance = Math.max(0, currentBalance - totalAttempted);
                
                t.update(userRef, { 
                    walletBalance: newBalance,
                    'subscription.nextPaymentDate': nextDate.toISOString()
                });
            }
        });

        res.json({ success: true, receipt: allocations || [] });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/tip-artist', verifyUser, express.json(), async (req, res) => {
    try {
        const { artistId, amount } = req.body;
        const tipAmount = Number(amount);

        if (!artistId || isNaN(tipAmount) || tipAmount <= 0.00) {
            return res.status(400).json({ error: "Invalid amount or artist." });
        }

        const userRef = db.collection('users').doc(req.uid);
        const artistRef = db.collection('artists').doc(artistId);
        const transactionRef = db.collection('transactions').doc();

        await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error("User not found");

            const userData = userDoc.data();
            const currentBalance = Number(userData.walletBalance || 0);

            // 1. Check Funds
            if (currentBalance < tipAmount) {
                throw new Error("Insufficient funds");
            }

            // 2. Deduct from User
            const newBalance = Number((currentBalance - tipAmount).toFixed(2));
            t.update(userRef, { walletBalance: newBalance });

            // 3. Add to Artist (Credits)
            t.update(artistRef, { 
                'stats.tipsTotal': admin.firestore.FieldValue.increment(tipAmount),
                walletBalance: admin.firestore.FieldValue.increment(tipAmount) 
            });

            // 4. Create Ledger Entry
            t.set(transactionRef, {
                type: 'tip',
                fromUser: req.uid,
                toArtist: artistId,
                amount: tipAmount,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        // Return new balance so UI updates immediately
        const updatedDoc = await userRef.get();
        res.json({ success: true, newBalance: updatedDoc.data().walletBalance });

    } catch (e) {
        console.error("Tip Error:", e);
        res.status(500).json({ error: e.message });
    }
});

/// ==========================================
// IMPROVED CRATE CREATION ROUTE
// ==========================================

/**
 * FIXES APPLIED:
 * 1. Now stores tracks in BOTH personal crate AND discovery index
 * 2. Ensures consistent data structure across both sources
 * 3. Properly handles userId/creatorId field naming
 */

router.post('/api/crate/create', verifyUser, upload.single('coverImage'), async (req, res) => {
    try {
        const { title, tracks, privacy, metadata, existingCoverUrl } = req.body;
        
        if (!title || !tracks) {
            return res.status(400).json({ error: "Missing title or tracks" });
        }

        // Handle cover image upload
        let coverImageUrl = existingCoverUrl || null;
        if (req.file) {
            const filename = `crates/${req.uid}_${Date.now()}.jpg`;
            const command = new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: filename,
                Body: req.file.buffer,
                ContentType: req.file.mimetype
            });
            await r2.send(command);
            coverImageUrl = `https://cdn.eporiamusic.com/${filename}`;
        }

        // Parse JSON strings
        const tracksArray = typeof tracks === 'string' ? JSON.parse(tracks) : tracks;
        const metadataObj = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

        // Get user data
        const userDoc = await db.collection('users').doc(req.uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        // ==========================================
        // 1. PERSONAL CRATE (Source of Truth)
        // ==========================================
        // FIXED: Now includes tracks array so private crates work properly
        const crateData = {
            id: null, // Will update after creation
            title,
            coverImage: coverImageUrl,
            privacy,
            tracks: tracksArray, // <-- FIX: Added tracks to personal crate
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            stats: { plays: 0, likes: 0 },
            metadata: {
                trackCount: tracksArray.length,
                genres: metadataObj?.genres || [],
                totalDuration: metadataObj?.totalDuration || 0
            }
        };

        const userRef = db.collection('users').doc(req.uid);
        const crateRef = await userRef.collection('crates').add(crateData);
        const crateId = crateRef.id;
        
        // Update with the generated ID
        await crateRef.update({ id: crateId });

        // ==========================================
        // 2. PUBLIC DISCOVERY INDEX (if public)
        // ==========================================
        if (privacy === 'public') {
            const batch = db.batch();

            // Build the full public data object
            const discoveryData = {
                id: crateId,
                title: title,
                coverImage: coverImageUrl,
                
                // Creator info
                creatorId: req.uid, // <-- IMPORTANT: Store creator's UID
                creatorHandle: userData.handle || 'Anonymous',
                creatorAvatar: userData.photoURL || null,
                
                // Full track data for zero-join reads
                tracks: tracksArray,
                
                // Metadata for filtering/sorting
                metadata: {
                    trackCount: tracksArray.length,
                    genres: metadataObj?.genres || [],
                    totalDuration: metadataObj?.totalDuration || 0
                },
                
                // Location data
                city: userData.city || 'Unknown',
                state: userData.state || null,
                
                // Stats
                stats: { plays: 0, likes: 0 },
                
                // Timestamps
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // Index by City
            if (userData.city) {
                const cityRef = db.collection('discovery')
                    .doc('crates_by_city')
                    .collection(userData.city)
                    .doc(crateId);
                batch.set(cityRef, discoveryData);
            }

            // Index by State (fallback)
            if (userData.state) {
                const stateRef = db.collection('discovery')
                    .doc('crates_by_state')
                    .collection(userData.state)
                    .doc(crateId);
                batch.set(stateRef, discoveryData);
            }

            await batch.commit();
        }

        res.json({ 
            success: true, 
            crateId,
            crate: {
                id: crateId,
                title,
                coverImage: coverImageUrl,
                trackCount: tracksArray.length
            }
        });

    } catch (e) {
        console.error("Crate Creation Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// UPDATE CRATE (Important for editing)
// ==========================================
router.patch('/api/crate/:crateId', verifyUser, upload.single('coverImage'), async (req, res) => {
    try {
        const { crateId } = req.params;
        const { title, tracks, privacy, metadata, existingCoverUrl } = req.body;

        // Verify ownership
        const crateRef = db.collection('users').doc(req.uid).collection('crates').doc(crateId);
        const crateDoc = await crateRef.get();

        if (!crateDoc.exists) {
            return res.status(404).json({ error: 'Crate not found' });
        }

        const currentData = crateDoc.data();

        // Handle cover image
        let coverImageUrl = existingCoverUrl || currentData.coverImage;
        if (req.file) {
            const filename = `crates/${req.uid}_${Date.now()}.jpg`;
            const command = new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: filename,
                Body: req.file.buffer,
                ContentType: req.file.mimetype
            });
            await r2.send(command);
            coverImageUrl = `https://cdn.eporiamusic.com/${filename}`;
        }

        const tracksArray = tracks ? (typeof tracks === 'string' ? JSON.parse(tracks) : tracks) : currentData.tracks;
        const metadataObj = metadata ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : currentData.metadata;
        const newPrivacy = privacy || currentData.privacy;

        // Update personal crate
        const updateData = {
            title: title || currentData.title,
            coverImage: coverImageUrl,
            privacy: newPrivacy,
            tracks: tracksArray,
            metadata: {
                trackCount: tracksArray.length,
                genres: metadataObj?.genres || [],
                totalDuration: metadataObj?.totalDuration || 0
            }
        };

        await crateRef.update(updateData);

        // Update discovery if public
        if (newPrivacy === 'public') {
            const userDoc = await db.collection('users').doc(req.uid).get();
            const userData = userDoc.data() || {};

            const discoveryData = {
                ...updateData,
                id: crateId,
                creatorId: req.uid,
                creatorHandle: userData.handle || 'Anonymous',
                creatorAvatar: userData.photoURL || null,
                city: userData.city || 'Unknown',
                state: userData.state || null
            };

            const batch = db.batch();

            if (userData.city) {
                const cityRef = db.collection('discovery')
                    .doc('crates_by_city')
                    .collection(userData.city)
                    .doc(crateId);
                batch.set(cityRef, discoveryData, { merge: true });
            }

            if (userData.state) {
                const stateRef = db.collection('discovery')
                    .doc('crates_by_state')
                    .collection(userData.state)
                    .doc(crateId);
                batch.set(stateRef, discoveryData, { merge: true });
            }

            await batch.commit();
        } else if (currentData.privacy === 'public' && newPrivacy === 'private') {
            // Remove from discovery if changing from public to private
            const userDoc = await db.collection('users').doc(req.uid).get();
            const userData = userDoc.data() || {};
            const batch = db.batch();

            if (userData.city) {
                const cityRef = db.collection('discovery')
                    .doc('crates_by_city')
                    .collection(userData.city)
                    .doc(crateId);
                batch.delete(cityRef);
            }

            if (userData.state) {
                const stateRef = db.collection('discovery')
                    .doc('crates_by_state')
                    .collection(userData.state)
                    .doc(crateId);
                batch.delete(stateRef);
            }

            await batch.commit();
        }

        res.json({ success: true });

    } catch (e) {
        console.error("Crate Update Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// DELETE CRATE
// ==========================================
router.delete('/api/crate/:crateId', verifyUser, async (req, res) => {
    try {
        const { crateId } = req.params;

        // Verify ownership and get data
        const crateRef = db.collection('users').doc(req.uid).collection('crates').doc(crateId);
        const crateDoc = await crateRef.get();

        if (!crateDoc.exists) {
            return res.status(404).json({ error: 'Crate not found' });
        }

        const crateData = crateDoc.data();

        // Delete from personal collection
        await crateRef.delete();

        // If it was public, remove from discovery
        if (crateData.privacy === 'public') {
            const userDoc = await db.collection('users').doc(req.uid).get();
            const userData = userDoc.data() || {};
            const batch = db.batch();

            if (userData.city) {
                const cityRef = db.collection('discovery')
                    .doc('crates_by_city')
                    .collection(userData.city)
                    .doc(crateId);
                batch.delete(cityRef);
            }

            if (userData.state) {
                const stateRef = db.collection('discovery')
                    .doc('crates_by_state')
                    .collection(userData.state)
                    .doc(crateId);
                batch.delete(stateRef);
            }

            await batch.commit();
        }

        res.json({ success: true });

    } catch (e) {
        console.error("Crate Delete Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/crates/user/:uid', verifyUser, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        const isOwnProfile = req.uid === targetUid;
        
        // Query the specific user's subcollection for fast profile loads
        let query = db.collection('users')
            .doc(targetUid)
            .collection('crates')
            .orderBy('createdAt', 'desc');
        
        if (!isOwnProfile) {
            query = query.where('privacy', '==', 'public');
        }
        
        const cratesSnap = await query.get();

        const crates = [];
        cratesSnap.forEach(doc => {
            const data = doc.data();
            crates.push({
                id: doc.id,
                userId: targetUid,
                title: data.title,
                coverImage: data.coverImage, // [CONFIRMED] Displayed in Signature Stack
                trackCount: data.metadata?.trackCount || 0,
                privacy: data.privacy,
                createdAt: data.createdAt?.toDate() || new Date(),
                stats: data.stats || { plays: 0, likes: 0 }
            });
        });

        res.json({ crates });

    } catch (e) {
        console.error("User Crates Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// GET SINGLE CRATE BY ID (API Endpoint)
// ==========================================
router.get('/api/crate/:crateId', verifyUser, async (req, res) => {
    try {
        const { crateId } = req.params;
        const userId = req.uid;

        console.log(`[CRATE VIEW] Fetching crate ${crateId} for user ${userId}`);

        // Get user's location for targeted discovery lookup
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        // STEP 1: Check if this is the user's own crate (personal collection)
        const userCrateRef = db.collection('users').doc(userId).collection('crates').doc(crateId);
        const userCrateDoc = await userCrateRef.get();

        if (userCrateDoc.exists) {
            const crateData = userCrateDoc.data();
            console.log(`[CRATE VIEW] Found in user's personal collection`);
            
            // If it's public, try to get enriched data from discovery (with updated stats)
            if (crateData.privacy === 'public') {
                // Try city first
                if (userData.city) {
                    const cityRef = db.collection('discovery')
                        .doc('crates_by_city')
                        .collection(userData.city)
                        .doc(crateId);
                    const cityDoc = await cityRef.get();
                    if (cityDoc.exists) {
                        console.log(`[CRATE VIEW] Returning enriched data from discovery/city`);
                        return res.json(cityDoc.data());
                    }
                }
                
                // Try state as fallback
                if (userData.state) {
                    const stateRef = db.collection('discovery')
                        .doc('crates_by_state')
                        .collection(userData.state)
                        .doc(crateId);
                    const stateDoc = await stateRef.get();
                    if (stateDoc.exists) {
                        console.log(`[CRATE VIEW] Returning enriched data from discovery/state`);
                        return res.json(stateDoc.data());
                    }
                }
            }
            
            // Return personal crate data (works for private crates)
            console.log(`[CRATE VIEW] Returning personal crate data`);
            return res.json({
                ...crateData,
                creatorHandle: userData.handle || 'You',
                creatorAvatar: userData.photoURL || null,
                creatorId: userId
            });
        }

        // STEP 2: Not the user's crate, search discovery (public only)
        console.log(`[CRATE VIEW] Not in user's collection, searching discovery...`);
        
        // Try user's city first (most likely location)
        if (userData.city) {
            const cityRef = db.collection('discovery')
                .doc('crates_by_city')
                .collection(userData.city)
                .doc(crateId);
            const cityDoc = await cityRef.get();
            if (cityDoc.exists) {
                console.log(`[CRATE VIEW] Found in discovery/city`);
                return res.json(cityDoc.data());
            }
        }

        // Try user's state
        if (userData.state) {
            const stateRef = db.collection('discovery')
                .doc('crates_by_state')
                .collection(userData.state)
                .doc(crateId);
            const stateDoc = await stateRef.get();
            if (stateDoc.exists) {
                console.log(`[CRATE VIEW] Found in discovery/state`);
                return res.json(stateDoc.data());
            }
        }

        // STEP 3: Last resort - search ALL cities and states
        console.log(`[CRATE VIEW] Searching all discovery collections...`);
        
        const citiesParent = db.collection('discovery').doc('crates_by_city');
        const cityCollections = await citiesParent.listCollections();

        for (const cityCollection of cityCollections) {
            const crateDoc = await cityCollection.doc(crateId).get();
            if (crateDoc.exists) {
                console.log(`[CRATE VIEW] Found in discovery/city/${cityCollection.id}`);
                return res.json(crateDoc.data());
            }
        }

        // Try all states too
        const statesParent = db.collection('discovery').doc('crates_by_state');
        const stateCollections = await statesParent.listCollections();

        for (const stateCollection of stateCollections) {
            const crateDoc = await stateCollection.doc(crateId).get();
            if (crateDoc.exists) {
                console.log(`[CRATE VIEW] Found in discovery/state/${stateCollection.id}`);
                return res.json(crateDoc.data());
            }
        }

        // Not found anywhere
        console.log(`[CRATE VIEW] Crate not found anywhere`);
        return res.status(404).json({ 
            error: 'Crate not found or you do not have permission to view it' 
        });

    } catch (e) {
        console.error('[CRATE VIEW] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/artists/local', verifyUser, async (req, res) => {
    try {
        const city = req.query.city;
        const state = req.query.state;
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 24;

        let artistsSnap;

        if (city) {
            artistsSnap = await db.collection('artists')
                .where('city', '==', city)
                .orderBy('stats.followers', 'desc')
                .offset(offset)
                .limit(limit)
                .get();
        }

        if ((!artistsSnap || artistsSnap.empty) && state && offset === 0) {
            artistsSnap = await db.collection('artists')
                .where('state', '==', state)
                .orderBy('stats.followers', 'desc')
                .limit(limit)
                .get();
        }

        const artists = [];
        if (artistsSnap && !artistsSnap.empty) {
            artistsSnap.forEach(doc => {
                const data = doc.data();
                artists.push({
                    id: doc.id,
                    name: data.name || 'Unknown Artist',
                    img: data.profileImage || 'https://via.placeholder.com/150',
                    followers: data.stats?.followers || 0,
                    city: data.city || '',
                    state: data.state || ''
                });
            });
        }

        res.json({ artists, hasMore: artists.length === limit });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/crates/liked/:uid', verifyUser, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        const userDoc = await db.collection('users').doc(targetUid).get();
        if (!userDoc.exists) return res.json({ crates: [] });
        
        const likedCrateIds = userDoc.data().likedCrates || [];
        if (likedCrateIds.length === 0) return res.json({ crates: [] });
        
        const crateBatches = [];
        for (let i = 0; i < likedCrateIds.length; i += 10) {
            const batch = likedCrateIds.slice(i, i + 10);
            const cratesSnap = await db.collection('crates')
                .where(admin.firestore.FieldPath.documentId(), 'in', batch)
                .where('privacy', '==', 'public')
                .get();
            crateBatches.push(cratesSnap);
        }
        
        const crates = [];
        crateBatches.forEach(snap => {
            snap.forEach(doc => {
                const data = doc.data();
                crates.push({
                    id: doc.id,
                    title: data.title,
                    creatorHandle: data.creatorHandle,
                    creatorAvatar: data.creatorAvatar,
                    trackCount: data.metadata?.trackCount || 0,
                    genres: data.metadata?.genres || [],
                    plays: data.plays || 0,
                    likes: data.likes || 0,
                    img: data.coverImage || data.tracks?.[0]?.img || 'https://via.placeholder.com/150'
                });
            });
        });
        
        res.json({ crates });
        
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/crate/like/toggle', verifyUser, async (req, res) => {
    try {
        const { crateId } = req.body;
        const uid = req.uid;
        if (!crateId) return res.status(400).json({ error: "Missing crateId" });

        const userRef = db.collection('users').doc(uid);
        const crateRef = db.collection('crates').doc(crateId);

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const crateDoc = await transaction.get(crateRef);

            if (!crateDoc.exists) throw new Error("Crate not found");

            const userData = userDoc.data() || {};
            const likedCrates = userData.likedCrates || [];
            const isLiked = likedCrates.includes(crateId);

            if (isLiked) {
                transaction.update(userRef, { likedCrates: admin.firestore.FieldValue.arrayRemove(crateId) });
                transaction.update(crateRef, { likes: admin.firestore.FieldValue.increment(-1) });
            } else {
                transaction.update(userRef, { likedCrates: admin.firestore.FieldValue.arrayUnion(crateId) });
                transaction.update(crateRef, { likes: admin.firestore.FieldValue.increment(1) });
            }
        });

        const userDoc = await userRef.get();
        const likedCrates = userDoc.data()?.likedCrates || [];
        res.json({ liked: likedCrates.includes(crateId) });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/crate/like/check', verifyUser, async (req, res) => {
    try {
        const { crateId } = req.query;
        if (!crateId) return res.json({ liked: false });

        const userDoc = await db.collection('users').doc(req.uid).get();
        const likedCrates = userDoc.data()?.likedCrates || [];
        res.json({ liked: likedCrates.includes(crateId) });

    } catch (e) {
        res.json({ liked: false });
    }
});

router.post('/api/draft/save', verifyUser, express.json(), async (req, res) => {
    try {
        const { title, tracks, genreMap, coverImage } = req.body;
        
        const draftData = {
            title: title || '',
            tracks: tracks || [],
            genreMap: genreMap || {},
            coverImage: coverImage || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromDate(
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) 
            )
        };

        const draftRef = db.collection('users').doc(req.uid).collection('drafts').doc('workbench');
        const draftDoc = await draftRef.get();

        if (draftDoc.exists) {
            await draftRef.update(draftData);
        } else {
            draftData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            await draftRef.set(draftData);
        }

        res.json({ success: true, message: 'Draft saved' });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/draft/get', verifyUser, async (req, res) => {
    try {
        const draftDoc = await db.collection('users').doc(req.uid).collection('drafts').doc('workbench').get();
        if (!draftDoc.exists) return res.json({ hasDraft: false });

        const draft = draftDoc.data();
        const now = new Date();
        if (draft.expiresAt && draft.expiresAt.toDate() < now) {
            await draftDoc.ref.delete();
            return res.json({ hasDraft: false });
        }

        res.json({ 
            hasDraft: true, 
            draft: {
                title: draft.title,
                tracks: draft.tracks,
                genreMap: draft.genreMap,
                coverImage: draft.coverImage,
                updatedAt: draft.updatedAt
            }
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/api/draft/delete', verifyUser, async (req, res) => {
    try {
        await db.collection('users').doc(req.uid).collection('drafts').doc('workbench').delete();
        res.json({ success: true, message: 'Draft deleted' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/crate/play/:id', verifyUser, async (req, res) => {
    try {
        await db.collection('crates').doc(req.params.id).update({
            plays: admin.firestore.FieldValue.increment(1)
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/notifications', verifyUser, async (req, res) => {
    try {
        const notifsSnap = await db.collection('users')
            .doc(req.uid)
            .collection('notifications')
            .where('read', '==', false) 
            .orderBy('timestamp', 'desc')
            .limit(5)
            .get();

        const notifications = [];
        notifsSnap.forEach(doc => {
            const data = doc.data();
            notifications.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp ? data.timestamp.toDate() : new Date()
            });
        });

        res.json({ notifications });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/notifications/mark-read', verifyUser, express.json(), async (req, res) => {
    try {
        const { notificationId } = req.body;
        if (!notificationId) return res.status(400).json({ error: "Missing ID" });

        await db.collection('users')
            .doc(req.uid)
            .collection('notifications')
            .doc(notificationId)
            .update({ read: true });

        res.json({ success: true });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 6. ARTIST WALL COMMENTS API
// ==========================================

// POST: Add a comment to an artist's wall
router.post('/api/artist/:artistId/comment', verifyUser, express.json(), async (req, res) => {
    try {
        const { artistId } = req.params;
        const { comment } = req.body;
        const uid = req.uid;

        // Validate input
        if (!comment || comment.trim().length === 0) return res.status(400).json({ error: "Comment cannot be empty" });
        if (comment.length > 500) return res.status(400).json({ error: "Comment too long" });

        // 1. [FIX] Check Subcollection for Follow Status (The Source of Truth)
        const followDoc = await db.collection('users').doc(uid)
                                  .collection('following').doc(artistId)
                                  .get();

        if (!followDoc.exists) {
            return res.status(403).json({ 
                error: "You must be following this artist to comment",
                requiresFollow: true 
            });
        }

        // 2. Get user data for display
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
        const userData = userDoc.data();

        // 3. Create comment
        const commentData = {
            userId: uid,
            userName: userData.displayName || userData.handle || 'Anonymous',
            userHandle: userData.handle || null,
            userAvatar: userData.photoURL || null, // Ensure this field exists
            artistId: artistId,
            comment: comment.trim(),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            likes: 0,
            reported: false,
            hidden: false
        };

        const commentRef = await db.collection('artists').doc(artistId).collection('comments').add(commentData);

        // 4. Update counts
        await db.collection('artists').doc(artistId).update({
            'stats.comments': admin.firestore.FieldValue.increment(1)
        });

        res.json({ 
            success: true, 
            commentId: commentRef.id,
            comment: { id: commentRef.id, ...commentData, timestamp: new Date() }
        });

    } catch (e) {
        console.error("Comment Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET: Fetch comments for an artist
router.get('/api/artist/:artistId/comments', verifyUser, async (req, res) => {
    try {
        const { artistId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const lastTimestamp = req.query.lastTimestamp;

        let query = db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .where('hidden', '==', false)
            .orderBy('timestamp', 'desc')
            .limit(limit);

        // Pagination support
        if (lastTimestamp) {
            query = query.startAfter(new Date(lastTimestamp));
        }

        const commentsSnap = await query.get();

        const comments = [];
        commentsSnap.forEach(doc => {
            const data = doc.data();
            comments.push({
                id: doc.id,
                userId: data.userId,
                userName: data.userName,
                userHandle: data.userHandle,
                userAvatar: data.userAvatar,
                comment: data.comment,
                timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
                likes: data.likes || 0,
                isOwn: data.userId === req.uid
            });
        });

        res.json({ 
            comments,
            hasMore: comments.length === limit
        });

    } catch (e) {
        console.error("Fetch Comments Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// DELETE: Remove own comment
router.delete('/api/artist/:artistId/comment/:commentId', verifyUser, async (req, res) => {
    try {
        const { artistId, commentId } = req.params;
        const uid = req.uid;

        const commentRef = db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .doc(commentId);

        const commentDoc = await commentRef.get();
        
        if (!commentDoc.exists) {
            return res.status(404).json({ error: "Comment not found" });
        }

        const commentData = commentDoc.data();

        // Check if user owns the comment OR is the artist
        const artistDoc = await db.collection('artists').doc(artistId).get();
        const isArtistOwner = artistDoc.exists && artistDoc.data().userId === uid;

        if (commentData.userId !== uid && !isArtistOwner) {
            return res.status(403).json({ error: "Unauthorized to delete this comment" });
        }

        // Delete the comment
        await commentRef.delete();

        // Update artist's comment count
        await db.collection('artists').doc(artistId).update({
            'stats.comments': admin.firestore.FieldValue.increment(-1)
        });

        res.json({ success: true });

    } catch (e) {
        console.error("Delete Comment Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// POST: Report a comment (for moderation)
router.post('/api/artist/:artistId/comment/:commentId/report', verifyUser, express.json(), async (req, res) => {
    try {
        const { artistId, commentId } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: "Report reason required" });
        }

        const commentRef = db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .doc(commentId);

        const commentDoc = await commentRef.get();
        if (!commentDoc.exists) {
            return res.status(404).json({ error: "Comment not found" });
        }

        // Add to reports subcollection
        await commentRef.collection('reports').add({
            reportedBy: req.uid,
            reason: reason,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mark comment as reported
        await commentRef.update({ reported: true });

        res.json({ success: true });

    } catch (e) {
        console.error("Report Comment Error:", e);
        res.status(500).json({ error: e.message });
    }
});


// GET: Check if user can comment (Permission Check)
router.get('/api/artist/:artistId/can-comment', verifyUser, async (req, res) => {
    try {
        const { artistId } = req.params;
        const uid = req.uid;

        // [FIX] Check the SUBCOLLECTION, not the array
        const followDoc = await db.collection('users').doc(uid)
                                  .collection('following').doc(artistId)
                                  .get();

        const isFollowing = followDoc.exists;

        res.json({ 
            canComment: isFollowing,
            reason: isFollowing ? null : 'Must follow artist to comment'
        });

    } catch (e) {
        console.error("Can Comment Check Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// WALLET ALLOCATION ENDPOINT
// Add this to your routes/player.js file
// ==========================================

// POST: Commit allocation to multiple artists
router.post('/api/wallet/allocate', verifyUser, express.json(), async (req, res) => {
    try {
        const uid = req.uid;
        const { allocations } = req.body; // Array of {artistId, amount}
        
        if (!allocations || !Array.isArray(allocations)) {
            return res.status(400).json({ error: 'Invalid allocation data' });
        }
        
        if (allocations.length === 0) {
            return res.status(400).json({ error: 'No allocations provided' });
        }
        
        // Calculate total allocation
        const totalAllocation = allocations.reduce((sum, a) => sum + parseFloat(a.amount || 0), 0);
        
        if (totalAllocation <= 0) {
            return res.status(400).json({ error: 'Total allocation must be greater than 0' });
        }
        
        // Get user's current balance
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userData = userDoc.data();
        const currentBalance = parseFloat(userData.walletBalance || 0);
        
        // Validate user has enough balance
        if (totalAllocation > currentBalance) {
            return res.status(400).json({ 
                error: 'Allocation exceeds available balance',
                balance: currentBalance,
                requested: totalAllocation
            });
        }
        
        // Process allocations in a batch
        const batch = db.batch();
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        
        // Create allocation records
        allocations.forEach(({ artistId, amount }) => {
            const allocationRef = db.collection('allocations').doc();
            batch.set(allocationRef, {
                userId: uid,
                artistId: artistId,
                amount: parseFloat(amount),
                timestamp: timestamp,
                status: 'committed',
                type: 'monthly_allocation'
            });
            
            // Update artist's earnings (optional - you can do this in a cron job instead)
            const artistRef = db.collection('artists').doc(artistId);
            batch.update(artistRef, {
                'earnings.total': admin.firestore.FieldValue.increment(parseFloat(amount)),
                'earnings.thisMonth': admin.firestore.FieldValue.increment(parseFloat(amount)),
                'stats.supporters': admin.firestore.FieldValue.increment(1)
            });
        });
        
        // Deduct from user's balance
        const userRef = db.collection('users').doc(uid);
        batch.update(userRef, {
            walletBalance: currentBalance - totalAllocation,
            lastAllocation: timestamp
        });
        
        // Commit all changes
        await batch.commit();
        
        res.json({ 
            success: true,
            newBalance: currentBalance - totalAllocation,
            allocated: totalAllocation,
            artists: allocations.length
        });
        
    } catch (e) {
        console.error('Allocation Error:', e);
        res.status(500).json({ error: e.message || 'Failed to commit allocation' });
    }
});

// GET: Transaction/Allocation History (Optional)
router.get('/api/wallet/transactions', verifyUser, async (req, res) => {
    try {
        const uid = req.uid;
        const limit = parseInt(req.query.limit) || 50;

        // Helper to get artist name with caching
        const artistCache = {};
        const getArtistName = async (id) => {
            if (!id) return null;
            if (artistCache[id]) return artistCache[id];
            try {
                const artistDoc = await db.collection('artists').doc(id).get();
                const name = artistDoc.exists ? artistDoc.data().name : null;
                artistCache[id] = name;
                return name;
            } catch (e) { return null; }
        };

        const rawTransactions = [];

        // 1. Wallet subcollection (membership payments, auto-allocations, wallet credits from signup)
        const walletSnap = await db.collection('users').doc(uid)
            .collection('wallet')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();

        for (const doc of walletSnap.docs) {
            const d = doc.data();
            rawTransactions.push({
                id: doc.id,
                type: d.type,
                description: d.description || '',
                amount: d.amount,
                breakdown: d.breakdown || null,
                timestamp: d.timestamp?.toDate() || new Date(),
                source: 'wallet_subcollection'
            });
        }

        // 2. Legacy allocations collection
        try {
            const allocSnap = await db.collection('allocations')
                .where('userId', '==', uid)
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();
            for (const doc of allocSnap.docs) {
                const d = doc.data();
                const artistName = await getArtistName(d.artistId);
                rawTransactions.push({
                    id: doc.id,
                    type: 'allocation',
                    description: artistName ? `Allocated to ${artistName}` : (d.description || 'Allocation'),
                    amount: -(Math.abs(d.amount)),
                    timestamp: d.timestamp?.toDate() || new Date(),
                    source: 'allocations'
                });
            }
        } catch (e) { /* collection may not exist yet */ }

        // 3. Legacy tips collection
        try {
            const tipsSnap = await db.collection('transactions')
                .where('fromUser', '==', uid)
                .where('type', '==', 'tip')
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();
            for (const doc of tipsSnap.docs) {
                const d = doc.data();
                const artistName = await getArtistName(d.toArtist);
                rawTransactions.push({
                    id: doc.id,
                    type: 'tip',
                    description: artistName ? `Tip to ${artistName}` : (d.description || 'Tip'),
                    amount: -(Math.abs(d.amount)),
                    timestamp: d.timestamp?.toDate() || new Date(),
                    source: 'transactions'
                });
            }
        } catch (e) { /* collection may not exist yet */ }

        // Sort all sources by most recent and deduplicate by id
        const seen = new Set();
        const sorted = rawTransactions
            .filter(tx => { if (seen.has(tx.id)) return false; seen.add(tx.id); return true; })
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);

        res.json({ transactions: sorted, count: sorted.length });

    } catch (e) {
        console.error('Transaction History Error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;