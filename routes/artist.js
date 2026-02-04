var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require("firebase-admin");
const { analyzeAudioFeatures } = require('./audioAnalysis');

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
if (!admin.apps.length) {
    try {
        var serviceAccount = require("../serviceAccountKey.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: "eporia.firebasestorage.app"
        });
    } catch (e) {
        console.warn("Attempting default init...", e);
        try {
            admin.initializeApp({
                projectId: "eporia",
                storageBucket: "eporia.firebasestorage.app"
            });
        } catch (err) {
            console.error("Firebase Init Failed:", err);
        }
    }
}

const db = admin.firestore();
const bucket = admin.storage().bucket();


// ==========================================
// MULTER CONFIGURATION
// ==========================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images and audio allowed.'), false);
        }
    }
});

// ==========================================
// MIDDLEWARE: VERIFY USER
// ==========================================
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).send("Unauthorized");
    try {
        const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch (error) { 
        res.status(403).send("Invalid Token"); 
    }
}

// ==========================================
// HELPER: COPYRIGHT DETECTION (SKIP FOR NOW - FLAG ALL FOR MANUAL REVIEW)
// ==========================================
async function detectCopyright(audioBuffer, filename) {
    // TEMPORARILY DISABLED - All uploads flagged for manual review
    // This will be replaced with actual API integration later
    
    return {
        detected: false,  // Changed from detection logic to always pass
        match: null,
        confidence: 0,
        requiresVerification: true,  // Flag everything for manual review
        note: 'All uploads automatically flagged for manual review'
    };
}

// ==========================================
// HELPER: UPLOAD FILE TO STORAGE
// ==========================================
async function uploadToStorage(fileBuffer, filePath, contentType) {
    const fileUpload = bucket.file(filePath);
    await fileUpload.save(fileBuffer, { 
        contentType: contentType, 
        public: true 
    });
    const [url] = await fileUpload.getSignedUrl({ 
        action: 'read', 
        expires: '01-01-2100' 
    });
    return url;
}

// ==========================================
// ROUTE: SINGLE TRACK UPLOAD (Lightweight)
// ==========================================
router.post('/api/upload-track',
    upload.fields([
        { name: 'audioFile', maxCount: 1 },
        { name: 'artFile', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            // 1. Basic Validation
            if (!req.files || !req.files['audioFile'] || !req.files['artFile']) {
                return res.status(400).json({ error: "Missing files" });
            }

            const audioFile = req.files['audioFile'][0];
            const artFile = req.files['artFile'][0];
            
            // Extract Form Fields
            // [NOTE] We do NOT ask for 'artistName' here anymore to avoid the undefined error
            const { 
                title, genre, subgenre, artistId, albumName, 
                bpm, key, mode, energy, danceability, duration 
            } = req.body;

            // 2. Validate Artist ID
            if (!artistId || typeof artistId !== 'string') {
                return res.status(400).json({ error: "Missing Artist ID" });
            }

            // Start Stream
            res.setHeader('Content-Type', 'application/json');

            // 3. Fetch Artist Data from DB (Secure & Reliable)
            const artistDoc = await db.collection('artists').doc(artistId).get();
            if (!artistDoc.exists) throw new Error("Artist not found");
            
            const artistData = artistDoc.data();
            
            // [CRITICAL FIX] Get 'name' from the DB document (matches your screenshot)
            const dbArtistName = artistData.name || "Unknown Artist"; 

            // Parse Location
            const loc = artistData.location || '';
            const parts = loc.split(',').map(s => s.trim());
            const city = parts[0] || null;
            const state = parts[1] || null;
            const country = parts[2] || 'US';

            // 4. Create Copyright Flag
            res.write(JSON.stringify({ step: 'copyright', status: 'flagging' }) + '\n');
            await db.collection('copyright_flags').add({
                artistId: artistId,
                trackTitle: title,
                match: { source: "System", note: "Manual Review Required" },
                status: 'pending_review',
                flaggedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 5. Upload Files
            res.write(JSON.stringify({ step: 'upload', status: 'processing' }) + '\n');
            
            const audioPath = `artists/${artistId}/tracks/${Date.now()}_${title.replace(/\s+/g, '_')}.mp3`;
            const audioUrl = await uploadToStorage(audioFile.buffer, audioPath, audioFile.mimetype);

            const artPath = `artists/${artistId}/art/${Date.now()}_${title}_art.jpg`;
            const artUrl = await uploadToStorage(artFile.buffer, artPath, artFile.mimetype);

            // 6. Save to Database
            const songData = {
                title: title,
                titleLower: title.toLowerCase(),
                artistId: artistId,
                
                // [FIX] Save the name fetched from DB
                artistName: dbArtistName, 
                
                album: albumName || "Single",
                isSingle: !albumName,
                genre: genre,
                subgenre: subgenre || "General",
                audioUrl: audioUrl,
                artUrl: artUrl,
                
                // Analysis Data (From Client-Side)
                bpm: parseInt(bpm) || 0,
                key: key || 'Unknown',
                mode: mode || 'Unknown',
                energy: parseFloat(energy) || 0,
                danceability: parseFloat(danceability) || 0,
                duration: parseFloat(duration) || 0,

                city: city,
                state: state,
                country: country,
                copyrightChecked: false,
                copyrightFlagged: true,
                stats: { plays: 0, likes: 0 },
                uploadedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            const docRef = await db.collection('songs').add(songData);

            // Link to Artist Profile
            await db.collection('artists').doc(artistId).collection('releases').doc(docRef.id).set({
                type: 'single',
                ref: docRef,
                title: title,
                artUrl: artUrl,
                city: city,
                state: state,
                uploadedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            res.write(JSON.stringify({ 
                step: 'complete', 
                status: 'success',
                data: { songId: docRef.id }
            }) + '\n');
            res.end();

        } catch (error) {
            console.error("Upload Error:", error);
            if (!res.headersSent) {
                res.status(500).json({ status: 'failed', error: error.message });
            } else {
                res.write(JSON.stringify({ status: 'failed', error: error.message }));
                res.end();
            }
        }
    }
);

// ==========================================
// ROUTE: ALBUM UPLOAD (ENHANCED WITH LOCATION DATA)
// ==========================================
router.post('/api/upload-album',
    upload.fields([
        { name: 'audioFiles', maxCount: 50 }, // Support up to 50 tracks
        { name: 'albumArt', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            // Validate files
            if (!req.files || !req.files['audioFiles'] || !req.files['albumArt']) {
                return res.status(400).json({ 
                    error: "Missing audio files or album artwork",
                    step: 'validation'
                });
            }

            const audioFiles = req.files['audioFiles'];
            const albumArt = req.files['albumArt'][0];
            
            // Parse metadata
            const {
                albumName,
                artistId,
                artistName,
                genre,
                subgenres, // comma-separated or JSON array
                releaseDate,
                trackTitles, // JSON array of track names
                trackDurations // JSON array of durations
            } = req.body;

            const trackNames = JSON.parse(trackTitles);
            const durations = JSON.parse(trackDurations);
            const subgenreList = typeof subgenres === 'string' ? subgenres.split(',') : JSON.parse(subgenres);

            // Validate track count matches
            if (audioFiles.length !== trackNames.length) {
                return res.status(400).json({ 
                    error: "Mismatch between audio files and track titles",
                    step: 'validation'
                });
            }

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Transfer-Encoding', 'chunked');

            // FETCH ARTIST LOCATION FOR LOCAL DISCOVERY
            res.write(JSON.stringify({ 
                step: 'location_fetch', 
                status: 'processing',
                message: 'Fetching artist location data...' 
            }) + '\n');

            const artistDoc = await db.collection('artists').doc(artistId).get();
            if (!artistDoc.exists) {
                return res.status(404).json({ 
                    error: "Artist not found",
                    step: 'validation'
                });
            }

            const artistData = artistDoc.data();
            const artistLocation = artistData.location || '';

            // Parse location into city, state, country
            let city = null, state = null, country = 'US';
            if (artistLocation) {
                const parts = artistLocation.split(',').map(p => p.trim());
                if (parts.length >= 2) {
                    city = parts[0];
                    state = parts[1];
                    if (parts.length >= 3) country = parts[2];
                } else {
                    city = parts[0];
                }
            }

            res.write(JSON.stringify({ 
                step: 'location_fetch', 
                status: 'complete',
                message: `Location set: ${city || 'Unknown'}, ${state || 'Unknown'}` 
            }) + '\n');

            // STEP 1: UPLOAD ALBUM ART
            res.write(JSON.stringify({ 
                step: 'album_art', 
                status: 'uploading',
                message: 'Uploading album artwork...' 
            }) + '\n');

            const artExt = albumArt.originalname.split('.').pop();
            const artPath = `artists/${artistId}/albums/${Date.now()}_${albumName.replace(/\s+/g, '_')}_art.${artExt}`;
            const albumArtUrl = await uploadToStorage(albumArt.buffer, artPath, albumArt.mimetype);

            res.write(JSON.stringify({ 
                step: 'album_art', 
                status: 'complete',
                message: 'Album artwork uploaded' 
            }) + '\n');

            // STEP 2: CREATE ALBUM DOCUMENT (WITH LOCATION DATA)
            res.write(JSON.stringify({ 
                step: 'album_create', 
                status: 'creating',
                message: 'Creating album document...' 
            }) + '\n');

            const albumRef = await db.collection('albums').add({
                name: albumName,
                nameLower: albumName.toLowerCase(),
                artistId: artistId,
                artistName: artistName,
                genre: genre,
                subgenres: subgenreList,
                artUrl: albumArtUrl,
                releaseDate: new Date(releaseDate),
                trackCount: audioFiles.length,
                trackIds: [], // Will be updated after tracks are uploaded
                
                // LOCATION DATA FOR LOCAL DISCOVERY
                city: city,
                state: state,
                country: country,
                
                // Stats
                plays: 0,
                likes: 0,
                
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                uploadedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const albumId = albumRef.id;

            res.write(JSON.stringify({ 
                step: 'album_create', 
                status: 'complete',
                message: `Album created with ID: ${albumId}`,
                data: { albumId: albumId }
            }) + '\n');

            const uploadedTracks = [];

            // STEP 3: PROCESS EACH TRACK
            for (let i = 0; i < audioFiles.length; i++) {
                const audioFile = audioFiles[i];
                const trackTitle = trackNames[i];
                const trackDuration = durations[i];

                res.write(JSON.stringify({ 
                    step: 'track_processing', 
                    status: 'analyzing',
                    message: `Processing track ${i + 1}/${audioFiles.length}: ${trackTitle}`,
                    progress: Math.round(((i + 1) / audioFiles.length) * 100)
                }) + '\n');

                // COPYRIGHT CHECK (SIMPLIFIED - FLAG FOR MANUAL REVIEW)
                await db.collection('pending_review').add({
                    type: 'album_track',
                    artistId: artistId,
                    albumId: albumId,
                    albumName: albumName,
                    trackTitle: trackTitle,
                    trackNumber: i + 1,
                    flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
                    reviewStatus: 'pending'
                });
                
                res.write(JSON.stringify({ 
                    step: 'copyright_check', 
                    status: 'flagged',
                    message: `"${trackTitle}" flagged for manual review` 
                }) + '\n');

                // AUDIO ANALYSIS (BPM, Key, etc.)
                const audioFeatures = await analyzeAudioFeatures(audioFile.buffer, audioFile.originalname);

                // UPLOAD AUDIO FILE
                const audioExt = audioFile.originalname.split('.').pop();
                const audioPath = `artists/${artistId}/albums/${albumId}/${i + 1}_${trackTitle.replace(/\s+/g, '_')}.${audioExt}`;
                const audioUrl = await uploadToStorage(audioFile.buffer, audioPath, audioFile.mimetype);

                // SAVE TRACK TO DATABASE (WITH FULL LOCATION DATA)
                const trackData = {
                    title: trackTitle,
                    titleLower: trackTitle.toLowerCase(),
                    artistId: artistId,
                    artistName: artistName,
                    albumId: albumId,
                    album: albumName,
                    isSingle: false,
                    trackNumber: i + 1,
                    genre: genre,
                    subgenre: subgenreList.join(', '),
                    audioUrl: audioUrl,
                    artUrl: albumArtUrl,
                    duration: parseInt(trackDuration) || 0,
                    
                    // Audio Analysis Data
                    bpm: audioFeatures.bpm,
                    key: audioFeatures.key,
                    mode: audioFeatures.mode,
                    energy: audioFeatures.energy,
                    danceability: audioFeatures.danceability,
                    
                    // Copyright Info (All flagged for manual review)
                    copyrightChecked: false,
                    copyrightFlagged: true,
                    reviewStatus: 'pending',
                    
                    // LOCATION DATA FOR LOCAL DISCOVERY
                    city: city,
                    state: state,
                    country: country,
                    
                    // Stats
                    plays: 0,
                    likes: 0,
                    
                    uploadedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                const trackRef = await db.collection('songs').add(trackData);
                uploadedTracks.push(trackRef.id);

                res.write(JSON.stringify({ 
                    step: 'track_processing', 
                    status: 'complete',
                    message: `Track ${i + 1} uploaded: ${trackTitle}`,
                    data: { 
                        trackId: trackRef.id,
                        bpm: audioFeatures.bpm,
                        key: audioFeatures.key
                    }
                }) + '\n');
            }

            // UPDATE ALBUM WITH TRACK IDS
            await albumRef.update({
                trackIds: uploadedTracks
            });

            // LINK TO ARTIST PROFILE (under artist's releases)
            await db.collection('artists').doc(artistId).collection('releases').doc(albumId).set({
                type: 'album',
                ref: albumRef,
                name: albumName,
                artUrl: albumArtUrl,
                trackCount: audioFiles.length,
                city: city,
                state: state,
                uploadedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // FINAL RESPONSE
            res.write(JSON.stringify({ 
                step: 'complete', 
                status: 'success',
                message: `Album "${albumName}" upload complete! Now discoverable in ${city || 'global'} feeds.`,
                data: { 
                    albumId: albumId,
                    trackCount: uploadedTracks.length,
                    trackIds: uploadedTracks,
                    location: {
                        city: city,
                        state: state,
                        country: country
                    }
                }
            }) + '\n');

            res.end();

        } catch (error) {
            console.error("Album Upload Error:", error);
            res.status(500).json({ 
                step: 'error',
                status: 'failed',
                error: error.message 
            });
        }
    }
);

// ==========================================
// EXISTING ROUTES (kept for reference)
// ==========================================

router.post('/api/upload-asset', verifyUser, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const type = req.body.type;
        const ext = req.file.originalname.split('.').pop();
        const filePath = `artists/${req.uid}/${type}_${Date.now()}.${ext}`;
        const url = await uploadToStorage(req.file.buffer, filePath, req.file.mimetype);

        res.json({ success: true, url: url, path: filePath });
    } catch (error) {
        console.error("Asset Upload Error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/create-profile', express.json(), async (req, res) => {
    try {
        const data = req.body;
        const newArtistRef = db.collection('artists').doc();
        const artistId = newArtistRef.id;
        
        const artistData = {
            id: artistId,
            name: data.identity.artistName,
            nameLower: data.identity.artistName.toLowerCase(),
            handle: data.identity.handle || "",
            location: data.identity.location || "",
            bio: data.identity.bio || "",
            ownerUid: null,
            ownerEmail: null,
            status: 'pending_setup',
            profileImage: data.visuals.avatarUrl || null,
            bannerImage: data.visuals.bannerUrl || null,
            musicProfile: {
                primaryGenre: data.music.primaryGenre,
                subgenres: data.music.subgenres,
                moods: data.music.moods,
                typicalFeatures: {
                    tempo: parseInt(data.music.features.tempo) || 0,
                    energy: parseFloat(data.music.features.energy) || 0,
                    valence: parseFloat(data.music.features.valence) || 0,
                    instrumentalness: parseFloat(data.music.features.instrumentalness) || 0
                }
            },
            stats: {
                totalTracks: 0,
                followers: 0,
                monthlyListeners: 0
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await newArtistRef.set(artistData);
        res.json({ success: true, artistId: artistId });
    } catch (error) {
        console.error("Profile Creation Error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/onboarding', (req, res) => {
    res.render('artist_signup', { title: 'Artist Setup | Eporia' });
});

router.get('/api/check-handle/:handle', async (req, res) => {
    try {
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

router.get('/login', (req, res) => {
    res.render('artist_signin', { title: 'Artist Login | Eporia' });
});

router.get('/studio', (req, res) => {
    const artistId = req.query.id;
    res.render('artist_studio', { 
        title: 'Artist Command Center | Eporia',
        artistId: artistId 
    });
});

router.get('/api/studio/check-status/:artistId', async (req, res) => {
    try {
        const doc = await db.collection('artists').doc(req.params.artistId).get();
        if (!doc.exists) return res.status(404).json({ error: "Artist not found" });
        
        const data = doc.data();
        res.json({ 
            needsSetup: !data.ownerEmail,
            artistName: data.name,
            artistHandle: data.handle
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/studio/setup-credentials', async (req, res) => {
    try {
        const { artistId, email, password } = req.body;
        
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
            displayName: `Artist: ${artistId}`
        });

        await db.collection('artists').doc(artistId).update({
            ownerUid: userRecord.uid,
            ownerEmail: email,
            status: 'active',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const customToken = await admin.auth().createCustomToken(userRecord.uid);
        res.json({ success: true, token: customToken });
    } catch (e) {
        console.error("Credential Setup Error:", e);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/studio/dashboard', verifyUser, async (req, res) => {
    try {
        // Find the artist owned by this logged-in user
        const snapshot = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
        
        if (snapshot.empty) return res.status(404).json({ error: "No artist profile linked to this login." });
        
        const doc = snapshot.docs[0]; // Get the document reference
        const data = doc.data();
        
        const dashboardData = {
            // [FIX] Send the ID back to the frontend
            artistId: doc.id, 
            
            profile: {
                name: data.name,
                image: data.profileImage,
                handle: data.handle
            },
            stats: {
                listeners: data.stats?.monthlyListeners || 0,
                followers: data.stats?.followers || 0,
                tipsTotal: 0.00,
                tipsGrowth: 0
            },
            recentActivity: [],
            catalog: { albums: 0, tracks: 0, merch: 0 }
        };

        res.json(dashboardData);
    } catch (error) {
        console.error("Studio Data Error:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;