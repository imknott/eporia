/* public/javascripts/mobileUI.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();

export class MobileUIController {
    constructor(audioEngine) {
        this.engine = audioEngine;
        this.searchDebounce = null;
        this.init();
    }

    init() {
        console.log("📱 Mobile UI Initialized");
        this.setupPlayerStateListener();
        this.setupDataListeners();
        this.setupMobileSearch();
        this.bindEvents();
        
        // Check if data is already waiting
        if (window.globalUserCache) {
            this.syncUserProfile(window.globalUserCache);
        }
    }

    bindEvents() {
        // Close search on backdrop click
        const searchModal = document.getElementById('mobileSearchModal');
        if (searchModal) {
            searchModal.addEventListener('click', (e) => {
                if (e.target === searchModal) this.closeSearch();
            });
        }
        
        // Close profile menu on outside click
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('mobileProfileMenu');
            const trigger = document.querySelector('.mobile-profile-trigger');
            if (menu && menu.classList.contains('active')) {
                if (!menu.contains(e.target) && !trigger.contains(e.target)) {
                    menu.classList.remove('active');
                }
            }
        });
    }

    // ==========================================
    // 1. DATA SYNC (Profile & Wallet)
    // ==========================================
    setupDataListeners() {
        // Listen for the event fired by uiController.js after it fetches Firestore data
        window.addEventListener('userDataReady', () => {
            if (window.globalUserCache) {
                this.syncUserProfile(window.globalUserCache);
            }
        });
    }

    syncUserProfile(user) {
        // 1. Top Bar Avatar
        const avatarEl = document.getElementById('mobileProfileAvatar');
        if (avatarEl && user.photoURL) {
            avatarEl.src = user.photoURL;
        }

        // 2. Profile Menu Details
        const nameEl = document.querySelector('.menu-user-name');
        const balanceEl = document.querySelector('.menu-balance');
        
        if (nameEl) nameEl.innerText = user.handle || "Member";
        if (balanceEl) {
            const balance = user.walletBalance !== undefined ? user.walletBalance : 0.00;
            balanceEl.innerText = `$${Number(balance).toFixed(2)}`;
        }
    }

    // ==========================================
    // 2. MOBILE SEARCH LOGIC
    // ==========================================
    setupMobileSearch() {
        const input = document.getElementById('mobileSearchInput');
        const resultsBox = document.getElementById('mobileSearchResults');

        if (!input || !resultsBox) return;

        input.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(this.searchDebounce);

            if (query.length < 2) {
                resultsBox.innerHTML = '<div class="empty-state-search">Start typing to discover...</div>';
                return;
            }

            // Show loading state
            resultsBox.innerHTML = '<div class="search-loading"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';

            this.searchDebounce = setTimeout(async () => {
                try {
                    const token = await auth.currentUser.getIdToken();
                    const res = await fetch(`/player/api/search?q=${encodeURIComponent(query)}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    this.renderMobileSearchResults(data.results);
                } catch (err) {
                    console.error("Mobile Search Error:", err);
                    resultsBox.innerHTML = '<div class="error-state">Search failed. Try again.</div>';
                }
            }, 300);
        });
    }

    renderMobileSearchResults(results) {
        const box = document.getElementById('mobileSearchResults');
        box.innerHTML = '';

        if (!results || results.length === 0) {
            box.innerHTML = '<div class="empty-state-search">No results found.</div>';
            return;
        }

        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'm-search-item';
            
            // Image Logic
            let imgHtml = item.img 
                ? `<img src="${item.img}" class="m-result-img">` 
                : `<div class="m-result-img placeholder"><i class="${item.icon || 'fas fa-music'}"></i></div>`;

            // Click Logic
            div.onclick = () => {
                if (item.type === 'song') {
                    window.playSong(item.id, item.title, item.subtitle, item.img, item.audioUrl, item.duration);
                    this.closeSearch(); // Close modal on play
                } else if (item.url) {
                    window.navigateTo(item.url);
                    this.closeSearch();
                }
            };

            div.innerHTML = `
                ${imgHtml}
                <div class="m-result-info">
                    <div class="m-result-title">${item.title}</div>
                    <div class="m-result-sub">${item.subtitle}</div>
                </div>
                ${item.type === 'song' ? '<div class="m-result-action"><i class="fas fa-play"></i></div>' : ''}
            `;
            box.appendChild(div);
        });
    }

    // ==========================================
    // 3. UI TOGGLES
    // ==========================================
    expandPlayer() {
        const modal = document.getElementById('mobileFullPlayer');
        if (modal) modal.classList.add('active');
        document.body.style.overflow = 'hidden'; 
    }

    collapsePlayer() {
        const modal = document.getElementById('mobileFullPlayer');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    openSearch() {
        const modal = document.getElementById('mobileSearchModal');
        if (modal) {
            modal.classList.add('active');
            setTimeout(() => document.getElementById('mobileSearchInput').focus(), 100);
        }
    }

    closeSearch() {
        const modal = document.getElementById('mobileSearchModal');
        if (modal) modal.classList.remove('active');
    }

    toggleProfileMenu() {
        const menu = document.getElementById('mobileProfileMenu');
        if (menu) menu.classList.toggle('active');
    }

    // ==========================================
    // 4. PLAYER SYNC
    // ==========================================
    setupPlayerStateListener() {
        this.engine.on('stateChange', (data) => this.updateMobilePlayer(data));
        this.engine.on('progress', (data) => this.updateMobileProgress(data));
    }

    updateMobilePlayer(data) {
        const { isPlaying, track } = data;
        if (!track) return;

        // Mini Player
        const miniTitle = document.getElementById('m-mini-title');
        const miniArtist = document.getElementById('m-mini-artist');
        const miniArt = document.getElementById('m-mini-art');
        const miniIcon = document.getElementById('m-mini-play-icon');

        if (miniTitle) miniTitle.innerText = track.title;
        if (miniArtist) miniArtist.innerText = track.artist;
        if (miniArt) miniArt.src = track.artUrl || 'https://via.placeholder.com/40';
        if (miniIcon) miniIcon.className = isPlaying ? "fas fa-pause" : "fas fa-play";

        // Full Player
        const fullTitle = document.getElementById('m-full-title');
        const fullArtist = document.getElementById('m-full-artist');
        const fullArt = document.getElementById('m-full-art');
        const fullIcon = document.getElementById('m-play-icon');

        if (fullTitle) fullTitle.innerText = track.title;
        if (fullArtist) fullArtist.innerText = track.artist;
        if (fullArt) fullArt.src = track.artUrl || 'https://via.placeholder.com/400';
        if (fullIcon) fullIcon.className = isPlaying ? "fas fa-pause" : "fas fa-play";
    }

    updateMobileProgress(data) {
        const { currentTime, duration } = data;
        if (!duration) return;
        
        const percent = (currentTime / duration) * 100;
        
        // Progress Bar
        const bar = document.getElementById('m-progress-bar');
        if (bar) bar.style.width = `${percent}%`;

        // Time Text
        const curEl = document.getElementById('m-curr-time');
        const totEl = document.getElementById('m-total-time');
        
        if (curEl) curEl.innerText = this.formatTime(currentTime);
        if (totEl) totEl.innerText = this.formatTime(duration);
    }

    formatTime(seconds) {
        if (!seconds) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }
}