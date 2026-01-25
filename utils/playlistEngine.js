/* utils/playlistEngine.js */
const admin = require("firebase-admin");
const db = admin.firestore();

// Taxonomy constants (Same as your frontend, but server-side)
const MOOD_PROFILES = {
  'focus': {
    requiredMoods: ['focus', 'calm'],
    audioFeatures: { energy: [0.1, 0.6], instrumentalness: [0.5, 1.0] }
  },
  'workout': {
    requiredMoods: ['energetic', 'workout'],
    audioFeatures: { energy: [0.7, 1.0], tempo: [130, 180] }
  },
  'chill': {
    requiredMoods: ['chill', 'relax'],
    audioFeatures: { energy: [0.0, 0.5], valence: [0.4, 0.8] }
  }
};

class PlaylistEngine {
    
  async generate(userId, moodId) {
    try {
      const profile = MOOD_PROFILES[moodId];
      if (!profile) throw new Error("Invalid mood profile");

      // 1. QUERY: Get candidates from Firestore
      // (Admin SDK allows complex queries faster than client)
      const tracksRef = db.collection('tracks');
      const snapshot = await tracksRef
        .where('moodIds', 'array-contains-any', profile.requiredMoods)
        .where('status', '==', 'active')
        .limit(200) // Get a pool of 200 candidates
        .get();

      if (snapshot.empty) return [];

      let candidates = [];
      snapshot.forEach(doc => candidates.push({ id: doc.id, ...doc.data() }));

      // 2. FILTER & SCORE (Server-Side Logic)
      // This is your "Secret Sauce" that no one can see
      const scoredTracks = candidates.map(track => {
        let score = 0;
        
        // A. Feature Matching
        const features = track.musicProfile?.typicalFeatures || {};
        if (this.checkFeatures(features, profile.audioFeatures)) {
           score += 50; 
        }

        // B. Popularity Boost (Example)
        score += (track.stats?.playCount || 0) * 0.1;

        return { ...track, score };
      });

      // 3. SORT & SLICE
      // Sort by score and take top 50
      scoredTracks.sort((a, b) => b.score - a.score);
      const finalPlaylist = scoredTracks.slice(0, 50);

      // 4. SAVE (Optional: Cache this specific run for the user)
      // await this.saveToHistory(userId, finalPlaylist);

      return finalPlaylist;

    } catch (e) {
      console.error("Engine Error:", e);
      throw e;
    }
  }

  checkFeatures(trackFeatures, criteria) {
    // Simple range checker
    for (const [key, range] of Object.entries(criteria)) {
      if (!trackFeatures[key]) continue;
      if (trackFeatures[key] < range[0] || trackFeatures[key] > range[1]) {
        return false; 
      }
    }
    return true;
  }
}

module.exports = new PlaylistEngine();