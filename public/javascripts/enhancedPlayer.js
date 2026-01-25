/* public/javascripts/enhancedPlayer.js */
import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import * as Tone from 'https://cdn.skypack.dev/tone';
import { MOODS } from '/javascripts/taxonomy.js';

const auth = getAuth();

/* public/javascripts/enhancedPlayer.js */

// --- DATA: LOCATIONS ---

// --- DATA: STATE NEIGHBORS ---
const STATE_CITIES = {
    // --- WEST ---
    'California': [
        { id: 'sd', name: 'San Diego', emoji: '🌊', color: 200 },
        { id: 'la', name: 'Los Angeles', emoji: '🌴', color: 30 },
        { id: 'sf', name: 'San Francisco', emoji: '🌁', color: 210 },
        { id: 'oak', name: 'Oakland', emoji: '🌳', color: 150 },
        { id: 'sac', name: 'Sacramento', emoji: '🏛️', color: 45 }
    ],
    'Oregon': [
        { id: 'pdx', name: 'Portland', emoji: '🌲', color: 140 },
        { id: 'sal', name: 'Salem', emoji: '🍒', color: 340 },
        { id: 'eug', name: 'Eugene', emoji: '🏃', color: 100 }
    ],
    'Washington': [
        { id: 'sea', name: 'Seattle', emoji: '☕', color: 180 },
        { id: 'spo', name: 'Spokane', emoji: '🏞️', color: 30 },
        { id: 'tac', name: 'Tacoma', emoji: '🗻', color: 200 }
    ],
    'Nevada': [
        { id: 'lv', name: 'Las Vegas', emoji: '🎰', color: 320 },
        { id: 'rno', name: 'Reno', emoji: '🎲', color: 240 },
        { id: 'cc', name: 'Carson City', emoji: '🪙', color: 50 }
    ],
    'Arizona': [
        { id: 'phx', name: 'Phoenix', emoji: '🌵', color: 25 },
        { id: 'tuc', name: 'Tucson', emoji: '☀️', color: 45 },
        { id: 'flg', name: 'Flagstaff', emoji: '🌲', color: 160 }
    ],
    'Hawaii': [
        { id: 'hnl', name: 'Honolulu', emoji: '🌺', color: 300 },
        { id: 'hil', name: 'Hilo', emoji: '🌋', color: 10 },
        { id: 'kah', name: 'Kahului', emoji: '🍍', color: 60 }
    ],
    'Alaska': [
        { id: 'anc', name: 'Anchorage', emoji: '🏔️', color: 190 },
        { id: 'jun', name: 'Juneau', emoji: '❄️', color: 210 },
        { id: 'fai', name: 'Fairbanks', emoji: '🌌', color: 270 }
    ],

    // --- MOUNTAIN ---
    'Colorado': [
        { id: 'den', name: 'Denver', emoji: '🏔️', color: 210 },
        { id: 'cos', name: 'Colorado Springs', emoji: '🌲', color: 140 },
        { id: 'bou', name: 'Boulder', emoji: '🧗', color: 30 }
    ],
    'Utah': [
        { id: 'slc', name: 'Salt Lake City', emoji: '🐝', color: 40 },
        { id: 'pro', name: 'Provo', emoji: '⛰️', color: 220 },
        { id: 'ogd', name: 'Ogden', emoji: '🚂', color: 180 }
    ],
    'Idaho': [
        { id: 'boi', name: 'Boise', emoji: '🥔', color: 30 },
        { id: 'mer', name: 'Meridian', emoji: '🏡', color: 150 },
        { id: 'if', name: 'Idaho Falls', emoji: '🌊', color: 200 }
    ],
    'Montana': [
        { id: 'bil', name: 'Billings', emoji: '🤠', color: 45 },
        { id: 'mis', name: 'Missoula', emoji: '🐻', color: 160 },
        { id: 'boz', name: 'Bozeman', emoji: '🎿', color: 210 }
    ],
    'Wyoming': [
        { id: 'che', name: 'Cheyenne', emoji: '🚂', color: 350 },
        { id: 'cas', name: 'Casper', emoji: '👻', color: 180 },
        { id: 'jac', name: 'Jackson', emoji: '🏂', color: 210 }
    ],
    'New Mexico': [
        { id: 'abq', name: 'Albuquerque', emoji: '🎈', color: 20 },
        { id: 'sfe', name: 'Santa Fe', emoji: '🎨', color: 300 },
        { id: 'lc', name: 'Las Cruces', emoji: '🌶️', color: 10 }
    ],

    // --- SOUTHWEST / TEXAS ---
    'Texas': [
        { id: 'aus', name: 'Austin', emoji: '🎸', color: 200 },
        { id: 'hou', name: 'Houston', emoji: '🚀', color: 230 },
        { id: 'dal', name: 'Dallas', emoji: '🤠', color: 30 }
    ],
    'Oklahoma': [
        { id: 'okc', name: 'Oklahoma City', emoji: '🌪️', color: 210 },
        { id: 'tul', name: 'Tulsa', emoji: '🛢️', color: 40 },
        { id: 'nor', name: 'Norman', emoji: '🎓', color: 350 }
    ],

    // --- MIDWEST ---
    'Illinois': [
        { id: 'chi', name: 'Chicago', emoji: '🍕', color: 220 },
        { id: 'spr', name: 'Springfield', emoji: '🎩', color: 45 },
        { id: 'aur', name: 'Aurora', emoji: '✨', color: 280 }
    ],
    'Ohio': [
        { id: 'col', name: 'Columbus', emoji: '🏈', color: 350 },
        { id: 'cle', name: 'Cleveland', emoji: '🎸', color: 20 },
        { id: 'cin', name: 'Cincinnati', emoji: '⚾', color: 10 }
    ],
    'Michigan': [
        { id: 'det', name: 'Detroit', emoji: '🚗', color: 240 },
        { id: 'gr', name: 'Grand Rapids', emoji: '🍺', color: 40 },
        { id: 'aa', name: 'Ann Arbor', emoji: '🌳', color: 120 }
    ],
    'Wisconsin': [
        { id: 'mil', name: 'Milwaukee', emoji: '🧀', color: 45 },
        { id: 'mad', name: 'Madison', emoji: '🦡', color: 350 },
        { id: 'gb', name: 'Green Bay', emoji: '🏈', color: 140 }
    ],
    'Minnesota': [
        { id: 'msp', name: 'Minneapolis', emoji: '❄️', color: 200 },
        { id: 'stp', name: 'St. Paul', emoji: '🏛️', color: 220 },
        { id: 'dul', name: 'Duluth', emoji: '🚢', color: 240 }
    ],
    'Indiana': [
        { id: 'ind', name: 'Indianapolis', emoji: '🏎️', color: 30 },
        { id: 'fw', name: 'Fort Wayne', emoji: '🏰', color: 150 },
        { id: 'evn', name: 'Evansville', emoji: '🛶', color: 200 }
    ],
    'Missouri': [
        { id: 'stl', name: 'St. Louis', emoji: '🌉', color: 350 },
        { id: 'kc', name: 'Kansas City', emoji: '🍖', color: 10 },
        { id: 'spr', name: 'Springfield', emoji: '🛣️', color: 100 }
    ],
    'Kansas': [
        { id: 'wic', name: 'Wichita', emoji: '🌻', color: 50 },
        { id: 'op', name: 'Overland Park', emoji: '🌳', color: 140 },
        { id: 'top', name: 'Topeka', emoji: '⚖️', color: 210 }
    ],
    'Iowa': [
        { id: 'dsm', name: 'Des Moines', emoji: '🌽', color: 50 },
        { id: 'cr', name: 'Cedar Rapids', emoji: '🏞️', color: 150 },
        { id: 'dav', name: 'Davenport', emoji: '🌊', color: 220 }
    ],
    'Nebraska': [
        { id: 'oma', name: 'Omaha', emoji: '🥩', color: 10 },
        { id: 'lin', name: 'Lincoln', emoji: '🌽', color: 350 },
        { id: 'bel', name: 'Bellevue', emoji: '✈️', color: 200 }
    ],
    'North Dakota': [
        { id: 'far', name: 'Fargo', emoji: '❄️', color: 210 },
        { id: 'bis', name: 'Bismarck', emoji: '🏛️', color: 45 },
        { id: 'gf', name: 'Grand Forks', emoji: '🏒', color: 120 }
    ],
    'South Dakota': [
        { id: 'sf', name: 'Sioux Falls', emoji: '🌊', color: 200 },
        { id: 'rc', name: 'Rapid City', emoji: '🗿', color: 30 },
        { id: 'abr', name: 'Aberdeen', emoji: '🚂', color: 100 }
    ],

    // --- SOUTH ---
    'Georgia': [
        { id: 'atl', name: 'Atlanta', emoji: '🍑', color: 20 },
        { id: 'sav', name: 'Savannah', emoji: '🌳', color: 140 },
        { id: 'aug', name: 'Augusta', emoji: '⛳', color: 100 }
    ],
    'Florida': [
        { id: 'mia', name: 'Miami', emoji: '🦩', color: 320 },
        { id: 'orl', name: 'Orlando', emoji: '🎢', color: 45 },
        { id: 'tpa', name: 'Tampa', emoji: '🏴‍☠️', color: 350 }
    ],
    'North Carolina': [
        { id: 'clt', name: 'Charlotte', emoji: '👑', color: 210 },
        { id: 'ral', name: 'Raleigh', emoji: '🌳', color: 140 },
        { id: 'avl', name: 'Asheville', emoji: '🏔️', color: 300 }
    ],
    'South Carolina': [
        { id: 'chs', name: 'Charleston', emoji: '🌴', color: 200 },
        { id: 'col', name: 'Columbia', emoji: '🐯', color: 340 },
        { id: 'myr', name: 'Myrtle Beach', emoji: '🏖️', color: 180 }
    ],
    'Virginia': [
        { id: 'vb', name: 'Virginia Beach', emoji: '🌊', color: 210 },
        { id: 'ric', name: 'Richmond', emoji: '🏛️', color: 350 },
        { id: 'nor', name: 'Norfolk', emoji: '⚓', color: 220 }
    ],
    'Tennessee': [
        { id: 'nas', name: 'Nashville', emoji: '🎸', color: 25 },
        { id: 'mem', name: 'Memphis', emoji: '🎷', color: 200 },
        { id: 'knx', name: 'Knoxville', emoji: '🍊', color: 30 }
    ],
    'Kentucky': [
        { id: 'lou', name: 'Louisville', emoji: '🐎', color: 350 },
        { id: 'lex', name: 'Lexington', emoji: '🐴', color: 200 },
        { id: 'bg', name: 'Bowling Green', emoji: '🏎️', color: 20 }
    ],
    'Alabama': [
        { id: 'bir', name: 'Birmingham', emoji: '🏭', color: 150 },
        { id: 'hun', name: 'Huntsville', emoji: '🚀', color: 220 },
        { id: 'mob', name: 'Mobile', emoji: '🎭', color: 280 }
    ],
    'Louisiana': [
        { id: 'no', name: 'New Orleans', emoji: '🎷', color: 280 },
        { id: 'br', name: 'Baton Rouge', emoji: '🐯', color: 40 },
        { id: 'shr', name: 'Shreveport', emoji: '🎲', color: 350 }
    ],
    'Mississippi': [
        { id: 'jac', name: 'Jackson', emoji: '🎶', color: 200 },
        { id: 'gul', name: 'Gulfport', emoji: '🏖️', color: 180 },
        { id: 'bil', name: 'Biloxi', emoji: '🎰', color: 320 }
    ],
    'Arkansas': [
        { id: 'lr', name: 'Little Rock', emoji: '🪨', color: 30 },
        { id: 'fay', name: 'Fayetteville', emoji: '🐗', color: 350 },
        { id: 'hs', name: 'Hot Springs', emoji: '♨️', color: 150 }
    ],
    'West Virginia': [
        { id: 'cha', name: 'Charleston', emoji: '🏛️', color: 45 },
        { id: 'hun', name: 'Huntington', emoji: '🚂', color: 120 },
        { id: 'mor', name: 'Morgantown', emoji: '⛰️', color: 200 }
    ],

    // --- NORTHEAST ---
    'New York': [
        { id: 'nyc', name: 'New York City', emoji: '🗽', color: 210 },
        { id: 'buf', name: 'Buffalo', emoji: '🦬', color: 200 },
        { id: 'roc', name: 'Rochester', emoji: '📸', color: 300 }
    ],
    'Pennsylvania': [
        { id: 'phi', name: 'Philadelphia', emoji: '🔔', color: 350 },
        { id: 'pit', name: 'Pittsburgh', emoji: '🌉', color: 45 },
        { id: 'all', name: 'Allentown', emoji: '🏗️', color: 200 }
    ],
    'Massachusetts': [
        { id: 'bos', name: 'Boston', emoji: '🦞', color: 200 },
        { id: 'wor', name: 'Worcester', emoji: '❤️', color: 340 },
        { id: 'spr', name: 'Springfield', emoji: '🏀', color: 30 }
    ],
    'New Jersey': [
        { id: 'new', name: 'Newark', emoji: '✈️', color: 210 },
        { id: 'jc', name: 'Jersey City', emoji: '🏙️', color: 180 },
        { id: 'ac', name: 'Atlantic City', emoji: '🎰', color: 320 }
    ],
    'Maryland': [
        { id: 'bal', name: 'Baltimore', emoji: '🦀', color: 20 },
        { id: 'ann', name: 'Annapolis', emoji: '⛵', color: 200 },
        { id: 'oc', name: 'Ocean City', emoji: '🏖️', color: 45 }
    ],
    'Connecticut': [
        { id: 'bri', name: 'Bridgeport', emoji: '🎪', color: 150 },
        { id: 'nh', name: 'New Haven', emoji: '🍕', color: 20 },
        { id: 'har', name: 'Hartford', emoji: '💼', color: 200 }
    ],
    'Rhode Island': [
        { id: 'pvd', name: 'Providence', emoji: '⚓', color: 220 },
        { id: 'new', name: 'Newport', emoji: '⛵', color: 200 },
        { id: 'war', name: 'Warwick', emoji: '✈️', color: 150 }
    ],
    'Delaware': [
        { id: 'wil', name: 'Wilmington', emoji: '🏢', color: 200 },
        { id: 'dov', name: 'Dover', emoji: '🏁', color: 350 },
        { id: 'new', name: 'Newark', emoji: '🎓', color: 45 }
    ],
    'New Hampshire': [
        { id: 'man', name: 'Manchester', emoji: '🏭', color: 200 },
        { id: 'nas', name: 'Nashua', emoji: '🛍️', color: 300 },
        { id: 'con', name: 'Concord', emoji: '🍇', color: 150 }
    ],
    'Vermont': [
        { id: 'bur', name: 'Burlington', emoji: '🍁', color: 40 },
        { id: 'mon', name: 'Montpelier', emoji: '🏛️', color: 120 },
        { id: 'rut', name: 'Rutland', emoji: '⛰️', color: 200 }
    ],
    'Maine': [
        { id: 'por', name: 'Portland', emoji: '🦞', color: 200 },
        { id: 'aug', name: 'Augusta', emoji: '🌲', color: 140 },
        { id: 'ban', name: 'Bangor', emoji: '📖', color: 30 }
    ],

    // --- TERRITORIES & DC ---
    'District of Columbia': [
        { id: 'wdc', name: 'Washington D.C.', emoji: '🏛️', color: 210 },
        { id: 'geo', name: 'Georgetown', emoji: '🛍️', color: 340 },
        { id: 'cap', name: 'Capitol Hill', emoji: '⚖️', color: 200 }
    ],
    'Puerto Rico': [
        { id: 'sj', name: 'San Juan', emoji: '🏰', color: 40 },
        { id: 'pon', name: 'Ponce', emoji: '🦁', color: 350 },
        { id: 'may', name: 'Mayagüez', emoji: '🥭', color: 120 }
    ],
    
    // --- FALLBACK ---
    'default': [
        { id: 'cap', name: 'Capital City', emoji: '🏛️', color: 200 },
        { id: 'met', name: 'Metro Area', emoji: '🏙️', color: 30 }
    ]
};
const LOCATIONS = {
    major: [
        { id: 'nyc', name: 'New York', emoji: '🗽', color: 210 },
        { id: 'la', name: 'Los Angeles', emoji: '🌴', color: 30 },
        { id: 'london', name: 'London', emoji: '🇬🇧', color: 0 },
        { id: 'tokyo', name: 'Tokyo', emoji: '🗼', color: 320 },
        { id: 'berlin', name: 'Berlin', emoji: '🐻', color: 45 },
        { id: 'nashville', name: 'Nashville', emoji: '🎸', color: 25 },
        { id: 'austin', name: 'Austin', emoji: '🤠', color: 180 },
        { id: 'miami', name: 'Miami', emoji: '🦩', color: 300 }
    ],
    us: [
        { id: 'ca', name: 'California', emoji: '🌊', color: 200 },
        { id: 'tx', name: 'Texas', emoji: '🐂', color: 25 },
        { id: 'ny', name: 'New York', emoji: '🚕', color: 50 },
        { id: 'fl', name: 'Florida', emoji: '🍊', color: 30 },
        { id: 'ga', name: 'Georgia', emoji: '🍑', color: 15 },
        { id: 'wa', name: 'Washington', emoji: '🌲', color: 140 }
    ],
    global: [
        { id: 'uk', name: 'United Kingdom', emoji: '🇬🇧', color: 210 },
        { id: 'jp', name: 'Japan', emoji: '🇯🇵', color: 0 },
        { id: 'fr', name: 'France', emoji: '🇫🇷', color: 230 },
        { id: 'br', name: 'Brazil', emoji: '🇧🇷', color: 100 },
        { id: 'ng', name: 'Nigeria', emoji: '🇳🇬', color: 120 },
        { id: 'kr', name: 'South Korea', emoji: '🇰🇷', color: 300 }
    ]
};

// --- DATA MAPPING (Mock Data for Demo) ---
const ARTIST_DB = {
    '1': { name: 'Neon Echoes', img: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100' },
    '2': { name: 'The Fold', img: 'https://images.unsplash.com/photo-1493225255756-d9584f8606e9?w=100' },
    '3': { name: 'Mono', img: 'https://images.unsplash.com/photo-1619983081563-430f63602796?w=100' },
    '4': { name: 'M83', img: 'https://images.unsplash.com/photo-1514525253440-b393452e8d26?w=100' },
    '5': { name: 'ODESZA', img: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=100' }
};

// ==========================================
// 1. PRO AUDIO ENGINE (Tone.js)
// ==========================================
class AudioPlayerEngine {
    constructor() {
        // A. Signal Chain Nodes
        this.crossfader = new Tone.CrossFade(0).toDestination();
        
        // LIMITER/COMPRESSOR (Normalization)
        this.limiter = new Tone.Compressor({
            threshold: -24,
            ratio: 4,
            attack: 0.005,
            release: 0.1
        });

        // EQUALIZER (3-Band)
        this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 });

        // CHAIN: Crossfader -> EQ -> Limiter -> Master Output
        this.crossfader.connect(this.eq);
        this.eq.connect(this.limiter);
        this.limiter.toDestination();

        // B. Dual Decks (For Crossfading)
        this.playerA = new Tone.Player();
        this.playerB = new Tone.Player();
        
        // Connect Decks to Crossfader inputs
        this.playerA.connect(this.crossfader.a);
        this.playerB.connect(this.crossfader.b);

        // State
        this.activeDeck = 'A'; // 'A' or 'B'
        this.currentTrack = null;
        this.crossfadeTime = 3; // Default 3s
        this.settings = {}; 

        // Events
        this.listeners = { stateChange: [], progress: [], error: [] };
        this.startProgressTracking();
    }

    // --- SETTINGS UPDATE ---
    updateSettings(settings) {
        this.settings = settings;

        // 1. Crossfade Time
        this.crossfadeTime = parseInt(settings.crossfade) || 3;

        // 2. Normalization (Limiter)
        if (settings.normalizeVolume) {
            this.limiter.threshold.value = -24; // Engage
            this.limiter.ratio.value = 4;
        } else {
            this.limiter.threshold.value = 0; // Bypass
            this.limiter.ratio.value = 1;
        }
        
        // 3. EQ is handled dynamically via setEQ(), but we can restore saved state here
        if (settings.eq) {
             // this.setEQ(settings.eq.low, settings.eq.mid, settings.eq.high);
        }
    }

    setEQ(low, mid, high) {
        // Tone.js uses dB (-10 to 10 usually)
        this.eq.low.value = low;
        this.eq.mid.value = mid;
        this.eq.high.value = high;
    }

    // --- PLAYBACK LOGIC ---
    async play(trackId, metadata = {}) {
        if (Tone.context.state !== 'running') await Tone.start();

        // 1. Determine Quality URL (Mock Logic)
        let fileUrl = metadata.audioUrl || "https://actions.google.com/sounds/v1/science_fiction/scifi_industrial_alarm.ogg"; 
        
        if (this.settings.audioQuality === 'saver') {
            console.log("Loading Data Saver version...");
        }

        // 2. Load into Inactive Deck
        const loadingDeck = this.activeDeck === 'A' ? this.playerB : this.playerA;
        const nextDeckChar = this.activeDeck === 'A' ? 'B' : 'A';

        try {
            // await loadingDeck.load(fileUrl); // Uncomment for real URL loading
            
            loadingDeck.start();
            
            // 3. Perform Crossfade
            const fadeTime = this.crossfadeTime;
            
            if (nextDeckChar === 'B') {
                this.crossfader.fade.rampTo(1, fadeTime);
            } else {
                this.crossfader.fade.rampTo(0, fadeTime);
            }

            // Stop the old deck after fade finishes
            const oldDeck = this.activeDeck === 'A' ? this.playerA : this.playerB;
            setTimeout(() => { oldDeck.stop(); }, fadeTime * 1000);

            // Update State
            this.activeDeck = nextDeckChar;
            this.currentTrack = { id: trackId, ...metadata };
            this.emit('stateChange', { track: this.currentTrack, isPlaying: true });

        } catch (e) {
            this.emit('error', e);
        }
    }

    togglePlay() {
        const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
        if (deck.state === 'started') {
            deck.mute = !deck.mute; 
        } else {
            deck.start();
            deck.mute = false;
        }
        this.emit('stateChange', { 
            track: this.currentTrack, 
            isPlaying: !deck.mute 
        });
    }

    startProgressTracking() {
        const update = () => {
            if (this.currentTrack) {
                // Mock progress for demo
                const duration = 180; 
                const currentTime = (Date.now() / 1000) % duration; 
                this.emit('progress', { progress: currentTime / duration, currentTime, duration });
            }
            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    emit(event, data) { if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data)); }
    on(event, cb) { if (this.listeners[event]) this.listeners[event].push(cb); }
}

export const audioEngine = new AudioPlayerEngine();

// ==========================================
// 2. UI & DATA CONTROLLER
// ==========================================
class PlayerUIController {
    constructor(engine) {
        this.engine = engine;
        this.isMinimized = true; 
        this.saveTimeout = null;
        
        // Wallet State
        this.allTopArtists = [];
        this.allocationArtists = [];
        this.allocationBalance = 0;
        this.isCustomMode = false;
        
       this.engine.on('stateChange', (data) => {
            this.updatePlayPauseIcons(data.isPlaying);
            this.updatePlayerUI(data.track?.title, data.track?.artist, data.track?.artUrl);
        });
        this.engine.on('progress', (data) => this.updateProgressBar(data));
        
        this.init();
        
    }

    init() {
        this.initAuthListener();
        this.exposeGlobalFunctions();
        
        // Render Dashboard Moods if present
        if(document.getElementById('moodGrid')) this.renderMoodGrid('all');
        if(document.getElementById('locationGrid')) this.renderLocationGrid('major');
        if(document.getElementById('localCityGrid')) this.renderLocalGrid();

        // [!] EVENT DELEGATION: Auto-Save for Settings Page
        document.addEventListener('change', (e) => {
            if (e.target.matches('.eq-slider')) {
                window.updateEQ();
            } else if (e.target.closest('.settings-container')) {
                window.autoSave();
            }
        });
        
        document.addEventListener('input', (e) => {
            if (e.target.matches('.eq-slider')) {
                window.updateEQ();
            }
        });
    }

    // 1. THE RENDERER: Builds the clickable mood circles
    renderMoodGrid(category) {
        const grid = document.getElementById('moodGrid');
        if (!grid) return;
        
        // Clear previous skeletons/items
        grid.innerHTML = ''; 
        
        let moodsToShow = [];
        
        // Flatten the taxonomy if "All", otherwise pick specific category
        if (category === 'all') {
            moodsToShow = [...MOODS.energy, ...MOODS.activity, ...MOODS.emotion];
        } else {
            moodsToShow = MOODS[category] || [];
        }
        
        // Randomize and Pick 8 items to keep it fresh
        moodsToShow.sort(() => 0.5 - Math.random()).slice(0, 8).forEach(mood => {
            const card = document.createElement('div');
            card.className = 'mood-card';
            
            // Generate a pastel color based on the ID string
            const hue = (mood.id.length * 40) % 360;
            card.style.backgroundColor = `hsl(${hue}, 60%, 85%)`; 
            
            // [!] THIS MAKES THEM CLICKABLE
            // It calls the global playSong function with the mood name
            card.onclick = () => window.playSong('demo', `${mood.name} Vibe`, 'Eporia Radio', null);
            
            card.innerHTML = `
                <span class="mood-icon">${mood.emoji}</span>
                <span class="mood-name">${mood.name.split('/')[0]}</span>
            `;
            grid.appendChild(card);
        });
    }

    // --- LOCAL SCENE LOGIC ---
    renderLocalGrid() {
        const grid = document.getElementById('localCityGrid');
        if (!grid) return;
        
        // 1. Get User State from the UI (we rendered it in Pug)
        // We look at the subtitle or a hidden field
        const stateText = document.querySelector('.dashboard-hero .subtitle')?.innerText || "California";
        const stateName = stateText.replace("Pulse of ", "").trim();
        
        const cities = STATE_CITIES[stateName] || STATE_CITIES['California'];
        
        grid.innerHTML = '';
        
        cities.forEach(city => {
            const card = document.createElement('div');
            card.className = 'mood-card';
            card.style.backgroundColor = `hsl(${city.color}, 60%, 90%)`; 
            card.style.borderColor = `hsl(${city.color}, 60%, 80%)`;
            
            // Click switches the view to that neighbor city
            card.onclick = () => this.switchLocalView(city.name);
            
            card.innerHTML = `
                <span class="mood-icon" style="font-size:2rem">${city.emoji}</span>
                <span class="mood-name">${city.name}</span>
            `;
            grid.appendChild(card);
        });

        // Load default content (The first city, usually user's own)
        if(document.getElementById('local-row-1')?.children[0]?.classList.contains('skeleton-box')) {
             this.switchLocalView(cities[0].name);
        }
    }

    switchLocalView(cityName) {
        // Update Headers
        document.getElementById('local-title-1').innerText = `Top 50: ${cityName}`;
        document.getElementById('local-title-2').innerText = `Tonight in ${cityName}`;
        document.getElementById('local-title-3').innerText = `${cityName} Curators`;

        // Render Mock Content (Reusing your Explore helpers!)
        this.renderMockCards('local-row-1', cityName, 'Chart');
        this.renderMockEvents('local-events', cityName); // New Helper
        this.renderMockArtists('local-curators', cityName);
    }

    renderMockEvents(containerId, cityName) {
        const row = document.getElementById(containerId);
        if(!row) return;
        row.innerHTML = '';
        const venues = ['The Casbah', 'Music Box', 'House of Blues', 'Observatory'];
        
        for(let i=0; i<4; i++) {
            const venue = venues[i % venues.length];
            const card = document.createElement('div');
            card.className = 'media-card';
            card.style.minWidth = '200px'; // Wider for event cards
            
            card.innerHTML = `
                <div class="img-container" style="height:120px; background: linear-gradient(45deg, #333, #555); display:flex; flex-direction:column; justify-content:center; align-items:center; color:white">
                    <span style="font-weight:900; font-size:1.2rem">NOV ${12+i}</span>
                    <span style="font-size:0.8rem; opacity:0.8">8:00 PM</span>
                </div>
                <div class="card-info">
                    <div class="card-title">Live at ${venue}</div>
                    <div class="card-subtitle">${cityName} Showcase</div>
                </div>
            `;
            row.appendChild(card);
        }
    }

    // --- EXPLORE PAGE LOGIC ---
    
    renderLocationGrid(category) {
        const grid = document.getElementById('locationGrid');
        if (!grid) return;
        
        grid.innerHTML = ''; 
        const locs = LOCATIONS[category] || LOCATIONS.major;
        
        locs.forEach(loc => {
            const card = document.createElement('div');
            card.className = 'mood-card'; // Reuse the circular style
            card.style.backgroundColor = `hsl(${loc.color}, 60%, 90%)`; 
            card.style.borderColor = `hsl(${loc.color}, 60%, 80%)`;
            
            // [!] Click triggers the "Simulated Local Scene"
            card.onclick = () => this.loadLocationScene(loc);
            
            card.innerHTML = `
                <span class="mood-icon" style="font-size:2rem">${loc.emoji}</span>
                <span class="mood-name">${loc.name}</span>
            `;
            grid.appendChild(card);
        });
        
        // Load the first one by default if rows are empty
        if(document.getElementById('explore-row-1')?.children[0]?.classList.contains('skeleton-box')) {
             this.loadLocationScene(locs[0]);
        }
    }

    loadLocationScene(loc) {
        // 1. Update Titles
        document.getElementById('explore-title-1').innerText = `Trending in ${loc.name}`;
        document.getElementById('explore-title-2').innerText = `${loc.name} Artists`;
        document.getElementById('explore-title-3').innerText = `Community Crates: ${loc.name}`;

        // 2. Mock Content Refresh (Simulate fetching local data)
        // In a real app, this would be: await fetch(`/api/local/${loc.id}`)
        
        this.renderMockCards('explore-row-1', loc.name, 'Charts');
        this.renderMockArtists('explore-artists', loc.name);
        this.renderMockCards('explore-row-2', loc.name, 'Playlist');
    }

    // Helper to generate fake content for the demo
    renderMockCards(containerId, locationName, type) {
        const row = document.getElementById(containerId);
        if(!row) return;
        
        row.innerHTML = '';
        const genres = ['Indie', 'House', 'Hip Hop', 'Jazz', 'Rock'];
        
        for(let i=0; i<5; i++) {
            const genre = genres[Math.floor(Math.random()*genres.length)];
            const card = document.createElement('div');
            card.className = 'media-card';
            card.onclick = () => window.playSong('demo', `${locationName} ${genre}`, 'Local Scene', null);
            
            card.innerHTML = `
                <div class="img-container gradient-placeholder" style="background: linear-gradient(135deg, hsl(${Math.random()*360}, 70%, 80%), hsl(${Math.random()*360}, 70%, 80%))">
                    <span style="font-size:1.5rem; color:white; font-weight:900">${locationName.substring(0,3).toUpperCase()}</span>
                </div>
                <div class="card-info">
                    <div class="card-title">${locationName} ${genre}</div>
                    <div class="card-subtitle">Local ${type}</div>
                </div>
            `;
            row.appendChild(card);
        }
    }
    
    renderMockArtists(containerId, locationName) {
        const row = document.getElementById(containerId);
        if(!row) return;
        row.innerHTML = '';
        
        for(let i=0; i<6; i++) {
            const div = document.createElement('div');
            div.className = 'artist-circle';
            div.style.textAlign = 'center';
            div.style.cursor = 'pointer';
            
            // Random Unsplash portraits
            const id = 100 + i;
            div.innerHTML = `
                <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&random=${i}" 
                     style="width:120px; height:120px; border-radius:50%; object-fit:cover; margin-bottom:10px; box-shadow:0 5px 15px rgba(0,0,0,0.1)">
                <div style="font-weight:700; font-size:0.9rem">${locationName} Act ${i+1}</div>
            `;
            row.appendChild(div);
        }
    }

    // --- AUTH & USER DATA ---
    initAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                // Load User Data
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if(userDoc.exists()) {
                    const data = userDoc.data();
                    
                    // 1. Apply Settings
                    this.engine.updateSettings(data.settings || {});
                    
                    // 2. Update Profile Pill
                    const nameEl = document.getElementById('profileName');
                    const picEl = document.getElementById('profilePic');
                    if (nameEl) nameEl.innerText = data.handle || "Member";
                    if (picEl && data.photoURL) picEl.src = data.photoURL;

                    // 3. Load Sidebar & Wallet
                    this.renderSidebarArtists(data.topArtists || []);
                    this.loadUserWallet();
                    this.checkAllocationStatus(); 
                }
            }
        });
    }

    // --- WALLET & ALLOCATION LOGIC ---
    async loadUserWallet() {
        const balanceEl = document.getElementById('userWalletBalance');
        const barEl = document.getElementById('walletBar');
        if (!balanceEl) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            
            if (data.balance) {
                balanceEl.innerText = data.balance;
                if (barEl) {
                    const percent = Math.min((data.balance / data.monthlyAllocation) * 100, 100);
                    barEl.style.width = `${percent}%`;
                    barEl.style.backgroundColor = percent < 20 ? '#e74c3c' : '#88C9A1';
                }
            }
        } catch (e) { console.error("Wallet error", e); }
    }

    async checkAllocationStatus() {
        if (!auth.currentUser) return;
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/check-allocation', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return;
            
            const result = await res.json();
            if (result.due) {
                this.allocationBalance = result.balance || 0;
                this.allTopArtists = result.topArtists || [];
                
                // [!] CRASH FIX: Ensure modal exists before trying to open it
                const modal = document.getElementById('allocationModal');
                if (modal) {
                    this.renderAllocationModal(this.allTopArtists, this.allocationBalance);
                    modal.style.display = 'flex';
                }
            }
        } catch (e) { console.error("Allocation check failed", e); }
    }

    renderAllocationModal(artistIds, balance, selectedIds = null) {
        const grid = document.getElementById('allocGrid');
        const totalEl = document.getElementById('allocTotalAmount');
        if(!grid) return;

        // Reset View
        this.isCustomMode = false;
        document.getElementById('allocActionsDefault').style.display = 'flex';
        document.getElementById('allocActionsCustom').style.display = 'none';
        
        totalEl.innerText = `$${parseFloat(balance).toFixed(2)}`;
        totalEl.style.color = ""; 
        grid.innerHTML = '';
        grid.className = 'alloc-grid';

        // Select All by default
        this.allocationArtists = selectedIds ? [...selectedIds] : [...artistIds];

        if (artistIds.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; color:#999;">No top artists yet. Go listen!</div>';
            return;
        }

        artistIds.forEach(id => {
            const artist = ARTIST_DB[id];
            if (artist) {
                const div = document.createElement('div');
                const isSelected = this.allocationArtists.includes(id);
                div.className = isSelected ? 'alloc-item selected' : 'alloc-item';
                div.id = `alloc-item-${id}`;
                div.onclick = () => this.toggleAllocArtist(id, div);
                div.innerHTML = `
                    <img class="alloc-avatar" src="${artist.img}">
                    <span class="alloc-name">${artist.name}</span>
                `;
                grid.appendChild(div);
            }
        });
    }

    toggleAllocArtist(id, el) {
        if (this.isCustomMode) return;
        if (this.allocationArtists.includes(id)) {
            this.allocationArtists = this.allocationArtists.filter(a => a !== id);
            el.classList.remove('selected');
        } else {
            this.allocationArtists.push(id);
            el.classList.add('selected');
        }
    }

    enableCustomAllocation() {
        this.isCustomMode = true;
        document.getElementById('allocActionsDefault').style.display = 'none';
        document.getElementById('allocActionsCustom').style.display = 'flex';
        
        const grid = document.getElementById('allocGrid');
        grid.innerHTML = ''; 
        grid.className = 'alloc-list'; 

        this.allocationArtists.forEach(id => {
            const artist = ARTIST_DB[id];
            const row = document.createElement('div');
            row.className = 'alloc-custom-row';
            row.innerHTML = `
                <div class="row-left"><img src="${artist.img}"><span>${artist.name}</span></div>
                <div class="row-right"><span>$</span><input type="number" step="0.01" class="alloc-input" data-id="${id}" placeholder="0.00"></div>
            `;
            grid.appendChild(row);
        });
        
        // Add listeners to new inputs
        document.querySelectorAll('.alloc-input').forEach(input => {
            input.addEventListener('input', () => this.updateCustomTotal());
        });
        
        document.getElementById('allocTotalAmount').innerText = "$0.00";
    }

    updateCustomTotal() {
        const inputs = document.querySelectorAll('.alloc-input');
        let sum = 0;
        inputs.forEach(input => sum += Number(input.value));
        
        const display = document.getElementById('allocTotalAmount');
        display.innerText = `$${sum.toFixed(2)}`;
        const btn = document.getElementById('btnConfirmCustom');
        
        if (sum > (this.allocationBalance + 0.01)) {
            display.style.color = "#e74c3c"; 
            btn.disabled = true;
            btn.innerText = "Over Budget";
        } else {
            display.style.color = "#E67E22";
            btn.disabled = false;
            btn.innerText = "Confirm Allocation";
        }
    }

    // --- GLOBAL FUNCTIONS (Exposed to Window) ---
    exposeGlobalFunctions() {
        
        // 1. Playback Controls
        window.togglePlay = () => this.engine.togglePlay();
        window.playSong = (id, title, artist, art) => this.engine.play(id, { title, artist, audioUrl: art }); 
        
        // 2. EQ Handler
        window.updateEQ = () => {
            const low = document.querySelector('input[data-band="low"]')?.value || 0;
            const mid = document.querySelector('input[data-band="mid"]')?.value || 0;
            const high = document.querySelector('input[data-band="high"]')?.value || 0;
            this.engine.setEQ(low, mid, high);
            window.autoSave(); 
        };

        window.initLocalScene = () => {
            this.renderLocalGrid();
        };

        window.filterLocations = (cat) => {
            document.querySelectorAll('.mood-tab').forEach(b => b.classList.remove('active'));
            if(event && event.target) event.target.classList.add('active');
            this.renderLocationGrid(cat);
        };

        window.filterMoods = (cat) => {
            // UI: Update active tab styling
            document.querySelectorAll('.mood-tab').forEach(b => b.classList.remove('active'));
            if(event && event.target) event.target.classList.add('active');
            
            // LOGIC: Re-render the grid
            this.renderMoodGrid(cat);
        };

        // 3. Settings Auto-Save
        window.autoSave = () => {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(async () => {
                const user = auth.currentUser;
                if (!user) return;

                const qInputs = document.querySelectorAll('.quick-tip-input');
                const payload = {
                    audioQuality: document.querySelector('select[name="audioQuality"]')?.value,
                    normalizeVolume: document.querySelector('input[name="normalizeVolume"]')?.checked,
                    crossfade: document.querySelector('input[name="crossfade"]')?.value,
                    allocationMethod: document.querySelector('select[name="allocationMethod"]')?.value,
                    rolloverPref: document.querySelector('select[name="rolloverPref"]')?.value,
                    publicReceipts: document.querySelector('input[name="publicReceipts"]')?.checked,
                    quickTips: [qInputs[0]?.value || 1, qInputs[1]?.value || 3, qInputs[2]?.value || 5],
                    ghostMode: document.querySelector('input[name="ghostMode"]')?.checked,
                    localVisibility: document.querySelector('input[name="localVisibility"]')?.checked,
                    tasteMatch: document.querySelector('input[name="tasteMatch"]')?.checked
                };

                this.engine.updateSettings(payload);

                try {
                    const token = await user.getIdToken();
                    await fetch('/player/api/settings/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(payload)
                    });
                    const toast = document.getElementById('saveStatus');
                    if(toast) { toast.style.opacity = '1'; setTimeout(() => toast.style.opacity = '0', 2000); }
                } catch (e) { console.error("AutoSave Error:", e); }
            }, 1000);
        };

        // 4. Wallet Functions
        window.enableCustomAllocation = () => this.enableCustomAllocation();
        window.updateCustomTotal = () => this.updateCustomTotal();
        window.cancelCustomAllocation = () => {
            this.renderAllocationModal(this.allTopArtists, this.allocationBalance, this.allocationArtists);
        };
        
        window.commitAllocation = async (mode) => {
            let payload = [];
            if (mode === 'auto') {
                if (this.allocationArtists.length === 0) return alert("Select at least one artist.");
                const splitAmount = (this.allocationBalance / this.allocationArtists.length).toFixed(2);
                payload = this.allocationArtists.map(id => ({ artistId: id, amount: splitAmount })); 
            } else if (mode === 'custom') {
                 document.querySelectorAll('.alloc-input').forEach(input => {
                     if (Number(input.value) > 0) payload.push({ artistId: input.dataset.id, amount: input.value });
                 });
            }
            
            try {
                const token = await auth.currentUser.getIdToken();
                const res = await fetch('/player/api/commit-allocation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ action: mode === 'skip' ? 'skip' : 'allocate', allocations: payload })
                });
                
                if (res.ok) {
                    document.getElementById('allocationModal').style.display = 'none';
                    alert(mode === 'skip' ? "Funds rolled over." : "Allocation Complete!");
                    this.loadUserWallet(); 
                }
            } catch(e) { alert("Error: " + e.message); }
        };

        // 5. UI Toggles
        window.togglePlayerSize = () => {
            this.isMinimized = !this.isMinimized;
            document.getElementById('rightSidebar').classList.toggle('minimized', this.isMinimized);
        };
        
        window.toggleTheme = () => {
            document.body.classList.toggle('dark-theme');
            localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
        };

        window.switchTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            const target = document.getElementById(`tab-${tabName}`);
            if (target) target.style.display = 'block';
            
            const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.innerText.toLowerCase().includes(tabName));
            if (btn) btn.classList.add('active');
        };
        
        window.toggleProfileMenu = () => document.getElementById('profileDropdown')?.classList.toggle('active');
        window.navigateTo = window.navigateTo;
    }
    
    // --- UI UPDATES ---
    updatePlayerUI(title, artist, artUrl) {
        document.querySelectorAll('#d-title-full, #d-title-mini').forEach(el => el.innerText = title || "Ready to Play");
        document.querySelectorAll('#d-artist-full, #d-artist-mini').forEach(el => el.innerText = artist || "Select track");
        
        // [!] CHANGE 2: Set Background Image on Divs
        document.querySelectorAll('#d-art-full, #d-art-mini').forEach(el => {
            if (artUrl) {
                el.style.backgroundImage = `url('${artUrl}')`;
            } else {
                el.style.backgroundImage = ''; // Revert to CSS gradient
            }
        });

        // Mobile player still uses IMG tag, so we keep src for it
        const mobileArt = document.getElementById('m-art');
        if(mobileArt && artUrl) mobileArt.src = artUrl;
    }

    updatePlayPauseIcons(isPlaying) {
        document.querySelectorAll('.fa-play, .fa-pause').forEach(icon => {
            icon.classList.toggle('fa-pause', isPlaying);
            icon.classList.toggle('fa-play', !isPlaying);
        });
    }

    updateProgressBar({ progress, currentTime }) {
        const bar = document.getElementById('progressBar');
        if (bar) bar.style.width = `${progress * 100}%`;
        const timeEl = document.getElementById('currentTime');
        if (timeEl) {
            const m = Math.floor(currentTime / 60);
            const s = Math.floor(currentTime % 60);
            timeEl.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
        }
    }
    
    renderMoodGrid(category) {
        const grid = document.getElementById('moodGrid');
        if (!grid) return;
        grid.innerHTML = ''; 
        let moodsToShow = [];
        if (category === 'all') moodsToShow = [...MOODS.energy, ...MOODS.activity, ...MOODS.emotion];
        else moodsToShow = MOODS[category] || [];
        
        moodsToShow.sort(() => 0.5 - Math.random()).slice(0, 8).forEach(mood => {
            const card = document.createElement('div');
            card.className = 'mood-card';
            const hue = (mood.id.length * 40) % 360;
            card.style.backgroundColor = `hsl(${hue}, 60%, 85%)`; 
            card.onclick = () => window.playSong('demo', `${mood.name} Vibe`, 'Eporia Radio', null);
            card.innerHTML = `<span class="mood-icon">${mood.emoji}</span><span class="mood-name">${mood.name.split('/')[0]}</span>`;
            grid.appendChild(card);
        });
    }
    
    renderSidebarArtists(artistIds) {
        const container = document.getElementById('sidebarArtistList');
        if (!container) return;
        if (!artistIds || artistIds.length === 0) {
            container.innerHTML = '<div style="padding:10px; font-size:0.8rem; color:#888">No artists followed yet.</div>';
            return;
        }
        container.innerHTML = artistIds.map(id => {
            const artist = ARTIST_DB[id];
            return artist ? `<div class="artist-item" onclick="navigateTo('/player/artist/${id}')"><img src="${artist.img}"><span>${artist.name}</span></div>` : '';
        }).join('');
    }
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
    new PlayerUIController(audioEngine);

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('profileDropdown');
        const trigger = document.querySelector('.profile-trigger');
        if (menu?.classList.contains('active') && !menu.contains(e.target) && !trigger?.contains(e.target)) {
            menu.classList.remove('active');
        }
    });
});