// routes/audioAnalysis.js
//
// Server-side audio analysis using:
//   - Essentia.js Node WASM build  →  BPM, key, energy, danceability
//   - music-metadata               →  duration, codec, sampleRate, lossless, tags
//   - FFmpeg                       →  PCM decode (feeds raw samples to Essentia)
//
// ── Why server-side Essentia instead of browser? ─────────────────────────────
// The CDN browser build uses new Function() for Emscripten error naming, which
// is blocked by CSP without unsafe-eval. The Node WASM build compiles natively —
// no eval, no CSP issues, consistent results on every upload regardless of
// what browser the artist is using.
//
// ── Pipeline ─────────────────────────────────────────────────────────────────
//   1. music-metadata: container facts (duration, codec, lossless, tags)
//   2. FFmpeg: decode audio → mono 44.1kHz f32le PCM buffer
//   3. Essentia: RhythmExtractor2013 → BPM
//              KeyExtractor         → key + mode
//              Energy               → energy
//              Danceability         → danceability
//
// ── Safety ───────────────────────────────────────────────────────────────────
// This module must NEVER throw. Any failure returns safe defaults so that a
// bad audio file never aborts an upload.

'use strict';

const { parseBuffer }  = require('music-metadata');
const ffmpeg           = require('fluent-ffmpeg');
const ffmpegPath       = require('@ffmpeg-installer/ffmpeg').path;
const { PassThrough }  = require('stream');

ffmpeg.setFfmpegPath(ffmpegPath);

// ── Essentia singleton ───────────────────────────────────────────────────────
// Load once at module init, reuse across all analysis calls.
// The WASM module is heavy (~10MB) — initialising per-call would be wasteful.
let essentiaInstance  = null;
let essentiaInitError = null;

async function getEssentia() {
    if (essentiaInstance)  return essentiaInstance;
    if (essentiaInitError) throw essentiaInitError;

    try {
        // 1. Require the main package (bundles both core and WASM for Node)
        const esPkg = require('essentia.js');
        
        // 2. Initialize synchronously. EssentiaWASM is a loaded object, not a function.
        essentiaInstance = new esPkg.Essentia(esPkg.EssentiaWASM);
        
        console.log('✅ Essentia.js Node WASM loaded successfully');
        return essentiaInstance;
    } catch (err) {
        essentiaInitError = err;
        console.error('❌ Essentia.js failed to load:', err.message);
        throw err;
    }
}

// Pre-warm at startup so the first upload isn't slow
getEssentia().catch(() => {});

// ── PCM decode ───────────────────────────────────────────────────────────────
// Decodes any audio format to mono 44.1kHz 32-bit float raw PCM.
// This is exactly what the browser Web Audio API produced for Essentia WASM —
// same input, same output.
function decodeToFloat32PCM(audioBuffer) {
    return new Promise((resolve, reject) => {
        const input  = new PassThrough();
        input.end(audioBuffer);

        const chunks = [];
        const output = new PassThrough();

        ffmpeg(input)
            .audioChannels(1)       // mono — Essentia algorithms expect mono
            .audioFrequency(44100)  // standard analysis rate
            .audioCodec('pcm_f32le')
            .format('f32le')
            .on('error', err => reject(new Error(`PCM decode failed: ${err.message}`)))
            .pipe(output, { end: true });

        output.on('data',  chunk => chunks.push(chunk));
        output.on('end',   () => resolve(Buffer.concat(chunks)));
        output.on('error', reject);
    });
}

// ── Main analysis ─────────────────────────────────────────────────────────────
async function analyzeAudioFeatures(audioBuffer, filename) {
    try {
        console.log(`🔍 Analyzing: ${filename} (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

        // ── Step 1: music-metadata (container facts + tag fallbacks) ─────────
        const metadata = await parseBuffer(audioBuffer, {
            duration:   true,
            skipCovers: false,
        });

        const common = metadata.common || {};
        const format = metadata.format || {};

        console.log(`📊 ${format.codec || 'unknown codec'}, ${format.duration?.toFixed(1)}s, lossless=${!!format.lossless}`);

        // ── Step 2: tag extraction (fallback values only) ────────────────────
        const tagFeatures = extractMusicalTags(common);

        // ── Step 3: Essentia signal analysis ─────────────────────────────────
        let essentiaFeatures = null;
        try {
            const essentia = await getEssentia();

            // Decode to raw PCM for Essentia
            const pcmBuffer  = await decodeToFloat32PCM(audioBuffer);
            const float32arr = new Float32Array(
                pcmBuffer.buffer,
                pcmBuffer.byteOffset,
                pcmBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
            );

            essentiaFeatures = await runEssentiaAlgorithms(essentia, float32arr);
            console.log(
                `🎵 Essentia: BPM=${essentiaFeatures.bpm}, ` +
                `Key=${essentiaFeatures.key} ${essentiaFeatures.mode}, ` +
                `Energy=${essentiaFeatures.energy}`
            );
        } catch (essentiaErr) {
            // Non-fatal — fall back to tag data and genre heuristics
            console.warn(`⚠ Essentia analysis failed for ${filename}: ${essentiaErr.message}`);
        }

        // ── Step 4: merge — Essentia wins for perceptual features ────────────
        const bpm          = (essentiaFeatures?.bpm  > 0)                          ? essentiaFeatures.bpm          : tagFeatures.bpm;
        const key          = (essentiaFeatures?.key  && essentiaFeatures.key  !== 'Unknown') ? essentiaFeatures.key  : tagFeatures.key;
        const mode         = (essentiaFeatures?.mode && essentiaFeatures.mode !== 'Unknown') ? essentiaFeatures.mode : tagFeatures.mode;
        const energy       = essentiaFeatures?.energy       ?? tagFeatures.energy;
        const danceability = essentiaFeatures?.danceability ?? tagFeatures.danceability;
        const loudness     = essentiaFeatures?.loudness     ?? tagFeatures.loudness;

        const analysis = {
            // Perceptual features — Essentia signal processing
            bpm,
            key,
            mode,
            energy,
            danceability,
            loudness,
            tempo: bpm,

            // Container facts — always from music-metadata (file header)
            duration:         format.duration         || 0,
            sampleRate:       format.sampleRate        || 44100,
            bitrate:          format.bitrate           || null,
            codec:            format.codec             || guessCodecFromFilename(filename),
            numberOfChannels: format.numberOfChannels  || 2,
            lossless:         format.lossless          || isLosslessFilename(filename),

            // Informational metadata from tags
            title:   common.title  || null,
            artist:  common.artist || null,
            album:   common.album  || null,
            year:    common.year   || null,
            genre:   Array.isArray(common.genre) ? common.genre.join(', ') : (common.genre || null),
            albumArt: extractAlbumArt(common),
            isrc:    normaliseStringField(common.isrc),
            label:   normaliseStringField(common.label),
            comment: normaliseStringField(common.comment),
        };

        console.log(
            `✅ Analysis complete: ${formatDuration(analysis.duration)}, ` +
            `BPM=${analysis.bpm || 'none'}, Key=${analysis.key !== 'Unknown' ? analysis.key + ' ' + analysis.mode : 'none'}`
        );

        return analysis;

    } catch (error) {
        console.error(`❌ Analysis failed for ${filename}: ${error.message}`);
        return safeDefaults();
    }
}

// ── Essentia algorithms ───────────────────────────────────────────────────────
async function runEssentiaAlgorithms(essentia, float32arr) {
    // Essentia expects its own vector type
    const signal = essentia.arrayToVector(float32arr);

    // ── BPM: RhythmExtractor2013 ─────────────────────────────────────────────
    // Most accurate beat tracker in Essentia — uses multi-feature approach
    // combining spectral flux, complex domain onset, and HFC.
    let bpm = 0;
    try {
        const rhythm = essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40);
        bpm = Math.round(rhythm.bpm);
        // Sanity check — discard if out of musical range
        if (bpm < 40 || bpm > 220) bpm = 0;
    } catch (e) {
        console.warn('⚠ RhythmExtractor2013 failed:', e.message);
    }

    // ── Key + Mode: KeyExtractor ─────────────────────────────────────────────
    // Uses HPCP (Harmonic Pitch Class Profile) chroma features — the same
    // algorithm used in professional DJ software.
    // ── Key + Mode: KeyExtractor ─────────────────────────────────────────────
    let key  = 'Unknown';
    let mode = 'Unknown';
    try {
        // Just pass the signal. Essentia automatically defaults to 'bgate'
        // and the optimal window sizes for mixed-genre music.
        const keyResult = essentia.KeyExtractor(signal);
        
        key  = keyResult.key;
        mode = keyResult.scale;  // Essentia returns 'major' or 'minor'
    } catch (e) {
        console.warn('⚠ KeyExtractor failed:', e.message);
    }
    // ── Energy ───────────────────────────────────────────────────────────────
    // Essentia Energy: mean square of the signal samples, normalised 0-1.
    let energy = 0.5;
    try {
        const energyResult = essentia.Energy(signal);
        // Raw energy values are very small floats — normalise to 0–1 range
        // using a log scale that maps typical music energy to readable values
        const rawEnergy = energyResult.energy;
        energy = Math.min(1, Math.max(0, Math.log10(rawEnergy * 1000 + 1) / 3));
        energy = Math.round(energy * 100) / 100;
    } catch (e) {
        console.warn('⚠ Energy algorithm failed:', e.message);
    }

    // ── Danceability ─────────────────────────────────────────────────────────
    // Essentia's Danceability algorithm uses a combination of detrended
    // fluctuation analysis of the energy envelope — proper signal processing,
    // not a genre lookup table.
    let danceability = 0.5;
    try {
        const danceResult = essentia.Danceability(signal);
        // Essentia returns a value roughly 0–3, normalise to 0–1
        danceability = Math.min(1, Math.max(0, danceResult.danceability / 3));
        danceability = Math.round(danceability * 100) / 100;
    } catch (e) {
        console.warn('⚠ Danceability algorithm failed:', e.message);
    }

    // ── Loudness (RMS) ────────────────────────────────────────────────────────
    // Note: For the mastering chain the authoritative loudness measurement
    // comes from FFmpeg's loudnorm two-pass. This is a lightweight RMS
    // estimate used only for the song metadata loudness field.
    let loudness = 0;
    try {
        const rmsResult = essentia.RMS(signal);
        // Convert RMS amplitude to dBFS — typical music: -20 to -3 dBFS
        const dBFS  = 20 * Math.log10(Math.max(rmsResult.rms, 1e-10));
        // Normalise to 0–1 range (0 = very quiet, 1 = very loud)
        loudness = Math.min(1, Math.max(0, (dBFS + 60) / 60));
        loudness = Math.round(loudness * 100) / 100;
    } catch (e) {
        console.warn('⚠ RMS algorithm failed:', e.message);
    }

    // Free the Essentia vector to prevent WASM heap growth across many uploads
    signal.delete();

    return { bpm, key, mode, energy, danceability, loudness };
}

// ── Tag extraction (fallback only) ───────────────────────────────────────────
// These values are used ONLY if Essentia fails. Essentia results always win.
function extractMusicalTags(common) {
    let bpm = 0;
    if (common.bpm) {
        const parsed = Math.round(parseFloat(common.bpm));
        if (!isNaN(parsed) && parsed > 0 && parsed <= 300) bpm = parsed;
    }

    let key = 'Unknown', mode = 'Unknown';
    if (common.key) {
        const raw = String(common.key).trim();
        const shortMinor = raw.match(/^([A-G][#b]?)m$/i);
        if (shortMinor) {
            key = shortMinor[1].charAt(0).toUpperCase() + shortMinor[1].slice(1);
            mode = 'minor';
        } else if (/minor/i.test(raw)) {
            key = raw.replace(/minor/i, '').trim();
            key = key.charAt(0).toUpperCase() + key.slice(1);
            mode = 'minor';
        } else if (/major/i.test(raw)) {
            key = raw.replace(/major/i, '').trim();
            key = key.charAt(0).toUpperCase() + key.slice(1);
            mode = 'major';
        } else if (/^[A-G][#b]?$/.test(raw)) {
            key = raw.charAt(0).toUpperCase() + raw.slice(1);
            mode = 'major';
        }
        if (!/^[A-G][#b]?$/.test(key)) { key = 'Unknown'; mode = 'Unknown'; }
    }

    // Genre heuristics for energy/danceability when Essentia is unavailable
    const { energy, danceability, loudness } = estimateFromGenre(common);

    return { bpm, key, mode, energy, danceability, loudness };
}

function estimateFromGenre(common) {
    let energy = 0.5, danceability = 0.5, loudness = 0;
    if (common.genre?.length > 0) {
        const g = common.genre.join(' ').toLowerCase();
        if      (g.match(/metal|punk|hardcore/))                       { energy = 0.95; danceability = 0.45; loudness = 0.9; }
        else if (g.match(/techno|trance|drum and bass|dnb/))           { energy = 0.9;  danceability = 0.95; loudness = 0.85; }
        else if (g.match(/house|deep house|tech house/))               { energy = 0.8;  danceability = 0.9;  loudness = 0.8; }
        else if (g.match(/edm|electro|dubstep/))                       { energy = 0.85; danceability = 0.85; loudness = 0.9; }
        else if (g.match(/hip hop|rap|trap/))                          { energy = 0.7;  danceability = 0.8;  loudness = 0.75; }
        else if (g.match(/pop|dance pop/))                             { energy = 0.7;  danceability = 0.75; loudness = 0.7; }
        else if (g.match(/r&b|rnb|soul/))                              { energy = 0.6;  danceability = 0.7;  loudness = 0.65; }
        else if (g.match(/ambient|chillout|downtempo/))                { energy = 0.25; danceability = 0.3;  loudness = 0.4; }
        else if (g.match(/classical|orchestra/))                       { energy = 0.35; danceability = 0.2;  loudness = 0.5; }
        else if (g.match(/jazz|blues/))                                { energy = 0.55; danceability = 0.6;  loudness = 0.6; }
        else if (g.match(/folk|acoustic/))                             { energy = 0.45; danceability = 0.4;  loudness = 0.5; }
    }
    return { energy, danceability, loudness };
}

// ── Utilities ────────────────────────────────────────────────────────────────

function normaliseStringField(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
        return value.map(v => (typeof v === 'object' && v !== null) ? (v.text || JSON.stringify(v)) : String(v))
            .filter(Boolean).join(', ') || null;
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
    return ['flac', 'wav', 'aiff', 'aif', 'alac'].includes((filename || '').split('.').pop().toLowerCase());
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
    try {
        await getEssentia();
        console.log('✅ Essentia.js ready (Node WASM — BPM + key analysis active)');
        return true;
    } catch (err) {
        console.warn('⚠ Essentia.js unavailable — falling back to tag extraction:', err.message);
        return false;
    }
}

module.exports = { analyzeAudioFeatures, initEssentia };