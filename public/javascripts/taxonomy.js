// taxonomy.js - Eporia Music Classification System
// Used by: Artist Onboarding, Playlist Generator, Search Engine

export const GENRES = {
  // --- ELECTRONIC & DANCE ---
  ELECTRONIC: {
    id: 'electronic',
    name: 'Electronic / Dance',
    icon: '🎹',
    subgenres: [
      { id: 'ambient', name: 'Ambient', aliases: ['drone', 'soundscape'] },
      { id: 'bass_music', name: 'Bass Music', aliases: ['uk bass', 'future bass'] },
      { id: 'breakbeat', name: 'Breakbeat', aliases: ['breaks', 'big beat'] },
      { id: 'chillout', name: 'Chillout', aliases: ['lounge', 'downtempo'] },
      { id: 'disco', name: 'Disco', aliases: ['nu-disco', 'italo disco'] },
      { id: 'dnb', name: 'Drum & Bass', aliases: ['jungle', 'liquid', 'neurofunk'] },
      { id: 'dubstep', name: 'Dubstep', aliases: ['riddim', 'brostep', 'deep dubstep'] },
      { id: 'edm', name: 'EDM', aliases: ['festival', 'big room'] },
      { id: 'electro', name: 'Electro', aliases: ['electro house', 'complextro'] },
      { id: 'electronica', name: 'Electronica', aliases: ['idm', 'glitch'] },
      { id: 'garage', name: 'Garage', aliases: ['uk garage', '2-step', 'future garage'] },
      { id: 'hard_dance', name: 'Hard Dance', aliases: ['hardstyle', 'happy hardcore'] },
      { id: 'house', name: 'House', aliases: ['deep house', 'tech house', 'progressive house'] },
      { id: 'industrial', name: 'Industrial', aliases: ['ebm', 'aggrotech'] },
      { id: 'techno', name: 'Techno', aliases: ['minimal', 'acid', 'detroit'] },
      { id: 'trance', name: 'Trance', aliases: ['psytrance', 'uplifting', 'goa'] },
      { id: 'synthwave', name: 'Synthwave', aliases: ['vaporwave', 'retrowave', 'outrun'] },
      { id: 'trip_hop', name: 'Trip Hop', aliases: ['bristol sound'] }
    ]
  },

  // --- HIP HOP & RAP ---
  HIP_HOP: {
    id: 'hip_hop',
    name: 'Hip Hop / Rap',
    icon: '🎤',
    subgenres: [
      { id: 'alternative_rap', name: 'Alternative Hip Hop', aliases: ['experimental hip hop'] },
      { id: 'boom_bap', name: 'Boom Bap', aliases: ['golden age', 'old school'] },
      { id: 'cloud_rap', name: 'Cloud Rap', aliases: ['sad boys'] },
      { id: 'conscious', name: 'Conscious Rap', aliases: ['political rap'] },
      { id: 'drill', name: 'Drill', aliases: ['uk drill', 'ny drill', 'chicago drill'] },
      { id: 'east_coast', name: 'East Coast', aliases: ['new york rap'] },
      { id: 'gangsta', name: 'Gangsta Rap', aliases: ['g-funk'] },
      { id: 'grime', name: 'Grime', aliases: ['uk grime'] },
      { id: 'lo_fi', name: 'Lo-Fi Hip Hop', aliases: ['chillhop', 'study beats'] },
      { id: 'mumble_rap', name: 'Mumble Rap', aliases: ['soundcloud rap'] },
      { id: 'trap', name: 'Trap', aliases: ['southern rap', 'dirty south'] },
      { id: 'west_coast', name: 'West Coast', aliases: ['cali rap'] },
      { id: 'latin_urban', name: 'Latin Urban', aliases: ['reggaeton', 'latin trap'] }
    ]
  },

  // --- ROCK & ALTERNATIVE ---
  ROCK: {
    id: 'rock',
    name: 'Rock',
    icon: '🎸',
    subgenres: [
      { id: 'alternative_rock', name: 'Alternative Rock', aliases: ['alt rock'] },
      { id: 'blues_rock', name: 'Blues Rock', aliases: [] },
      { id: 'classic_rock', name: 'Classic Rock', aliases: [] },
      { id: 'emo', name: 'Emo', aliases: ['screamo', 'midwest emo'] },
      { id: 'garage_rock', name: 'Garage Rock', aliases: [] },
      { id: 'grunge', name: 'Grunge', aliases: ['seattle sound'] },
      { id: 'hard_rock', name: 'Hard Rock', aliases: [] },
      { id: 'indie_rock', name: 'Indie Rock', aliases: ['indie'] },
      { id: 'math_rock', name: 'Math Rock', aliases: [] },
      { id: 'metal', name: 'Metal', aliases: ['heavy metal', 'death metal', 'black metal', 'metalcore'] },
      { id: 'pop_punk', name: 'Pop Punk', aliases: [] },
      { id: 'post_punk', name: 'Post Punk', aliases: ['new wave', 'dark wave'] },
      { id: 'post_rock', name: 'Post Rock', aliases: ['instrumental rock'] },
      { id: 'progressive_rock', name: 'Prog Rock', aliases: ['art rock'] },
      { id: 'psychedelic', name: 'Psychedelic Rock', aliases: ['psych rock'] },
      { id: 'punk', name: 'Punk', aliases: ['hardcore punk'] },
      { id: 'shoegaze', name: 'Shoegaze', aliases: ['dream pop'] },
      { id: 'soft_rock', name: 'Soft Rock', aliases: ['yacht rock'] },
      { id: 'surf_rock', name: 'Surf Rock', aliases: [] }
    ]
  },

  // --- POP ---
  POP: {
    id: 'pop',
    name: 'Pop',
    icon: '✨',
    subgenres: [
      { id: 'acoustic_pop', name: 'Acoustic Pop', aliases: ['singer-songwriter'] },
      { id: 'art_pop', name: 'Art Pop', aliases: [] },
      { id: 'bedroom_pop', name: 'Bedroom Pop', aliases: ['diy pop'] },
      { id: 'dance_pop', name: 'Dance Pop', aliases: [] },
      { id: 'dream_pop', name: 'Dream Pop', aliases: [] },
      { id: 'electropop', name: 'Electropop', aliases: ['synthpop'] },
      { id: 'hyperpop', name: 'Hyperpop', aliases: ['pc music'] },
      { id: 'indie_pop', name: 'Indie Pop', aliases: ['twee'] },
      { id: 'j_pop', name: 'J-Pop', aliases: ['japanese pop'] },
      { id: 'k_pop', name: 'K-Pop', aliases: ['korean pop'] },
      { id: 'latin_pop', name: 'Latin Pop', aliases: [] },
      { id: 'pop_rock', name: 'Pop Rock', aliases: [] }
    ]
  },

  // --- R&B & SOUL ---
  RNB: {
    id: 'rnb',
    name: 'R&B / Soul',
    icon: '❤️',
    subgenres: [
      { id: 'alternative_rnb', name: 'Alternative R&B', aliases: ['pbr&b'] },
      { id: 'contemporary_rnb', name: 'Contemporary R&B', aliases: [] },
      { id: 'doo_wop', name: 'Doo Wop', aliases: [] },
      { id: 'funk', name: 'Funk', aliases: ['p-funk'] },
      { id: 'gospel', name: 'Gospel', aliases: [] },
      { id: 'motown', name: 'Motown', aliases: ['northern soul'] },
      { id: 'neo_soul', name: 'Neo Soul', aliases: [] },
      { id: 'soul', name: 'Soul', aliases: ['classic soul'] },
      { id: 'quiet_storm', name: 'Quiet Storm', aliases: [] }
    ]
  },

  // --- JAZZ & BLUES ---
  JAZZ: {
    id: 'jazz',
    name: 'Jazz / Blues',
    icon: '🎷',
    subgenres: [
      { id: 'acid_jazz', name: 'Acid Jazz', aliases: [] },
      { id: 'avant_garde_jazz', name: 'Avant-Garde Jazz', aliases: ['free jazz'] },
      { id: 'bebop', name: 'Bebop', aliases: ['hard bop'] },
      { id: 'big_band', name: 'Big Band', aliases: ['swing'] },
      { id: 'blues', name: 'Blues', aliases: ['chicago blues', 'delta blues'] },
      { id: 'cool_jazz', name: 'Cool Jazz', aliases: [] },
      { id: 'fusion', name: 'Jazz Fusion', aliases: [] },
      { id: 'latin_jazz', name: 'Latin Jazz', aliases: ['bossa nova'] },
      { id: 'nu_jazz', name: 'Nu Jazz', aliases: ['electro-swing'] },
      { id: 'smooth_jazz', name: 'Smooth Jazz', aliases: [] }
    ]
  },

  // --- COUNTRY & FOLK ---
  COUNTRY: {
    id: 'country',
    name: 'Country / Folk',
    icon: '🤠',
    subgenres: [
      { id: 'alt_country', name: 'Alt-Country', aliases: ['americana'] },
      { id: 'bluegrass', name: 'Bluegrass', aliases: [] },
      { id: 'contemporary_country', name: 'Contemporary Country', aliases: ['pop country'] },
      { id: 'folk', name: 'Folk', aliases: ['traditional folk', 'contemporary folk'] },
      { id: 'indie_folk', name: 'Indie Folk', aliases: [] },
      { id: 'outlaw_country', name: 'Outlaw Country', aliases: [] },
      { id: 'rockabilly', name: 'Rockabilly', aliases: [] }
    ]
  },

  // --- REGGAE & CARIBBEAN ---
  REGGAE: {
    id: 'reggae',
    name: 'Reggae / Caribbean',
    icon: '🏝️',
    subgenres: [
      { id: 'afrobeats', name: 'Afrobeats', aliases: ['afro-pop'] },
      { id: 'dancehall', name: 'Dancehall', aliases: [] },
      { id: 'dub', name: 'Dub', aliases: [] },
      { id: 'lovers_rock', name: 'Lovers Rock', aliases: [] },
      { id: 'reggaeton', name: 'Reggaeton', aliases: ['urbano'] },
      { id: 'roots_reggae', name: 'Roots Reggae', aliases: [] },
      { id: 'ska', name: 'Ska', aliases: ['rocksteady'] },
      { id: 'soca', name: 'Soca', aliases: ['calypso'] }
    ]
  },

  // --- CLASSICAL & ORCHESTRAL ---
  CLASSICAL: {
    id: 'classical',
    name: 'Classical',
    icon: '🎻',
    subgenres: [
      { id: 'baroque', name: 'Baroque', aliases: [] },
      { id: 'chamber', name: 'Chamber Music', aliases: [] },
      { id: 'choral', name: 'Choral', aliases: [] },
      { id: 'contemporary_classical', name: 'Contemporary Classical', aliases: ['modern classical'] },
      { id: 'film_score', name: 'Film Score', aliases: ['soundtrack', 'cinematic'] },
      { id: 'minimalism', name: 'Minimalism', aliases: [] },
      { id: 'opera', name: 'Opera', aliases: [] },
      { id: 'romantic', name: 'Romantic', aliases: [] },
      { id: 'symphonic', name: 'Symphonic', aliases: ['orchestral'] }
    ]
  }
};

// --- MOOD & ACTIVITY TAGS ---
// Used for the "Vibe" matching in PlaylistGenerator
export const MOODS = {
  energy: [
    { id: 'energetic', name: 'High Energy', emoji: '⚡', category: 'energy' },
    { id: 'chill', name: 'Chill / Mellow', emoji: '😌', category: 'energy' },
    { id: 'calm', name: 'Calm / Peaceful', emoji: '🌊', category: 'energy' },
    { id: 'intense', name: 'Aggressive / Intense', emoji: '🔥', category: 'energy' },
    { id: 'bouncy', name: 'Bouncy / Upbeat', emoji: '🤸', category: 'energy' }
  ],
  
  emotion: [
    { id: 'happy', name: 'Happy / Feel Good', emoji: '😊', category: 'emotion' },
    { id: 'sad', name: 'Sad / Melancholic', emoji: '🌧️', category: 'emotion' },
    { id: 'romantic', name: 'Romantic / Love', emoji: '💕', category: 'emotion' },
    { id: 'dark', name: 'Dark / Eerie', emoji: '🌑', category: 'emotion' },
    { id: 'nostalgic', name: 'Nostalgic', emoji: '📼', category: 'emotion' },
    { id: 'dreamy', name: 'Dreamy / Ethereal', emoji: '☁️', category: 'emotion' },
    { id: 'confident', name: 'Confident / Swagger', emoji: '😎', category: 'emotion' }
  ],
  
  activity: [
    { id: 'workout', name: 'Workout / Gym', emoji: '💪', category: 'activity' },
    { id: 'party', name: 'Party / Club', emoji: '🎉', category: 'activity' },
    { id: 'focus', name: 'Focus / Study', emoji: '🧠', category: 'activity' },
    { id: 'sleep', name: 'Sleep', emoji: '😴', category: 'activity' },
    { id: 'gaming', name: 'Gaming', emoji: '🎮', category: 'activity' },
    { id: 'driving', name: 'Driving', emoji: '🚗', category: 'activity' },
    { id: 'meditation', name: 'Meditation / Yoga', emoji: '🧘', category: 'activity' }
  ]
};

// --- AUDIO FEATURE RANGES ---
// Used by PlaylistEngine to map user sliders to database queries
export const AUDIO_FEATURES = {
  // Tempo-based
  tempo: {
    slow: { min: 0, max: 90, label: 'Slow (<90 BPM)' },
    medium: { min: 90, max: 130, label: 'Medium (90-130 BPM)' },
    fast: { min: 130, max: 300, label: 'Fast (>130 BPM)' }
  },
  
  // Energy (0.0 to 1.0)
  energy: {
    low: { min: 0, max: 0.4, label: 'Low Energy' },
    medium: { min: 0.4, max: 0.7, label: 'Medium Energy' },
    high: { min: 0.7, max: 1.0, label: 'High Energy' }
  },
  
  // Valence (Musical Positivity - 0.0 to 1.0)
  valence: {
    sad: { min: 0, max: 0.4, label: 'Sad / Dark' },
    neutral: { min: 0.4, max: 0.7, label: 'Neutral' },
    happy: { min: 0.7, max: 1.0, label: 'Happy / Bright' }
  },
  
  // Danceability (0.0 to 1.0)
  danceability: {
    low: { min: 0, max: 0.4, label: 'Not Danceable' },
    high: { min: 0.7, max: 1.0, label: 'Very Danceable' }
  },
  
  // Acousticness (0.0 to 1.0)
  acousticness: {
    electronic: { min: 0, max: 0.3, label: 'Electronic' },
    acoustic: { min: 0.7, max: 1.0, label: 'Acoustic' }
  }
};

// --- PRESET MOOD PROFILES ---
// Used by the Backend Engine to generate quick mixes
export const MOOD_PROFILES = {
  'focus': {
    requiredMoods: ['focus', 'calm'],
    audioFeatures: { 
        energy: [0.0, 0.5], 
        valence: [0.3, 0.7], 
        instrumentalness: [0.5, 1.0] // Prefer instrumental
    },
    preferredGenres: ['ambient', 'lo_fi', 'classical', 'post_rock']
  },
  
  'workout': {
    requiredMoods: ['workout', 'energetic', 'intense'],
    audioFeatures: { 
        energy: [0.7, 1.0], 
        tempo: [120, 180] 
    },
    preferredGenres: ['edm', 'hip_hop', 'rock', 'trap']
  },
  
  'party': {
    requiredMoods: ['party', 'bouncy', 'happy'],
    audioFeatures: { 
        danceability: [0.7, 1.0], 
        energy: [0.6, 1.0] 
    },
    preferredGenres: ['pop', 'hip_hop', 'edm', 'reggaeton', 'house']
  },
  
  'chill': {
    requiredMoods: ['chill', 'relax', 'calm'],
    audioFeatures: { 
        energy: [0.0, 0.6], 
        tempo: [60, 110] 
    },
    preferredGenres: ['lo_fi', 'rnb', 'indie_pop', 'reggae', 'acoustic_pop']
  },
  
  'sleep': {
    requiredMoods: ['sleep', 'calm', 'dreamy'],
    audioFeatures: { 
        energy: [0.0, 0.3], 
        loudness: [-60, -15] // Quiet tracks
    },
    preferredGenres: ['ambient', 'classical', 'nature_sounds']
  }
};