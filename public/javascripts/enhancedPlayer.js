/* public/javascripts/enhancedPlayer.js */
import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import * as Tone from 'https://cdn.skypack.dev/tone';
import { MOODS } from '/javascripts/taxonomy.js';
import { STATE_CITIES, LOCATIONS } from '/javascripts/states.js';

const auth = getAuth();
window.globalUserCache = null;

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
        
        // [FIX] Bind togglePlayerSize so 'this' works when clicked
        this.togglePlayerSize = this.togglePlayerSize.bind(this);

        this.engine.on('stateChange', (data) => {
            this.updatePlayPauseIcons(data.isPlaying);
            this.updatePlayerUI(data.track);
            // Auto-Maximize logic
            if (data.isPlaying && this.isMinimized) this.togglePlayerSize();
        });

        this.engine.on('progress', (data) => this.updateProgressBar(data));
        
        this.init();
    }

    init() {
        this.initAuthListener();
        this.exposeGlobalFunctions();
        this.setupOmniSearch();
        
        this.setupViewObserver();
        this.updateSidebarState();
        this.setupNotifications(); // [NEW]

        document.addEventListener('change', (e) => {
            if (e.target.matches('.eq-slider')) window.updateEQ();
            else if (e.target.closest('.settings-container')) window.autoSave();
        });
        document.addEventListener('input', (e) => {
            if (e.target.matches('.eq-slider')) window.updateEQ();
        });

        document.addEventListener('click', (e) => {
            const menu = document.getElementById('profileDropdown');
            const trigger = document.querySelector('.profile-trigger'); 
            if (menu && menu.classList.contains('active')) {
                if (!menu.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
                    menu.classList.remove('active');
                }
            }
        });
    }
    // --- NOTIFICATIONS SYSTEM ---
    setupNotifications() {
        // 1. Poll for notifications periodically (every 60s)
        setInterval(() => this.checkNotifications(), 60000);
        
        // 2. Also check immediately on load (via initAuthListener)
        
        // 3. Clear notifications when dropdown is clicked
        const trigger = document.querySelector('.profile-trigger');
        if (trigger) {
            trigger.addEventListener('click', () => {
                this.markNotificationsRead();
            });
        }
    }

    async checkNotifications() {
        if (!auth.currentUser) return;
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/notifications', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            this.renderNotifications(data.notifications);
        } catch (e) { console.error("Notif check failed", e); }
    }

    renderNotifications(notifs) {
        const pill = document.querySelector('.profile-trigger');
        const menu = document.getElementById('profileDropdown');
        
        // 1. Update Red Dot Badge on Pill
        if (notifs.length > 0) {
            pill.classList.add('has-notification'); // Add CSS for red dot
        } else {
            pill.classList.remove('has-notification');
        }

        // 2. Render List in Dropdown
        // Remove old notif items first
        const oldItems = menu.querySelectorAll('.notif-item');
        oldItems.forEach(el => el.remove());

        if (notifs.length > 0) {
            // Create a "Notifications" header if not exists
            let header = menu.querySelector('.notif-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'dropdown-divider notif-header'; 
                // Insert before the first divider
                menu.insertBefore(header, menu.firstChild); 
            }

            // Insert Items
            notifs.forEach(n => {
                const item = document.createElement('div');
                item.className = 'dropdown-item notif-item';
                item.style.fontSize = '0.8rem';
                item.onclick = () => window.navigateTo(`/player/u/${n.fromHandle.replace('@','')}`);
                
                item.innerHTML = `
                    <img src="${n.fromImg || 'https://via.placeholder.com/30'}" style="width:24px; height:24px; border-radius:50%; margin-right:8px;">
                    <div>
                        <span style="font-weight:800">${n.fromHandle}</span> followed you.
                    </div>
                `;
                // Insert after header
                menu.insertBefore(item, header.nextSibling);
            });
        }
    }

    async markNotificationsRead() {
        const pill = document.querySelector('.profile-trigger');
        if (!pill.classList.contains('has-notification')) return;

        // Get IDs currently rendered
        const items = document.querySelectorAll('.notif-item');
        // We assume logic here: if user opens menu, we mark ALL unread as read
        // Ideally, we'd track IDs. For simplicity, we just clear the UI and tell server "mark all unread as read"
        // But our API expects IDs. Let's fetch IDs from the render logic store or just re-fetch.
        
        // Simplified: Just remove the dot immediately for UX
        pill.classList.remove('has-notification');

        try {
            // Fetch real IDs to mark
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/notifications', { headers: { 'Authorization': `Bearer ${token}` }});
            const data = await res.json();
            const ids = data.notifications.map(n => n.id);
            
            if (ids.length > 0) {
                await fetch('/player/api/notifications/mark-read', {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ ids })
                });
            }
        } catch (e) { console.error("Mark read failed", e); }
    }

    setupViewObserver() {
        const observer = new MutationObserver((mutations) => {
            this.checkAndReloadViews();
            this.updateSidebarState();
        });
        
        const target = document.querySelector('.main-wrapper') || document.body;
        observer.observe(target, { childList: true, subtree: true });
    }

    checkAndReloadViews() {
        // [FIX] Guard: If no user, do not attempt to load data that requires tokens
        if (!auth.currentUser) return; 

        if (document.getElementById('newReleasesContainer')?.querySelector('.skeleton-box')) this.loadNewReleases();
        if (document.getElementById('moodGrid')?.querySelector('.skeleton-box')) this.renderMoodGrid('all');
        if (document.getElementById('locationGrid') && document.querySelector('#locationGrid:empty')) this.renderLocationGrid('major');
        if (document.getElementById('localCityGrid') && document.querySelector('#localCityGrid:empty')) this.renderLocalGrid();
        
        // Check Follow Status on Artist Pages
        const followBtn = document.getElementById('followBtn');
        if (followBtn && followBtn.dataset.artistId) {
            this.checkFollowStatus(followBtn.dataset.artistId);
        }
    }

    updateSidebarState() {
        const currentPath = window.location.pathname;
        document.querySelectorAll('.sidebar .nav-item').forEach(item => {
            item.classList.remove('active');
            const onClickAttr = item.getAttribute('onclick');
            if (onClickAttr && onClickAttr.includes(currentPath)) item.classList.add('active');
        });
    }

    // [FIX] Sidebar Render - NOW ACCEPTS REAL OBJECTS
    renderSidebarArtists(artists) {
        const container = document.getElementById('sidebarArtistList');
        if (!container) return;
        
        if (!artists || artists.length === 0) {
            container.innerHTML = '<div style="padding:10px; font-size:0.8rem; color:#888">No artists followed yet.</div>';
            return;
        }
        
        // artists array looks like: [{ id: "123", name: "Neon", img: "..." }, ...]
        container.innerHTML = artists.map(artist => {
            // Safety check: ensure artist is an object
            if (typeof artist !== 'object') return ''; 
            
            return `
                <div class="artist-item" onclick="navigateTo('/player/artist/${artist.id}')">
                    <img src="${artist.img || 'https://via.placeholder.com/50'}" style="background:#333; width:32px; height:32px; border-radius:50%; object-fit:cover;">
                    <span>${artist.name}</span>
                </div>
            `;
        }).join('');
    }

    // [FIX] Follow Logic
    async checkFollowStatus(artistId) {
        if (!auth.currentUser) return;
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/follow/status?artistId=${artistId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            this.updateFollowButtonUI(data.following);
        } catch (e) { console.error("Status check failed", e); }
    }

    async toggleFollow(btn) {
        if (!auth.currentUser) {
            window.location.href = '/members/login';
            return;
        }

        const isFollowing = btn.classList.contains('following');
        this.updateFollowButtonUI(!isFollowing); // Optimistic UI

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/artist/follow', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    artistId: btn.dataset.artistId,
                    artistName: btn.dataset.artistName,
                    artistImg: btn.dataset.artistImg
                })
            });
            
            const data = await res.json();
            
            // 1. Confirm UI State
            this.updateFollowButtonUI(data.following);

            // 2. Update Global Cache & Sidebar Immediately
            if (window.globalUserCache) {
                window.globalUserCache.sidebarArtists = data.sidebar;
                this.renderSidebarArtists(data.sidebar);
            }

        } catch (e) {
            console.error("Follow error", e);
            this.updateFollowButtonUI(isFollowing); // Revert
            alert("Action failed.");
        }
    }

    updateFollowButtonUI(isFollowing) {
        const btn = document.getElementById('followBtn');
        if (!btn) return;

        if (isFollowing) {
            btn.classList.add('following');
            btn.innerHTML = 'Following';
            btn.style.background = 'transparent';
            btn.style.border = '1px solid #FFF';
            btn.style.color = '#FFF';
        } else {
            btn.classList.remove('following');
            btn.innerHTML = 'Follow';
            btn.style.background = '#88C9A1';
            btn.style.border = 'none';
            btn.style.color = '#FFF';
        }
    }

    togglePlayerSize() {
        this.isMinimized = !this.isMinimized;
        const rightSidebar = document.getElementById('rightSidebar');
        if (rightSidebar) rightSidebar.classList.toggle('minimized', this.isMinimized);
    }

    // --- AUTH & DATA ---
  initAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                // [FIX] Now safe to call reloading logic
                this.checkAndReloadViews();
                this.checkNotifications();
                
                try {
                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    if(userDoc.exists()) {
                        const data = userDoc.data();
                        window.globalUserCache = data;
                        this.engine.updateSettings(data.settings || {});
                        
                        const nameEl = document.getElementById('profileName');
                        const picEl = document.getElementById('profilePic');
                        if (nameEl) nameEl.innerText = data.handle || "Member";
                        if (picEl && data.photoURL) picEl.src = data.photoURL;

                        this.renderSidebarArtists(data.sidebarArtists || []);
                        this.loadUserWallet();
                        window.dispatchEvent(new Event('userDataReady'));
                    }
                } catch (err) { console.error("Profile Error:", err); }
            }
        });
    }

    async loadNewReleases() {
        // [FIX] Guard added
        if (!auth.currentUser) return;
        const container = document.getElementById('newReleasesContainer');
        if (!container) return;
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/dashboard/new-releases', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (data.success && data.songs.length > 0) {
                container.innerHTML = ''; 
                data.songs.forEach(song => {
                    const card = document.createElement('div');
                    card.className = 'media-card';
                    card.onclick = () => window.playSong(song.id, song.title, song.artist, song.artUrl, song.audioUrl, song.duration);
                    card.innerHTML = `<div class="img-container"><img src="${song.artUrl}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;"><div class="play-overlay"><i class="fas fa-play"></i></div></div><div class="card-info"><div class="card-title">${song.title}</div><div class="card-subtitle">${song.artist}</div></div>`;
                    container.appendChild(card);
                });
            } else { container.innerHTML = '<div style="padding:20px; color:#666; font-size:0.9rem">No new tracks found.</div>'; }
        } catch (e) { console.error(e); }
    }

    renderMoodGrid(category) {
        const grid = document.getElementById('moodGrid');
        if (!grid) return;
        grid.innerHTML = ''; 
        let moodsToShow = (category === 'all') ? [...MOODS.energy, ...MOODS.activity, ...MOODS.emotion] : (MOODS[category] || []);
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

    // --- GLOBAL FUNCTIONS ---
    // --- GLOBAL FUNCTIONS ---
    exposeGlobalFunctions() {
        window.playSong = (id, title, artist, artUrl, audioUrl, duration) => {
            const dur = duration ? parseFloat(duration) : 0;
            this.engine.play(id, { title, artist, artUrl, audioUrl, duration: dur }); 
        };

        window.togglePlay = () => this.engine.togglePlay();
        window.togglePlayerSize = this.togglePlayerSize;
        window.updateEQ = () => { };
        window.autoSave = () => { };
        window.navigateTo = window.navigateTo; 
        window.filterMoods = (cat) => this.renderMoodGrid(cat);
        
        window.toggleProfileMenu = () => {
            const menu = document.getElementById('profileDropdown');
            if (menu) menu.classList.toggle('active');
        };

        window.toggleTheme = () => {
            const isDark = document.body.classList.toggle('dark-theme');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        };

        window.toggleFollow = (btn) => this.toggleFollow(btn);
        window.openTipModal = () => alert("Tipping coming soon!");
        
        // [FIX] Removed global switchTab to prevent collision with Profile-specific logic.
        // Or keep a dummy one if other pages need it:
        /* window.switchTab = (tabName) => { ... } */
        
        this.setupOmniSearch();
    }

    setupOmniSearch() {
        const input = document.getElementById('mainSearchInput');
        const resultsBox = document.getElementById('searchResults');
        if(!input) return;
        
        window.toggleSearchFilter = () => document.getElementById('searchFilterMenu').classList.toggle('active');
        
        window.setSearchMode = (mode) => {
            const icon = document.getElementById('currentSearchIcon');
            const menu = document.getElementById('searchFilterMenu');
            let prefix = '';
            let placeholder = 'Search...';
            let iconClass = 'fa-search';

            switch(mode) {
                case 'artist':
                    prefix = '@'; placeholder = 'Search artists...'; iconClass = 'fa-microphone-alt'; break;
                case 'song':
                    prefix = 's:'; placeholder = 'Search songs...'; iconClass = 'fa-music'; break;
                case 'user':
                    prefix = 'u:'; placeholder = 'Search users...'; iconClass = 'fa-user'; break;
                case 'city':
                    prefix = 'C:'; placeholder = 'Search cities...'; iconClass = 'fa-city'; break;
                default:
                    prefix = ''; placeholder = 'Search...'; iconClass = 'fa-search';
            }

            if(icon) icon.className = `fas ${iconClass}`;
            input.value = prefix;
            input.placeholder = placeholder;
            input.focus();
            if(menu) menu.classList.remove('active');
        };
        
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

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
    new PlayerUIController(audioEngine);
});