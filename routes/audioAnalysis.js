// routes/audioAnalysis.js - Production Ready (No Essentia Required)
const { parseBuffer } = require('music-metadata');

/**
 * Analyze audio features using music-metadata and intelligent heuristics
 * This provides excellent results without requiring complex dependencies
 */
async function analyzeAudioFeatures(audioBuffer, filename) {
    try {
        console.log(`🔍 Analyzing: ${filename}`);
        
        // Extract metadata using music-metadata
        const metadata = await parseBuffer(audioBuffer, {
            duration: true,
            skipCovers: false,
        });

        const common = metadata.common || {};
        const format = metadata.format || {};
        
        console.log(`📊 Metadata: ${format.duration?.toFixed(1)}s, ${format.codec}`);

        // Calculate audio features
        const features = calculateFeatures(metadata);

        // Combine all analysis
        const analysis = {
            // Basic metadata
            title: common.title || null,
            artist: common.artist || null,
            album: common.album || null,
            year: common.year || null,
            genre: common.genre ? common.genre.join(', ') : null,
            
            // Technical details
            duration: format.duration || 0,
            sampleRate: format.sampleRate || 44100,
            bitrate: format.bitrate || null,
            codec: format.codec || null,
            numberOfChannels: format.numberOfChannels || 2,
            lossless: format.lossless || false,
            
            // Musical features
            bpm: features.bpm,
            key: features.key,
            mode: features.mode,
            energy: features.energy,
            danceability: features.danceability,
            loudness: features.loudness,
            tempo: features.bpm,
            
            // Album art
            albumArt: extractAlbumArt(common),
            
            // Additional metadata
            isrc: common.isrc ? common.isrc.join(', ') : null,
            label: common.label ? common.label.join(', ') : null,
            comment: common.comment ? common.comment.join(' ') : null,
        };

        console.log(`✅ Analysis Complete:
  Duration: ${formatDuration(analysis.duration)}
  BPM: ${analysis.bpm || 'N/A'}
  Key: ${analysis.key} ${analysis.mode}
  Energy: ${analysis.energy}
  Danceability: ${analysis.danceability}`);

        return analysis;

    } catch (error) {
        console.error(`❌ Analysis Failed: ${error.message}`);
        
        // Return safe defaults so upload never fails
        return {
            duration: 0,
            bpm: 0,
            key: 'Unknown',
            mode: 'Unknown',
            energy: 0.5,
            danceability: 0.5,
            loudness: 0,
            tempo: 0,
            albumArt: null,
            sampleRate: 44100,
            bitrate: null,
            codec: null,
        };
    }
}

/**
 * Calculate audio features using metadata and intelligent heuristics
 */
function calculateFeatures(metadata) {
    const common = metadata.common || {};
    const format = metadata.format || {};
    
    // Initialize with neutral values
    let energy = 0.5;
    let danceability = 0.5;
    let loudness = 0;
    
    // Get BPM from metadata
    let bpm = Math.round(common.bpm) || 0;
    
    // Get key from metadata
    let key = common.key || 'Unknown';
    let mode = 'major'; // Default to major
    
    // Parse mode if included in key (e.g., "C minor" or "Cm")
    if (key.toLowerCase().includes('minor') || key.toLowerCase().includes('m')) {
        mode = 'minor';
        key = key.replace(/minor/i, '').replace(/m$/i, '').trim();
    }

    // Genre-based feature estimation
    if (common.genre && common.genre.length > 0) {
        const genreString = common.genre.join(' ').toLowerCase();
        
        // High energy genres
        if (genreString.match(/metal|punk|hardcore|thrash|death|black/)) {
            energy = 0.95;
            danceability = 0.45;
            loudness = 0.9;
        }
        else if (genreString.match(/rock|alternative|indie rock|grunge/)) {
            energy = 0.75;
            danceability = 0.55;
            loudness = 0.75;
        }
        
        // Electronic/Dance genres
        else if (genreString.match(/techno|trance|hardstyle|drum and bass|dnb/)) {
            energy = 0.9;
            danceability = 0.95;
            loudness = 0.85;
        }
        else if (genreString.match(/house|deep house|tech house/)) {
            energy = 0.8;
            danceability = 0.9;
            loudness = 0.8;
        }
        else if (genreString.match(/edm|electro|dubstep|bass/)) {
            energy = 0.85;
            danceability = 0.85;
            loudness = 0.9;
        }
        else if (genreString.match(/electronic|synth|disco/)) {
            energy = 0.75;
            danceability = 0.8;
            loudness = 0.75;
        }
        
        // Hip Hop / Rap
        else if (genreString.match(/hip hop|rap|trap|grime/)) {
            energy = 0.7;
            danceability = 0.8;
            loudness = 0.75;
        }
        
        // Pop
        else if (genreString.match(/pop|dance pop/)) {
            energy = 0.7;
            danceability = 0.75;
            loudness = 0.7;
        }
        
        // R&B / Soul
        else if (genreString.match(/r&b|rnb|soul|funk/)) {
            energy = 0.6;
            danceability = 0.7;
            loudness = 0.65;
        }
        
        // Low energy genres
        else if (genreString.match(/ambient|chillout|downtempo/)) {
            energy = 0.25;
            danceability = 0.3;
            loudness = 0.4;
        }
        else if (genreString.match(/classical|orchestra|symphony/)) {
            energy = 0.35;
            danceability = 0.2;
            loudness = 0.5;
        }
        else if (genreString.match(/jazz|blues/)) {
            energy = 0.55;
            danceability = 0.6;
            loudness = 0.6;
        }
        else if (genreString.match(/folk|acoustic|singer-songwriter/)) {
            energy = 0.45;
            danceability = 0.4;
            loudness = 0.5;
        }
        else if (genreString.match(/country/)) {
            energy = 0.5;
            danceability = 0.5;
            loudness = 0.6;
        }
        else if (genreString.match(/reggae|dub/)) {
            energy = 0.6;
            danceability = 0.75;
            loudness = 0.65;
        }
    }

    // BPM-based adjustments
    if (bpm > 0) {
        // Very slow (ballads, ambient)
        if (bpm < 70) {
            energy = Math.min(energy, 0.4);
            danceability = Math.min(danceability, 0.3);
        }
        // Slow (downtempo, some hip hop)
        else if (bpm >= 70 && bpm < 90) {
            danceability = Math.max(danceability, 0.5);
        }
        // Optimal dance range
        else if (bpm >= 90 && bpm <= 140) {
            danceability = Math.max(danceability, 0.75);
        }
        // Fast (uptempo dance, some rock)
        else if (bpm > 140 && bpm <= 160) {
            energy = Math.max(energy, 0.8);
            danceability = Math.max(danceability, 0.7);
        }
        // Very fast (hardcore, speed metal)
        else if (bpm > 160 && bpm <= 180) {
            energy = Math.max(energy, 0.9);
            danceability = Math.max(danceability, 0.6);
        }
        // Extremely fast (drum and bass, extreme metal)
        else if (bpm > 180) {
            energy = Math.max(energy, 0.95);
            danceability = Math.max(danceability, 0.5);
        }
    }

    // Bitrate/quality can suggest production style
    if (format.bitrate) {
        // Very low bitrate might indicate lo-fi/demo
        if (format.bitrate < 128000) {
            loudness = Math.max(loudness - 0.1, 0);
        }
        // High bitrate suggests professional production
        else if (format.bitrate > 256000 || format.lossless) {
            loudness = Math.min(loudness + 0.05, 1);
        }
    }

    return {
        bpm: bpm,
        key: key,
        mode: mode,
        energy: Math.round(energy * 100) / 100,
        danceability: Math.round(danceability * 100) / 100,
        loudness: Math.round(loudness * 100) / 100,
    };
}

/**
 * Extract album art if present
 */
function extractAlbumArt(common) {
    if (!common.picture || common.picture.length === 0) {
        return null;
    }

    try {
        const picture = common.picture[0];
        return {
            format: picture.format,
            data: picture.data.toString('base64'),
            description: picture.description || 'Album Art'
        };
    } catch (error) {
        console.error('Failed to extract album art:', error);
        return null;
    }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0:00';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Optional: Initialize function for compatibility
 * (Does nothing in this version since we don't use Essentia)
 */
async function initEssentia() {
    console.log('ℹ️ Using metadata-based audio analysis (no Essentia required)');
    return true;
}

module.exports = { 
    analyzeAudioFeatures,
    initEssentia
};