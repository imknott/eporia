/* routes/artist/uploads.js */
const express    = require('express');
const router     = express.Router();
const admin      = require("firebase-admin");
const multer     = require('multer');
const ffmpeg     = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { PassThrough } = require('stream');
const { Upload }      = require('@aws-sdk/lib-storage');
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { analyzeAudioFeatures } = require('../audioAnalysis');
const r2 = require('../../config/r2');
const { queueForDistribution } = require('../../services/distroService');

ffmpeg.setFfmpegPath(ffmpegPath);

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    STREAMING_THRESHOLD:    50 * 1024 * 1024,  // 50MB  — multipart above this
    MAX_FILE_SIZE:         500 * 1024 * 1024,  // 500MB — hard per-file cap
    UPLOAD_PART_SIZE:       10 * 1024 * 1024,  // 10MB  — S3 multipart chunk
    MP3_BITRATE:           '320k',
    // Max simultaneous ffmpeg processes during an album job.
    // 2 keeps peak RAM low without slowing things down much.
    MAX_CONCURRENT_TRANSCODES: 2,
};

// ==========================================
// MULTER
// memoryStorage is fine — multer streams
// files in one-at-a-time. The OOM problem
// isn't multer itself; it's holding all the
// buffers alive while processing in serial.
// The concurrency limiter below fixes that.
// ==========================================
const AUDIO_TYPES = [
    'audio/mpeg', 'audio/mp3',
    'audio/x-flac', 'audio/flac',
    'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/x-aiff', 'audio/aiff',
    'audio/x-m4a', 'audio/mp4',
];
const IMAGE_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: CONFIG.MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (AUDIO_TYPES.includes(file.mimetype) || IMAGE_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type: ${file.mimetype}`), false);
        }
    },
});

// ==========================================
// BACKGROUND JOB STORE
//
// Keyed by jobId. Each job lives in memory and
// is auto-deleted after 2 hours.
// For multi-instance deploys swap this Map for
// Redis or a Firestore jobs/ collection.
// ==========================================
const jobs = new Map();

function createJob() {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    jobs.set(id, {
        id,
        status:    'queued',   // queued | processing | complete | failed
        progress:  [],         // [{ step, message, ts }]
        error:     null,
        result:    null,
        createdAt: Date.now(),
    });
    // Auto-expire after 2 h to prevent memory leak on long-running server
    setTimeout(() => jobs.delete(id), 2 * 60 * 60 * 1000);
    return id;
}

function jobLog(id, step, message) {
    const job = jobs.get(id);
    if (!job) return;
    console.log(`[job:${id}] [${step}] ${message}`);
    job.progress.push({ step, message, ts: Date.now() });
}

// ==========================================
// HELPERS
// ==========================================

async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).json({ error: 'No authentication token provided' });
    try {
        const token  = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch {
        res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
    }
}

async function uploadToStorage(fileBuffer, filePath, contentType) {
    try {
        await r2.send(new PutObjectCommand({
            Bucket:      process.env.R2_BUCKET_NAME,
            Key:         filePath,
            Body:        fileBuffer,
            ContentType: contentType,
        }));
        return `${process.env.R2_PUBLIC_URL}/${filePath}`;
    } catch (error) {
        console.error('R2 Upload Error:', error);
        throw new Error('Failed to upload asset to storage.');
    }
}

async function streamUploadToR2(stream, key, contentType) {
    const up = new Upload({
        client: r2,
        params: { Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: stream, ContentType: contentType },
        partSize:  CONFIG.UPLOAD_PART_SIZE,
        queueSize: 4,
    });
    up.on('httpUploadProgress', (p) => {
        if (p.total) console.log(`📤 [${key}]: ${((p.loaded / p.total) * 100).toFixed(1)}%`);
    });
    await up.done();
    return `${process.env.R2_PUBLIC_URL}/${key}`;
}

async function transcodeToBuffer(inputBuffer) {
    const inputStream  = new PassThrough();
    inputStream.end(inputBuffer);
    return new Promise((resolve, reject) => {
        const chunks = [];
        const out    = new PassThrough();
        ffmpeg(inputStream)
            .toFormat('mp3').audioBitrate(CONFIG.MP3_BITRATE)
            .audioChannels(2).audioFrequency(44100)
            .on('error', (err) => { console.error('❌ Transcode:', err.message); reject(err); })
            .on('end',   () => console.log('✅ Transcode complete'))
            .pipe(out);
        out.on('data',  chunk => chunks.push(chunk));
        out.on('end',   () => resolve(Buffer.concat(chunks)));
        out.on('error', reject);
    });
}

function createTranscodeStream(inputBuffer) {
    const inputStream  = new PassThrough();
    inputStream.end(inputBuffer);
    const outputStream = new PassThrough();
    ffmpeg(inputStream)
        .toFormat('mp3').audioBitrate(CONFIG.MP3_BITRATE)
        .audioChannels(2).audioFrequency(44100)
        .on('start',    cmd  => console.log('🎵 FFmpeg:', cmd))
        .on('progress', p    => { if (p.percent) console.log(`⏳ Transcoding: ${p.percent.toFixed(1)}%`); })
        .on('error',    err  => { console.error('❌ Transcode:', err.message); outputStream.destroy(err); })
        .on('end',      ()   => console.log('✅ Transcode complete'))
        .pipe(outputStream, { end: true });
    return outputStream;
}

function getAudioDuration(buffer) {
    return new Promise((resolve, reject) => {
        const stream = new PassThrough();
        stream.end(buffer);
        ffmpeg(stream).ffprobe((err, metadata) => {
            if (err) return reject(err);
            resolve(Math.round(metadata.format.duration || 0));
        });
    });
}

// ==========================================
// FEATURE MERGE
//
// BPM and key come from two sources:
//   - Client (Essentia WASM): real signal-processing on decoded waveform.
//     This is the MOST ACCURATE source — use it whenever present & non-zero.
//   - Server (music-metadata): reads embedded ID3/Vorbis tags.
//     Artists rarely embed these, so they're usually 0/Unknown.
//
// Merge rule: client wins for perceptual features (bpm, key, mode, energy,
// danceability). Server wins for technical container facts (duration,
// sampleRate, codec) since those come from the file header.
// ==========================================
function mergeFeatures(client = {}, server = {}) {
    return {
        bpm:          (client.bpm  > 0)                              ? Math.round(client.bpm)  : (server.bpm  || 0),
        key:          (client.key  && client.key  !== 'Unknown')     ? client.key               : (server.key  || 'Unknown'),
        mode:         (client.mode && client.mode !== 'Unknown')     ? client.mode              : (server.mode || 'Unknown'),
        energy:       (client.energy       != null)                  ? client.energy            : (server.energy       || 0.5),
        danceability: (client.danceability != null)                  ? client.danceability      : (server.danceability || 0.5),
        loudness:     (client.loudness     != null)                  ? client.loudness          : (server.loudness     || 0),
        // Container facts — server wins
        duration:     server.duration   || client.duration  || 0,
        sampleRate:   server.sampleRate || 44100,
        bitrate:      server.bitrate    || null,
        codec:        server.codec      || null,
        lossless:     server.lossless   || false,
    };
}

// Parse floats sent from form data — returns null if missing/NaN
function safeFloat(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

// ==========================================
// CONCURRENCY LIMITER
//
// Prevents more than N simultaneous ffmpeg
// processes. Without this, a 10-track album
// launches 10 transcodes at once, fills RAM,
// and crashes the Node process.
// ==========================================
function createLimiter(concurrency) {
    let running = 0;
    const queue = [];
    return function limit(fn) {
        return new Promise((resolve, reject) => {
            const run = () => {
                running++;
                Promise.resolve(fn())
                    .then(resolve, reject)
                    .finally(() => {
                        running--;
                        if (queue.length > 0) queue.shift()();
                    });
            };
            if (running < concurrency) run();
            else queue.push(run);
        });
    };
}

// ==========================================
// SHARED TRACK PROCESSOR
//
// Upload master → transcode to MP3 if lossless
// → run server-side analysis → merge with client
// analysis → return { masterUrl, streamUrl, features }
// ==========================================
async function processOneTrack({
    buffer, mimetype, originalname,
    artistId, cleanTitle, timestamp, trackNum,
    clientFeatures,
}) {
    const fileExt     = originalname.split('.').pop().toLowerCase();
    const isLossless  = ['flac', 'wav', 'aiff', 'alac'].includes(fileExt);
    const isLargeFile = buffer.length > CONFIG.STREAMING_THRESHOLD;

    const prefix   = trackNum != null ? `${timestamp}_${trackNum}_` : `${timestamp}_`;
    const masterKey = `artists/${artistId}/masters/${prefix}${cleanTitle}.${fileExt}`;
    const streamKey = `artists/${artistId}/tracks/${prefix}${cleanTitle}.mp3`;

    // 1. Upload master (original, full quality)
    let masterUrl;
    if (isLargeFile) {
        const s = new PassThrough(); s.end(buffer);
        masterUrl = await streamUploadToR2(s, masterKey, mimetype);
    } else {
        masterUrl = await uploadToStorage(buffer, masterKey, mimetype);
    }

    // 2. Create streaming MP3 version for lossless files
    let streamUrl;
    if (isLossless) {
        if (isLargeFile) {
            streamUrl = await streamUploadToR2(createTranscodeStream(buffer), streamKey, 'audio/mpeg');
        } else {
            streamUrl = await uploadToStorage(await transcodeToBuffer(buffer), streamKey, 'audio/mpeg');
        }
    } else {
        streamUrl = masterUrl; // Already MP3/AAC — no transcode needed
    }

    // 3. Server-side analysis (tag extraction — fallback for when browser Essentia isn't available)
    let serverFeatures = {};
    try {
        serverFeatures = await analyzeAudioFeatures(buffer, originalname);
    } catch (err) {
        console.warn(`⚠ Server analysis failed for ${originalname}:`, err.message);
    }

    // 4. Merge: client Essentia signal-processing wins for BPM/key
    const features = mergeFeatures(clientFeatures || {}, serverFeatures);

    console.log(`🎵 ${originalname} — BPM: ${features.bpm}, Key: ${features.key} ${features.mode}, Duration: ${features.duration}s`);

    return { masterUrl, streamUrl, features, isLossless };
}

// ==========================================
// ROUTE: JOB STATUS POLL
// GET /api/upload-job/:jobId
// Client polls this every 2s to get progress.
// ==========================================
router.get('/api/upload-job/:jobId', verifyUser, (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found or expired' });
    res.json(job);
});

// ==========================================
// ROUTE: ASSET UPLOAD (avatar / banner)
// ==========================================
router.post('/api/upload-asset', verifyUser, upload.single('file'), async (req, res) => {
    try {
        const db = admin.firestore();
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const artistSnap = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(403).json({ error: 'No artist profile linked to this account' });
        const artistId = artistSnap.docs[0].id;

        const type     = req.body.type;
        const ext      = req.file.originalname.split('.').pop();
        const filePath = `artists/${artistId}/${type}_${Date.now()}.${ext}`;
        const url      = await uploadToStorage(req.file.buffer, filePath, req.file.mimetype);
        res.json({ success: true, url, path: filePath });
    } catch (error) {
        console.error('Asset Upload Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ROUTE: SINGLE TRACK UPLOAD
// POST /api/upload-track
//
// Returns { jobId } immediately. All heavy work
// (transcode, R2 upload, analysis) runs in the
// background. Client polls /api/upload-job/:id.
// ==========================================
router.post(
    '/api/upload-track',
    verifyUser,
    upload.fields([{ name: 'audioFile', maxCount: 1 }, { name: 'artFile', maxCount: 1 }]),
    async (req, res) => {
        try {
            const db = admin.firestore();
            if (!req.files?.['audioFile'] || !req.files?.['artFile'])
                return res.status(400).json({ error: 'Missing audio or artwork file' });

            const audioFile = req.files['audioFile'][0];
            const artFile   = req.files['artFile'][0];
            const { title, genre, subgenre, albumName, isrc, upc } = req.body;

            if (!title) return res.status(400).json({ error: 'Track title is required' });

            if (isrc && !/^[A-Z]{2}-[A-Z0-9]{3}-\d{2}-\d{5}$/.test(isrc))
                return res.status(400).json({ error: 'Invalid ISRC format. Expected: CC-XXX-YY-NNNNN' });

            const artistSnap = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
            if (artistSnap.empty) return res.status(403).json({ error: 'No artist profile linked to this account' });
            const artistId = artistSnap.docs[0].id;

            // Read client Essentia results from form data — these win over tag extraction
            const clientFeatures = {
                bpm:          safeFloat(req.body.bpm),
                key:          req.body.key   || null,
                mode:         req.body.mode  || null,
                energy:       safeFloat(req.body.energy),
                danceability: safeFloat(req.body.danceability),
                duration:     safeFloat(req.body.duration),
            };

            // Respond immediately — don't make the browser wait for transcode
            const jobId = createJob();
            res.json({ success: true, jobId });

            // ── Everything below runs asynchronously after response is sent ──
            ;(async () => {
                const job   = jobs.get(jobId);
                job.status  = 'processing';
                const start = Date.now();

                try {
                    jobLog(jobId, 'init', 'Loading artist profile');
                    const artistDoc  = await db.collection('artists').doc(artistId).get();
                    const artistData = artistDoc.data();
                    const locParts   = (artistData.location || '').split(',').map(s => s.trim());

                    const cleanTitle = title.replace(/[^a-zA-Z0-9-_]/g, '_');
                    const timestamp  = Date.now();

                    jobLog(jobId, 'upload', 'Uploading master and creating stream version');
                    const { masterUrl, streamUrl, features, isLossless } = await processOneTrack({
                        buffer:       audioFile.buffer,
                        mimetype:     audioFile.mimetype,
                        originalname: audioFile.originalname,
                        artistId, cleanTitle, timestamp,
                        trackNum:     null,
                        clientFeatures,
                    });

                    jobLog(jobId, 'upload', 'Uploading artwork');
                    const fileExt = audioFile.originalname.split('.').pop().toLowerCase();
                    const artPath = `artists/${artistId}/art/${timestamp}_${cleanTitle}_art.jpg`;
                    const artUrl  = await uploadToStorage(artFile.buffer, artPath, artFile.mimetype);

                    jobLog(jobId, 'database', 'Saving track');
                    const songData = {
                        title, titleLower: title.toLowerCase(),
                        artistId, artistName: artistData.name,
                        album: albumName || 'Single', isSingle: !albumName,
                        genre, subgenre: subgenre || 'General',
                        audioUrl: streamUrl, masterUrl, artUrl,
                        originalFormat: fileExt, fileSize: audioFile.size,
                        isLossless, isTranscoded: isLossless,
                        // ── Audio features (client Essentia wins for BPM/key) ──
                        bpm:          features.bpm,
                        key:          features.key,
                        mode:         features.mode,
                        energy:       features.energy,
                        danceability: features.danceability,
                        loudness:     features.loudness,
                        duration:     features.duration,
                        sampleRate:   features.sampleRate,
                        bitrate:      features.bitrate,
                        codec:        features.codec,
                        // ── Location ──
                        city: locParts[0] || null, state: locParts[1] || null, country: locParts[2] || 'US',
                        stats: { plays: 0, likes: 0, downloads: 0 },
                        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                        isrc: isrc || null, upc: upc || null,
                        distroStatus: null, externalIds: {},
                        // ── DJ licensing placeholder ──
                        // djLicensing: { available: false, price: null, licenseType: null }
                        // Enable once the DJ service is live.
                    };

                    const docRef = await db.collection('songs').add(songData);
                    await db.collection('artists').doc(artistId).collection('singles').doc(docRef.id).set({
                        songId: docRef.id, title, artUrl, genre,
                        audioUrl:  streamUrl,
                        duration:  features.duration,
                        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    if (isrc) {
                        queueForDistribution(docRef.id, { isrc, upc, artistId, title, isAlbum: false })
                            .catch(err => console.error('⚠ Distro queue error:', err.message));
                    }

                    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
                    jobLog(jobId, 'complete', `Done in ${elapsed}s — BPM: ${features.bpm}, Key: ${features.key} ${features.mode}`);
                    job.status = 'complete';
                    job.result = {
                        songId: docRef.id, processingTime: elapsed,
                        bpm: features.bpm, key: features.key, mode: features.mode,
                        duration: features.duration,
                    };

                } catch (err) {
                    console.error(`[job:${jobId}] Track upload failed:`, err);
                    job.status = 'failed';
                    job.error  = err.message;
                }
            })();

        } catch (error) {
            console.error('Upload-track route error:', error);
            if (!res.headersSent) res.status(500).json({ error: error.message });
        }
    }
);

// ==========================================
// ROUTE: ALBUM UPLOAD
// POST /api/upload-album
//
// Same background-job pattern. Tracks are
// processed with a concurrency limiter so we
// never run more than MAX_CONCURRENT_TRANSCODES
// ffmpeg processes simultaneously — this is the
// key fix for the multi-track OOM crash.
// ==========================================
router.post(
    '/api/upload-album',
    verifyUser,
    upload.fields([{ name: 'audioFiles', maxCount: 50 }, { name: 'albumArt', maxCount: 1 }]),
    async (req, res) => {
        try {
            const db = admin.firestore();
            if (!req.files?.['audioFiles'] || !req.files?.['albumArt'])
                return res.status(400).json({ error: 'Missing audio files or album art' });

            const audioFiles = req.files['audioFiles'];
            const albumArt   = req.files['albumArt'][0];
            const { albumName, genre, subgenre, upc } = req.body;

            if (!albumName) return res.status(400).json({ error: 'Album name is required' });

            const artistSnap = await db.collection('artists').where('ownerUid', '==', req.uid).limit(1).get();
            if (artistSnap.empty) return res.status(403).json({ error: 'No artist profile linked to this account' });
            const artistId = artistSnap.docs[0].id;

            // Per-track titles the artist set in the UI
            let trackTitles = [];
            try { trackTitles = req.body.trackTitles ? JSON.parse(req.body.trackTitles) : []; }
            catch { trackTitles = []; }

            // Per-track Essentia analysis results from the browser
            // Shape: Array<{ bpm, key, mode, energy, danceability, duration } | null>
            let trackAnalyses = [];
            try { trackAnalyses = req.body.trackAnalyses ? JSON.parse(req.body.trackAnalyses) : []; }
            catch { trackAnalyses = []; }

            // Per-track ISRCs (optional)
            let trackIsrcs = [];
            try { trackIsrcs = req.body.trackIsrcs ? JSON.parse(req.body.trackIsrcs) : []; }
            catch { trackIsrcs = []; }

            // Validate ISRCs up front — fail fast before touching R2
            for (let i = 0; i < trackIsrcs.length; i++) {
                const isrc = trackIsrcs[i];
                if (isrc && !/^[A-Z]{2}-[A-Z0-9]{3}-\d{2}-\d{5}$/.test(isrc))
                    return res.status(400).json({ error: `Invalid ISRC for track ${i + 1}: ${isrc}` });
            }

            // Respond immediately with jobId
            const jobId = createJob();
            res.json({ success: true, jobId, totalTracks: audioFiles.length });

            // ── Background processing ────────────────────────────────────────
            ;(async () => {
                const job   = jobs.get(jobId);
                job.status  = 'processing';
                const start = Date.now();
                const limit = createLimiter(CONFIG.MAX_CONCURRENT_TRANSCODES);

                try {
                    jobLog(jobId, 'init', `Album: ${albumName} (${audioFiles.length} tracks)`);
                    const artistDoc  = await db.collection('artists').doc(artistId).get();
                    const artistData = artistDoc.data();
                    const locParts   = (artistData.location || '').split(',').map(s => s.trim());

                    const timestamp      = Date.now();
                    const cleanAlbumName = albumName.replace(/[^a-zA-Z0-9-_]/g, '_');

                    // Upload album art first — quick win, unblocks UI progress display
                    jobLog(jobId, 'album_art', 'Uploading album artwork');
                    const albumArtPath = `artists/${artistId}/albums/${timestamp}_${cleanAlbumName}_art.jpg`;
                    const albumArtUrl  = await uploadToStorage(albumArt.buffer, albumArtPath, albumArt.mimetype);

                    // Process tracks with concurrency limit.
                    // Promise.all + limit means up to MAX_CONCURRENT_TRANSCODES tracks
                    // are in-flight at any time. Once one finishes its buffer is GC'd.
                    const trackResults = new Array(audioFiles.length);

                    await Promise.all(audioFiles.map((file, i) => limit(async () => {
                        const trackNum  = i + 1;
                        const trackTitle = (trackTitles[i] && trackTitles[i].trim())
                            ? trackTitles[i].trim()
                            : file.originalname.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
                        const cleanTitle = trackTitle.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80);
                        const trackIsrc  = trackIsrcs[i] || null;
                        const clientFeat = trackAnalyses[i] || {};

                        jobLog(jobId, 'track', `Processing ${trackNum}/${audioFiles.length}: ${trackTitle}`);

                        try {
                            const { masterUrl, streamUrl, features, isLossless } = await processOneTrack({
                                buffer:       file.buffer,
                                mimetype:     file.mimetype,
                                originalname: file.originalname,
                                artistId, cleanTitle, timestamp, trackNum,
                                clientFeatures: clientFeat,
                            });

                            const fileExt  = file.originalname.split('.').pop().toLowerCase();
                            const songData = {
                                title: trackTitle, titleLower: trackTitle.toLowerCase(),
                                artistId, artistName: artistData.name,
                                album: albumName, isSingle: false, trackNumber: trackNum,
                                genre, subgenre: subgenre || 'General',
                                audioUrl: streamUrl, masterUrl, artUrl: albumArtUrl,
                                originalFormat: fileExt, fileSize: file.size,
                                isLossless, isTranscoded: isLossless,
                                bpm:          features.bpm,
                                key:          features.key,
                                mode:         features.mode,
                                energy:       features.energy,
                                danceability: features.danceability,
                                loudness:     features.loudness,
                                duration:     features.duration,
                                sampleRate:   features.sampleRate,
                                bitrate:      features.bitrate,
                                codec:        features.codec,
                                city: locParts[0] || null, state: locParts[1] || null, country: locParts[2] || 'US',
                                stats: { plays: 0, likes: 0, downloads: 0 },
                                uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                                isrc: trackIsrc, upc: upc || null,
                                distroStatus: null, externalIds: {},
                                // djLicensing: { available: false, price: null, licenseType: null }
                            };

                            const docRef = await db.collection('songs').add(songData);

                            if (trackIsrc) {
                                queueForDistribution(docRef.id, {
                                    isrc: trackIsrc, upc: upc || null,
                                    artistId, title: trackTitle, isAlbum: true,
                                }).catch(err => console.error(`⚠ Distro [track ${trackNum}]:`, err.message));
                            }

                            trackResults[i] = {
                                trackNumber: trackNum, songId: docRef.id,
                                title: trackTitle, isrc: trackIsrc || null,
                                bpm: features.bpm, key: features.key, mode: features.mode,
                                duration: features.duration,
                            };
                            jobLog(jobId, 'track_done', `✅ Track ${trackNum} saved — BPM: ${features.bpm}, Key: ${features.key} ${features.mode}`);

                        } catch (trackErr) {
                            console.error(`[job:${jobId}] Track ${trackNum} failed:`, trackErr);
                            trackResults[i] = { trackNumber: trackNum, error: trackErr.message };
                            jobLog(jobId, 'track_error', `Track ${trackNum} failed: ${trackErr.message}`);
                            // Do NOT rethrow — continue processing remaining tracks
                        }
                    })));

                    // Save album document
                    jobLog(jobId, 'database', 'Saving album record');
                    const successTracks = trackResults.filter(t => t?.songId);
                    const albumRef = await db.collection('artists').doc(artistId).collection('albums').add({
                        type: 'album', title: albumName, artUrl: albumArtUrl, genre,
                        upc:        upc || null,
                        trackCount: successTracks.length,
                        tracks:     trackResults.filter(Boolean),
                        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    const elapsed   = ((Date.now() - start) / 1000).toFixed(2);
                    const failCount = trackResults.filter(t => t?.error).length;
                    jobLog(jobId, 'complete',
                        `Album saved in ${elapsed}s — ${successTracks.length} tracks OK, ${failCount} failed`);
                    job.status = 'complete';
                    job.result = {
                        albumId: albumRef.id,
                        tracks:  trackResults.filter(Boolean),
                        processingTime: elapsed,
                        successCount:   successTracks.length,
                        failCount,
                    };

                } catch (err) {
                    console.error(`[job:${jobId}] Album upload failed:`, err);
                    job.status = 'failed';
                    job.error  = err.message;
                }
            })();

        } catch (error) {
            console.error('Upload-album route error:', error);
            if (!res.headersSent) res.status(500).json({ error: error.message });
        }
    }
);

// ==========================================
// ROUTE: MERCH SAMPLE UPLOAD
// (synchronous — single file, no analysis)
// ==========================================
router.post('/api/upload-merch-sample', verifyUser, upload.single('audioFile'), async (req, res) => {
    try {
        const db = admin.firestore();
        if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

        const { artistId, title } = req.body;
        if (!artistId) return res.status(400).json({ error: 'artistId required' });

        const artistDoc = await db.collection('artists').doc(artistId).get();
        if (!artistDoc.exists) return res.status(404).json({ error: 'Artist not found' });
        if (artistDoc.data().ownerUid !== req.uid)
            return res.status(403).json({ error: 'Forbidden: not your artist account' });

        const fileExt    = req.file.originalname.split('.').pop().toLowerCase();
        const isLossless = ['flac', 'wav', 'aiff', 'alac'].includes(fileExt);
        const isLarge    = req.file.size > CONFIG.STREAMING_THRESHOLD;
        const cleanTitle = (title || 'sample').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
        const r2Key      = `artists/${artistId}/merch-samples/${Date.now()}_${cleanTitle}.mp3`;

        let streamUrl;
        if (isLossless) {
            streamUrl = isLarge
                ? await streamUploadToR2(createTranscodeStream(req.file.buffer), r2Key, 'audio/mpeg')
                : await uploadToStorage(await transcodeToBuffer(req.file.buffer), r2Key, 'audio/mpeg');
        } else {
            if (isLarge) {
                const s = new PassThrough(); s.end(req.file.buffer);
                streamUrl = await streamUploadToR2(s, r2Key, req.file.mimetype);
            } else {
                streamUrl = await uploadToStorage(req.file.buffer, r2Key, req.file.mimetype);
            }
        }

        let duration = null;
        try { duration = await getAudioDuration(req.file.buffer); } catch (_) { /* non-fatal */ }

        res.json({
            success: true, streamUrl,
            title:   title || req.file.originalname.replace(/\.[^/.]+$/, ''),
            duration,
        });

    } catch (e) {
        console.error('[merch-sample] upload error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// HELPER: COPYRIGHT DETECTION (STUB)
// ==========================================
async function detectCopyright(audioBuffer, filename) {
    return {
        detected: false, match: null, confidence: 0,
        requiresVerification: true,
        note: 'All uploads automatically flagged for manual review',
    };
}

module.exports = router;