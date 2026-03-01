/* public/javascripts/uiController.js */
import { db } from './firebase-config.js';
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Import our new modular controllers
import { WalletController } from './controllers/WalletController.js';
import { ProfileController } from './controllers/ProfileController.js';
import { DashboardController } from './controllers/DashboardController.js';
import { SocialController, ArtistCommentsManager } from './controllers/SocialController.js';
import { AudioUIController } from './controllers/AudioUIController.js';
// NotificationController loaded dynamically in constructor so a missing file
// cannot prevent this module from executing and registering window globals.

// CitySoundscapeMap loaded dynamically — missing file won't crash the module
let CitySoundscapeMap = null;
import('./citySoundscapeMap.js')
    .then(m => { CitySoundscapeMap = m.CitySoundscapeMap; })
    .catch(() => console.warn('[ui] citySoundscapeMap.js not found — map disabled'));

const auth = getAuth();
window.globalUserCache = null;

// ==========================================
// CORE UI CONTROLLER (The Command Center)
// ==========================================
export class PlayerUIController {
    constructor(engine) {
        window.ui = this;
        this.engine = engine;
        this.isMinimized = true; 
        this.togglePlayerSize = this.togglePlayerSize.bind(this);
        
        // Initialize Sub-Controllers
        this.walletController = new WalletController(this);
        this.profileController = new ProfileController(this);
        this.dashboardController = new DashboardController(this);
        this.socialController = new SocialController(this);
        this.audioUIController = new AudioUIController(this);
        // NotificationController loads dynamically — a missing file won't crash the app
        this.notificationController = null;
        import('./controllers/NotificationController.js')
            .then(({ NotificationController }) => {
                this.notificationController = new NotificationController(this);
            })
            .catch(() => {
                console.warn('[ui] NotificationController not found — notifications disabled');
            });

        this.init();
    }

    init() {
        this.initAuthListener();
        this.exposeGlobalFunctions();
        this.setupViewObserver();
        this.socialController.setupOmniSearch();

        // Close dropdowns when clicking outside
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

    // ==========================================
    // AUTHENTICATION & INITIALIZATION
    // ==========================================
    initAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    // ── GUARD: Artist accounts must not load the player app ──────
                    // Check if this UID has a users/ doc. If not, or if role === 'artist',
                    // they are an artist-only account — send them to their studio.
                    const userDoc = await getDoc(doc(db, "users", user.uid));

                    if (!userDoc.exists()) {
                        // No fan doc — look up which artistId owns this UID
                        const artistSnap = await getDocs(
                            query(collection(db, "artists"), where("ownerUid", "==", user.uid))
                        );
                        const artistId = artistSnap.empty ? null : artistSnap.docs[0].id;
                        const dest = artistId
                            ? `/artist/studio?artistId=${artistId}`
                            : '/artist/login';
                        console.warn('[ui] Artist account attempted to load player — redirecting to studio');
                        window.location.href = dest;
                        return;
                    }

                    const data = userDoc.data();

                    if (data.role === 'artist') {
                        // Had a stale users/ doc from the old approval flow — redirect
                        const dest = data.artistId
                            ? `/artist/studio?artistId=${data.artistId}`
                            : '/artist/login';
                        console.warn('[ui] Artist role account blocked from player — redirecting');
                        window.location.href = dest;
                        return;
                    }
                    // ── END GUARD ────────────────────────────────────────────────
                    // At this point we have a valid fan/subscriber account.
                    window.globalUserCache = { ...window.globalUserCache, ...data };
                    this.engine.updateSettings(data.settings || {});
                    this.checkUserTheme(data);
                    
                    const nameEl = document.getElementById('profileName');
                    const picEl = document.getElementById('profilePic');
                    if (nameEl) nameEl.innerText = data.handle || "Member";
                    if (picEl && data.photoURL) picEl.src = this.fixImageUrl(data.photoURL);
                    
                    this.renderSidebarArtists(data.sidebarArtists || []);

                    this.loadUserWallet();
                    this.notificationController?.init();
                    
                    // 2. Delegate ALL page loading to the unified router
                    this.checkAndReloadViews();

                } catch (err) { console.error("Auth Init Error:", err); }
            }
        });
    }

    // ==========================================
    // VIEW ROUTER (SPA Hydration Logic)
    // ==========================================
    checkAndReloadViews() {
        if (!auth.currentUser) return; 

        const currentPage = document.querySelector('.content-scroll');
        const pageType = currentPage ? currentPage.dataset.page : null;

        if (!pageType) return;
        if (currentPage.dataset.hydrated === "true") return;

        // Route to the appropriate controller based on the view
        switch(pageType) {
            case 'dashboard':
                this.dashboardController.loadSceneDashboard();
                if (!window.globalUserCache?.likedSongs) this.socialController.loadUserLikes();
                break;
            case 'favorites':
                this.loadFavorites();
                if (!window.globalUserCache?.likedSongs) this.socialController.loadUserLikes();
                break;
            case 'wallet':
                this.walletController.initWalletPage();
                break;
            case 'profile':
                this.profileController.loadProfilePage();
                
                const saveBtn = document.getElementById('saveProfileBtn');
                if (saveBtn) saveBtn.onclick = () => this.profileController.saveProfileChanges();
                
                const cancelBtn = document.getElementById('cancelEditBtn');
                if (cancelBtn) cancelBtn.onclick = () => this.profileController.toggleProfileEditMode();
                break;
            case 'settings':
                this.audioUIController.loadSettingsPage(currentPage);
                break;
            case 'crate-view':
                const crateId = currentPage.dataset.crateId;
                if(crateId) this.dashboardController.loadCrateView(crateId);
                break;
            case 'artist-profile':
                const artistId = window.location.pathname.split('/').pop();
                if (artistId && artistId !== 'artist') {
                    if (window.artistComments) window.artistComments = null;
                    window.artistComments = new ArtistCommentsManager(artistId, auth.currentUser.uid);
                    window.artistComments.init();
                }
                break;
        }

        // Check for Tab Parameter
        const urlParams = new URLSearchParams(window.location.search);
        const targetTab = urlParams.get('tab');
        if (targetTab) {
            setTimeout(() => window.switchProfileTab(targetTab), 100);
        }

        currentPage.dataset.hydrated = "true";
        this.updateSidebarState();
        this.hydrateGlobalButtons(); 
        this.loadUserWallet(); 
    }

    setupViewObserver() {
        const observer = new MutationObserver(() => {
            this.checkAndReloadViews();
            this.updateSidebarState();
        });
        const target = document.querySelector('.main-wrapper') || document.body;
        observer.observe(target, { childList: true, subtree: true });
    }

    updateSidebarState() {
        const currentPath = window.location.pathname;
        document.querySelectorAll('.sidebar .nav-item').forEach(item => {
            item.classList.remove('active');
            const onClickAttr = item.getAttribute('onclick');
            if (onClickAttr && onClickAttr.includes(currentPath)) item.classList.add('active');
        });
    }

    hydrateGlobalButtons() {
        const followBtns = document.querySelectorAll('#followBtn');
        followBtns.forEach(btn => {
            if (btn.dataset.artistId && !btn.dataset.checked) {
                this.socialController.checkFollowStatus(btn.dataset.artistId);
                btn.dataset.checked = "true";
            }
        });
        
        const likeBtns = document.querySelectorAll('.card-like-btn i, .row-btn i.fa-heart, .player-full .fa-heart, .mp-controls .fa-heart');
        likeBtns.forEach(icon => {
            const btn = icon.closest('button') || icon.parentElement;
            let songId = btn.dataset.songId;
            if(!songId && this.engine.currentTrack) songId = this.engine.currentTrack.id;
            if(songId) this.socialController.checkSongLikeStatus(songId, icon);
        });
    }

    // ==========================================
    // SHARED DATA FETCHERS
    // ==========================================
    async loadUserWallet() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            const balance = Number(data.balance).toFixed(2);

            const sidebarBal = document.getElementById('userWalletBalance');
            if (sidebarBal) sidebarBal.innerText = balance;

            document.querySelectorAll('.menu-balance, #dropdownWalletBalance').forEach(el => {
                el.innerText = `$${balance}`;
            });
        } catch (e) { console.error("Wallet Sync Error", e); }
    }

    async loadFavorites() {
        const container = document.getElementById('favoritesList');
        if (!container) return;

        const CACHE_DURATION = 5 * 60 * 1000; 
        const now = Date.now();

        if (window.globalUserCache?.favorites && (now - window.globalUserCache.favoritesTimestamp < CACHE_DURATION)) {
            this.renderFavoritesList(window.globalUserCache.favorites);
            return;
        }

        container.innerHTML = '<div class="track-row skeleton-box"></div><div class="track-row skeleton-box"></div>';
        
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/favorites', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache.favorites = data.songs;
            window.globalUserCache.favoritesTimestamp = now;

            this.renderFavoritesList(data.songs);
        } catch (e) { 
            console.error("Load Favs Error:", e);
            container.innerHTML = this.createEmptyState("Failed to load favorites.");
        }
    }

    // ==========================================
    // UI COMPONENT GENERATORS (Cards & HTML)
    // ==========================================
    createSongCard(song) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.style.minWidth = '160px'; 
        
        const artistId = song.artistId || song.artist_id || null;
        
        card.onclick = () => window.playSong(song.id, song.title, song.artist, song.img, song.audioUrl, song.duration, artistId);
        
        card.innerHTML = `
            <div class="img-container">
                <img src="${song.img}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">
                <div class="play-overlay" style="display:flex; gap:10px; justify-content:center; align-items:center; background:rgba(0,0,0,0.6)">
                    <button onclick="event.stopPropagation(); playSong('${song.id}', '${song.title.replace(/'/g, "\\'")}', '${song.artist.replace(/'/g, "\\'")}', '${song.img}', '${song.audioUrl}', '${song.duration}', '${artistId || ''}')" style="background:white; color:black; border:none; border-radius:50%; width:40px; height:40px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fas fa-play"></i></button>
                    <button class="card-like-btn" data-song-id="${song.id}" onclick="event.stopPropagation(); window.ui.toggleSongLike(this, '${song.id}', '${song.title.replace(/'/g, "\\'")}', '${song.artist.replace(/'/g, "\\'")}', '${song.img}', '${song.audioUrl}', '${song.duration}')" style="background:rgba(255,255,255,0.2); color:white; border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="far fa-heart"></i></button>
                </div>
            </div>
            <div class="card-info"><div class="card-title">${song.title}</div><div class="card-subtitle">${song.artist}</div></div>`;
            
        this.socialController.checkSongLikeStatus(song.id, card.querySelector('.card-like-btn i'));
        return card;
    }

    createCrateCard(crate) {
        const card = document.createElement('div');
        card.className = 'media-card crate-card-dashboard';
        card.style.minWidth = '160px'; 
        card.onclick = () => window.navigateTo(`/player/crate/${crate.id}`);
        
        const image = this.fixImageUrl(crate.img || crate.coverImage || 'https://via.placeholder.com/150');
        let genreTag = '';
        if (crate.genres && crate.genres.length > 0) {
            genreTag = `<span style="font-size:0.65rem; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; color:#aaa;">${crate.genres[0]}</span>`;
        }
        const count = crate.songCount || crate.trackCount || 0;

        card.innerHTML = `
            <div class="img-container" style="position:relative; border-radius:12px; overflow:hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
                <img src="${image}" loading="lazy" style="width:100%; height:100%; object-fit:cover; transition:transform 0.3s;">
                <div class="play-overlay" style="display:flex; justify-content:center; align-items:center; background:rgba(0,0,0,0.4); position:absolute; inset:0; opacity:0; transition:opacity 0.2s;">
                    <i class="fas fa-box-open" style="color:white; font-size:2rem; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))"></i>
                </div>
                <div style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.7); color:white; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:700; backdrop-filter:blur(4px);">${count} tracks</div>
            </div>
            <div class="card-info" style="padding-top:8px;">
                <div class="card-title" style="margin-bottom:2px; font-size:0.95rem;">${crate.title}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="card-subtitle" style="opacity:0.7; font-size:0.8rem;">by ${crate.creatorHandle || 'Anonymous'}</div>
                    ${genreTag}
                </div>
            </div>`;
            
        card.onmouseenter = () => {
            const img = card.querySelector('img');
            const overlay = card.querySelector('.play-overlay');
            if(img) img.style.transform = 'scale(1.05)';
            if(overlay) overlay.style.opacity = '1';
        };
        card.onmouseleave = () => {
            const img = card.querySelector('img');
            const overlay = card.querySelector('.play-overlay');
            if(img) img.style.transform = 'scale(1)';
            if(overlay) overlay.style.opacity = '0';
        };
        return card;
    }

    createArtistCircle(artist, locationName) {
        const circle = document.createElement('div');
        circle.className = 'artist-circle-item';
        circle.style.cssText = "display:flex; flex-direction:column; align-items:center; min-width:120px; cursor:pointer;";
        circle.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
        circle.innerHTML = `<img src="${artist.img || 'https://via.placeholder.com/100'}" style="width:120px; height:120px; border-radius:50%; object-fit:cover; border:2px solid #fff; box-shadow:0 4px 10px rgba(0,0,0,0.1);"><span style="margin-top:10px; font-weight:700; font-size:0.9rem; text-align:center;">${artist.name || artist.handle}</span><span style="font-size:0.8rem; color:#888;">${artist.location || locationName}</span>`;
        return circle;
    }

    renderFavoritesList(songs) {
        const container = document.getElementById('favoritesList');
        if (!container) return;
        container.innerHTML = '';
        
        if (!songs || songs.length === 0) {
            container.innerHTML = this.createEmptyState("Go explore the scene and heart some tracks!");
            return;
        }

        songs.forEach((track, index) => {
            const row = document.createElement('div');
            row.className = 'track-row';
            row.onclick = (e) => {
                if(e.target.closest('button')) return;
                window.playSong(track.id, track.title, track.artist, track.img, track.audioUrl, track.duration);
            };

            row.innerHTML = `
                <span class="track-num">${index + 1}</span>
                <img class="track-img" src="${track.img}" loading="lazy">
                <div class="track-info-row">
                    <span class="t-title">${track.title}</span>
                    <span class="t-plays">${track.artist}</span>
                </div>
                <div class="row-controls" style="display:flex; gap:10px; align-items:center; margin-right:15px">
                    <button class="row-btn" onclick="addToQueue('${track.id}', '${track.title.replace(/'/g, "\\'")}', '${track.artist.replace(/'/g, "\\'")}', '${track.img}', '${track.audioUrl}', '${track.duration}')">
                        <i class="fas fa-list"></i>
                    </button>
                    <button class="row-btn" data-song-id="${track.id}" onclick="window.ui.toggleSongLike(this, '${track.id}', '${track.title.replace(/'/g, "\\'")}', '${track.artist.replace(/'/g, "\\'")}', '${track.img}', '${track.audioUrl}', '${track.duration}')">
                        <i class="fas fa-heart" style="color:#F4A261"></i>
                    </button>
                </div>
                <span class="t-time">${this.audioUIController.formatTime(track.duration)}</span>
            `;
            container.appendChild(row);
        });
    }

    renderSidebarArtists(artists) {
        const container = document.getElementById('sidebarArtistList');
        if (!container) return;
        if (!artists || artists.length === 0) {
            container.innerHTML = '<div style="padding:10px; font-size:0.8rem; color:#888">No artists followed yet.</div>';
            return;
        }
        container.innerHTML = artists.map(artist => `
            <div class="artist-item" onclick="navigateTo('/player/artist/${artist.id}')">
                <img src="${artist.img || 'https://via.placeholder.com/50'}" style="background:#333; width:32px; height:32px; border-radius:50%; object-fit:cover;">
                <span>${artist.name}</span>
            </div>`).join('');
    }

    createEmptyState(msg) {
        return `<div style="padding:20px; color:var(--text-muted); font-size:0.9rem; width:100%; text-align:center;">${msg}</div>`;
    }

    showToast(msg, type='info') {
        const toast = document.createElement('div');
        toast.innerText = msg;
        const bgColor = type === 'error' ? '#E63946' : type === 'success' ? '#2A9D8F' : '#333';
        toast.style.cssText = `position:fixed; bottom:80px; right:20px; background:${bgColor}; color:#fff; padding:10px 20px; border-radius:5px; z-index:1000; animation: fadeIn 0.3s;`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    fixImageUrl(url) {
        const CDN = 'https://cdn.eporiamusic.com';
        if (!url) return `${CDN}/assets/default-avatar.jpg`;
        if (!url.startsWith('http')) return `${CDN}/${url.replace(/^\//, '')}`;
        return url;
    }

    // ==========================================
    // THEMES & FONTS
    // ==========================================
    checkUserTheme(userData) {
        let targetTheme = null;
        if (userData.settings && userData.settings.theme) targetTheme = userData.settings.theme;
        else if (userData.theme) targetTheme = userData.theme;
        else if (userData.primaryGenre) targetTheme = userData.primaryGenre;
        else if (userData.genres && userData.genres.length > 0) targetTheme = userData.genres[0];

        if (targetTheme) this.applyGenreTheme(targetTheme);
    }

    applyGenreTheme(genreKey) {
        const themeSlug = genreKey.toLowerCase().replace(/_/g, '-');
        const themeClass = `theme-${themeSlug}`;
        document.body.classList.forEach(cls => {
            if (cls.startsWith('theme-')) document.body.classList.remove(cls);
        });
        document.body.classList.add(themeClass);
        this.injectGenreFonts(themeSlug);
    }

    injectGenreFonts(themeSlug) {
        const fontMap = {
            'pop':        'Montserrat:wght@800&family=Quicksand:wght@500;700',
            'electronic': 'Orbitron:wght@900&family=Rajdhani:wght@500;700',
            'hip-hop':    'Archivo+Black&family=Inter:wght@400;800',
            'rock':       'Teko:wght@600&family=Open+Sans:wght@400;800',
            'rnb':        'Playfair+Display:ital,wght@0,700;1,700&family=Lato:wght@400;700',
            'jazz':       'Abril+Fatface&family=Lora:ital,wght@0,500;1,500',
            'country':    'Rye&family=Merriweather:wght@400;900',
            'reggae':     'Chelsea+Market&family=Rubik:wght@400;700',
            'classical':  'Cinzel:wght@700&family=EB+Garamond:wght@400;600'
        };

        if (!fontMap[themeSlug]) return;
        const linkId = `font-${themeSlug}`;
        if (document.getElementById(linkId)) return;

        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${fontMap[themeSlug]}&display=swap`;
        document.head.appendChild(link);
    }

    // ==========================================
    // GLOBAL WINDOW BINDINGS
    // ==========================================
    exposeGlobalFunctions() {
        window.playSong = (id, title, artist, artUrl, audioUrl, duration, artistId = null) => {
            this.engine.play(id, { 
                id: id, title: title, artist: artist, 
                artUrl: this.fixImageUrl(artUrl), 
                audioUrl: audioUrl, 
                duration: duration ? parseFloat(duration) : 0,
                artistId: artistId 
            }); 
        };

        window.togglePlayerSize = this.togglePlayerSize;
        window.toggleProfileMenu = () => document.getElementById('profileDropdown')?.classList.toggle('active');
        
        window.switchArtistTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById(`tab-${tabName}`);
            if (target) target.style.display = 'block';
            document.querySelectorAll('.profile-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
            if (event && event.target) event.target.classList.add('active');
        };

        window.switchProfileTab = (tab) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById(`tab-${tab}`);
            if(target) target.style.display = 'block';
            document.querySelectorAll('.tab-btn').forEach(btn => 
                btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(tab))
            );
        };

        window.switchSubTab = (subTab) => {
            const artistView = document.getElementById('followingArtistsView');
            const userView = document.getElementById('followingUsersView');
            const artistBtn = document.getElementById('subBtnArtists');
            const userBtn = document.getElementById('subBtnUsers');
            
            if (subTab === 'artists') {
                if(artistView) artistView.style.display = 'block';
                if(userView) userView.style.display = 'none';
                if(artistBtn) { artistBtn.classList.add('active'); artistBtn.style.opacity = '1'; artistBtn.style.color = 'var(--text-main)'; }
                if(userBtn) { userBtn.classList.remove('active'); userBtn.style.opacity = '0.6'; userBtn.style.color = 'var(--text-secondary)'; }
            } else {
                if(artistView) artistView.style.display = 'none';
                if(userView) userView.style.display = 'block';
                if(artistBtn) { artistBtn.classList.remove('active'); artistBtn.style.opacity = '0.6'; artistBtn.style.color = 'var(--text-secondary)'; }
                if(userBtn) { userBtn.classList.add('active'); userBtn.style.opacity = '1'; userBtn.style.color = 'var(--text-main)'; }
            }
        };

        window.switchStackTab = (stackTab) => {
            const createdView = document.getElementById('createdCratesView');
            const likedView = document.getElementById('likedCratesView');
            const createdBtn = document.getElementById('subBtnCreated');
            const likedBtn = document.getElementById('subBtnLiked');
            
            if (stackTab === 'created') {
                if(createdView) createdView.style.display = 'block';
                if(likedView) likedView.style.display = 'none';
                if(createdBtn) { createdBtn.classList.add('active'); createdBtn.style.opacity = '1'; createdBtn.style.color = 'var(--text-main)'; }
                if(likedBtn) { likedBtn.classList.remove('active'); likedBtn.style.opacity = '0.6'; likedBtn.style.color = 'var(--text-secondary)'; }
            } else {
                if(createdView) createdView.style.display = 'none';
                if(likedView) likedView.style.display = 'block';
                if(createdBtn) { createdBtn.classList.remove('active'); createdBtn.style.opacity = '0.6'; createdBtn.style.color = 'var(--text-secondary)'; }
                if(likedBtn) { likedBtn.classList.add('active'); likedBtn.style.opacity = '1'; likedBtn.style.color = 'var(--text-main)'; }
            }
        };

        window.switchSettingsTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById('tab-' + tabName);
            if(target) target.style.display = 'block';
            document.querySelectorAll('.settings-tabs .tab-btn').forEach(el => el.classList.remove('active'));
            if(event && event.currentTarget) event.currentTarget.classList.add('active');
        };

        // Link the template's "Explore Somewhere New" button to the controller
        window.openCitySearch = () => this.dashboardController.openCitySearch();

        // Link the Map's "Explore Scene" button to the controller
        window.navigateToCity = (city, state, country) => {
            this.dashboardController.navigateToCity(city, state, country);
        };


        window.CitySoundscapeMap = CitySoundscapeMap;
    }
    
    togglePlayerSize() {
        this.isMinimized = !this.isMinimized;
        const rightSidebar = document.getElementById('rightSidebar');
        if (rightSidebar) rightSidebar.classList.toggle('minimized', this.isMinimized);
    }
}