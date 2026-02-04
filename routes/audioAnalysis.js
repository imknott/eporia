// routes/audioAnalysis.js - Stable Version (No Crashes)
const { parseBuffer } = require('music-metadata');

async function analyzeAudioFeatures(audioBuffer, filename) {
    try {
        console.log(`🎵 Analyzing Metadata: ${filename}`);
        
        // This runs safely on ANY server (Local or Production)
        const metadata = await parseBuffer(audioBuffer);
        const common = metadata.common || {};
        
        return {
            bpm: Math.round(common.bpm) || 0,
            key: common.key || 'Unknown',
            mode: 'Unknown',
            energy: 0,
            danceability: 0,
            duration: metadata.format.duration || 0,
            note: 'Metadata analysis (Safe Mode)'
        };

    } catch (error) {
        console.error(`  ✗ Analysis Failed: ${error.message}`);
        // Return defaults so the upload NEVER fails
        return { bpm: 0, key: 'Unknown', mode: 'Unknown', energy: 0, danceability: 0, duration: 0 };
    }
}

module.exports = { analyzeAudioFeatures };