/* routes/artist/uploads.js */
const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { PassThrough } = require('stream');
const { Upload } = require('@aws-sdk/lib-storage');
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { analyzeAudioFeatures } = require('../audioAnalysis'); 
const r2 = require('../../config/r2'); 

ffmpeg.setFfmpegPath(ffmpegPath);

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    STREAMING_THRESHOLD: 50 * 1024 * 1024, // 50MB
    MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB
    UPLOAD_PART_SIZE: 5 * 1024 * 1024, // 5MB chunks
    MP3_BITRATE: '320k',
};

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
// MIDDLEWARE & HELPERS
// ==========================================
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).json({ error: "No authentication token provided" });

    try {
        const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch (error) { 
        res.status(403).json({ error: "Invalid or expired session. Please log in again." }); 
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


//==========================================
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
// UPLOAD ROUTES
// ==========================================

// ASSET UPLOAD
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

// SINGLE TRACK UPLOAD
router.post('/api/upload-track', upload.fields([{ name: 'audioFile', maxCount: 1 }, { name: 'artFile', maxCount: 1 }]), async (req, res) => {
    const startTime = Date.now();
    try {
        const db = admin.firestore();
        if (!req.files || !req.files['audioFile'] || !req.files['artFile']) return res.status(400).json({ error: "Missing files" });
        
        const audioFile = req.files['audioFile'][0];
        const artFile = req.files['artFile'][0];
        const { title, genre, subgenre, artistId, albumName } = req.body;

        const fileExt = audioFile.originalname.split('.').pop().toLowerCase();
        const isLossless = ['flac', 'wav', 'aiff', 'alac'].includes(fileExt);
        const isLargeFile = audioFile.size > CONFIG.STREAMING_THRESHOLD;

        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ step: 'init', status: 'loading artist data' }) + '\n');
        
        const artistDoc = await db.collection('artists').doc(artistId).get();
        const artistData = artistDoc.data();
        const locParts = (artistData.location || '').split(',').map(s => s.trim());

        res.write(JSON.stringify({ step: 'analysis', status: 'analyzing audio' }) + '\n');
        const features = await analyzeAudioFeatures(audioFile.buffer, audioFile.originalname);

        res.write(JSON.stringify({ step: 'upload', status: 'uploading master' }) + '\n');
        const cleanTitle = title.replace(/[^a-zA-Z0-9-_]/g, '_');
        const timestamp = Date.now();
        const masterPath = `artists/${artistId}/masters/${timestamp}_${cleanTitle}.${fileExt}`;
        
        let masterUrl;
        if (isLargeFile) {
            const masterStream = new PassThrough();
            masterStream.end(audioFile.buffer);
            masterUrl = await streamUploadToR2(masterStream, masterPath, audioFile.mimetype);
        } else {
            masterUrl = await uploadToStorage(audioFile.buffer, masterPath, audioFile.mimetype);
        }

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
        } else { streamUrl = masterUrl; }

        res.write(JSON.stringify({ step: 'upload', status: 'uploading artwork' }) + '\n');
        const artPath = `artists/${artistId}/art/${timestamp}_${cleanTitle}_art.jpg`;
        const artUrl = await uploadToStorage(artFile.buffer, artPath, artFile.mimetype);

        res.write(JSON.stringify({ step: 'database', status: 'saving track' }) + '\n');
        const songData = {
            title: title, titleLower: title.toLowerCase(), artistId: artistId, artistName: artistData.name, 
            album: albumName || "Single", isSingle: !albumName, genre: genre, subgenre: subgenre || "General", 
            audioUrl: streamUrl, masterUrl: masterUrl, artUrl: artUrl, originalFormat: fileExt, fileSize: audioFile.size, 
            isLossless: isLossless, isTranscoded: isLossless, bpm: features.bpm || 0, key: features.key || 'Unknown', 
            mode: features.mode || 'Unknown', energy: features.energy || 0, danceability: features.danceability || 0, 
            duration: features.duration || 0, city: locParts[0] || null, state: locParts[1] || null, country: locParts[2] || 'US',
            stats: { plays: 0, likes: 0, downloads: 0 }, uploadedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('songs').add(songData);
        await db.collection('artists').doc(artistId).collection('releases').doc(docRef.id).set({
            type: 'single', ref: docRef, title: title, artUrl: artUrl, uploadedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        res.write(JSON.stringify({ step: 'complete', status: 'success', data: { songId: docRef.id, processingTime: elapsed } }) + '\n');
        res.end();
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ status: 'failed', error: error.message });
        else { res.write(JSON.stringify({ status: 'failed', error: error.message })); res.end(); }
    }
});

// ALBUM UPLOAD
router.post('/api/upload-album', upload.fields([{ name: 'audioFiles', maxCount: 50 }, { name: 'albumArt', maxCount: 1 }]), async (req, res) => {
    const startTime = Date.now();
    try {
        const db = admin.firestore();
        if (!req.files || !req.files['audioFiles'] || !req.files['albumArt']) return res.status(400).json({ error: "Missing files" });

        const audioFiles = req.files['audioFiles'];
        const albumArt = req.files['albumArt'][0];
        const { albumName, genre, subgenre, artistId } = req.body;

        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ step: 'init', status: 'starting', totalTracks: audioFiles.length }) + '\n');

        const artistDoc = await db.collection('artists').doc(artistId).get();
        const artistData = artistDoc.data();
        const locParts = (artistData.location || '').split(',').map(s => s.trim());

        const timestamp = Date.now();
        const cleanAlbumName = albumName.replace(/[^a-zA-Z0-9-_]/g, '_');
        const albumArtPath = `artists/${artistId}/albums/${timestamp}_${cleanAlbumName}_art.jpg`;
        const albumArtUrl = await uploadToStorage(albumArt.buffer, albumArtPath, albumArt.mimetype);

        const trackResults = [];
        for (let i = 0; i < audioFiles.length; i++) {
            const file = audioFiles[i];
            const trackNum = i + 1;
            
            res.write(JSON.stringify({ step: 'processing', track: trackNum, total: audioFiles.length, filename: file.originalname }) + '\n');

            try {
                const trackTitle = file.originalname.replace(/\.[^/.]+$/, '');
                const fileExt = file.originalname.split('.').pop().toLowerCase();
                const isLossless = ['flac', 'wav', 'aiff', 'alac'].includes(fileExt);
                const isLargeFile = file.size > CONFIG.STREAMING_THRESHOLD;

                const features = await analyzeAudioFeatures(file.buffer, file.originalname);

                const masterPath = `artists/${artistId}/masters/${timestamp}_${trackNum}_${trackTitle}.${fileExt}`;
                let masterUrl;
                if (isLargeFile) {
                    const stream = new PassThrough();
                    stream.end(file.buffer);
                    masterUrl = await streamUploadToR2(stream, masterPath, file.mimetype);
                } else { masterUrl = await uploadToStorage(file.buffer, masterPath, file.mimetype); }

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
                } else { streamUrl = masterUrl; }

                const songData = {
                    title: trackTitle, titleLower: trackTitle.toLowerCase(), artistId: artistId, artistName: artistData.name,
                    album: albumName, isSingle: false, trackNumber: trackNum, genre: genre, subgenre: subgenre || "General",
                    audioUrl: streamUrl, masterUrl: masterUrl, artUrl: albumArtUrl, originalFormat: fileExt, fileSize: file.size,
                    isLossless: isLossless, isTranscoded: isLossless, bpm: features.bpm || 0, key: features.key || 'Unknown',
                    mode: features.mode || 'Unknown', energy: features.energy || 0, danceability: features.danceability || 0,
                    duration: features.duration || 0, city: locParts[0] || null, state: locParts[1] || null, country: locParts[2] || 'US',
                    stats: { plays: 0, likes: 0, downloads: 0 }, uploadedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                const docRef = await db.collection('songs').add(songData);
                trackResults.push({ trackNumber: trackNum, songId: docRef.id, title: trackTitle });

            } catch (error) { trackResults.push({ trackNumber: trackNum, error: error.message }); }
        }

        const albumRef = await db.collection('artists').doc(artistId).collection('releases').add({
            type: 'album', title: albumName, artUrl: albumArtUrl, trackCount: trackResults.filter(t => t.songId).length,
            tracks: trackResults, uploadedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        res.write(JSON.stringify({ step: 'complete', status: 'success', data: { albumId: albumRef.id, tracks: trackResults, processingTime: elapsed } }) + '\n');
        res.end();
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ status: 'failed', error: error.message });
        else { res.write(JSON.stringify({ status: 'failed', error: error.message })); res.end(); }
    }
});


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


module.exports = router;