// routes/audioAnalysis.js
//
// Server-side audio analysis using music-metadata.
// Extracts duration, codec, sampleRate, lossless flag, and any BPM/key
// tags embedded in the file.
//
// IMPORTANT: BPM and key tags are rarely present in artist files. The real
// accurate values come from the browser running Essentia WASM on the decoded
// waveform. See upload.js mergeFeatures() for how these two sources are combined.
//
// This module must NEVER throw — a bad audio file should not abort an upload.

const { parseBuffer } = require('music-metadata');

async function analyzeAudioFeatures(audioBuffer, filename) {
    try {
        console.log(`🔍 Analyzing: ${filename} (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

        const metadata = await parseBuffer(audioBuffer, {
            duration:    true,
            skipCovers:  false,
        });

        const common = metadata.common || {};
        const format = metadata.format || {};

        console.log(`📊 ${format.codec || 'unknown codec'}, ${format.duration?.toFixed(1)}s, lossless=${!!format.lossless}`);

        const { bpm, key, mode } = extractMusicalTags(common);
        const { energy, danceability, loudness } = estimateFeatures(common, format, bpm);

        const analysis = {
            // Musical features (from tags — treated as fallback, Essentia wins)
            bpm,
            key,
            mode,
            energy,
            danceability,
            loudness,
            tempo: bpm,

            // Technical (always from server — these come from the container header)
            duration:         format.duration         || 0,
            sampleRate:       format.sampleRate        || 44100,
            bitrate:          format.bitrate           || null,
            codec:            format.codec             || guessCodecFromFilename(filename),
            numberOfChannels: format.numberOfChannels  || 2,
            lossless:         format.lossless          || isLosslessFilename(filename),

            // Informational metadata
            title:   common.title  || null,
            artist:  common.artist || null,
            album:   common.album  || null,
            year:    common.year   || null,
            genre:   Array.isArray(common.genre) ? common.genre.join(', ') : (common.genre || null),
            albumArt: extractAlbumArt(common),

            // Rights metadata — music-metadata returns these inconsistently
            // so we normalise to string | null
            isrc:    normaliseStringField(common.isrc),
            label:   normaliseStringField(common.label),
            comment: normaliseStringField(common.comment),
        };

        console.log(`✅ Analysis complete: ${formatDuration(analysis.duration)}, BPM tag=${analysis.bpm || 'none'}, Key tag=${analysis.key !== 'Unknown' ? analysis.key + ' ' + analysis.mode : 'none'}`);

        return analysis;

    } catch (error) {
        console.error(`❌ Analysis failed for ${filename}: ${error.message}`);
        // Return safe defaults — an analysis failure must never abort an upload
        return safeDefaults();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MUSICAL TAG EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────
function extractMusicalTags(common) {
    // BPM: round and sanity-check (0 = not present)
    let bpm = 0;
    if (common.bpm) {
        const parsed = Math.round(parseFloat(common.bpm));
        if (!isNaN(parsed) && parsed > 0 && parsed <= 300) bpm = parsed;
    }

    // Key: music-metadata may return "Am", "A minor", "A", etc.
    let key  = 'Unknown';
    let mode = 'Unknown';

    if (common.key) {
        const raw = String(common.key).trim();

        // Pattern: "Am", "F#m", "Bbm" — short minor notation
        const shortMinor = raw.match(/^([A-G][#b]?)m$/i);
        if (shortMinor) {
            key  = shortMinor[1].charAt(0).toUpperCase() + shortMinor[1].slice(1);
            mode = 'minor';
        }
        // Pattern: "A minor", "F# major", "Bb Major"
        else if (/minor/i.test(raw)) {
            key  = raw.replace(/minor/i, '').trim();
            key  = key.charAt(0).toUpperCase() + key.slice(1);
            mode = 'minor';
        } else if (/major/i.test(raw)) {
            key  = raw.replace(/major/i, '').trim();
            key  = key.charAt(0).toUpperCase() + key.slice(1);
            mode = 'major';
        }
        // Plain note like "A", "F#", "Bb" — assume major
        else if (/^[A-G][#b]?$/.test(raw)) {
            key  = raw.charAt(0).toUpperCase() + raw.slice(1);
            mode = 'major';
        }

        // Validate — if it doesn't look like a note, discard
        if (!/^[A-G][#b]?$/.test(key)) {
            key  = 'Unknown';
            mode = 'Unknown';
        }
    }

    return { bpm, key, mode };
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE ESTIMATION
// Genre + BPM heuristics. These are rough fallbacks only —
// Essentia browser values will overwrite energy/danceability if available.
// ─────────────────────────────────────────────────────────────────────────────
function estimateFeatures(common, format, bpm) {
    let energy = 0.5, danceability = 0.5, loudness = 0;

    if (common.genre && common.genre.length > 0) {
        const g = common.genre.join(' ').toLowerCase();
        if      (g.match(/metal|punk|hardcore|thrash|death|black/))   { energy = 0.95; danceability = 0.45; loudness = 0.9; }
        else if (g.match(/rock|alternative|indie rock|grunge/))        { energy = 0.75; danceability = 0.55; loudness = 0.75; }
        else if (g.match(/techno|trance|hardstyle|drum and bass|dnb/)) { energy = 0.9;  danceability = 0.95; loudness = 0.85; }
        else if (g.match(/house|deep house|tech house/))               { energy = 0.8;  danceability = 0.9;  loudness = 0.8; }
        else if (g.match(/edm|electro|dubstep|bass/))                  { energy = 0.85; danceability = 0.85; loudness = 0.9; }
        else if (g.match(/electronic|synth|disco/))                    { energy = 0.75; danceability = 0.8;  loudness = 0.75; }
        else if (g.match(/hip hop|rap|trap|grime/))                    { energy = 0.7;  danceability = 0.8;  loudness = 0.75; }
        else if (g.match(/pop|dance pop/))                             { energy = 0.7;  danceability = 0.75; loudness = 0.7; }
        else if (g.match(/r&b|rnb|soul|funk/))                         { energy = 0.6;  danceability = 0.7;  loudness = 0.65; }
        else if (g.match(/ambient|chillout|downtempo/))                { energy = 0.25; danceability = 0.3;  loudness = 0.4; }
        else if (g.match(/classical|orchestra|symphony/))              { energy = 0.35; danceability = 0.2;  loudness = 0.5; }
        else if (g.match(/jazz|blues/))                                { energy = 0.55; danceability = 0.6;  loudness = 0.6; }
        else if (g.match(/folk|acoustic|singer-songwriter/))           { energy = 0.45; danceability = 0.4;  loudness = 0.5; }
        else if (g.match(/country/))                                   { energy = 0.5;  danceability = 0.5;  loudness = 0.6; }
        else if (g.match(/reggae|dub/))                                { energy = 0.6;  danceability = 0.75; loudness = 0.65; }
    }

    if (bpm > 0) {
        if      (bpm < 70)  { energy = Math.min(energy, 0.4);  danceability = Math.min(danceability, 0.3); }
        else if (bpm < 90)  { danceability = Math.max(danceability, 0.5); }
        else if (bpm <= 140){ danceability = Math.max(danceability, 0.75); }
        else if (bpm <= 160){ energy = Math.max(energy, 0.8);  danceability = Math.max(danceability, 0.7); }
        else if (bpm <= 180){ energy = Math.max(energy, 0.9);  danceability = Math.max(danceability, 0.6); }
        else                { energy = Math.max(energy, 0.95); danceability = Math.max(danceability, 0.5); }
    }

    if (format.bitrate) {
        if      (format.bitrate < 128000)                      loudness = Math.max(loudness - 0.1, 0);
        else if (format.bitrate > 256000 || format.lossless)   loudness = Math.min(loudness + 0.05, 1);
    }

    return {
        energy:       Math.round(energy       * 100) / 100,
        danceability: Math.round(danceability * 100) / 100,
        loudness:     Math.round(loudness     * 100) / 100,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

// music-metadata returns ISRC/label/comment as string, string[], or
// object[] depending on the format — normalise all to string | null
function normaliseStringField(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
        return value
            .map(v => (typeof v === 'object' && v !== null) ? (v.text || JSON.stringify(v)) : String(v))
            .filter(Boolean)
            .join(', ') || null;
    }
    if (typeof value === 'object') return value.text || JSON.stringify(value);
    return String(value) || null;
}

function extractAlbumArt(common) {
    if (!common.picture?.length) return null;
    try {
        const pic = common.picture[0];
        return { format: pic.format, data: pic.data.toString('base64'), description: pic.description || 'Album Art' };
    } catch { return null; }
}

function guessCodecFromFilename(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    return { mp3: 'MP3', flac: 'FLAC', wav: 'PCM', aiff: 'AIFF', aif: 'AIFF', m4a: 'AAC', mp4: 'AAC', ogg: 'OGG' }[ext] || null;
}

function isLosslessFilename(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    return ['flac', 'wav', 'aiff', 'aif', 'alac'].includes(ext);
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function safeDefaults() {
    return {
        duration: 0, sampleRate: 44100, bitrate: null, codec: null,
        numberOfChannels: 2, lossless: false,
        bpm: 0, key: 'Unknown', mode: 'Unknown', tempo: 0,
        energy: 0.5, danceability: 0.5, loudness: 0,
        albumArt: null, title: null, artist: null, album: null,
        year: null, genre: null, isrc: null, label: null, comment: null,
    };
}

async function initEssentia() {
    console.log('ℹ️  Server analysis: music-metadata tag extraction (Essentia WASM runs in browser)');
    return true;
}

module.exports = { analyzeAudioFeatures, initEssentia };