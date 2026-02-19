const express = require('express');

module.exports = (db, verifyUser, CDN_URL) => {
    const router = express.Router();

    // ==========================================
    // DASHBOARD & CITY NAVIGATION
    // ==========================================

    router.get('/api/dashboard', verifyUser, async (req, res) => {
        try {
            const fixImageUrl = (url) => url ? url : `${CDN_URL}/assets/placeholder_art.jpg`;

            const requestedCity = req.query.city;
            const requestedState = req.query.state;
            const requestedCountry = req.query.country;
            
            const userDoc = await db.collection('users').doc(req.uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
            
            const userData = userDoc.data();
            
            const userCity = requestedCity || userData.city || 'Local';
            const userState = requestedState || userData.state || '';
            const userCountry = requestedCountry || userData.country || 'US';
            
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

            const cratesSnap = await db.collection('discovery')
                .doc('crates_by_city')
                .collection(userCity)
                .orderBy('createdAt', 'desc')
                .limit(8)
                .get();

            const localCrates = cratesSnap.docs.map(doc => {
                const data = doc.data();
                const coverImg = data.coverImage || data.tracks?.[0]?.artUrl || 'https://via.placeholder.com/150';
                return {
                    id: data.id,
                    userId: data.creatorId,
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
                            userId: indexData.userId,
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

    router.get('/api/cities/active', verifyUser, async (req, res) => {
        try {
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
            
            const activeCities = Array.from(cityMap.values());
            res.json({ cities: activeCities });
            
        } catch (e) {
            console.error("Active Cities API Error:", e);
            res.status(500).json({ error: "Failed to load active cities" });
        }
    });

    router.get('/api/cities/stats', verifyUser, async (req, res) => {
        try {
            const artistsSnap = await db.collection('artists')
                .select('city', 'state', 'country', 'coordinates', 'primaryGenre', 'genres')
                .get();
            
            const cityStatsMap = new Map();
            
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
                
                if (data.primaryGenre) {
                    cityStats.genreCount[data.primaryGenre] = (cityStats.genreCount[data.primaryGenre] || 0) + 1;
                }
                
                if (data.genres) {
                    data.genres.forEach(g => cityStats.genres.add(g));
                }
            });
            
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
            
            const crateCountMap = new Map();
            const discoveryRef = db.collection('discovery').doc('crates_by_city');
            const cityCollections = await discoveryRef.listCollections();
            
            for (const collection of cityCollections) {
                const cityName = collection.id;
                const crateCount = (await collection.count().get()).data().count;
                crateCountMap.set(cityName, crateCount);
            }
            
            const cities = [];
            
            cityStatsMap.forEach((stats, cityKey) => {
                let topGenre = 'Hip-Hop';
                let maxCount = 0;
                Object.entries(stats.genreCount).forEach(([genre, count]) => {
                    if (count > maxCount) {
                        maxCount = count;
                        topGenre = genre;
                    }
                });
                
                let activity = 'low';
                if (stats.artistCount > 50) activity = 'high';
                else if (stats.artistCount > 20) activity = 'medium';
                
                cities.push({
                    city: stats.city,
                    state: stats.state,
                    country: stats.country,
                    coordinates: stats.coordinates || null, 
                    topGenre: topGenre,
                    genres: Array.from(stats.genres).slice(0, 3), 
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