/* routes/artist.js - Complete with Streaming Upload & Essentia.js */
var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require("firebase-admin");
const { analyzeAudioFeatures } = require('./audioAnalysis');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { PassThrough } = require('stream');
const { Upload } = require('@aws-sdk/lib-storage');

ffmpeg.setFfmpegPath(ffmpegPath);

// --- R2 & AWS SDK SETUP ---
const r2 = require('../config/r2'); 
const { PutObjectCommand } = require("@aws-sdk/client-s3");

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    STREAMING_THRESHOLD: 50 * 1024 * 1024, // 50MB
    MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB
    UPLOAD_PART_SIZE: 5 * 1024 * 1024, // 5MB chunks
    MP3_BITRATE: '320k',
};

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
// --- 1. FIREBASE SETUP ---
if (!admin.apps.length) {
    if (process.env.K_SERVICE) {
        // [FIX] No arguments needed in Cloud Run. 
        // It will automatically use the correct Project ID (eporiamusic-481619).
        admin.initializeApp(); 
        console.log("Firebase initialized via Auto-Detection (Cloud Run Mode)");
    } else {
        try {
            var serviceAccount = require("../serviceAccountKey.json");
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } catch (e) {
            console.error("Local Init Failed:", e.message);
        }
    }
}

const db = admin.firestore();



// ==========================================
// MULTER CONFIGURATION
// ==========================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CONFIG.MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const allowedAudio = [
            'audio/mpeg', 'audio/mp3',
            'audio/x-flac', 'audio/flac',
            'audio/wav', 'audio/x-wav', 'audio/wave',
            'audio/x-aiff', 'audio/aiff',
            'audio/x-m4a', 'audio/mp4'
        ];
        
        const allowedImage = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        
        if (allowedAudio.includes(file.mimetype) || allowedImage.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type: ${file.mimetype}`), false);
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
// HELPER: UPLOAD TO R2 (SMALL FILES)
// ==========================================
async function uploadToStorage(fileBuffer, filePath, contentType) {
    try {
        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: filePath,
            Body: fileBuffer,
            ContentType: contentType,
        });

        await r2.send(command);
        return `${process.env.R2_PUBLIC_URL}/${filePath}`;
    } catch (error) {
        console.error("R2 Upload Error:", error);
        throw new Error("Failed to upload asset to storage.");
    }
}

// ==========================================
// HELPER: STREAM UPLOAD TO R2 (LARGE FILES)
// ==========================================
async function streamUploadToR2(stream, key, contentType) {
    const upload = new Upload({
        client: r2,
        params: {
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: stream,
            ContentType: contentType,
        },
        partSize: CONFIG.UPLOAD_PART_SIZE,
        queueSize: 4,
    });

    upload.on('httpUploadProgress', (progress) => {
        const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
        console.log(`📤 Upload Progress [${key}]: ${percent}%`);
    });

    await upload.done();
    return `${process.env.R2_PUBLIC_URL}/${key}`;
}

// ==========================================
// HELPER: TRANSCODE TO MP3 (BUFFER)
// ==========================================
async function transcodeToBuffer(inputBuffer) {
    const inputStream = new PassThrough();
    inputStream.end(inputBuffer);

    return new Promise((resolve, reject) => {
        const chunks = [];
        const outputStream = new PassThrough();

        ffmpeg(inputStream)
            .toFormat('mp3')
            .audioBitrate(CONFIG.MP3_BITRATE)
            .audioChannels(2)
            .audioFrequency(44100)
            .on('error', reject)
            .on('end', () => console.log('✅ Transcode Complete'))
            .pipe(outputStream);

        outputStream.on('data', (chunk) => chunks.push(chunk));
        outputStream.on('end', () => resolve(Buffer.concat(chunks)));
        outputStream.on('error', reject);
    });
}
// ==========================================
// HELPER: TRANSCODE TO MP3 (STREAM)
// ==========================================
function createTranscodeStream(inputBuffer) {
    const inputStream = new PassThrough();
    inputStream.end(inputBuffer);
    
    const outputStream = new PassThrough();
    
    ffmpeg(inputStream)
        .toFormat('mp3')
        .audioBitrate(CONFIG.MP3_BITRATE)
        .audioChannels(2)
        .audioFrequency(44100)
        .on('start', (cmd) => console.log('🎵 FFmpeg:', cmd))
        .on('progress', (progress) => {
            if (progress.percent) {
                console.log(`⏳ Transcoding: ${progress.percent.toFixed(1)}%`);
            }
        })
        .on('error', (err) => {
            console.error('❌ Transcode Error:', err.message);
            outputStream.destroy(err);
        })
        .on('end', () => console.log('✅ Transcode Complete'))
        .pipe(outputStream, { end: true });
    
    return outputStream;
}

// ==========================================
// HELPER: COPYRIGHT DETECTION (STUB)
// ==========================================
async function detectCopyright(audioBuffer, filename) {
    return {
        detected: false,
        match: null,
        confidence: 0,
        requiresVerification: true,
        note: 'All uploads automatically flagged for manual review'
    };
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
        const startTime = Date.now();
        
        try {
            // 1. Validation
            if (!req.files || !req.files['audioFile'] || !req.files['artFile']) {
                return res.status(400).json({ error: "Missing files" });
            }

            const audioFile = req.files['audioFile'][0];
            const artFile = req.files['artFile'][0];
            
            const { 
                title, genre, subgenre, artistId, albumName 
            } = req.body;

            if (!artistId) {
                return res.status(400).json({ error: "Missing Artist ID" });
            }

            const fileExt = audioFile.originalname.split('.').pop().toLowerCase();
            const isLossless = ['flac', 'wav', 'aiff', 'alac'].includes(fileExt);
            const isLargeFile = audioFile.size > CONFIG.STREAMING_THRESHOLD;

            console.log(`\n📥 Track Upload:
  File: ${audioFile.originalname}
  Size: ${(audioFile.size / 1024 / 1024).toFixed(2)} MB
  Format: ${fileExt} ${isLossless ? '(Lossless)' : ''}
  Strategy: ${isLargeFile ? 'STREAMING' : 'BUFFERED'}`);

            // Set up streaming response
            res.setHeader('Content-Type', 'application/json');

            // 2. Fetch Artist Data
            res.write(JSON.stringify({ step: 'init', status: 'loading artist data' }) + '\n');
            const artistDoc = await db.collection('artists').doc(artistId).get();
            if (!artistDoc.exists) throw new Error("Artist not found");
            
            const artistData = artistDoc.data();
            const dbArtistName = artistData.name || "Unknown Artist";
            
            const loc = artistData.location || '';
            const parts = loc.split(',').map(s => s.trim());
            const city = parts[0] || null;
            const state = parts[1] || null;
            const country = parts[2] || 'US';

            // 3. Analyze Audio Features with Essentia.js
            res.write(JSON.stringify({ step: 'analysis', status: 'analyzing audio' }) + '\n');
            const features = await analyzeAudioFeatures(audioFile.buffer, audioFile.originalname);

            // 4. Copyright Check
            res.write(JSON.stringify({ step: 'copyright', status: 'flagging' }) + '\n');
            await db.collection('copyright_flags').add({
                artistId: artistId,
                trackTitle: title,
                match: { source: "System", note: "Manual Review Required" },
                status: 'pending_review',
                flaggedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 5. Upload Files
            res.write(JSON.stringify({ step: 'upload', status: 'uploading master' }) + '\n');
            
            const cleanTitle = title.replace(/[^a-zA-Z0-9-_]/g, '_');
            const timestamp = Date.now();
            
            // Upload Master (Original Quality)
            const masterPath = `artists/${artistId}/masters/${timestamp}_${cleanTitle}.${fileExt}`;
            let masterUrl;
            
            if (isLargeFile) {
                const masterStream = new PassThrough();
                masterStream.end(audioFile.buffer);
                masterUrl = await streamUploadToR2(masterStream, masterPath, audioFile.mimetype);
            } else {
                masterUrl = await uploadToStorage(audioFile.buffer, masterPath, audioFile.mimetype);
            }

            console.log(`✅ Master uploaded: ${masterUrl}`);

            // Upload Streaming Version (MP3 320kbps)
            res.write(JSON.stringify({ step: 'transcode', status: 'creating stream version' }) + '\n');
            const streamPath = `artists/${artistId}/tracks/${timestamp}_${cleanTitle}.mp3`;
            let streamUrl;

            if (isLossless) {
                if (isLargeFile) {
                    const transcodeStream = createTranscodeStream(audioFile.buffer);
                    streamUrl = await streamUploadToR2(transcodeStream, streamPath, 'audio/mpeg');
                } else {
                    const mp3Buffer = await transcodeToBuffer(audioFile.buffer);
                    streamUrl = await uploadToStorage(mp3Buffer, streamPath, 'audio/mpeg');
                }
            } else {
                // Already MP3, use master as stream
                streamUrl = masterUrl;
            }

            console.log(`✅ Stream uploaded: ${streamUrl}`);

            // Upload Album Art
            res.write(JSON.stringify({ step: 'upload', status: 'uploading artwork' }) + '\n');
            const artPath = `artists/${artistId}/art/${timestamp}_${cleanTitle}_art.jpg`;
            const artUrl = await uploadToStorage(artFile.buffer, artPath, artFile.mimetype);

            // 6. Save to Database
            res.write(JSON.stringify({ step: 'database', status: 'saving track' }) + '\n');
            
            const songData = {
                title: title,
                titleLower: title.toLowerCase(),
                artistId: artistId,
                artistName: dbArtistName,
                album: albumName || "Single",
                isSingle: !albumName,
                genre: genre,
                subgenre: subgenre || "General",
                
                // Dual URL system
                audioUrl: streamUrl,      // For streaming
                masterUrl: masterUrl,     // For premium downloads
                artUrl: artUrl,
                
                // File metadata
                originalFormat: fileExt,
                fileSize: audioFile.size,
                isLossless: isLossless,
                isTranscoded: isLossless,
                
                // Audio features from Essentia
                bpm: features.bpm || 0,
                key: features.key || 'Unknown',
                mode: features.mode || 'Unknown',
                energy: features.energy || 0,
                danceability: features.danceability || 0,
                duration: features.duration || 0,
                loudness: features.loudness || 0,

                // Location
                city: city,
                state: state,
                country: country,
                
                // Status
                copyrightChecked: false,
                copyrightFlagged: true,
                
                // Stats
                stats: { 
                    plays: 0, 
                    likes: 0,
                    downloads: 0 
                },
                
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

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`\n✅ Upload Complete in ${elapsed}s\n`);

            res.write(JSON.stringify({ 
                step: 'complete', 
                status: 'success',
                data: { 
                    songId: docRef.id,
                    streamUrl: streamUrl,
                    masterUrl: masterUrl,
                    duration: features.duration,
                    processingTime: elapsed
                }
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
// ROUTE: PREMIUM DOWNLOAD
// ==========================================
router.get('/api/tracks/:songId/download', verifyUser, async (req, res) => {
    try {
        const { songId } = req.params;

        // Fetch track
        const trackDoc = await db.collection('songs').doc(songId).get();
        if (!trackDoc.exists) {
            return res.status(404).json({ error: 'Track not found' });
        }

        const track = trackDoc.data();

        // Check permissions
        const userDoc = await db.collection('users').doc(req.uid).get();
        const isPremium = userDoc.data()?.isPremium || false;
        const isOwner = track.artistId === req.uid;

        if (!isPremium && !isOwner) {
            return res.status(403).json({ 
                error: 'Premium subscription required for lossless downloads' 
            });
        }

        // Increment download counter
        await db.collection('songs').doc(songId).update({
            'stats.downloads': admin.firestore.FieldValue.increment(1)
        });

        res.json({
            downloadUrl: track.masterUrl,
            format: track.originalFormat,
            fileSize: track.fileSize,
            title: track.title
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});


// ==========================================
// ROUTE: ALBUM UPLOAD (ENHANCED)
// ==========================================
router.post('/api/upload-album',
    upload.fields([
        { name: 'audioFiles', maxCount: 50 },
        { name: 'albumArt', maxCount: 1 }
    ]),
    async (req, res) => {
        const startTime = Date.now();
        
        try {
            if (!req.files || !req.files['audioFiles'] || !req.files['albumArt']) {
                return res.status(400).json({ error: "Missing files" });
            }

            const audioFiles = req.files['audioFiles'];
            const albumArt = req.files['albumArt'][0];
            const { albumName, genre, subgenre, artistId } = req.body;

            if (!artistId || !albumName) {
                return res.status(400).json({ error: "Missing required fields" });
            }

            console.log(`\n📦 Album Upload: ${audioFiles.length} tracks`);
            
            res.setHeader('Content-Type', 'application/json');
            res.write(JSON.stringify({ 
                step: 'init', 
                status: 'starting',
                totalTracks: audioFiles.length 
            }) + '\n');

            // Fetch Artist
            const artistDoc = await db.collection('artists').doc(artistId).get();
            if (!artistDoc.exists) throw new Error("Artist not found");
            const artistData = artistDoc.data();
            const dbArtistName = artistData.name || "Unknown Artist";

            const loc = artistData.location || '';
            const parts = loc.split(',').map(s => s.trim());
            const city = parts[0] || null;
            const state = parts[1] || null;
            const country = parts[2] || 'US';

            // Upload Album Art
            const timestamp = Date.now();
            const cleanAlbumName = albumName.replace(/[^a-zA-Z0-9-_]/g, '_');
            const albumArtPath = `artists/${artistId}/albums/${timestamp}_${cleanAlbumName}_art.jpg`;
            const albumArtUrl = await uploadToStorage(albumArt.buffer, albumArtPath, albumArt.mimetype);

            // Process each track
            const trackResults = [];
            
            for (let i = 0; i < audioFiles.length; i++) {
                const file = audioFiles[i];
                const trackNum = i + 1;
                
                res.write(JSON.stringify({ 
                    step: 'processing',
                    track: trackNum,
                    total: audioFiles.length,
                    filename: file.originalname
                }) + '\n');

                try {
                    // Extract track title from filename or metadata
                    const trackTitle = file.originalname.replace(/\.[^/.]+$/, '');
                    const fileExt = file.originalname.split('.').pop().toLowerCase();
                    const isLossless = ['flac', 'wav', 'aiff', 'alac'].includes(fileExt);
                    const isLargeFile = file.size > CONFIG.STREAMING_THRESHOLD;

                    // Analyze audio
                    const features = await analyzeAudioFeatures(file.buffer, file.originalname);

                    // Upload master
                    const masterPath = `artists/${artistId}/masters/${timestamp}_${trackNum}_${trackTitle}.${fileExt}`;
                    let masterUrl;
                    
                    if (isLargeFile) {
                        const stream = new PassThrough();
                        stream.end(file.buffer);
                        masterUrl = await streamUploadToR2(stream, masterPath, file.mimetype);
                    } else {
                        masterUrl = await uploadToStorage(file.buffer, masterPath, file.mimetype);
                    }

                    // Create streaming version
                    const streamPath = `artists/${artistId}/tracks/${timestamp}_${trackNum}_${trackTitle}.mp3`;
                    let streamUrl;

                    if (isLossless) {
                        if (isLargeFile) {
                            const transcodeStream = createTranscodeStream(file.buffer);
                            streamUrl = await streamUploadToR2(transcodeStream, streamPath, 'audio/mpeg');
                        } else {
                            const mp3Buffer = await transcodeToBuffer(file.buffer);
                            streamUrl = await uploadToStorage(mp3Buffer, streamPath, 'audio/mpeg');
                        }
                    } else {
                        streamUrl = masterUrl;
                    }

                    // Save to database
                    const songData = {
                        title: trackTitle,
                        titleLower: trackTitle.toLowerCase(),
                        artistId: artistId,
                        artistName: dbArtistName,
                        album: albumName,
                        isSingle: false,
                        trackNumber: trackNum,
                        genre: genre,
                        subgenre: subgenre || "General",
                        
                        audioUrl: streamUrl,
                        masterUrl: masterUrl,
                        artUrl: albumArtUrl,
                        
                        originalFormat: fileExt,
                        fileSize: file.size,
                        isLossless: isLossless,
                        isTranscoded: isLossless,
                        
                        bpm: features.bpm || 0,
                        key: features.key || 'Unknown',
                        mode: features.mode || 'Unknown',
                        energy: features.energy || 0,
                        danceability: features.danceability || 0,
                        duration: features.duration || 0,

                        city: city,
                        state: state,
                        country: country,
                        
                        copyrightChecked: false,
                        copyrightFlagged: true,
                        stats: { plays: 0, likes: 0, downloads: 0 },
                        uploadedAt: admin.firestore.FieldValue.serverTimestamp()
                    };

                    const docRef = await db.collection('songs').add(songData);
                    trackResults.push({ 
                        trackNumber: trackNum,
                        songId: docRef.id, 
                        title: trackTitle 
                    });

                    console.log(`✅ Track ${trackNum}/${audioFiles.length} uploaded`);

                } catch (error) {
                    console.error(`❌ Track ${trackNum} failed:`, error.message);
                    trackResults.push({ 
                        trackNumber: trackNum,
                        error: error.message 
                    });
                }
            }

            // Link album to artist
            const albumRef = await db.collection('artists')
                .doc(artistId)
                .collection('releases')
                .add({
                    type: 'album',
                    title: albumName,
                    artUrl: albumArtUrl,
                    trackCount: trackResults.filter(t => t.songId).length,
                    tracks: trackResults,
                    uploadedAt: admin.firestore.FieldValue.serverTimestamp()
                });

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`\n✅ Album Upload Complete in ${elapsed}s\n`);

            res.write(JSON.stringify({ 
                step: 'complete', 
                status: 'success',
                data: {
                    albumId: albumRef.id,
                    albumArtUrl: albumArtUrl,
                    tracks: trackResults,
                    processingTime: elapsed
                }
            }) + '\n');
            res.end();

        } catch (error) {
            console.error("Album Upload Error:", error);
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
// ROUTE: ASSET UPLOAD (R2 INTEGRATED)
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

// ==========================================
// EXISTING ACCOUNT ROUTES
// ==========================================

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

router.get('/studio', verifyUser, async (req, res) => {
    const artistSnap = await db.collection('artists')
        .where('ownerUid', '==', req.uid)
        .limit(1)
        .get();
    
    if (artistSnap.empty) {
        return res.redirect('/artist/signup');
    }
    
    const artistData = artistSnap.docs[0].data();
    
    // CHECK APPROVAL
    if (!artistData.dashboardAccess || artistData.status !== 'approved') {
        return res.render('artist/artist_pending_approval', {
            status: artistData.status,
            appliedAt: artistData.appliedAt,
            rejectionReason: artistData.rejectionReason,
            artistId: artistSnap.docs[0].id
        });
    }
    
    // Approved - show dashboard
    res.render('artist/studio', { artist: artistData });
});

// ==========================================
// ROUTE: CHECK ARTIST APPROVAL STATUS
// ==========================================
router.get('/api/check-approval-status/:artistId', async (req, res) => {
    try {
        const { artistId } = req.params;
        
        const artistDoc = await db.collection('artists').doc(artistId).get();
        
        if (!artistDoc.exists) {
            return res.status(404).json({ error: "Artist not found" });
        }
        
        const data = artistDoc.data();
        
        res.json({
            status: data.status,
            approved: data.reviewApproved || false,
            dashboardAccess: data.dashboardAccess || false,
            approvedAt: data.approvedAt?.toDate(),
            rejectedAt: data.rejectedAt?.toDate(),
            rejectionReason: data.rejectionReason || null
        });

    } catch (error) {
        console.error("Check Status Error:", error);
        res.status(500).json({ error: error.message });
    }
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
        
        const doc = snapshot.docs[0];
        const data = doc.data();
        
        const dashboardData = {
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

// ==========================================
// ARTIST COMMENT MANAGEMENT API
// (Artists READ comments created by players, don't create them)
// ==========================================

// GET: Fetch comments for the artist (from their wall)
router.get('/api/studio/comments', verifyUser, async (req, res) => {
    try {
        // Find artist profile for this user
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;
        const limit = parseInt(req.query.limit) || 20;
        const lastTimestamp = req.query.lastTimestamp;

        // Fetch comments from the artist's subcollection
        let query = db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .where('hidden', '==', false)
            .orderBy('timestamp', 'desc')
            .limit(limit);

        if (lastTimestamp) {
            query = query.startAfter(new Date(lastTimestamp));
        }

        const commentsSnap = await query.get();

        const comments = [];
        commentsSnap.forEach(doc => {
            const data = doc.data();
            comments.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp ? data.timestamp.toDate() : new Date()
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

// POST: Mark comment as read
router.post('/api/studio/comments/mark-read', verifyUser, express.json(), async (req, res) => {
    try {
        const { commentId } = req.body;
        if (!commentId) return res.status(400).json({ error: "Missing comment ID" });

        // Find artist profile
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;

        // Update the comment to mark as read
        await db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .doc(commentId)
            .update({ 
                read: true,
                readAt: admin.firestore.FieldValue.serverTimestamp()
            });

        res.json({ success: true });

    } catch (e) {
        console.error("Mark Read Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// POST: Flag comment as offensive
router.post('/api/studio/comments/flag', verifyUser, express.json(), async (req, res) => {
    try {
        const { commentId, reason } = req.body;
        if (!commentId) return res.status(400).json({ error: "Missing comment ID" });

        // Find artist profile
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;

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
            reportedByType: 'artist',
            reason: reason || 'Offensive content',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mark comment as reported
        await commentRef.update({ 
            reported: true,
            reportedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true });

    } catch (e) {
        console.error("Flag Comment Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// DELETE: Hide/delete a comment from artist's wall
router.delete('/api/studio/comments/:commentId', verifyUser, async (req, res) => {
    try {
        const { commentId } = req.params;

        // Find artist profile
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;

        const commentRef = db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .doc(commentId);

        const commentDoc = await commentRef.get();
        if (!commentDoc.exists) {
            return res.status(404).json({ error: "Comment not found" });
        }

        // Hide the comment (don't delete to maintain records)
        await commentRef.update({ 
            hidden: true,
            hiddenAt: admin.firestore.FieldValue.serverTimestamp(),
            hiddenBy: req.uid
        });

        // Update comment count
        await db.collection('artists').doc(artistId).update({
            'stats.comments': admin.firestore.FieldValue.increment(-1)
        });

        res.json({ success: true });

    } catch (e) {
        console.error("Hide Comment Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET: Get unread comment count
router.get('/api/studio/comments/unread-count', verifyUser, async (req, res) => {
    try {
        // Find artist profile
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();
        
        if (artistSnap.empty) {
            return res.status(404).json({ error: "Artist not found" });
        }

        const artistId = artistSnap.docs[0].id;

        // Count unread comments
        const unreadSnap = await db.collection('artists')
            .doc(artistId)
            .collection('comments')
            .where('hidden', '==', false)
            .where('read', '==', false)
            .get();

        res.json({ count: unreadSnap.size });

    } catch (e) {
        console.error("Unread Count Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;