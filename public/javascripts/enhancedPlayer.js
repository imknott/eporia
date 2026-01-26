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

// ==========================================
// 1. PRO AUDIO ENGINE
// ==========================================
class AudioPlayerEngine {
    constructor() {
        this.crossfader = new Tone.CrossFade(0).toDestination();
        this.limiter = new Tone.Compressor({ threshold: -24, ratio: 4 }).connect(Tone.Destination);
        this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 }).connect(this.limiter);
        this.crossfader.connect(this.eq);

        this.playerA = new Tone.Player();
        this.playerB = new Tone.Player();
        this.playerA.connect(this.crossfader.a);
        this.playerB.connect(this.crossfader.b);

        this.activeDeck = 'A'; 
        this.currentTrack = null;
        this.crossfadeTime = 3;
        this.settings = {}; 
        
        this.startTime = 0;
        this.pausedAt = 0;
        this.isPlaying = false;
        this.trackDuration = 0;

        this.listeners = { stateChange: [], progress: [], error: [] };
        this.startProgressLoop(); 
    }

    async play(trackId, metadata = {}) {
        if (Tone.context.state !== 'running') await Tone.start();

        let fileUrl = metadata.audioUrl;
        if (!fileUrl) { console.warn("No audio URL"); return; }

        const loadingDeck = this.activeDeck === 'A' ? this.playerB : this.playerA;
        const nextDeckChar = this.activeDeck === 'A' ? 'B' : 'A';

        try {
            await loadingDeck.load(fileUrl);
            this.trackDuration = metadata.duration || loadingDeck.buffer.duration;
            
            loadingDeck.start();
            this.startTime = Tone.now(); 
            this.pausedAt = 0;
            this.isPlaying = true;

            const fadeTime = this.crossfadeTime;
            const targetVal = nextDeckChar === 'B' ? 1 : 0;
            this.crossfader.fade.rampTo(targetVal, fadeTime);

            const oldDeck = this.activeDeck === 'A' ? this.playerA : this.playerB;
            setTimeout(() => { oldDeck.stop(); }, fadeTime * 1000);

            this.activeDeck = nextDeckChar;
            this.currentTrack = { id: trackId, ...metadata, duration: this.trackDuration };
            
            this.emit('stateChange', { track: this.currentTrack, isPlaying: true });

        } catch (e) {
            console.error("Play Error:", e);
            this.emit('error', e);
        }
    }

    togglePlay() {
        const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
        if (this.isPlaying) {
            deck.stop(); 
            this.pausedAt = Tone.now() - this.startTime;
            this.isPlaying = false;
        } else {
            if (this.currentTrack) {
                deck.start(0, this.pausedAt); 
                this.startTime = Tone.now() - this.pausedAt; 
                this.isPlaying = true;
            }
        }
        this.emit('stateChange', { track: this.currentTrack, isPlaying: this.isPlaying });
    }

    startProgressLoop() {
        const update = () => {
            if (this.isPlaying && this.currentTrack) {
                const now = Tone.now();
                let currentTime = now - this.startTime;
                if (currentTime > this.trackDuration) currentTime = this.trackDuration;

                this.emit('progress', { 
                    progress: currentTime / this.trackDuration, 
                    currentTime: currentTime, 
                    duration: this.trackDuration 
                });
            }
            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    updateSettings(settings) {
        this.settings = settings;
        this.crossfadeTime = parseInt(settings.crossfade) || 3;
        if (settings.normalizeVolume) {
            this.limiter.threshold.value = -24; this.limiter.ratio.value = 4;
        } else {
            this.limiter.threshold.value = 0; this.limiter.ratio.value = 1;
        }
    }

    setEQ(low, mid, high) { this.eq.low.value = low; this.eq.mid.value = mid; this.eq.high.value = high; }
    emit(event, data) { if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data)); }
    on(event, cb) { if (this.listeners[event]) this.listeners[event].push(cb); }
}

export const audioEngine = new AudioPlayerEngine();

// ==========================================
// 2. UI CONTROLLER (Handles Navigation & Data)
// ==========================================
class PlayerUIController {
    constructor(engine) {
        this.engine = engine;
        this.isMinimized = true; 
        
        this.engine.on('stateChange', (data) => {
            this.updatePlayPauseIcons(data.isPlaying);
            this.updatePlayerUI(data.track);
            if (data.isPlaying && this.isMinimized) this.togglePlayerSize();
        });

        this.engine.on('progress', (data) => this.updateProgressBar(data));
        
        this.init();
    }

    init() {
        this.initAuthListener();
        this.exposeGlobalFunctions();
        this.setupOmniSearch();
        
        // [FIX] Initial Load
        this.checkAndReloadViews();

        // [FIX] Setup Observer to detect Navigation changes
        this.setupViewObserver();

        // Event Delegation
        document.addEventListener('change', (e) => {
            if (e.target.matches('.eq-slider')) window.updateEQ();
            else if (e.target.closest('.settings-container')) window.autoSave();
        });
        document.addEventListener('input', (e) => {
            if (e.target.matches('.eq-slider')) window.updateEQ();
        });
    }

    // --- [NEW] NAVIGATION OBSERVER ---
    // Watches for when the Router swaps HTML, so we can re-fetch data
    setupViewObserver() {
        const observer = new MutationObserver((mutations) => {
            // If the main wrapper changed, check if we need to reload data
            this.checkAndReloadViews();
        });
        
        const target = document.querySelector('.main-wrapper') || document.body;
        observer.observe(target, { childList: true, subtree: true });
    }

    checkAndReloadViews() {
        // 1. Check New Releases (Dashboard)
        const newReleases = document.getElementById('newReleasesContainer');
        // If container exists AND has skeletons, load data
        if (newReleases && newReleases.querySelector('.skeleton-box')) {
             this.loadNewReleases();
        }

        // 2. Check Mood Grid (Dashboard)
        const moodGrid = document.getElementById('moodGrid');
        if (moodGrid && moodGrid.querySelector('.skeleton-box')) {
             this.renderMoodGrid('all');
        }

        // 3. Check Location Grid (Explore)
        if(document.getElementById('locationGrid') && document.querySelector('#locationGrid:empty')) {
            this.renderLocationGrid('major');
        }
        
        // 4. Check Local Scene Grid (Local)
        if(document.getElementById('localCityGrid') && document.querySelector('#localCityGrid:empty')) {
            this.renderLocalGrid();
        }
    }

    // --- UI UPDATES ---
    updatePlayerUI(track) {
        if(!track) return;
        document.querySelectorAll('#d-title-full, #d-title-mini').forEach(el => el.innerText = track.title);
        document.querySelectorAll('#d-artist-full, #d-artist-mini').forEach(el => el.innerText = track.artist);
        
        if (track.duration) {
            const m = Math.floor(track.duration / 60);
            const s = Math.floor(track.duration % 60);
            document.getElementById('totalTime').innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
        }

        const artElements = document.querySelectorAll('#d-art-full, #d-art-mini');
        if (track.artUrl && track.artUrl !== 'null') {
            artElements.forEach(el => {
                el.style.backgroundImage = `url('${track.artUrl}')`;
                if(el.id === 'd-art-full') el.style.backgroundSize = 'cover';
                el.classList.remove('art-placeholder');
            });
        }
    }

    updatePlayPauseIcons(isPlaying) {
        document.querySelectorAll('.fa-play, .fa-pause').forEach(icon => {
            if (icon.parentElement.classList.contains('btn-play-hero') || 
                icon.parentElement.classList.contains('btn-play-mini') || 
                icon.parentElement.classList.contains('mp-play')) {
                
                icon.classList.toggle('fa-pause', isPlaying);
                icon.classList.toggle('fa-play', !isPlaying);
            }
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

    togglePlayerSize() {
        this.isMinimized = !this.isMinimized;
        document.getElementById('rightSidebar').classList.toggle('minimized', this.isMinimized);
    }

    // --- AUTH & DATA ---
    initAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                // If we are currently staring at skeletons, load them now
                this.checkAndReloadViews();
                
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if(userDoc.exists()) {
                    const data = userDoc.data();
                    this.engine.updateSettings(data.settings || {});
                    
                    const nameEl = document.getElementById('profileName');
                    const picEl = document.getElementById('profilePic');
                    if (nameEl) nameEl.innerText = data.handle || "Member";
                    if (picEl && data.photoURL) picEl.src = data.photoURL;

                    this.renderSidebarArtists(data.topArtists || []);
                    this.loadUserWallet();
                }
            }
        });
    }

    async loadNewReleases() {
        const container = document.getElementById('newReleasesContainer');
        if (!container) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/dashboard/new-releases', { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            const data = await res.json();

            if (data.success && data.songs.length > 0) {
                container.innerHTML = ''; 
                data.songs.forEach(song => {
                    const card = document.createElement('div');
                    card.className = 'media-card';
                    card.onclick = () => window.playSong(
                        song.id, 
                        song.title, 
                        song.artist, 
                        song.artUrl, 
                        song.audioUrl,
                        song.duration 
                    );

                    card.innerHTML = `
                        <div class="img-container">
                            <img src="${song.artUrl}" loading="lazy" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">
                            <div class="play-overlay"><i class="fas fa-play"></i></div>
                        </div>
                        <div class="card-info">
                            <div class="card-title">${song.title}</div>
                            <div class="card-subtitle">${song.artist}</div>
                        </div>
                    `;
                    container.appendChild(card);
                });
            } else {
                container.innerHTML = '<div style="padding:20px; color:#666; font-size:0.9rem">No new tracks found.</div>';
            }
        } catch (e) {
            console.error("Failed to load releases", e);
        }
    }

    // --- RENDER HELPERS ---
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

    renderLocationGrid(category) {
        const grid = document.getElementById('locationGrid');
        if (!grid) return;
        grid.innerHTML = ''; 
        const locs = LOCATIONS[category] || LOCATIONS.major;
        
        locs.forEach(loc => {
            const card = document.createElement('div');
            card.className = 'mood-card';
            card.style.backgroundColor = `hsl(${loc.color}, 60%, 90%)`; 
            card.style.borderColor = `hsl(${loc.color}, 60%, 80%)`;
            card.onclick = () => this.loadLocationScene(loc);
            card.innerHTML = `<span class="mood-icon" style="font-size:2rem">${loc.emoji}</span><span class="mood-name">${loc.name}</span>`;
            grid.appendChild(card);
        });
    }

    renderLocalGrid() {
        const grid = document.getElementById('localCityGrid');
        if (!grid) return;
        const stateText = document.querySelector('.dashboard-hero .subtitle')?.innerText || "California";
        const stateName = stateText.replace("Pulse of ", "").trim();
        const cities = STATE_CITIES[stateName] || STATE_CITIES['California'];
        
        grid.innerHTML = '';
        cities.forEach(city => {
            const card = document.createElement('div');
            card.className = 'mood-card';
            card.style.backgroundColor = `hsl(${city.color}, 60%, 90%)`; 
            card.onclick = () => this.switchLocalView(city.name);
            card.innerHTML = `<span class="mood-icon" style="font-size:2rem">${city.emoji}</span><span class="mood-name">${city.name}</span>`;
            grid.appendChild(card);
        });
    }

    // --- WALLET ---
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
                }
            }
        } catch (e) { console.error("Wallet error", e); }
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
    
    // --- GLOBAL FUNCTIONS ---
    exposeGlobalFunctions() {
        window.playSong = (id, title, artist, artUrl, audioUrl, duration) => {
            console.log("Requesting Play:", title);
            const dur = duration ? parseFloat(duration) : 0;
            this.engine.play(id, { title, artist, artUrl, audioUrl, duration: dur }); 
        };

        window.togglePlay = () => this.engine.togglePlay();
        window.togglePlayerSize = () => this.togglePlayerSize();
        window.updateEQ = () => { };
        window.autoSave = () => { };
        window.navigateTo = window.navigateTo; 
        window.filterMoods = (cat) => this.renderMoodGrid(cat); // [FIX] Added for Dashboard Tabs
        
        this.setupOmniSearch();
    }

    setupOmniSearch() {
        const input = document.getElementById('mainSearchInput');
        const resultsBox = document.getElementById('searchResults');
        if(!input) return;
        
        window.toggleSearchFilter = () => document.getElementById('searchFilterMenu').classList.toggle('active');
        window.setSearchMode = (mode) => { /* Simple mode switch */ };
        
        let debounceTimer;
        input.addEventListener('input', (e) => {
            const query = e.target.value;
            clearTimeout(debounceTimer);
            if (query.length < 2) { resultsBox.classList.remove('active'); return; }

            debounceTimer = setTimeout(async () => {
                resultsBox.innerHTML = '<div class="search-placeholder"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
                resultsBox.classList.add('active');
                try {
                    const token = await auth.currentUser.getIdToken();
                    const res = await fetch(`/player/api/search?q=${encodeURIComponent(query)}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    this.renderSearchResults(data.results);
                } catch (err) { console.error(err); }
            }, 300);
        });
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                document.getElementById('searchFilterMenu')?.classList.remove('active');
                resultsBox?.classList.remove('active');
            }
        });
    }

    renderSearchResults(results) {
        const box = document.getElementById('searchResults');
        box.innerHTML = '';
        if (!results || results.length === 0) {
            box.innerHTML = '<div class="search-placeholder">No results found.</div>';
            return;
        }
        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            let imgHtml = item.img ? `<img src="${item.img}" class="result-img">` : '<div class="result-img square"></div>';
            
            div.onclick = () => {
                if (item.type === 'song') window.playSong(item.id, item.title, item.subtitle, item.img, item.audioUrl, item.duration);
                else if (item.url) window.navigateTo(item.url);
                box.classList.remove('active');
            };
            div.innerHTML = `${imgHtml}<div class="result-info"><div class="result-title">${item.title}</div><div class="result-sub">${item.subtitle}</div></div>`;
            box.appendChild(div);
        });
    }
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
    new PlayerUIController(audioEngine);
});