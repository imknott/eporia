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

    /**
     * Canonical city key — must match the format written by crates.js exactly.
     * Format: "San_Diego__CA__US"  (title-case preserved, double-underscore separator)
     */
    function makeCityKey(city, state, country) {
        if (!city) return null;
        const c = city.trim().replace(/\s+/g, '_');
        const s = (state   || 'Global').trim().replace(/\s+/g, '_');
        const n = (country || 'US').trim().replace(/\s+/g, '_');
        return `${c}__${s}__${n}`;
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
        // UPDATE: Added 'geo' and 'location' to the select query
        const artistsSnap = await db.collection('artists')
            .select('city', 'state', 'country', 'coordinates', 'geo', 'location', 'primaryGenre', 'genres', 'name', 'createdAt')
            .get();

        for (const doc of artistsSnap.docs) {
            const d = doc.data();
            
            // UPDATE: Check top-level, then geo, then location
            const city        = d.city        || d.geo?.city        || d.location?.city;
            const state       = d.state       || d.geo?.state       || d.location?.state;
            const country     = d.country     || d.geo?.country     || d.location?.country;
            
            // Format geo coordinates if they exist
            let geoCoords = null;
            if (d.geo?.lat != null && d.geo?.lng != null) {
                geoCoords = { lat: d.geo.lat, lng: d.geo.lng };
            }
            const coordinates = d.coordinates || geoCoords || d.location?.coordinates;
            
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
            // Guest safety net — if no uid, redirect to the public global endpoint.
            // This shouldn't normally happen (DashboardController routes guests to
            // /api/dashboard/global directly) but protects against stale SPA state.
            if (!req.uid) {
                return res.redirect('/player/api/dashboard/global');
            }

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

            // No server-side cache — caching is handled in the client via sessionStorage.
            // Writing to Firestore to avoid Firestore reads is self-defeating.
            
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

                // Collect only non-album songs, then batch-fetch all distinct artists
                // in one Promise.all instead of sequential awaits in a for loop (N+1 fix).
                const songDocs = citySnap.docs.filter(d => !d.data().albumId);
                const uniqueArtistIds = [...new Set(songDocs.map(d => d.data().artistId).filter(Boolean))];

                const artistDocs = await Promise.all(
                    uniqueArtistIds.map(id => db.collection('artists').doc(id).get())
                );
                const artistMap = new Map(
                    artistDocs.filter(d => d.exists).map(d => [d.id, d.data()])
                );

                for (const doc of songDocs) {
                    const data = doc.data();
                    const artistData = artistMap.get(data.artistId) || {};
                    freshDrops.push({
                        id:       doc.id,
                        title:    data.title,
                        artist:   artistData.name || 'Unknown',
                        artistId: data.artistId,
                        img:      normalizeUrl(data.artUrl || artistData.profileImage || artistData.avatarUrl),
                        audioUrl: normalizeUrl(data.audioUrl, null),
                        duration: data.duration || 0,
                        type:     'song'
                    });
                }
            } catch (songsErr) {
                console.warn('Songs query failed (index may be missing):', songsErr.message);
            }

            // ── City crates from flat collection ────────────────────────────
            // Query: crates where cityKey == x AND privacy == 'public'
            // Index needed: cityKey ASC + privacy ASC + createdAt DESC
            const cityCrateKey = makeCityKey(userCity, userState, userCountry);

            function shapeCrate(docId, data) {
                const coverImg = normalizeUrl(
                    data.coverImage || data.tracks?.[0]?.artUrl || data.tracks?.[0]?.img
                );
                return {
                    id:            docId,
                    userId:        data.creatorId || null,
                    title:         data.title || 'Untitled',
                    artist:        `by ${data.creatorHandle || 'Anonymous'}`,
                    creatorHandle: data.creatorHandle || 'Anonymous',
                    img:           coverImg,
                    coverImage:    coverImg,
                    trackCount:    data.trackCount || data.metadata?.trackCount || 0,
                    songCount:     data.trackCount || data.metadata?.trackCount || 0,
                    type:          'crate',
                };
            }

            const localCrates  = [];
            const seenCrateIds = new Set();

            // Community crates only — viewer's own crates live on their profile page.
            if (cityCrateKey) {
                try {
                    const cratesSnap = await db.collection('crates')
                        .where('cityKey', '==', cityCrateKey)
                        .where('privacy', '==', 'public')
                        .orderBy('createdAt', 'desc')
                        .limit(12)
                        .get();

                    cratesSnap.docs.forEach(doc => {
                        if (!seenCrateIds.has(doc.id)) {
                            seenCrateIds.add(doc.id);
                            localCrates.push(shapeCrate(doc.id, doc.data()));
                        }
                    });
                } catch (cityErr) {
                    console.warn('[dashboard] city crates fetch failed:', cityErr.message);
                }
            }

            // State-level fallback — only if the city query returned nothing
            if (localCrates.length === 0 && userState) {
                try {
                    // Find sibling cityKeys in the same state from cityMap
                    const stateCityMapSnap = await db.collection('cityMap')
                        .where('state', '==', userState)
                        .limit(10)
                        .get();

                    const stateFetches = stateCityMapSnap.docs
                        .map(d => d.data().cityKey)
                        .filter(key => key && key !== cityCrateKey)
                        .map(key =>
                            db.collection('crates')
                                .where('cityKey', '==', key)
                                .where('privacy', '==', 'public')
                                .orderBy('createdAt', 'desc')
                                .limit(4)
                                .get()
                                .catch(() => null)
                        );

                    const stateResults = await Promise.all(stateFetches);
                    stateResults.forEach(snap => {
                        if (!snap) return;
                        snap.docs.forEach(doc => {
                            if (!seenCrateIds.has(doc.id)) {
                                seenCrateIds.add(doc.id);
                                localCrates.push(shapeCrate(doc.id, doc.data()));
                            }
                        });
                    });
                } catch (stateErr) {
                    console.warn('[dashboard] state fallback crates fetch failed:', stateErr.message);
                }
            }

            // NOTE: .where('city') only matches the top-level field.
            // Run POST /admin/api/migrate/fix-artist-locations once to backfill
            // artists approved before the location-flattening fix.
            // Two equality filters on different fields work without a composite index.
            let artistsSnap = await db.collection('artists')
                .where('status', '==', 'approved')
                .where('city', '==', userCity)
                .limit(20)
                .get();

            if (artistsSnap.empty && userState) {
                artistsSnap = await db.collection('artists')
                    .where('status', '==', 'approved')
                    .where('state', '==', userState)
                    .limit(20)
                    .get();
            }

            const allLocalArtists = [];
            const genreMatchedArtists = [];

            artistsSnap.forEach(doc => {
                const data = doc.data();
                const artistObj = {
                    id:           doc.id,
                    name:         data.name          || 'Unknown Artist',
                    img:          normalizeUrl(data.profileImage || data.avatarUrl),
                    city:         data.city          || null,
                    state:        data.state         || null,
                    country:      data.country       || null,
                    genres:       data.genres        || [],
                    primaryGenre: data.primaryGenre  || null,
                    // slug is critical — without it, navigating to an artist circle
                    // uses the raw Firestore doc ID which triggers a server 301
                    // redirect. appRouter must then re-fetch, and any error in
                    // that re-fetch falls through to window.location.href → music stops.
                    slug:         data.slug          || slugify(data.name || doc.id),
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
                    slug: d.slug || null,   // stored by connections.js on follow
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
            
            // Note: This relies on the migration script having elevated geo.city to top-level city
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

            // Deduplicate by normalised city name — the soundscape collection can
            // accumulate duplicate docs if the cityKey format ever changed (e.g. the
            // old lowercase key and the new title-case key both exist for the same city).
            // We keep whichever entry has the higher artistCount (already sorted desc).
            function deduplicateCities(docs) {
                const seen = new Map();
                docs.forEach(d => {
                    const raw = d.city || d.data?.()?.city;
                    if (!raw) return;
                    const key = raw.trim().toLowerCase();
                    if (!seen.has(key)) seen.set(key, typeof d.data === 'function' ? d.data() : d);
                });
                return Array.from(seen.values());
            }

            if (snap.empty) {
                const artistsSnap = await db.collection('artists')
                    .select('city', 'state', 'country', 'geo', 'location').get();
                
                const seen = new Map();
                artistsSnap.forEach(d => {
                    const v = d.data();
                    const c = v.city || v.geo?.city || v.location?.city;
                    const s = v.state || v.geo?.state || v.location?.state;
                    const cntry = v.country || v.geo?.country || v.location?.country || 'United States';
                    
                    if (c && !seen.has(c.trim().toLowerCase())) {
                        seen.set(c.trim().toLowerCase(), { city: c, state: s, country: cntry });
                    }
                });
                return res.json({ cities: Array.from(seen.values()) });
            }

            res.json({ cities: deduplicateCities(snap.docs) });
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


    // ==========================================
    // PUBLIC GLOBAL SCENE  — no auth required
    //
    // GET /api/dashboard/global
    //
    // Served to unauthenticated (guest) visitors.  Returns a platform-wide
    // view: all approved artists ordered by followers, plus the latest songs
    // across the entire catalogue.  No location or genre personalisation —
    // that only applies to signed-in members.
    //
    // This intentionally has no verifyUser middleware so it is accessible
    // without a session cookie or Bearer token.
    // ==========================================
    router.get('/api/dashboard/global', async (req, res) => {
        try {
            // ── All approved artists (ordered by followers) ──────────────────
            const artistsSnap = await db.collection('artists')
                .where('status', '==', 'approved')
                .orderBy('stats.followers', 'desc')
                .limit(24)
                .get();

            const allArtists = artistsSnap.docs.map(doc => {
                const d = doc.data();
                return {
                    id:           doc.id,
                    name:         d.name          || 'Unknown Artist',
                    img:          normalizeUrl(d.profileImage || d.avatarUrl),
                    city:         d.city          || null,
                    state:        d.state         || null,
                    country:      d.country       || null,
                    genres:       d.genres        || [],
                    primaryGenre: d.primaryGenre  || null,
                    slug:         d.slug          || slugify(d.name || doc.id),
                    followers:    d.stats?.followers || 0,
                };
            });

            // ── Latest songs platform-wide ────────────────────────────────────
            const freshDrops = [];
            try {
                const songsSnap = await db.collection('songs')
                    .orderBy('uploadedAt', 'desc')
                    .limit(12)
                    .get();

                // Batch-fetch all distinct artists referenced by these songs
                const artistIds = [...new Set(
                    songsSnap.docs.map(d => d.data().artistId).filter(Boolean)
                )];
                const artistDocs = await Promise.all(
                    artistIds.map(id => db.collection('artists').doc(id).get())
                );
                const artistMap = new Map(
                    artistDocs.filter(d => d.exists).map(d => [d.id, d.data()])
                );

                songsSnap.docs.forEach(doc => {
                    const d           = doc.data();
                    const artistData  = artistMap.get(d.artistId) || {};
                    freshDrops.push({
                        id:       doc.id,
                        title:    d.title,
                        artist:   artistData.name || d.artistName || 'Unknown',
                        artistId: d.artistId,
                        img:      normalizeUrl(d.artUrl || artistData.profileImage || artistData.avatarUrl),
                        audioUrl: normalizeUrl(d.audioUrl, null),
                        duration: d.duration || 0,
                        type:     'song',
                    });
                });
            } catch (songsErr) {
                console.warn('[global scene] songs query failed:', songsErr.message);
            }

            res.json({
                isGuest:     true,
                city:        null,
                state:       null,
                freshDrops,
                topLocal:    allArtists,   // "topLocal" is the key renderSceneDashboard reads
                localCrates: [],
                forYou:      [],
            });

        } catch (e) {
            console.error('[global scene] error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};