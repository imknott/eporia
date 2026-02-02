/* public/javascripts/uiController.js */
import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();
window.globalUserCache = null;

// ==========================================
// 2. UI CONTROLLER (The Pulse)
// ==========================================
export class PlayerUIController {
    constructor(engine) {
        window.ui = this;
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
        this.setupSeekbar(); 

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
    // ==========================================
    // A. SETTINGS & SAVE LOGIC (Rebuilt)
    // ==========================================
    
    // 1. UPDATE LOCAL (Live Audio / UI changes)
    updateGlobalSetting(key, value) {
        if (!window.globalUserCache) window.globalUserCache = {};
        if (!window.globalUserCache.settings) window.globalUserCache.settings = {};
        
        // Update Cache
        window.globalUserCache.settings[key] = value;

        // Update Audio Engine Immediately (The "Live" feel)
        this.engine.updateSettings(window.globalUserCache.settings);
        
        // [CHANGED] We do NOT save to DB here anymore.
        // We just visually indicate unsaved changes if you want (optional UX)
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
            saveBtn.style.opacity = "1";
        }
    }

    // 2. SAVE TO DB (Manual Trigger)
    async saveSettings() {
        const btn = document.getElementById('saveSettingsBtn');
        if (btn) {
            btn.innerText = "Saving...";
            btn.disabled = true;
        }

        try {
            const token = await auth.currentUser.getIdToken();
            await fetch('/player/api/settings/save', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(window.globalUserCache.settings)
            });
            
            if (btn) {
                btn.innerText = "Saved!";
                setTimeout(() => {
                    btn.innerText = "Save Changes";
                    // Optionally disable again until next change
                }, 2000);
            }
            this.showToast("Settings saved.");
        } catch (e) {
            console.error("Save Error:", e);
            this.showToast("Failed to save settings.");
            if (btn) btn.disabled = false;
        }
    }

    // 3. SAVE PROFILE DATA (Manual Trigger)
    async saveProfileChanges() {
        const btn = document.getElementById('saveProfileBtn');
        if(btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        const handle = document.getElementById('editHandle')?.value;
        const bio = document.getElementById('editBio')?.value;
        const location = document.getElementById('editLocation')?.value;

        try {
            const token = await auth.currentUser.getIdToken();
            await fetch('/player/api/profile/update', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ handle, bio, location })
            });
            
            this.showToast("Profile updated.");
            
            // Update global cache locally so sidebar updates immediately
            if(window.globalUserCache && handle) {
                window.globalUserCache.handle = handle;
                const sidebarName = document.getElementById('profileName');
                if(sidebarName) sidebarName.innerText = handle;
            }

        } catch (e) {
            console.error(e);
            this.showToast("Update failed.");
        } finally {
            if(btn) btn.innerText = "Save Profile";
        }
    }

    async loadSettingsPage(container) {
        container.dataset.hydrated = "true";
        const emailEl = document.getElementById('settingsEmail');
        if (emailEl && auth.currentUser.email) emailEl.innerText = auth.currentUser.email;

        // Attach Save Listener
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveSettings();
        }

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/settings', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            
            window.globalUserCache = data;
            const settings = data.settings || {};
            
            // Populate Inputs
            const setVal = (name, val) => {
                const el = document.querySelector(`[name="${name}"]`);
                if (!el) return;
                if (el.type === 'checkbox') el.checked = val;
                else el.value = val;
            };

            setVal('audioQuality', settings.audioQuality || 'auto');
            setVal('crossfade', settings.crossfade || 3);
            if(document.getElementById('fadeVal')) document.getElementById('fadeVal').innerText = (settings.crossfade || 3) + 's';
            
            // Set EQ Sliders
            if(settings.eqHigh) setVal('eqHigh', settings.eqHigh);
            if(settings.eqMid) setVal('eqMid', settings.eqMid);
            if(settings.eqLow) setVal('eqLow', settings.eqLow);

        } catch (e) { console.error("Settings Hydration Failed", e); }
    }

    // ==========================================
    // B. WALLET & FINANCE (UPDATED)
    // ==========================================
    async initWalletPage() {
        const balanceDisplay = document.getElementById('walletBalanceDisplay');
        const allocContainer = document.getElementById('allocationContainer');
        const list = document.getElementById('transactionList');
        
        // 1. Get Wallet Data
        let walletData = { balance: 0 };
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet', { headers: { 'Authorization': `Bearer ${token}` } });
            walletData = await res.json();
            
            // Update Card UI
            if (balanceDisplay) balanceDisplay.innerText = Number(walletData.balance).toFixed(2);
            const allocDisplay = document.getElementById('walletAllocation');
            if (allocDisplay) allocDisplay.innerText = `$${Number(walletData.monthlyAllocation).toFixed(2)}`;
            
            // Update Plan Badge
            const planBadge = document.getElementById('walletPlanBadge');
            if(planBadge) planBadge.innerHTML = `<i class="fas fa-crown"></i> <span>${(walletData.plan || 'Standard')}</span>`;

        } catch (e) { console.error("Wallet Data Error:", e); }

        // 2. Get Followed Artists for Allocation
        if (allocContainer) {
            try {
                const token = await auth.currentUser.getIdToken();
                const res = await fetch(`/player/api/profile/following/${auth.currentUser.uid}`, { 
                    headers: { 'Authorization': `Bearer ${token}` } 
                });
                const followData = await res.json();
                
                // Render the Allocation Table
                this.renderAllocationUI(allocContainer, followData.artists || [], Number(walletData.balance));

            } catch (e) {
                console.error("Allocation UI Error:", e);
                allocContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--danger)">Failed to load artists.</div>`;
            }
        }

        // 3. Render Receipt History (Mock for now, or fetch real receipts if you have an endpoint)
        // You can update this to fetch from /api/allocations/history if you build that route.
        const mockTransactions = [
            { title: 'Monthly Allocation', date: 'Today', amount: walletData.monthlyAllocation, type: 'in' }
        ];
        this.renderTransactions(list, mockTransactions);
    }

    renderAllocationUI(container, artists, balance) {
        if (artists.length === 0) {
            container.innerHTML = `
                <div class="allocation-container" style="text-align:center">
                    <h3>Follow Artists to Allocate</h3>
                    <p style="color:var(--text-secondary); margin-bottom:15px">You need to follow artists before you can support them directly.</p>
                    <button class="btn-alloc primary" onclick="navigateTo('/player/explore')">Explore Scene</button>
                </div>`;
            return;
        }

        let html = `
            <div class="allocation-container">
                <div class="alloc-header">
                    <div class="alloc-title-group">
                        <h3>Fair Trade Distribution</h3>
                        <div class="alloc-subtitle">Decide where 100% of your funds go.</div>
                    </div>
                    <div class="alloc-balance-pill" id="allocRemaining">
                        <span>Remaining:</span>
                        <span id="remainVal">$${balance.toFixed(2)}</span>
                    </div>
                </div>
                
                <div class="artist-alloc-list">`;

        artists.forEach(artist => {
            html += `
                <div class="artist-alloc-row">
                    <img src="${artist.img || 'https://via.placeholder.com/50'}" class="alloc-avatar">
                    <div class="alloc-info">
                        <span class="alloc-name">${artist.name}</span>
                        <span class="alloc-role">Artist</span>
                    </div>
                    <div class="alloc-input-wrapper">
                        <span class="alloc-currency">$</span>
                        <input type="number" class="alloc-input" data-id="${artist.id}" placeholder="0.00" min="0" step="0.01">
                    </div>
                </div>`;
        });

        html += `</div>
                <button id="commitAllocBtn" class="btn-alloc" disabled>
                    <i class="fas fa-lock"></i> Commit Allocation
                </button>
            </div>`;

        container.innerHTML = html;

        // --- Event Listeners for Math ---
        const inputs = container.querySelectorAll('.alloc-input');
        const remainDisplay = container.querySelector('#remainVal');
        const pill = container.querySelector('#allocRemaining');
        const btn = container.querySelector('#commitAllocBtn');

        const updateMath = () => {
            let total = 0;
            inputs.forEach(inp => total += Number(inp.value));
            
            const remaining = balance - total;
            remainDisplay.innerText = `$${remaining.toFixed(2)}`;

            if (remaining < 0) {
                pill.classList.add('error');
                pill.classList.remove('valid');
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-exclamation-circle"></i> Over Budget`;
            } else if (total > 0 && remaining >= 0) {
                pill.classList.remove('error');
                pill.classList.add('valid');
                btn.disabled = false;
                btn.innerHTML = `Confirm $${total.toFixed(2)} Distribution`;
                btn.classList.add('primary');
            } else {
                pill.classList.remove('error', 'valid');
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-lock"></i> Commit Allocation`;
                btn.classList.remove('primary');
            }
        };

        inputs.forEach(inp => inp.addEventListener('input', updateMath));

        // --- Commit Action ---
        btn.onclick = async () => {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;

            const allocations = [];
            inputs.forEach(inp => {
                const val = Number(inp.value);
                if (val > 0) {
                    allocations.push({ artistId: inp.dataset.id, amount: val });
                }
            });

            try {
                const token = await auth.currentUser.getIdToken();
                const res = await fetch('/player/api/commit-allocation', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'allocate', allocations })
                });
                
                const result = await res.json();
                if (result.success) {
                    this.showToast("Funds Allocated Successfully!");
                    this.initWalletPage(); // Reload to refresh balance
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                console.error(err);
                this.showToast("Allocation Failed: " + err.message);
                btn.disabled = false;
                updateMath(); // Reset text
            }
        };
    }

    // ==========================================
    // B. PROFILE & FOLLOWING
    // ==========================================
   async loadProfileFollowing() {
        // [FIX] Target the correct IDs in profile.pug
        const artistContainer = document.getElementById('fullArtistsGrid'); 
        const userContainer = document.getElementById('fullUsersGrid');
        
        if (!artistContainer && !userContainer) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const uid = auth.currentUser.uid;
            
            // Use the API that returns BOTH artists and users
            const res = await fetch(`/player/api/profile/following/${uid}`, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            const data = await res.json();

            // 1. Render Artists
            if (artistContainer) {
                artistContainer.innerHTML = '';
                if (data.artists && data.artists.length > 0) {
                    data.artists.forEach(artist => {
                        // Reuse the existing helper
                        artistContainer.appendChild(this.createArtistCircle(artist, "Following"));
                    });
                } else {
                    artistContainer.innerHTML = this.createEmptyState("No artists followed.");
                }
            }

            // 2. Render Users
            if (userContainer) {
                userContainer.innerHTML = '';
                if (data.users && data.users.length > 0) {
                    data.users.forEach(u => {
                        const card = document.createElement('div');
                        card.className = 'artist-circle-item';
                        card.style.cssText = "display:flex; flex-direction:column; align-items:center; min-width:100px; cursor:pointer;";
                        // Navigate to their public profile
                        card.onclick = () => window.navigateTo(`/player/u/${u.handle.replace('@','')}`);
                        
                        card.innerHTML = `
                            <img src="${u.img || 'https://via.placeholder.com/100'}" style="width:100px; height:100px; border-radius:50%; object-fit:cover; border:2px solid var(--border-color);">
                            <span style="margin-top:10px; font-weight:700; font-size:0.9rem">${u.handle}</span>
                        `;
                        userContainer.appendChild(card);
                    });
                } else {
                    userContainer.innerHTML = this.createEmptyState("No users followed.");
                }
            }

        } catch (e) { console.error("Following Load Error:", e); }
    }

    // Profile Picture Upload (Keep this immediate/live)
    setupProfileUpload() {
        const fileInput = document.getElementById('hiddenProfileInput');
        if (!fileInput) return;

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            this.showToast('Uploading image...');
            const formData = new FormData();
            formData.append('profilePic', file);

            try {
                const token = await auth.currentUser.getIdToken();
                const res = await fetch('/player/api/profile/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                
                const data = await res.json();
                if (data.success) {
                    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => img.src = data.imageUrl);
                    this.showToast('Profile picture updated!');
                } else {
                    this.showToast('Upload failed.');
                }
            } catch (err) {
                this.showToast('Error uploading image.');
            }
        });
    }

    triggerProfileUpload() {
        document.getElementById('hiddenProfileInput')?.click();
    }

    // ==========================================
    // C. DASHBOARD & WALLET
    // ==========================================
    async loadSceneDashboard() {
        const dropsContainer = document.getElementById('localDropsContainer');
        const cratesContainer = document.getElementById('localCratesContainer');
        const artistsContainer = document.getElementById('localArtistsContainer');
        
        if (!dropsContainer) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/dashboard', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            console.log('[DASHBOARD] Data loaded:', data);

            // Update page title and subtitle with location data
            const sceneTitle = document.querySelector('.scene-title');
            const sceneSubtitle = document.querySelector('.scene-subtitle');
            
            if (sceneTitle && data.city) {
                sceneTitle.textContent = `${data.city} Underground`;
            }
            
            if (sceneSubtitle && data.state) {
                // Calculate active count based on artists or default
                const activeCount = data.topLocal ? data.topLocal.length * 12 : 128;
                sceneSubtitle.textContent = `Pulse of ${data.state} • ${activeCount} Active Listeners`;
            }

            // [NEW] Update "Top Local" section title to show city
            const artistSection = document.querySelector('.feed-section:has(#localArtistsContainer)');
            if (artistSection && data.city) {
                const header = artistSection.querySelector('h3');
                if (header) {
                    header.innerHTML = `
                        Artists in ${data.city}
                        <button class="btn-see-more" onclick="loadMoreArtists()" 
                                style="margin-left: 15px; background: var(--primary); color: #000; 
                                padding: 6px 15px; border-radius: 20px; font-size: 0.8rem; 
                                border: none; cursor: pointer; font-weight: 700; transition: 0.2s;">
                            See All
                        </button>
                    `;
                }
            }

            // Update Community Crates description
            const cratesDesc = document.querySelector('.feed-section:has(#localCratesContainer) .section-desc');
            if (cratesDesc && data.city) {
                cratesDesc.textContent = `Hand-picked collections from ${data.city} locals.`;
            }

            if (dropsContainer) {
                dropsContainer.innerHTML = '';
                if (!data.freshDrops || data.freshDrops.length === 0) {
                    dropsContainer.innerHTML = this.createEmptyState("Quiet in the city tonight.");
                } else {
                    data.freshDrops.forEach(song => dropsContainer.appendChild(this.createSongCard(song)));
                }
            }

            if (cratesContainer) {
                cratesContainer.innerHTML = '';
                if (!data.localCrates || data.localCrates.length === 0) {
                     cratesContainer.innerHTML = this.createEmptyState("No local crates created yet.");
                } else {
                    data.localCrates.forEach(crate => cratesContainer.appendChild(this.createCrateCard(crate)));
                }
            }

            if (artistsContainer) {
                artistsContainer.innerHTML = '';
                if (data.topLocal) {
                    data.topLocal.forEach(artist => artistsContainer.appendChild(this.createArtistCircle(artist, data.city)));
                }
            }
            
            // [NEW] Store city/state globally for "Load More" functionality
            window.currentCity = data.city;
            window.currentState = data.state;
            window.currentCountry = data.country;
            
        } catch (e) { console.error("Scene Load Error:", e); }
    }

    async initWalletPage() {
        await this.loadUserWallet(); 
        const balanceDisplay = document.getElementById('walletBalanceDisplay');
        const allocDisplay = document.getElementById('walletAllocation');
        const planBadge = document.getElementById('walletPlanBadge');
        const list = document.getElementById('transactionList');
        
        if (!balanceDisplay) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            balanceDisplay.innerText = Number(data.balance).toFixed(2);
            if(allocDisplay) allocDisplay.innerText = `$${Number(data.monthlyAllocation).toFixed(2)}`;
            if(planBadge) {
                const planName = data.plan.charAt(0).toUpperCase() + data.plan.slice(1);
                planBadge.innerHTML = `<i class="fas fa-crown"></i> <span>${planName}</span>`;
            }
            if(document.getElementById('modalAvailable')) {
                document.getElementById('modalAvailable').innerText = Number(data.balance).toFixed(2);
            }

            const mockTransactions = [
                { title: 'Monthly Allocation', date: 'Today', amount: data.monthlyAllocation, type: 'in' },
                { title: 'Stream Payout', date: 'Yesterday', amount: 0.45, type: 'in' },
            ];
            this.renderTransactions(list, mockTransactions);
        } catch (e) { console.error("Wallet Page Error:", e); }
    }

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

    renderTransactions(container, items) {
        if(!container) return;
        container.innerHTML = '';
        items.forEach(item => {
            const isPos = item.type === 'in';
            const iconClass = isPos ? 'fa-arrow-down' : 'fa-arrow-up';
            const iconStyle = isPos ? '' : 'out';
            const sign = isPos ? '+' : '-';
            const amountClass = isPos ? 'positive' : 'negative';

            container.innerHTML += `
                <div class="trans-item">
                    <div class="trans-icon ${iconStyle}"><i class="fas ${iconClass}"></i></div>
                    <div class="trans-info">
                        <div class="trans-title">${item.title}</div>
                        <div class="trans-date">${item.date}</div>
                    </div>
                    <div class="trans-amount ${amountClass}">${sign}$${Number(Math.abs(item.amount)).toFixed(2)}</div>
                </div>`;
        });
    }

    // ==========================================
    // D. FAVORITES & LIBRARY
    // ==========================================
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
                container.innerHTML = this.createEmptyState("Go explore the scene and heart some tracks!");
                return;
            }

            data.songs.forEach((track, index) => {
                const row = document.createElement('div');
                row.className = 'track-row';
                row.onclick = (e) => {
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
                this.checkSongLikeStatus(track.id, row.querySelector('.fa-heart'));
            });
        } catch (e) { console.error("Load Favs Error:", e); }
    }

    // ==========================================
    // E. VIEW ROUTER (Hydration Logic)
    // ==========================================
    checkAndReloadViews() {
        if (!auth.currentUser) return; 

        const currentPage = document.querySelector('.content-scroll');
        const pageType = currentPage ? currentPage.dataset.page : null;

        if (!pageType) return;
        if (currentPage.dataset.hydrated === "true") return;

        console.log(`💧 Hydrating View: ${pageType}`);

        switch(pageType) {
            case 'dashboard':
                this.loadSceneDashboard();
                break;
            case 'favorites':
                this.loadFavorites();
                break;
            case 'wallet':
                this.initWalletPage();
                break;
            case 'profile':
                this.loadProfileFollowing(); 
                this.setupProfileUpload(); 
                
                // Bind Save Button for Profile
                const saveBtn = document.getElementById('saveProfileBtn');
                if (saveBtn) saveBtn.onclick = () => this.saveProfileChanges();
                break;
            case 'settings':
                this.loadSettingsPage(currentPage);
                break;

            // [NEW] Check for Tab Parameter (e.g. ?tab=following)
            const urlParams = new URLSearchParams(window.location.search);
            const targetTab = urlParams.get('tab');
            if (targetTab) {
                // Wait slightly for DOM to settle if needed
                setTimeout(() => window.switchProfileTab(targetTab), 100);
            }

            // [FIX] Added Artist Profile Case
            // This ensures hydrateGlobalButtons() runs when you land here
            case 'artist-profile':
                // No specific load function needed (SSR does the work)
                // Just break so it falls through to hydration
                break;
        }

        currentPage.dataset.hydrated = "true";
        this.updateSidebarState();
        this.hydrateGlobalButtons(); 
        this.loadUserWallet(); 
    }

    hydrateGlobalButtons() {
        console.log('[HYDRATE] Starting button hydration...');
        
        const followBtns = document.querySelectorAll('#followBtn');
        followBtns.forEach(btn => {
            if (btn.dataset.artistId && !btn.dataset.checked) {
                this.checkFollowStatus(btn.dataset.artistId);
                btn.dataset.checked = "true";
            }
        });
        
        const likeBtns = document.querySelectorAll('.card-like-btn i, .row-btn i.fa-heart, .player-full .fa-heart, .mp-controls .fa-heart');
        console.log('[HYDRATE] Found', likeBtns.length, 'like buttons to check');
        
        likeBtns.forEach(icon => {
            const btn = icon.closest('button') || icon.parentElement;
            let songId = btn.dataset.songId;
            if(!songId && this.engine.currentTrack) songId = this.engine.currentTrack.id;
            if(songId) this.checkSongLikeStatus(songId, icon);
        });
    }

    // ==========================================
    // F. PLAYBACK & ACTIONS
    // ==========================================
    addToQueue(id, title, artist, artUrl, audioUrl, duration) {
        this.engine.addToQueue({ id, title, artist, artUrl, audioUrl, duration });
        this.showToast(`Added to Queue: ${title}`);
    }

    async toggleSongLike(btn, songId, title, artist, artUrl, audioUrl, duration) {
        if (!auth.currentUser) return window.location.href = '/members/login';
        
        const icon = btn.tagName === 'I' ? btn : btn.querySelector('i');
        const isLiked = icon.classList.contains('fas');
        
        if (isLiked) { 
            icon.classList.remove('fas'); icon.classList.add('far'); icon.style.color = '';
            if(window.globalUserCache?.likedSongs) window.globalUserCache.likedSongs.delete(songId);
        } else { 
            icon.classList.remove('far'); icon.classList.add('fas'); icon.style.color = '#F4A261';
            if(window.globalUserCache?.likedSongs) window.globalUserCache.likedSongs.add(songId);
        }

        try {
            const token = await auth.currentUser.getIdToken();
            const method = isLiked ? 'DELETE' : 'POST';
            const url = isLiked ? `/player/api/user/like/${songId}` : '/player/api/user/like';
            
            await fetch(url, { 
                method: method, 
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, 
                body: method === 'POST' ? JSON.stringify({ songId, title, artist, artUrl, audioUrl, duration }) : undefined
            });
        } catch (e) { 
            console.error("Like failed", e); 
            this.checkSongLikeStatus(songId, icon); 
        }
    }

    async loadUserLikes() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/user/likes/ids', { headers: { 'Authorization': `Bearer ${token}` }});
            const data = await res.json();
            
            if(!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache.likedSongs = new Set(data.likedSongIds || []);
            
            console.log('[LIKES LOADED]', data.likedSongIds?.length || 0, 'liked songs:', Array.from(window.globalUserCache.likedSongs));
            
            this.hydrateGlobalButtons();
            
        } catch(e) { 
            console.error("Like Cache Error", e); 
        }
    }

    checkSongLikeStatus(songId, iconElement) {
        if (!auth.currentUser || !iconElement) return;
        
        let isLiked = false;
        if (window.globalUserCache && window.globalUserCache.likedSongs) {
            isLiked = window.globalUserCache.likedSongs.has(songId);
        }
        
        console.log(`[LIKE CHECK] Song ${songId}: ${isLiked ? 'LIKED' : 'NOT LIKED'}`, window.globalUserCache?.likedSongs);
        
        if (isLiked) {
            iconElement.classList.remove('far'); 
            iconElement.classList.add('fas'); 
            iconElement.style.color = '#F4A261';
        } else {
            iconElement.classList.remove('fas'); 
            iconElement.classList.add('far'); 
            iconElement.style.color = '';
        }
    }

    async toggleFollow(btn) {
        if (!auth.currentUser) return window.location.href = '/members/login';
        const isFollowing = btn.classList.contains('following');
        this.updateFollowButtonUI(!isFollowing); 

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/artist/follow', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    artistId: btn.dataset.artistId,
                    artistName: btn.dataset.artistName,
                    artistImg: btn.dataset.artistImg
                })
            });
            
            const data = await res.json();
            this.updateFollowButtonUI(data.following);
            
            if (window.globalUserCache) {
                window.globalUserCache.sidebarArtists = data.sidebar;
                this.renderSidebarArtists(data.sidebar);
            }
        } catch (e) {
            console.error("Follow error", e);
            this.updateFollowButtonUI(isFollowing); 
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

    // ==========================================
    // G. HELPERS & RENDERERS
    // ==========================================
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
                    <button class="card-like-btn" data-song-id="${song.id}" onclick="event.stopPropagation(); toggleSongLike(this, '${song.id}', '${song.title}', '${song.artist}', '${song.img}', '${song.audioUrl}', '${song.duration}')" style="background:rgba(255,255,255,0.2); color:white; border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="far fa-heart"></i></button>
                </div>
            </div>
            <div class="card-info"><div class="card-title">${song.title}</div><div class="card-subtitle">${song.artist}</div></div>`;
        this.checkSongLikeStatus(song.id, card.querySelector('.card-like-btn i'));
        return card;
    }

    createCrateCard(crate) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.style.minWidth = '160px'; 
        card.onclick = () => {
            if(crate.tracks && crate.tracks.length > 0) {
                const first = crate.tracks[0];
                window.playSong(first.id, first.title, first.artist, first.artUrl, first.audioUrl, first.duration);
                crate.tracks.slice(1).forEach(t => this.addToQueue(t.id, t.title, t.artist, t.artUrl, t.audioUrl, t.duration));
                this.showToast(`Playing Crate: ${crate.title}`);
            }
        };
        const image = crate.coverImage || 'https://via.placeholder.com/150';
        card.innerHTML = `
            <div class="img-container" style="box-shadow: 5px 5px 0px rgba(0,0,0,0.1); border: 1px solid var(--border-color);">
                <img src="${image}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">
                <div class="play-overlay" style="display:flex; justify-content:center; align-items:center; background:rgba(0,0,0,0.4)">
                    <i class="fas fa-box-open" style="color:white; font-size:2rem; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))"></i>
                </div>
            </div>
            <div class="card-info">
                <div class="card-title">${crate.title}</div>
                <div class="card-subtitle">by ${crate.creatorHandle}</div>
                <div class="card-subtitle" style="font-size:0.7rem; color:var(--primary)">${crate.songCount} tracks</div>
            </div>`;
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

    createEmptyState(msg) {
        return `<div style="padding:20px; color:var(--text-muted); font-size:0.9rem; width:100%; text-align:center;">${msg}</div>`;
    }

    showToast(msg) {
        const toast = document.createElement('div');
        toast.innerText = msg;
        toast.style.cssText = `position:fixed; bottom:80px; right:20px; background:#333; color:#fff; padding:10px 20px; border-radius:5px; z-index:1000; animation: fadeIn 0.3s;`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    formatTime(seconds) {
        if (!seconds) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    updatePlayerUI(track) {
        if(!track) return;

        // 1. Update Text Info
        document.querySelectorAll('#d-title-full, #d-title-mini').forEach(el => el.innerText = track.title);
        document.querySelectorAll('#d-artist-full, #d-artist-mini').forEach(el => el.innerText = track.artist);
        
        // 2. [RESTORED] Update Total Duration Time
        if (track.duration) {
            const m = Math.floor(track.duration / 60);
            const s = Math.floor(track.duration % 60);
            const timeString = `${m}:${s < 10 ? '0' : ''}${s}`;
            
            // Update both full player and any mini player time displays
            const totalEl = document.getElementById('totalTime');
            if (totalEl) totalEl.innerText = timeString;
        }

        // 3. Update Artwork
        const artElements = document.querySelectorAll('#d-art-full, #d-art-mini');
        if (track.artUrl && track.artUrl !== 'null') {
            artElements.forEach(el => {
                el.style.backgroundImage = `url('${track.artUrl}')`;
                if(el.id === 'd-art-full') el.style.backgroundSize = 'cover';
                el.classList.remove('art-placeholder');
            });
        }

        // 4. Update Heart Status
        const heartIcon = document.querySelector('.player-full .fa-heart') || document.querySelector('.mp-controls .fa-heart');
        if (heartIcon) this.checkSongLikeStatus(track.id, heartIcon);
    }

    setupSeekbar() {
        // We look for the container wrapper, not just the colored fill bar
        const progressContainer = document.querySelector('.progress-track') || document.getElementById('progressBar')?.parentElement;
        
        if (progressContainer) {
            progressContainer.style.cursor = 'pointer';
            
            // Handle Click / Scrub
            progressContainer.addEventListener('click', (e) => {
                if (!this.engine.currentTrack) return;
                
                const rect = progressContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                const pct = Math.max(0, Math.min(1, clickX / width)); // Clamp between 0-1
                
                // Calculate new time
                const seekTime = pct * this.engine.trackDuration;
                
                // Tell engine to jump
                this.engine.seek(seekTime);
                
                // Optimistic UI update (move bar instantly)
                this.updateProgressBar({ 
                    progress: pct, 
                    currentTime: seekTime 
                });
            });
        }
    }

    updateProgressBar({ progress, currentTime }) {
        // 1. Move the colored bar
        const bar = document.getElementById('progressBar'); // The colored fill
        if (bar) bar.style.width = `${progress * 100}%`;
        
        // 2. [RESTORED] Update the "Current Time" text
        const timeEl = document.getElementById('currentTime');
        if (timeEl) {
            timeEl.innerText = this.formatTime(currentTime);
        }
    }
    
    updatePlayPauseIcons(isPlaying) {
        document.querySelectorAll('.fa-play, .fa-pause').forEach(icon => {
            if (icon.parentElement.matches('.btn-play-hero, .btn-play-mini, .mp-play')) {
                icon.classList.toggle('fa-pause', isPlaying);
                icon.classList.toggle('fa-play', !isPlaying);
            }
        });
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

    initAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    // Load likes FIRST before hydrating any buttons
                    await this.loadUserLikes();
                    
                    // [FIX] Force dashboard load if we're on that page
                    const currentPath = window.location.pathname;
                    if (currentPath.includes('/dashboard')) {
                        console.log('[INIT] Dashboard page detected, forcing data load...');
                        await this.loadSceneDashboard();
                    }
                    
                    // Now safe to check and hydrate views
                    this.checkAndReloadViews();
                    this.loadUserWallet(); // Ensure sidebar updates
                    
                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    if(userDoc.exists()) {
                        const data = userDoc.data();
                        window.globalUserCache = { ...window.globalUserCache, ...data };
                        this.engine.updateSettings(data.settings || {});
                        
                        const nameEl = document.getElementById('profileName');
                        const picEl = document.getElementById('profilePic');
                        if (nameEl) nameEl.innerText = data.handle || "Member";
                        if (picEl && data.photoURL) picEl.src = data.photoURL;

                        this.renderSidebarArtists(data.sidebarArtists || []);
                    }
                } catch (err) { console.error("Profile Error:", err); }
            }
        });
    }

    // --- GLOBAL FUNCTIONS ---
    exposeGlobalFunctions() {
        window.playSong = (id, title, artist, artUrl, audioUrl, duration) => {
            this.engine.play(id, { title, artist, artUrl, audioUrl, duration: duration ? parseFloat(duration) : 0 }); 
        };
        window.togglePlay = () => this.engine.togglePlay();
        window.togglePlayerSize = this.togglePlayerSize;
        window.addToQueue = (id, title, artist, artUrl, audioUrl, duration) => {
            if(event) event.stopPropagation(); 
            this.addToQueue(id, title, artist, artUrl, audioUrl, duration);
        };
        window.playAllFavorites = () => this.playAllFavorites();
        window.toggleProfileMenu = () => document.getElementById('profileDropdown')?.classList.toggle('active');
        window.toggleTheme = () => {
            const isDark = document.body.classList.toggle('dark-theme');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        };

        // [NEW] Artist Tab Switcher
        window.switchArtistTab = (tabName) => {
            // 1. Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            
            // 2. Show target content
            const target = document.getElementById(`tab-${tabName}`);
            if (target) target.style.display = 'block';
            
            // 3. Update Active Button State
            document.querySelectorAll('.profile-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
            if (event && event.target) event.target.classList.add('active');
        };

        // [NEW] Profile Tab Switcher (Ensures tabs work even if userProfile.js is missing)
        window.switchProfileTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById(`tab-${tabName}`);
            if (target) target.style.display = 'block';
            
            // Manually highlight the correct button based on the tab name
            document.querySelectorAll('.profile-tabs .tab-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('onclick').includes(tabName)) {
                    btn.classList.add('active');
                }
            });
        };

        window.togglePlayerLike = () => this.togglePlayerLike();
        window.toggleFollow = (btn) => this.toggleFollow(btn); // Re-expose Follow
        window.toggleSongLike = (btn, songId, title, artist, artUrl, audioUrl, duration) => {
            this.toggleSongLike(btn, songId, title, artist, artUrl, audioUrl, duration);
        };
        
        // Expose helper functions for debugging/manual refresh
        window.refreshLikeStates = () => this.hydrateGlobalButtons();
        window.checkSongLikeStatus = (songId, iconElement) => this.checkSongLikeStatus(songId, iconElement);
        
        // Load More Artists
        window.loadMoreArtists = () => this.loadMoreArtists();
        window.loadMoreArtistsBatch = () => this.loadArtistsBatch();

        window.openCitySearch = () => window.setSearchMode('city');
        
        window.switchSettingsTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById('tab-' + tabName);
            if(target) target.style.display = 'block';
            document.querySelectorAll('.settings-tabs .tab-btn').forEach(el => el.classList.remove('active'));
            if(event && event.currentTarget) event.currentTarget.classList.add('active');
        };

        window.updateEQ = () => {
            const high = document.querySelector('input[name="eqHigh"]')?.value;
            const mid = document.querySelector('input[name="eqMid"]')?.value;
            const low = document.querySelector('input[name="eqLow"]')?.value;
            if (high) this.updateGlobalSetting('eqHigh', parseFloat(high));
            if (mid) this.updateGlobalSetting('eqMid', parseFloat(mid));
            if (low) this.updateGlobalSetting('eqLow', parseFloat(low));
        };
        
        window.triggerProfileUpload = () => this.triggerProfileUpload();
        window.saveProfileChanges = () => this.saveProfileChanges();
        window.saveSettings = () => this.saveSettings();
    }
    
    togglePlayerSize() {
        this.isMinimized = !this.isMinimized;
        const rightSidebar = document.getElementById('rightSidebar');
        if (rightSidebar) rightSidebar.classList.toggle('minimized', this.isMinimized);
    }
    
    async togglePlayerLike() {
        if (!this.engine.currentTrack) return;
        const heartBtn = document.querySelector('.mp-controls .fa-heart')?.parentElement || document.querySelector('.player-full .fa-heart')?.parentElement;
        if (heartBtn) {
            const t = this.engine.currentTrack;
            await this.toggleSongLike(heartBtn, t.id, t.title, t.artist, t.artUrl, t.audioUrl, t.duration);
        }
    }
    
    async playAllFavorites() {
        if (!auth.currentUser) return;
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/favorites', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (data.songs && data.songs.length > 0) {
                const first = data.songs[0];
                window.playSong(first.id, first.title, first.artist, first.img, first.audioUrl, first.duration);
                for (let i = 1; i < data.songs.length; i++) {
                    const s = data.songs[i];
                    this.engine.addToQueue({ 
                        id: s.id, title: s.title, artist: s.artist, 
                        artUrl: s.img, audioUrl: s.audioUrl, duration: s.duration 
                    });
                }
                this.showToast(`Playing ${data.songs.length} Liked Songs`);
            }
        } catch (e) { console.error(e); }
    }

    // ==========================================
    // H. SEARCH SYSTEM (Missing Functions)
    // ==========================================
    setupOmniSearch() {
        const input = document.getElementById('mainSearchInput');
        const resultsBox = document.getElementById('searchResults');
        
        // Guard clause: if search bar doesn't exist on this page, exit safely
        if(!input) return;
        
        // 1. Expose Global Helper for Filter Menu
        window.toggleSearchFilter = () => {
            const menu = document.getElementById('searchFilterMenu');
            if (menu) menu.classList.toggle('active');
        };
        
        // 2. Expose Search Mode Switcher (e.g. "Artists only", "Cities only")
        window.setSearchMode = (mode) => {
            const icon = document.getElementById('currentSearchIcon');
            const menu = document.getElementById('searchFilterMenu');
            let prefix = '', placeholder = 'Search...', iconClass = 'fa-search';

            switch(mode) {
                case 'artist': prefix = '@'; placeholder = 'Search artists...'; iconClass = 'fa-microphone-alt'; break;
                case 'song': prefix = 's:'; placeholder = 'Search songs...'; iconClass = 'fa-music'; break;
                case 'city': prefix = 'C:'; placeholder = 'Search cities...'; iconClass = 'fa-city'; break;
                default: prefix = ''; placeholder = 'Search...'; iconClass = 'fa-search';
            }

            if(icon) icon.className = `fas ${iconClass}`;
            input.value = prefix; 
            input.placeholder = placeholder; 
            input.focus();
            if(menu) menu.classList.remove('active');
        };
        
        // 3. Input Listener with Debounce
        let debounceTimer;
        input.addEventListener('input', (e) => {
            const query = e.target.value;
            clearTimeout(debounceTimer);
            
            // Hide box if query is too short
            if (query.length < 2) { 
                if(resultsBox) resultsBox.classList.remove('active'); 
                return; 
            }

            debounceTimer = setTimeout(async () => {
                if(resultsBox) {
                    resultsBox.innerHTML = '<div class="search-placeholder"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
                    resultsBox.classList.add('active');
                }
                
                try {
                    const token = await auth.currentUser.getIdToken();
                    const res = await fetch(`/player/api/search?q=${encodeURIComponent(query)}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    this.renderSearchResults(data.results);
                } catch (err) { console.error("Search Error:", err); }
            }, 300);
        });
        
        // 4. Click Outside to Close
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                document.getElementById('searchFilterMenu')?.classList.remove('active');
                if(resultsBox) resultsBox.classList.remove('active');
            }
        });
    }

    renderSearchResults(results) {
        const box = document.getElementById('searchResults');
        if (!box) return;
        
        box.innerHTML = '';
        if (!results || results.length === 0) {
            box.innerHTML = '<div class="search-placeholder">No results found.</div>';
            return;
        }
        
        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            
            // Handle Image logic
            let imgHtml = '';
            if (item.img) {
                imgHtml = `<img src="${item.img}" class="result-img">`;
            } else {
                imgHtml = '<div class="result-img square"></div>';
            }
            
            // Handle Click
            div.onclick = () => {
                if (item.type === 'song') {
                    window.playSong(item.id, item.title, item.subtitle, item.img, item.audioUrl, item.duration);
                } else if (item.url) {
                    window.navigateTo(item.url);
                }
                box.classList.remove('active');
            };
            
            div.innerHTML = `
                ${imgHtml}
                <div class="result-info">
                    <div class="result-title">${item.title}</div>
                    <div class="result-sub">${item.subtitle}</div>
                </div>`;
            box.appendChild(div);
        });
    }

    async checkFollowStatus(artistId) {
        if (!auth.currentUser) return;
        try {
            const token = await auth.currentUser.getIdToken();
            // WAS: /status?artistId... -> NOW: /check?artistId... (Matches player.js)
            const res = await fetch(`/player/api/artist/follow/check?artistId=${artistId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            this.updateFollowButtonUI(data.following);
        } catch (e) { console.error("Status check failed", e); }
    }


    async loadMoreArtists() {
        try {
            const modal = document.createElement('div');
            modal.className = 'artists-modal';
            modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1000;';
            modal.innerHTML = `
                <div class="modal-overlay" onclick="this.parentElement.remove()" 
                     style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                     background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);"></div>
                <div class="modal-content" style="position: relative; background: var(--card-bg); 
                     max-width: 900px; max-height: 85vh; margin: 5vh auto; border-radius: 20px; 
                     overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div class="modal-header" style="display: flex; justify-content: space-between; 
                         align-items: center; padding: 25px 30px; border-bottom: 1px solid var(--border-color);">
                        <h2 style="margin: 0; color: var(--text-main); font-size: 1.5rem; font-weight: 900;">
                            Artists in ${window.currentCity || 'Your City'}
                        </h2>
                        <button onclick="this.closest('.artists-modal').remove()" 
                                style="background: none; border: none; font-size: 1.5rem; cursor: pointer; 
                                color: var(--text-secondary); transition: 0.2s;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div id="allArtistsList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); 
                         gap: 20px; padding: 30px; max-height: calc(85vh - 150px); overflow-y: auto;">
                        <div style="grid-column: 1/-1; text-align: center; padding: 60px;">
                            <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: var(--primary);"></i>
                            <p style="margin-top: 15px; color: var(--text-secondary);">Loading artists...</p>
                        </div>
                    </div>
                    <div style="text-align: center; padding: 20px; border-top: 1px solid var(--border-color);">
                        <button id="loadMoreBtn" onclick="window.loadMoreArtistsBatch()" 
                                style="background: var(--primary); color: #000; padding: 12px 35px; 
                                border-radius: 25px; border: none; font-weight: 800; cursor: pointer; 
                                font-size: 0.95rem; transition: 0.2s;">
                            Load More
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Initialize and load first batch
            window.artistsOffset = 0;
            window.artistsLimit = 24;
            await this.loadArtistsBatch();

        } catch (e) {
            console.error("Load More Artists Error:", e);
        }
    }

    async loadArtistsBatch() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(
                `/player/api/artists/local?city=${encodeURIComponent(window.currentCity)}&offset=${window.artistsOffset}&limit=${window.artistsLimit}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            const data = await res.json();

            const container = document.getElementById('allArtistsList');
            
            if (window.artistsOffset === 0) {
                container.innerHTML = '';
            }

            if (data.artists && data.artists.length > 0) {
                data.artists.forEach(artist => {
                    const card = document.createElement('div');
                    card.className = 'artist-card-modal';
                    card.style.cssText = 'cursor: pointer; text-align: center; transition: 0.2s;';
                    card.onmouseenter = () => card.style.transform = 'translateY(-5px)';
                    card.onmouseleave = () => card.style.transform = 'translateY(0)';
                    card.onclick = () => {
                        window.navigateTo(`/player/artist/${artist.id}`);
                        document.querySelector('.artists-modal').remove();
                    };
                    card.innerHTML = `
                        <img src="${artist.img}" 
                             style="width: 100%; aspect-ratio: 1; border-radius: 50%; object-fit: cover; 
                             margin-bottom: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
                        <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main); 
                             margin-bottom: 4px;">${artist.name}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">
                            ${artist.followers || 0} followers
                        </div>
                    `;
                    container.appendChild(card);
                });

                window.artistsOffset += data.artists.length;

                // Hide "Load More" if no more artists
                const loadMoreBtn = document.getElementById('loadMoreBtn');
                if (data.artists.length < window.artistsLimit) {
                    loadMoreBtn.style.display = 'none';
                } else {
                    loadMoreBtn.style.display = 'inline-block';
                }
            } else {
                if (window.artistsOffset === 0) {
                    container.innerHTML = `
                        <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                            <i class="fas fa-music" style="font-size: 3rem; color: var(--text-secondary); 
                               opacity: 0.3; margin-bottom: 15px;"></i>
                            <p style="color: var(--text-secondary); font-size: 1rem;">
                                No artists found in ${window.currentCity} yet.
                            </p>
                            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 10px;">
                                Be the first to represent!
                            </p>
                        </div>
                    `;
                }
                document.getElementById('loadMoreBtn').style.display = 'none';
            }

        } catch (e) {
            console.error("Load Artists Batch Error:", e);
            const container = document.getElementById('allArtistsList');
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <p>Failed to load artists. Please try again.</p>
                </div>
            `;
        }
    }

    setupNotifications() {}
}