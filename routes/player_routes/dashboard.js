const express = require('express');
const admin   = require('firebase-admin');

/** Convert an artist name to a URL-safe slug */
function slugify(str = '') {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

module.exports = (db, verifyUser, CDN_URL) => {
    const router = express.Router();

    // ─── URL normaliser — used across all routes in this module ───────────
    const CDN_HOST = CDN_URL.replace(/^https?:\/\//, '');
    const R2_DEV   = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;
    function normalizeUrl(url, fallback = `${CDN_URL}/assets/placeholder_art.jpg`) {
        if (!url) return fallback;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return R2_DEV.test(url) ? url.replace(R2_DEV, CDN_URL) : url;
        }
        if (url.startsWith(CDN_HOST)) return `https://${url}`;
        return `${CDN_URL}/${url.replace(/^\//, '')}`;
    }

    // ─── Soundscape helpers ────────────────────────────────────────────────

    /** Canonical city key: "san_diego__california" */
    function makeCityKey(city, state) {
        if (!city || !state) return null;
        return `${city.trim().toLowerCase().replace(/\s+/g, '_')}__${state.trim().toLowerCase().replace(/\s+/g, '_')}`;
    }

    /**
     * Parse "San Diego, California, United States" -> { city, state, country }
     * Handles any number of comma-separated parts gracefully.
     */
    function parseLocationString(str) {
        if (!str || typeof str !== 'string') return {};
        const parts = str.split(',').map(p => p.trim()).filter(Boolean);
        return {
            city:    parts[0] || null,
            state:   parts[1] || null,
            country: parts[2] || null,
        };
    }

    /** Dashboard Firestore cache TTL: 30 minutes */
    const DASHBOARD_CACHE_TTL_MS = 30 * 60 * 1000;

    /** Normalise a raw Firestore GeoPoint → { lat, lng } | null */
    function extractCoords(raw) {
        if (!raw) return null;
        const lat = raw._latitude  ?? raw.latitude  ?? raw.lat;
        const lng = raw._longitude ?? raw.longitude ?? raw.lng;
        if (lat == null || lng == null) return null;
        return { lat: parseFloat(lat), lng: parseFloat(lng) };
    }

    // How long a soundscape cache doc is considered fresh
    const SOUNDSCAPE_TTL_MS = 30 * 60 * 1000; // 30 minutes

    /**
     * Full rebuild of the `soundscape` collection.
     * Aggregates artists + users + songs + cityMap (crates) into one doc per city.
     * Returns the array of city objects written.
     */
    async function buildSoundscape() {
        const now           = Date.now();
        const oneDayAgo     = new Date(now - 24 * 60 * 60 * 1000);
        const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

        const map = new Map(); // cityKey → entry

        function getOrCreate(city, state, country, coordsRaw) {
            const key = makeCityKey(city, state);
            if (!key) return null;
            if (!map.has(key)) {
                map.set(key, {
                    cityKey:         key,
                    city:            city.trim(),
                    state:           state.trim(),
                    country:         country || 'United States',
                    coordinates:     extractCoords(coordsRaw),
                    artistCount:     0,
                    userCount:       0,
                    trackCount:      0,
                    crateCount:      0,
                    foundingArtists: 0,
                    genreCounts:     {},
                    topTracks:       [],
                    recentUploads:   0,
                });
            } else if (!map.get(key).coordinates && coordsRaw) {
                map.get(key).coordinates = extractCoords(coordsRaw);
            }
            return map.get(key);
        }

        // 1. Artists ──────────────────────────────────────────────────────
        const artistsSnap = await db.collection('artists')
            .select('city', 'state', 'country', 'coordinates', 'primaryGenre', 'genres', 'name', 'createdAt')
            .get();

        for (const doc of artistsSnap.docs) {
            const d = doc.data();
            // Top-level city/state are set at approval time by admin.js.
            // Fall back to the nested location object for artists approved before
            // the location-flattening fix (or before running the migration).
            const city        = d.city        || d.location?.city;
            const state       = d.state       || d.location?.state;
            const country     = d.country     || d.location?.country;
            const coordinates = d.coordinates || d.location?.coordinates;
            const entry = getOrCreate(city, state, country, coordinates);
            if (!entry) continue;
            entry.artistCount++;
            const genres = [...(d.genres || []), ...(d.primaryGenre ? [d.primaryGenre] : [])];
            genres.forEach(g => { entry.genreCounts[g] = (entry.genreCounts[g] || 0) + 1; });
            const createdAt = d.createdAt?.toDate?.() || (d.createdAt ? new Date(d.createdAt) : null);
            if (createdAt && createdAt < ninetyDaysAgo) entry.foundingArtists++;
        }

        // 2. Users with a city set ─────────────────────────────────────────
        const usersSnap = await db.collection('users')
            .select('city', 'state', 'country', 'coordinates')
            .get();

        for (const doc of usersSnap.docs) {
            const d = doc.data();
            const entry = getOrCreate(d.city, d.state, d.country, d.coordinates);
            if (!entry) continue;
            entry.userCount++;
        }

        // 3. Songs → track counts + recent uploads + top tracks ───────────
        const songsSnap = await db.collection('songs')
            .select('city', 'state', 'title', 'artistName', 'audioUrl', 'artUrl', 'genre', 'uploadedAt')
            .get();

        for (const doc of songsSnap.docs) {
            const d     = doc.data();
            const entry = getOrCreate(d.city, d.state, null, null);
            if (!entry) continue;
            entry.trackCount++;
            const uploadedAt = d.uploadedAt?.toDate?.() || (d.uploadedAt ? new Date(d.uploadedAt) : null);
            if (uploadedAt && uploadedAt > oneDayAgo) entry.recentUploads++;
            if (d.genre) entry.genreCounts[d.genre] = (entry.genreCounts[d.genre] || 0) + 1;
            if (entry.topTracks.length < 5) {
                entry.topTracks.push({
                    id:       doc.id,
                    title:    d.title,
                    artist:   d.artistName || 'Unknown',
                    audioUrl: normalizeUrl(d.audioUrl, null),
                    artUrl:   normalizeUrl(d.artUrl,   null),
                    genre:    d.genre || null,
                });
            }
        }

        // 4. Crate counts from cityMap (written by crates route) ──────────
        const cityMapSnap = await db.collection('cityMap').get();
        for (const doc of cityMapSnap.docs) {
            const d = doc.data();
            if (!d.city || !d.state) continue;
            const entry = getOrCreate(d.city, d.state, d.country, d.coordinates);
            if (!entry) continue;
            entry.crateCount = d.crateCount || 0;
            if (d.genreCounts) {
                Object.entries(d.genreCounts).forEach(([g, c]) => {
                    entry.genreCounts[g] = (entry.genreCounts[g] || 0) + (c || 0);
                });
            }
        }

        // 5. Derive stats + batch-write to soundscape collection ──────────
        const results = [];
        let batchObj  = db.batch();
        let opCount   = 0;

        for (const [, entry] of map) {
            if (entry.artistCount === 0 && entry.userCount === 0 && entry.crateCount === 0) continue;

            const sortedGenres = Object.entries(entry.genreCounts).sort((a, b) => b[1] - a[1]);
            const topGenre = sortedGenres[0]?.[0] || 'Various';
            const genres   = sortedGenres.slice(0, 3).map(([g]) => g);
            const activityScore = entry.recentUploads + Math.min(entry.crateCount, 15);
            const activity = activityScore > 10 ? 'high' : activityScore > 4 ? 'medium' : 'low';

            const cityDoc = {
                cityKey:         entry.cityKey,
                city:            entry.city,
                state:           entry.state,
                country:         entry.country,
                coordinates:     entry.coordinates,   // { lat, lng } | null
                artistCount:     entry.artistCount,
                userCount:       entry.userCount,
                trackCount:      entry.trackCount,
                crateCount:      entry.crateCount,
                foundingArtists: entry.foundingArtists,
                topGenre,
                genres,
                genreCounts:     entry.genreCounts,
                activity,
                recentUploads:   entry.recentUploads,
                topTracks:       entry.topTracks,
                updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
            };

            batchObj.set(db.collection('soundscape').doc(entry.cityKey), cityDoc, { merge: true });
            opCount++;
            results.push(cityDoc);

            if (opCount === 499) {
                await batchObj.commit();
                batchObj = db.batch();
                opCount  = 0;
            }
        }
        if (opCount > 0) await batchObj.commit();

        return results;
    }

    // ==========================================
    // DASHBOARD & CITY NAVIGATION
    // ==========================================

    router.get('/api/dashboard', verifyUser, async (req, res) => {
        try {

            const requestedCity = req.query.city;
            const requestedState = req.query.state;
            const requestedCountry = req.query.country;
            
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
            
            const userData = userDoc.data();

            // userData.city / .state may not exist if the user signed up before
            // location flattening — fall back to parsing the location string.
            const parsedLoc  = parseLocationString(userData.location);
            const userCity    = requestedCity  || userData.city   || parsedLoc.city   || 'Local';
            const userState   = requestedState || userData.state  || parsedLoc.state  || '';
            const userCountry = requestedCountry || userData.country || parsedLoc.country || 'US';

            // ── Firestore dashboard cache ─────────────────────────────────
            // Key = uid + city so city-switching always fetches fresh data for
            // new cities while the home city is served from cache.
            const cityKey  = makeCityKey(userCity, userState) || userCity.toLowerCase().replace(/\s+/g,'_');
            const cacheRef = db.collection('dashboardCache').doc(`${req.uid}__${cityKey}`);

            if (!requestedCity) { // only use cache for the user's home city
                const cacheSnap = await cacheRef.get();
                if (cacheSnap.exists) {
                    const cached = cacheSnap.data();
                    const age    = Date.now() - (cached.cachedAt?.toMillis?.() || 0);
                    if (age < DASHBOARD_CACHE_TTL_MS) {
                        return res.json(cached.payload);
                    }
                }
            }
            
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
                        img:      normalizeUrl(data.artUrl || artistData.profileImage || artistData.avatarUrl),
                        audioUrl: normalizeUrl(data.audioUrl, null),
                        duration: data.duration || 0,
                        type: 'song'
                    });
                }
            } catch (songsErr) {
                console.warn('Songs query failed (index may be missing):', songsErr.message);
            }

            const cratesSnap = await db.collection('discovery')
                .doc('crates_by_city')
                .collection(userCity)
                .orderBy('createdAt', 'desc')
                .limit(8)
                .get();

            const localCrates = cratesSnap.docs.map(doc => {
                const data = doc.data();
                const coverImg = normalizeUrl(data.coverImage || data.tracks?.[0]?.artUrl || data.tracks?.[0]?.img);
                return {
                    id: data.id,
                    userId: data.creatorId,
                    title: data.title,
                    artist: `by ${data.creatorHandle || 'Anonymous'}`,
                    creatorHandle: data.creatorHandle || 'Anonymous',
                    img: coverImg,
                    coverImage: coverImg,
                    trackCount: data.metadata?.trackCount || 0,
                    songCount: data.metadata?.trackCount || 0,
                    type: 'crate'
                };
            });

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
                        const crateCoverImg = normalizeUrl(crateData.coverImage || crateData.tracks?.[0]?.img || crateData.tracks?.[0]?.artUrl);
                        localCrates.push({
                            id: crateId,
                            userId: indexData.userId,
                            title: crateData.title,
                            artist: `by ${crateData.creatorHandle || 'Anonymous'}`,
                            creatorHandle: crateData.creatorHandle || 'Anonymous',
                            img: crateCoverImg,
                            coverImage: crateCoverImg,
                            trackCount: crateData.metadata?.trackCount || 0,
                            songCount: crateData.metadata?.trackCount || 0,
                            type: 'crate'
                        });
                    }
                }
            }

            // NOTE: .where('city') only matches the top-level field.
            // Run POST /admin/api/migrate/fix-artist-locations once to backfill
            // artists approved before the location-flattening fix.
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
                    img: normalizeUrl(data.profileImage || data.avatarUrl),
                    city: data.city, 
                    state: data.state, 
                    country: data.country,
                    genres: data.genres || [],
                    primaryGenre: data.primaryGenre || null
                };
                
                allLocalArtists.push(artistObj);
                
                if (userGenres.length > 0 || userPrimaryGenre) {
                    const artistGenres = data.genres || [];
                    const artistPrimaryGenre = data.primaryGenre;
                    
                    const hasGenreMatch = 
                        (userPrimaryGenre && artistPrimaryGenre === userPrimaryGenre) ||
                        artistGenres.some(g => userGenres.includes(g)) ||
                        artistGenres.some(g => userSubgenres.includes(g));
                    
                    if (hasGenreMatch) {
                        genreMatchedArtists.push(artistObj);
                    }
                }
            });

            const topLocal = allLocalArtists.slice(0, 8);
            const forYou = genreMatchedArtists.slice(0, 8);

            const payload = {
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
            };

            // Write Firestore cache for the home city (fire-and-forget)
            if (!requestedCity) {
                cacheRef.set({
                    payload,
                    cachedAt: admin.firestore.FieldValue.serverTimestamp(),
                    cityKey,
                }).catch(e => console.warn('[dashboard cache write]', e.message));
            }

            res.json(payload);

        } catch (e) {
            console.error("Dashboard API Error:", e);
            res.status(500).json({ error: "Failed to load dashboard" });
        }
    });


    // ==========================================
    // SIDEBAR: FOLLOWED ARTISTS
    // Reads users/{uid}/following (type='artist') and returns
    // the last 15 followed artists for the left-sidebar list.
    // ==========================================
    router.get('/api/user/sidebar-artists', verifyUser, async (req, res) => {
        try {
            const snap = await db.collection('users').doc(req.uid)
                .collection('following')
                .where('type', '==', 'artist')
                .orderBy('followedAt', 'desc')
                .limit(15)
                .get();

            const artists = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id:   doc.id,
                    name: d.name || 'Unknown Artist',
                    img:  normalizeUrl(d.img) || `${CDN_URL}/assets/default-avatar.jpg`,
                };
            });

            res.json({ artists });
        } catch (e) {
            console.error('Sidebar artists error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // =====================================================================
    // SOUNDSCAPE  —  materialized city stats used by the map + dashboard
    // soundscape/{cityKey} is rebuilt every 30 min or on-demand.
    // =====================================================================

    // GET /api/soundscape
    // Returns all cities for the City Soundscape map.
    // Reads from the cache; rebuilds automatically if stale.
    router.get('/api/soundscape', verifyUser, async (req, res) => {
        try {
            const forceRefresh = req.query.refresh === '1';
            const cacheSnap    = await db.collection('soundscape').limit(300).get();
            let   cities       = cacheSnap.docs.map(d => d.data());

            const isStale = forceRefresh || cities.length === 0 || cities.some(c => {
                const updated = c.updatedAt?.toDate?.()?.getTime() || 0;
                return (Date.now() - updated) > SOUNDSCAPE_TTL_MS;
            });

            if (isStale) {
                console.log('🗺️ Soundscape cache stale — rebuilding...');
                cities = await buildSoundscape();
                console.log(`🗺️ Rebuilt: ${cities.length} cities`);
            }

            res.json({ cities, rebuiltAt: isStale ? new Date().toISOString() : null });
        } catch (e) {
            console.error('Soundscape error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/soundscape/:cityKey
    // Full detail for a single city including a sample of local artists.
    // Used by "Explore Scene" to populate the city view on the dashboard.
    router.get('/api/soundscape/:cityKey', verifyUser, async (req, res) => {
        try {
            const doc = await db.collection('soundscape').doc(req.params.cityKey).get();
            if (!doc.exists) return res.status(404).json({ error: 'City not found in soundscape' });

            const cityData    = doc.data();
            const artistsSnap = await db.collection('artists')
                .where('city', '==', cityData.city)
                .orderBy('stats.followers', 'desc')
                .limit(12)
                .get();

            const artists = artistsSnap.docs.map(d => {
                const a = d.data();
                return {
                    id:        d.id,
                    name:      a.name,
                    img:       normalizeUrl(a.profileImage || a.avatarUrl),
                    genres:    a.genres || [],
                    followers: a.stats?.followers || 0,
                    slug:      a.slug || slugify(a.name || d.id),
                };
            });

            res.json({ ...cityData, artists });
        } catch (e) {
            console.error('Soundscape city detail error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/soundscape/rebuild
    // Force-rebuilds the soundscape collection. Call this after major write
    // events (artist signup, bulk upload) or from an admin dashboard.
    router.post('/api/soundscape/rebuild', verifyUser, async (req, res) => {
        try {
            console.log(`🗺️ Soundscape rebuild triggered by ${req.uid}`);
            const cities = await buildSoundscape();
            res.json({ success: true, citiesBuilt: cities.length });
        } catch (e) {
            console.error('Soundscape rebuild error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/cities/active
    // Kept for backward compat (city selector pills in dashboard).
    // Reads from soundscape so it stays consistent with the map.
    router.get('/api/cities/active', verifyUser, async (req, res) => {
        try {
            const snap = await db.collection('soundscape')
                .select('city', 'state', 'country', 'artistCount')
                .orderBy('artistCount', 'desc')
                .limit(50)
                .get();

            if (snap.empty) {
                // Soundscape not built yet — fall back to raw artists query
                const artistsSnap = await db.collection('artists')
                    .select('city', 'state', 'country').get();
                const seen = new Map();
                artistsSnap.forEach(d => {
                    const v = d.data();
                    if (v.city && !seen.has(v.city)) seen.set(v.city, { city: v.city, state: v.state, country: v.country || 'United States' });
                });
                return res.json({ cities: Array.from(seen.values()) });
            }

            res.json({ cities: snap.docs.map(d => d.data()) });
        } catch (e) {
            console.error('Cities active error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    // ==========================================
    // GLOBAL SEARCH
    // ==========================================

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
                        img: normalizeUrl(data.profileImage || data.avatarUrl),
                        url: `/player/artist/${data.slug || slugify(data.name || doc.id)}`
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

    return router;
};