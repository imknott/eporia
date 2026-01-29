/* public/javascripts/uiController.js */
import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { MOODS } from '/javascripts/taxonomy.js';
import { STATE_CITIES, LOCATIONS } from '/javascripts/states.js';

const auth = getAuth();
window.globalUserCache = null;
let saveTimeout = null;

// ==========================================
// 2. UI CONTROLLER (Handles Navigation & Data)
// ==========================================
export class PlayerUIController {
    constructor(engine) {
        this.engine = engine;
        this.isMinimized = true; 
        this.togglePlayerSize = this.togglePlayerSize.bind(this);

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
        this.setupNotifications();
        this.setupViewObserver();
        this.updateSidebarState();
        this.setupSeekbar(); // [NEW] Init Seekbar

        document.addEventListener('change', (e) => {
            if (e.target.matches('.eq-slider')) window.updateEQ();
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

    async loadDashboardLocal() {
        const container = document.getElementById('dash-local-row');
        const titleEl = document.getElementById('dash-local-title');
        
        if (!container) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/dashboard/local-trending', { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            const data = await res.json();

            // Update Title
            if (titleEl) titleEl.innerHTML = `<i class="fas fa-map-marker-alt" style="color:var(--accent-orange)"></i> Trending in ${data.city}`;

            container.innerHTML = '';

            if (data.items.length === 0) {
                container.innerHTML = this.createEmptyState(`No local trends in ${data.city} yet.`);
                return;
            }

            data.items.forEach(item => {
                // Render "Crate" (City Mix) differently if needed, or use Song Card
                if (item.type === 'crate') {
                    const card = document.createElement('div');
                    card.className = 'media-card';
                    // navigate to local page on click
                    card.onclick = () => window.navigateTo(`/player/local?city=${data.city}`);
                    card.innerHTML = `
                        <div class="img-container gradient-placeholder" style="background: linear-gradient(135deg, #FF9A9E, #FECFEF); display:flex; align-items:center; justify-content:center; color:white; font-weight:900; font-size:1.5rem">
                            <span>${item.title.substring(4,6).toUpperCase()}</span>
                        </div>
                        <div class="card-info">
                            <div class="card-title">${item.title}</div>
                            <div class="card-subtitle">${item.subtitle}</div>
                        </div>`;
                    container.appendChild(card);
                } else {
                    // Regular Song Card
                    container.appendChild(this.createSongCard({
                        id: item.id,
                        title: item.title,
                        artist: item.subtitle,
                        img: item.img,
                        audioUrl: item.audioUrl,
                        duration: item.duration
                    }));
                }
            });

        } catch (e) { console.error("Dash Local Error:", e); }
    }

    

    // [NEW] SETUP SEEK BAR INTERACTION
    setupSeekbar() {
        // We attach listener to the container (the gray line background)
        // Ensure your HTML structure has an ID or class for the wrapper of #progressBar
        const progressContainer = document.querySelector('.progress-container') || document.getElementById('progressBar')?.parentElement;
        
        if (progressContainer) {
            progressContainer.style.cursor = 'pointer';
            progressContainer.addEventListener('click', (e) => {
                if (!this.engine.currentTrack) return;
                
                const rect = progressContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                const pct = clickX / width;
                
                const seekTime = pct * this.engine.trackDuration;
                this.engine.seek(seekTime);
            });
        }
    }

    // [NEW] TOGGLE PLAYER HEART (Current Song)
    async togglePlayerLike() {
        if (!this.engine.currentTrack) return;
        
        // Find the heart icon in the player (adjust selector if needed)
        // Usually .mp-controls .mp-btn i or similar
        const heartBtn = document.querySelector('.mp-controls .fa-heart')?.parentElement;
        if (!heartBtn) return;

        const track = this.engine.currentTrack;
        await this.toggleSongLike(heartBtn, track.id, track.title, track.artist, track.artUrl, track.audioUrl, track.duration);
    }

   // --- GLOBAL SETTINGS LOGIC ---
    updateGlobalSetting(key, value) {
        if (!window.globalUserCache) return;
        
        if (!window.globalUserCache.settings) window.globalUserCache.settings = {};
        window.globalUserCache.settings[key] = value;

        this.engine.updateSettings(window.globalUserCache.settings);

        const statusEl = document.getElementById('saveStatus');
        if (statusEl) statusEl.style.opacity = '0';

        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            try {
                if (!auth.currentUser) return;
                const token = await auth.currentUser.getIdToken();
                
                await fetch('/player/api/settings/save', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(window.globalUserCache.settings)
                });

                if (statusEl) statusEl.style.opacity = '1';
            } catch (e) { console.error("Settings Sync Error:", e); }
        }, 1000);
    }
// [NEW] Cache Like IDs
    async loadUserLikes() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/user/likes/ids', { headers: { 'Authorization': `Bearer ${token}` }});
            const data = await res.json();
            
            if(!window.globalUserCache) window.globalUserCache = {};
            // Store as a Set for O(1) lookup
            window.globalUserCache.likedSongs = new Set(data.ids);
            
        } catch(e) { console.error("Like Cache Error", e); }
    }

    // [UPDATED] Check Status - Apply Orange Color
    checkSongLikeStatus(songId, iconElement) {
        if (!auth.currentUser || !iconElement) return;
        
        let isLiked = false;
        if (window.globalUserCache && window.globalUserCache.likedSongs) {
            isLiked = window.globalUserCache.likedSongs.has(songId);
        }

        if (isLiked) {
            iconElement.classList.remove('far');
            iconElement.classList.add('fas');
            iconElement.style.color = '#F4A261'; // [FIX] Orange
        } else {
            iconElement.classList.remove('fas');
            iconElement.classList.add('far');
            iconElement.style.color = ''; // Reset
        }
    }

    // [UPDATED] Toggle Like - Apply Orange Color
    async toggleSongLike(btn, songId, title, artist, artUrl, audioUrl, duration) {
        if (!auth.currentUser) { window.location.href = '/members/login'; return; }
        
        const icon = btn.querySelector('i');
        const isLiked = icon.classList.contains('fas');
        
        // Optimistic UI
        if (isLiked) { 
            // Unlike
            icon.classList.remove('fas'); 
            icon.classList.add('far');
            icon.style.color = ''; // Reset
            
            if(window.globalUserCache?.likedSongs) window.globalUserCache.likedSongs.delete(songId);
        } else { 
            // Like
            icon.classList.remove('far'); 
            icon.classList.add('fas'); 
            icon.style.color = '#F4A261'; // [FIX] Orange
            
            if(window.globalUserCache?.likedSongs) window.globalUserCache.likedSongs.add(songId);
        }

        try {
            const token = await auth.currentUser.getIdToken();
            await fetch('/player/api/song/like', { 
                method: 'POST', 
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ songId, title, artist, artUrl, audioUrl, duration }) 
            });
        } catch (e) {
            console.error("Like failed", e);
            // Revert UI
            if (isLiked) { 
                icon.classList.add('fas'); 
                icon.classList.remove('far');
                icon.style.color = '#F4A261'; 
            } else { 
                icon.classList.add('far'); 
                icon.classList.remove('fas');
                icon.style.color = ''; 
            }
        }
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

  // --- VIEW RELOADER (The Fix) ---
    checkAndReloadViews() {
        if (!auth.currentUser) return; 

        // 1. DASHBOARD: Check if skeletons exist (not if empty)
        if (document.getElementById('newReleasesContainer')?.querySelector('.skeleton-box')) this.loadNewReleases();
        if (document.getElementById('moodGrid')?.querySelector('.skeleton-box')) this.renderMoodGrid('all');
        // [NEW] Load Dashboard Local Section
        if (document.getElementById('dash-local-row')?.querySelector('.skeleton-box')) this.loadDashboardLocal();
        
        // 2. EXPLORE: Grid Fix
        // Check if locationGrid exists AND contains skeletons
        if (document.getElementById('locationGrid')?.querySelector('.skeleton-box')) this.renderExploreLocations('major');

        // 3. LOCAL: City Grid Fix
        // Check if localCityGrid exists AND contains skeletons
        if (document.getElementById('localCityGrid')?.querySelector('.skeleton-box')) this.renderLocalGrid();
        
        // 4. EXPLORE PAGE INIT (Hydration Fix)
        // Use 'dataset.hydrated' on the container itself. If the router swaps the view, 
        // this attribute disappears, correctly triggering a reload.
        const explorePage = document.querySelector('.content-scroll[data-page="explore"]');
        if (explorePage && !explorePage.dataset.hydrated) {
            this.renderExploreLocations('major'); // Ensure grid is drawn
            this.loadExploreFeed('Global');       // Load default feed
            explorePage.dataset.hydrated = "true";
        }

        // 5. LOCAL PAGE INIT (Hydration Fix)
        const localPage = document.querySelector('.content-scroll[data-page="local"]');
        if (localPage && !localPage.dataset.hydrated) {
            this.loadLocalFeed();
            // Also ensure the city grid is rendered immediately
            this.renderLocalGrid();
            localPage.dataset.hydrated = "true";
        }

        // 6. FOLLOW BUTTON
        const followBtn = document.getElementById('followBtn');
        if (followBtn && followBtn.dataset.artistId) {
            const artistId = followBtn.dataset.artistId;
            if (followBtn.dataset.checkedArtist !== artistId) {
                this.checkFollowStatus(artistId);
                followBtn.dataset.checkedArtist = artistId; 
            }
        }

        // 7. LIST LIKE BUTTONS
        const trackLikeBtns = document.querySelectorAll('.track-list-compact .row-btn[data-song-id]');
        trackLikeBtns.forEach(btn => {
            if(!btn.dataset.checked) {
                this.checkSongLikeStatus(btn.dataset.songId, btn.querySelector('i'));
                btn.dataset.checked = "true";
            }
        });

        // 8. SETTINGS
        const settingsPage = document.querySelector('.content-scroll[data-page="settings"]');
        if (settingsPage && !settingsPage.dataset.hydrated) {
            this.loadSettingsPage(settingsPage);
        }

        // 9. Favorites Page
        const favPage = document.querySelector('.content-scroll[data-page="favorites"]');
        if (favPage && !favPage.dataset.hydrated) {
            this.loadFavorites();
            favPage.dataset.hydrated = "true"; // Mark THIS view instance as loaded
        }
    }

    // [NEW] Load Favorites List
    async loadFavorites() {
        const container = document.getElementById('favoritesList');
        if (!container) return;
        
        container.innerHTML = '<div class="track-row skeleton-box"></div><div class="track-row skeleton-box"></div>';

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/favorites', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            container.innerHTML = '';
            
            if (data.songs.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center; padding:50px; color:var(--text-muted)">
                        <i class="far fa-heart" style="font-size:3rem; margin-bottom:15px; opacity:0.5"></i>
                        <h3>No likes yet</h3>
                        <p>Go explore and heart some tracks!</p>
                        <button onclick="navigateTo('/player/explore')" style="margin-top:10px; background:var(--accent-orange); border:none; padding:8px 16px; border-radius:20px; color:white; cursor:pointer">Find Music</button>
                    </div>`;
                return;
            }

            data.songs.forEach((track, index) => {
                const row = document.createElement('div');
                row.className = 'track-row';
                // Click row to play just this song
                row.onclick = (e) => {
                     // Prevent firing if clicked heart or add buttons
                    if(e.target.closest('button')) return;
                    window.playSong(track.id, track.title, track.artist, track.img, track.audioUrl, track.duration);
                };

                row.innerHTML = `
                    <span class="track-num">${index + 1}</span>
                    <img class="track-img" src="${track.img}">
                    <div class="track-info-row">
                        <span class="t-title">${track.title}</span>
                        <span class="t-plays">${track.artist}</span>
                    </div>
                    <div class="row-controls" style="display:flex; gap:10px; align-items:center; margin-right:15px">
                        <button class="row-btn" onclick="addToQueue('${track.id}', '${track.title.replace(/'/g, "\\'")}', '${track.artist.replace(/'/g, "\\'")}', '${track.img}', '${track.audioUrl}', '${track.duration}')">
                            <i class="fas fa-list"></i>
                        </button>
                        <button class="row-btn" data-song-id="${track.id}" onclick="toggleSongLike(this, '${track.id}', '${track.title.replace(/'/g, "\\'")}', '${track.artist.replace(/'/g, "\\'")}', '${track.img}', '${track.audioUrl}', '${track.duration}')">
                            <i class="fas fa-heart" style="color:#F4A261"></i>
                        </button>
                    </div>
                    <span class="t-time">${this.formatTime(track.duration)}</span>
                `;
                container.appendChild(row);
                
                // Ensure heart is checked (since this is the likes page, it should be!)
                this.checkSongLikeStatus(track.id, row.querySelector('.fa-heart'));
            });

        } catch (e) { console.error("Load Favs Error:", e); }
    }

    // [NEW] Play All Favorites (Queues them up)
    async playAllFavorites() {
        if (!auth.currentUser) return;
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/favorites', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (data.songs && data.songs.length > 0) {
                // Play first song immediately
                const first = data.songs[0];
                window.playSong(first.id, first.title, first.artist, first.img, first.audioUrl, first.duration);
                
                // Queue the rest
                for (let i = 1; i < data.songs.length; i++) {
                    const s = data.songs[i];
                    this.engine.addToQueue({ 
                        id: s.id, title: s.title, artist: s.artist, 
                        artUrl: s.img, audioUrl: s.audioUrl, duration: s.duration 
                    });
                }
                
                // Feedback
                const toast = document.createElement('div');
                toast.innerText = `Playing ${data.songs.length} Liked Songs`;
                toast.style.cssText = `position:fixed; bottom:80px; right:20px; background:var(--accent-orange); color:white; padding:10px 20px; border-radius:4px; z-index:1000; font-weight:bold;`;
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 2000);
            }
        } catch (e) { console.error(e); }
    }

    // Helper for time format (if not already present)
    formatTime(seconds) {
        if (!seconds) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }


    // --- CARD & UI HELPERS ---
    createSongCard(song) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.style.minWidth = '160px'; 
        card.onclick = () => window.playSong(song.id, song.title, song.artist, song.img, song.audioUrl, song.duration);
        card.innerHTML = `
            <div class="img-container">
                <img src="${song.img}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">
                <div class="play-overlay" style="display:flex; gap:10px; justify-content:center; align-items:center; background:rgba(0,0,0,0.6)">
                    <button onclick="event.stopPropagation(); playSong('${song.id}', '${song.title}', '${song.artist}', '${song.img}', '${song.audioUrl}', '${song.duration}')" style="background:white; color:black; border:none; border-radius:50%; width:40px; height:40px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fas fa-play"></i></button>
                    <button onclick="event.stopPropagation(); addToQueue('${song.id}', '${song.title}', '${song.artist}', '${song.img}', '${song.audioUrl}', '${song.duration}')" style="background:rgba(255,255,255,0.2); color:white; border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fas fa-list"></i></button>
                    <button class="card-like-btn" onclick="event.stopPropagation(); toggleSongLike(this, '${song.id}', '${song.title}', '${song.artist}', '${song.img}', '${song.audioUrl}', '${song.duration}')" style="background:rgba(255,255,255,0.2); color:white; border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="far fa-heart"></i></button>
                </div>
            </div>
            <div class="card-info"><div class="card-title">${song.title}</div><div class="card-subtitle">${song.artist}</div></div>`;
        this.checkSongLikeStatus(song.id, card.querySelector('.card-like-btn i'));
        return card;
    }

    createArtistCircle(artist, locationName) {
        const circle = document.createElement('div');
        circle.className = 'artist-circle-item';
        circle.style.cssText = "display:flex; flex-direction:column; align-items:center; min-width:120px; cursor:pointer;";
        circle.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
        circle.innerHTML = `<img src="${artist.img}" style="width:120px; height:120px; border-radius:50%; object-fit:cover; border:2px solid #fff; box-shadow:0 4px 10px rgba(0,0,0,0.1);"><span style="margin-top:10px; font-weight:700; font-size:0.9rem; text-align:center;">${artist.name}</span><span style="font-size:0.8rem; color:#888;">${artist.location || locationName}</span>`;
        return circle;
    }

    createArtistCard(artist) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
        card.innerHTML = `<div class="img-container"><img src="${artist.img}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;"></div><div class="card-info"><div class="card-title">${artist.name}</div><div class="card-subtitle">${artist.genre}</div></div>`;
        return card;
    }

    createMatchCircle(artist) {
        const circle = document.createElement('div');
        circle.className = 'artist-circle-item';
        circle.style.cssText = "display:flex; flex-direction:column; align-items:center; min-width:100px; cursor:pointer;";
        circle.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
        circle.innerHTML = `<img src="${artist.img}" style="width:100px; height:100px; border-radius:50%; object-fit:cover; border:2px solid var(--accent-orange);"><span style="margin-top:8px; font-weight:700; font-size:0.8rem; text-align:center;">${artist.name}</span><span style="font-size:0.7rem; color:var(--accent-orange);">98% Match</span>`;
        return circle;
    }

    createEmptyState(msg) {
        return `<div style="padding:20px; color:var(--text-muted); font-size:0.9rem; width:100%; text-align:center;">${msg}</div>`;
    }

    // [FIX] Hydrate with Flag
    async loadSettingsPage(container) {
        // 1. Mark as hydrated IMMEDIATELY to stop the Observer loop
        container.dataset.hydrated = "true";

        // 2. Populate Email
        const emailEl = document.getElementById('settingsEmail');
        if (emailEl && auth.currentUser.email) {
            emailEl.innerText = auth.currentUser.email;
        }

        // 3. Fetch Data
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/settings', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            window.globalUserCache = data;
            const settings = data.settings || {};
            
            const setVal = (name, val) => {
                const el = document.querySelector(`[name="${name}"]`);
                if (!el) return;
                if (el.type === 'checkbox') el.checked = val;
                else el.value = val;
            };

            setVal('audioQuality', settings.audioQuality || 'auto');
            setVal('normalizeVolume', settings.normalizeVolume);
            setVal('crossfade', settings.crossfade || 3);
            if(document.getElementById('fadeVal')) document.getElementById('fadeVal').innerText = (settings.crossfade || 3) + 's';

            setVal('allocationMethod', settings.allocationMethod || 'even');
            setVal('rolloverPref', settings.rolloverPref || 'rollover');
            setVal('publicReceipts', settings.publicReceipts);
            setVal('ghostMode', settings.ghostMode);
            setVal('localVisibility', settings.localVisibility);
            setVal('tasteMatch', settings.tasteMatch);

            const planEl = document.querySelector('.setting-desc.plan-name');
            if(planEl && data.subscription) planEl.innerText = (data.subscription.plan || 'Individual') + ' Plan';

        } catch (e) { console.error("Settings Hydration Failed", e); }
    }

    async loadExploreFeed(locationName) {
        const title1 = document.getElementById('explore-title-1');
        const title2 = document.getElementById('explore-title-2');
        if (title1) title1.innerText = locationName === 'Global' ? 'Trending Worldwide' : `Trending in ${locationName}`;
        if (title2) title2.innerText = locationName === 'Global' ? 'Featured Artists' : `${locationName} Scene`;

        const row1 = document.getElementById('explore-row-1');
        const artistRow = document.getElementById('explore-artists');
        const row2 = document.getElementById('explore-row-2');

        // Reset to skeletons if re-loading
        if (row1) row1.innerHTML = '<div class="media-card skeleton-box"></div><div class="media-card skeleton-box"></div>';
        
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/explore/feed?location=${encodeURIComponent(locationName)}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (row1 && data.trending) {
                row1.innerHTML = '';
                if (data.trending.length === 0) row1.innerHTML = this.createEmptyState('No trending tracks yet.');
                else data.trending.forEach(song => row1.appendChild(this.createSongCard(song)));
            }

            if (artistRow && data.localArtists) {
                artistRow.innerHTML = '';
                if (data.localArtists.length === 0) {
                    artistRow.innerHTML = `<div class="empty-placeholder" style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; min-height:120px; color:var(--text-muted); padding:0 20px;"><div style="background:rgba(255,255,255,0.05); width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:10px; border:1px dashed var(--text-muted);"><i class="fas fa-user-plus" style="font-size:1.2rem; opacity:0.7"></i></div><span style="font-size:0.9rem; font-weight:700">Scene Loading...</span><span style="font-size:0.8rem; text-align:center">No artists from ${locationName} have joined yet.</span></div>`;
                } else {
                    data.localArtists.forEach(artist => artistRow.appendChild(this.createArtistCircle(artist, locationName)));
                }
            }

            if (row2 && data.crates) {
                row2.innerHTML = '';
                if (data.crates.length === 0) row2.innerHTML = this.createEmptyState('No playlists found.');
                else data.crates.forEach(song => row2.appendChild(this.createSongCard(song)));
            }
        } catch (e) { console.error("Explore Load Error:", e); }
    }

    async loadLocalFeed() {
        const row1 = document.getElementById('local-row-1'); 
        const row2 = document.getElementById('local-events'); 
        const row3 = document.getElementById('local-curators'); 

        // Set Skeletons
        if(row1) row1.innerHTML = '<div class="media-card skeleton-box"></div><div class="media-card skeleton-box"></div>';
        
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/local/feed', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (row1) {
                row1.innerHTML = '';
                if (!data.topLocal || data.topLocal.length === 0) row1.innerHTML = this.createEmptyState(`No artists found in ${data.city}. Be the first?`);
                else data.topLocal.forEach(artist => row1.appendChild(this.createArtistCard(artist)));
            }

            if (row2) {
                row2.innerHTML = '';
                const title2 = document.getElementById('local-title-2');
                if(title2) title2.innerText = `Fresh Drops in ${data.city}`;
                if (!data.localCrates || data.localCrates.length === 0) row2.innerHTML = this.createEmptyState('No local tracks uploaded recently.');
                else data.localCrates.forEach(song => row2.appendChild(this.createSongCard(song)));
            }

            if (row3) {
                row3.innerHTML = '';
                const title3 = document.getElementById('local-title-3');
                if(title3) title3.innerText = `For You (${data.city})`;
                if (!data.vibeMatches || data.vibeMatches.length === 0) row3.innerHTML = this.createEmptyState("Add genres to your profile to see matches.");
                else data.vibeMatches.forEach(artist => row3.appendChild(this.createMatchCircle(artist)));
            }
        } catch (e) { console.error("Local Feed Error:", e); }
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
                    // [NEW] Load Likes Cache
                    this.loadUserLikes();
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

   // ... (Keep Cards with Play/Queue/Like buttons) ...
    async loadNewReleases() {
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
                    
                    card.innerHTML = `
                        <div class="img-container">
                            <img src="${song.artUrl}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">
                            <div class="play-overlay" style="display:flex; gap:10px; justify-content:center; align-items:center; background:rgba(0,0,0,0.6)">
                                <button onclick="event.stopPropagation(); playSong('${song.id}', '${song.title}', '${song.artist}', '${song.artUrl}', '${song.audioUrl}', '${song.duration}')" style="background:white; color:black; border:none; border-radius:50%; width:40px; height:40px; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                                    <i class="fas fa-play"></i>
                                </button>
                                <button onclick="event.stopPropagation(); addToQueue('${song.id}', '${song.title}', '${song.artist}', '${song.artUrl}', '${song.audioUrl}', '${song.duration}')" style="background:rgba(255,255,255,0.2); color:white; border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                                    <i class="fas fa-list"></i>
                                </button>
                                <button class="card-like-btn" onclick="event.stopPropagation(); toggleSongLike(this, '${song.id}', '${song.title}', '${song.artist}', '${song.artUrl}', '${song.audioUrl}', '${song.duration}')" style="background:rgba(255,255,255,0.2); color:white; border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                                    <i class="far fa-heart"></i>
                                </button>
                            </div>
                        </div>
                        <div class="card-info">
                            <div class="card-title">${song.title}</div>
                            <div class="card-subtitle">${song.artist}</div>
                        </div>`;
                    
                    container.appendChild(card);
                    
                    const btn = card.querySelector('.card-like-btn');
                    this.checkSongLikeStatus(song.id, btn.querySelector('i'));
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

    renderExploreLocations(category) {
        const grid = document.getElementById('locationGrid');
        if (!grid) return;
        const locs = LOCATIONS[category] || LOCATIONS.major;
        grid.innerHTML = '';
        locs.forEach(loc => {
            const card = document.createElement('div'); card.className = 'mood-card';
            card.style.backgroundColor = `hsl(${loc.color}, 60%, 90%)`; card.style.borderColor = `hsl(${loc.color}, 60%, 80%)`;
            card.onclick = () => this.loadExploreFeed(loc.name);
            card.innerHTML = `<span class="mood-icon" style="font-size:2rem">${loc.emoji}</span><span class="mood-name">${loc.name}</span>`;
            grid.appendChild(card);
        });
        document.querySelectorAll('.mood-tab').forEach(btn => btn.classList.remove('active'));
        if (event && event.currentTarget && event.currentTarget.classList.contains('mood-tab')) event.currentTarget.classList.add('active');
    }

    renderLocationGrid(category) {
        const grid = document.getElementById('locationGrid');
        if (!grid) return;
        const locs = LOCATIONS[category] || LOCATIONS.major;
        grid.innerHTML = '';
        locs.forEach(loc => {
            const card = document.createElement('div'); card.className = 'mood-card';
            card.style.backgroundColor = `hsl(${loc.color}, 60%, 90%)`; card.style.borderColor = `hsl(${loc.color}, 60%, 80%)`;
            card.onclick = () => this.loadLocationScene(loc); 
            card.innerHTML = `<span class="mood-icon" style="font-size:2rem">${loc.emoji}</span><span class="mood-name">${loc.name}</span>`;
            grid.appendChild(card);
        });
    }
    
    // [FIX] Render Local City Grid (Was failing due to bad selectors)
    renderLocalGrid() {
        const grid = document.getElementById('localCityGrid');
        if (!grid) return;
        
        // Grab state from subtitle or default
        const stateText = document.querySelector('.dashboard-hero .subtitle')?.innerText || "California";
        const stateName = stateText.replace("Pulse of ", "").trim();
        
        const cities = STATE_CITIES[stateName] || STATE_CITIES['California'];
        
        grid.innerHTML = '';
        cities.forEach(city => {
            const card = document.createElement('div'); 
            card.className = 'mood-card';
            card.style.backgroundColor = `hsl(${city.color}, 60%, 90%)`; 
            
            // On click, just reload the page with new city param (easiest for now)
            // or trigger loadLocalFeed() if we had a way to pass city to it dynamically
            card.onclick = () => window.navigateTo(`/player/local?city=${city.name}`);
            
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

   // [UPDATED] Player Update (Checks Heart)
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
        const heartIcon = document.querySelector('.player-full .fa-heart') || document.querySelector('.mp-controls .fa-heart');
        if (heartIcon) this.checkSongLikeStatus(track.id, heartIcon);
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

    // [NEW] ADD TO QUEUE Global Function
    addToQueue(id, title, artist, artUrl, audioUrl, duration) {
        this.engine.addToQueue({ id, title, artist, artUrl, audioUrl, duration });
        
        // Show Toast Feedback
        const toast = document.createElement('div');
        toast.innerText = `Added to Queue: ${title}`;
        toast.style.cssText = `position:fixed; bottom:80px; right:20px; background:#333; color:#fff; padding:10px 20px; border-radius:5px; z-index:1000; animation: fadeIn 0.3s;`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

   // --- GLOBAL FUNCTIONS ---
    exposeGlobalFunctions() {
        window.playSong = (id, title, artist, artUrl, audioUrl, duration) => {
            const dur = duration ? parseFloat(duration) : 0;
            this.engine.play(id, { title, artist, artUrl, audioUrl, duration: dur }); 
        };
        window.togglePlay = () => this.engine.togglePlay();
        window.togglePlayerSize = this.togglePlayerSize;
        window.navigateTo = window.navigateTo; 
        // [NEW] Expose Queue
        window.addToQueue = (id, title, artist, artUrl, audioUrl, duration) => {
            if(event) event.stopPropagation(); // Stop row click
            this.addToQueue(id, title, artist, artUrl, audioUrl, duration);
        };

        window.playAllFavorites = () => this.playAllFavorites();
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
        
        window.switchSettingsTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById('tab-' + tabName);
            if(target) target.style.display = 'block';
            document.querySelectorAll('.settings-tabs .tab-btn').forEach(el => el.classList.remove('active'));
            if(event && event.currentTarget) event.currentTarget.classList.add('active');
        };

        window.switchArtistTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById('tab-' + tabName);
            if(target) target.style.display = 'block';
            document.querySelectorAll('.profile-tabs .tab-btn').forEach(el => el.classList.remove('active'));
            if(event && event.currentTarget) event.currentTarget.classList.add('active');
        };

        window.updateSetting = (key, value) => this.updateGlobalSetting(key, value);
        window.updateEQ = () => {
            const high = document.querySelector('input[name="eqHigh"]')?.value;
            const mid = document.querySelector('input[name="eqMid"]')?.value;
            const low = document.querySelector('input[name="eqLow"]')?.value;
            if (high) this.updateGlobalSetting('eqHigh', parseFloat(high));
            if (mid) this.updateGlobalSetting('eqMid', parseFloat(mid));
            if (low) this.updateGlobalSetting('eqLow', parseFloat(low));
        };

        window.filterLocations = (cat) => this.renderExploreLocations(cat);
        window.filterLocalCities = (cat) => this.renderLocalGrid();

        // Like Button Logic
        window.toggleSongLike = (btn, id, title, artist, art, audio, dur) => {
            if (event) event.stopPropagation(); 
            this.toggleSongLike(btn, id, title, artist, art, audio, dur);
        };
        
        // [NEW] Toggle Player Heart
        window.togglePlayerLike = () => this.togglePlayerLike();

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
