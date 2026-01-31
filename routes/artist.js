var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require("firebase-admin");
var axios = require('axios'); // For API calls

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
// HELPER: COPYRIGHT DETECTION
// ==========================================
async function detectCopyright(audioBuffer, filename) {
    try {
        // Using AudD Music Recognition API (free tier available)
        // Alternative: ACRCloud, Spotify Web API, or AudioTag
        
        // Convert buffer to base64 for API
        const base64Audio = audioBuffer.toString('base64');
        
        // Option 1: AudD API (requires API key from https://audd.io/)
        const auddApiKey = "ee3a7c98b9036422001604f8d2db67d8";
        if (auddApiKey) {
            const response = await axios.post('https://api.audd.io/', {
                api_token: auddApiKey,
                audio: base64Audio,
                return: 'apple_music,spotify'
            });
            
            if (response.data.status === 'success' && response.data.result) {
                return {
                    detected: true,
                    match: response.data.result,
                    confidence: 0.9,
                    requiresVerification: true
                };
            }
        }
        
        // Option 2: ACRCloud (more accurate, requires separate API key)
        // const acrApiKey = process.env.ACR_API_KEY;
        // ... ACRCloud implementation
        
        // If no match found or API not configured
        return {
            detected: false,
            match: null,
            confidence: 0,
            requiresVerification: false
        };
        
    } catch (error) {
        console.error("Copyright detection error:", error);
        // Don't block upload on detection failure
        return {
            detected: false,
            match: null,
            confidence: 0,
            error: error.message,
            requiresVerification: false
        };
    }
}

// ==========================================
// HELPER: BPM & KEY DETECTION
// ==========================================
async function analyzeAudioFeatures(audioBuffer, filename) {
    try {
        // Using Essentia.js or web-based audio analysis
        // For production, consider: Spotify Audio Analysis API, Essentia, or librosa
        
        // Option 1: Use Essentia.js (requires installation)
        // const Essentia = require('essentia.js');
        
        // Option 2: Use external API like TuneFind or Audio Analyzer
        const analysisApiKey = process.env.AUDIO_ANALYSIS_API_KEY;
        
        if (analysisApiKey) {
            // Example using a hypothetical audio analysis service
            const formData = new FormData();
            formData.append('audio', audioBuffer, filename);
            
            const response = await axios.post('https://api.audioanalyzer.io/v1/analyze', formData, {
                headers: {
                    'Authorization': `Bearer ${analysisApiKey}`,
                    ...formData.getHeaders()
                }
            });
            
            return {
                bpm: response.data.tempo || 0,
                key: response.data.key || 'Unknown',
                mode: response.data.mode || 'Unknown', // Major/Minor
                energy: response.data.energy || 0,
                danceability: response.data.danceability || 0
            };
        }
        
        // Fallback: Basic analysis or mock data for development
        // In production, you should always use a proper audio analysis service
        return {
            bpm: 0,
            key: 'Unknown',
            mode: 'Unknown',
            energy: 0,
            danceability: 0,
            note: 'Audio analysis API not configured. Set AUDIO_ANALYSIS_API_KEY environment variable.'
        };
        
    } catch (error) {
        console.error("Audio analysis error:", error);
        return {
            bpm: 0,
            key: 'Unknown',
            mode: 'Unknown',
            error: error.message
        };
    }
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
// ROUTE: SINGLE TRACK UPLOAD (ENHANCED)
// ==========================================
router.post('/api/upload-track',
    upload.fields([
        { name: 'audioFile', maxCount: 1 },
        { name: 'artFile', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            // Validate files
            if (!req.files || !req.files['audioFile'] || !req.files['artFile']) {
                return res.status(400).json({ 
                    error: "Missing audio or artwork file",
                    step: 'validation'
                });
            }

            const audioFile = req.files['audioFile'][0];
            const artFile = req.files['artFile'][0];
            const { title, genre, subgenre, artistId, artistName, albumName, duration } = req.body;

            // STEP 1: COPYRIGHT DETECTION
            res.write(JSON.stringify({ 
                step: 'copyright', 
                status: 'analyzing',
                message: 'Analyzing file for copyright...' 
            }) + '\n');

            const copyrightResult = await detectCopyright(audioFile.buffer, audioFile.originalname);
            
            if (copyrightResult.detected && copyrightResult.requiresVerification) {
                // Flag for manual review but don't block
                res.write(JSON.stringify({ 
                    step: 'copyright', 
                    status: 'warning',
                    message: 'Potential copyright match detected. Please verify you own this material.',
                    data: copyrightResult.match
                }) + '\n');
                
                // Store flag for admin review
                await db.collection('copyright_flags').add({
                    artistId: artistId,
                    trackTitle: title,
                    match: copyrightResult.match,
                    confidence: copyrightResult.confidence,
                    flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'pending_review'
                });
            } else {
                res.write(JSON.stringify({ 
                    step: 'copyright', 
                    status: 'complete',
                    message: 'Copyright check passed' 
                }) + '\n');
            }

            // STEP 2: AUDIO ANALYSIS (BPM & KEY)
            res.write(JSON.stringify({ 
                step: 'analysis', 
                status: 'analyzing',
                message: 'Analyzing BPM and key...' 
            }) + '\n');

            const audioFeatures = await analyzeAudioFeatures(audioFile.buffer, audioFile.originalname);
            
            res.write(JSON.stringify({ 
                step: 'analysis', 
                status: 'complete',
                message: `Analysis complete: ${audioFeatures.bpm} BPM, Key: ${audioFeatures.key}`,
                data: audioFeatures
            }) + '\n');

            // STEP 3: UPLOAD AUDIO
            res.write(JSON.stringify({ 
                step: 'upload_audio', 
                status: 'uploading',
                message: 'Uploading audio file...' 
            }) + '\n');

            const audioExt = audioFile.originalname.split('.').pop();
            const audioPath = `artists/${artistId}/tracks/${Date.now()}_${title.replace(/\s+/g, '_')}.${audioExt}`;
            const audioUrl = await uploadToStorage(audioFile.buffer, audioPath, audioFile.mimetype);

            res.write(JSON.stringify({ 
                step: 'upload_audio', 
                status: 'complete',
                message: 'Audio uploaded successfully' 
            }) + '\n');

            // STEP 4: UPLOAD ARTWORK
            res.write(JSON.stringify({ 
                step: 'upload_art', 
                status: 'uploading',
                message: 'Uploading artwork...' 
            }) + '\n');

            const artExt = artFile.originalname.split('.').pop();
            const artPath = `artists/${artistId}/art/${Date.now()}_${title.replace(/\s+/g, '_')}_art.${artExt}`;
            const artUrl = await uploadToStorage(artFile.buffer, artPath, artFile.mimetype);

            res.write(JSON.stringify({ 
                step: 'upload_art', 
                status: 'complete',
                message: 'Artwork uploaded successfully' 
            }) + '\n');

            // STEP 5: SAVE TO DATABASE
            res.write(JSON.stringify({ 
                step: 'database', 
                status: 'saving',
                message: 'Saving to database...' 
            }) + '\n');

            const songData = {
                title: title,
                titleLower: title.toLowerCase(),
                artistId: artistId,
                artistName: artistName,
                album: albumName || "Single",
                isSingle: !albumName,
                genre: genre,
                subgenre: subgenre || "General",
                audioUrl: audioUrl,
                artUrl: artUrl,
                duration: parseInt(duration) || 0,
                
                // Enhanced metadata
                bpm: audioFeatures.bpm,
                key: audioFeatures.key,
                mode: audioFeatures.mode,
                energy: audioFeatures.energy,
                danceability: audioFeatures.danceability,
                
                // Copyright info
                copyrightChecked: true,
                copyrightFlagged: copyrightResult.detected,
                
                plays: 0,
                uploadedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            const docRef = await db.collection('songs').add(songData);

            await db.collection('artists').doc(artistId).collection('releases').doc(docRef.id).set({
                ref: docRef,
                title: title,
                artUrl: artUrl,
                uploadedAt: new Date()
            });

            // FINAL RESPONSE
            res.write(JSON.stringify({ 
                step: 'complete', 
                status: 'success',
                message: 'Upload complete!',
                data: { songId: docRef.id }
            }) + '\n');

            res.end();

        } catch (error) {
            console.error("Track Upload Error:", error);
            res.status(500).json({ 
                step: 'error',
                status: 'failed',
                error: error.message 
            });
        }
    }
);

// ==========================================
// ROUTE: ALBUM UPLOAD
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

            // STEP 2: CREATE ALBUM DOCUMENT
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
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const albumId = albumRef.id;
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

                // COPYRIGHT CHECK
                const copyrightResult = await detectCopyright(audioFile.buffer, audioFile.originalname);
                
                if (copyrightResult.detected) {
                    await db.collection('copyright_flags').add({
                        artistId: artistId,
                        albumId: albumId,
                        trackTitle: trackTitle,
                        match: copyrightResult.match,
                        flaggedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                // AUDIO ANALYSIS
                const audioFeatures = await analyzeAudioFeatures(audioFile.buffer, audioFile.originalname);

                // UPLOAD AUDIO
                const audioExt = audioFile.originalname.split('.').pop();
                const audioPath = `artists/${artistId}/albums/${albumId}/${i + 1}_${trackTitle.replace(/\s+/g, '_')}.${audioExt}`;
                const audioUrl = await uploadToStorage(audioFile.buffer, audioPath, audioFile.mimetype);

                // SAVE TRACK TO DATABASE
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
                    bpm: audioFeatures.bpm,
                    key: audioFeatures.key,
                    mode: audioFeatures.mode,
                    energy: audioFeatures.energy,
                    copyrightChecked: true,
                    copyrightFlagged: copyrightResult.detected,
                    plays: 0,
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

            // LINK TO ARTIST PROFILE
            await db.collection('artists').doc(artistId).collection('releases').doc(albumId).set({
                type: 'album',
                ref: albumRef,
                name: albumName,
                artUrl: albumArtUrl,
                trackCount: audioFiles.length,
                uploadedAt: new Date()
            });

            // FINAL RESPONSE
            res.write(JSON.stringify({ 
                step: 'complete', 
                status: 'success',
                message: 'Album upload complete!',
                data: { 
                    albumId: albumId,
                    trackCount: uploadedTracks.length,
                    trackIds: uploadedTracks
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
        const snapshot = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
        if (snapshot.empty) return res.status(404).json({ error: "No artist profile linked to this login." });
        
        const data = snapshot.docs[0].data();
        const dashboardData = {
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