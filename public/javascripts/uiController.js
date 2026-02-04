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
            
            if(window.globalUserCache && handle) {
                window.globalUserCache.handle = handle;
                window.globalUserCache.bio = bio; // Add this
                window.globalUserCache.location = location; // Add this
                
                // Refresh the UI without a reload
                this.updateProfileUI(window.globalUserCache); 

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
// PROFILE PAGE LOADER - Add this to uiController.js
// Insert after the loadProfileFollowing function (around line 412)
// ==========================================

async loadProfilePage() {
    const contentScroll = document.querySelector('.content-scroll');
    if (!contentScroll) return;

    const viewMode = contentScroll.dataset.viewMode;
    const targetHandle = contentScroll.dataset.targetHandle;
    
    let targetUserUid = null;
    let isOwnProfile = false;
    let profileData = null;

    // 1. Determine Context
    if (viewMode === 'private') {
        targetUserUid = auth.currentUser.uid;
        isOwnProfile = true;
        
        // INSTANT CACHE LOAD: Render immediately if we have local data
        if (window.globalUserCache) {
            this.updateProfileUI(window.globalUserCache);
        }
    } else {
        targetUserUid = await this.getUserIdByHandle(targetHandle);
        isOwnProfile = (targetUserUid === auth.currentUser.uid);
    }

    if (!targetUserUid) return;

    // 2. FETCH FRESH DATA
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/${targetUserUid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            profileData = await res.json();
            
            // Update local cache if it's the current user
            if (isOwnProfile) {
                window.globalUserCache = { ...window.globalUserCache, ...profileData };
            }
            
            this.updateProfileUI(profileData);
        }
        
        // 3. Load Connections
        await this.loadProfileFollowingData(targetUserUid);
        await this.loadTopArtists(targetUserUid);
        
        // 3.5. Load Signature Stack (Crates)
        await this.loadUserCrates(targetUserUid);
        
        // 4. BIND SPA EVENT LISTENERS (CRITICAL FOR SPA)
        if (isOwnProfile) {
            this.setupProfileEditControls();
        } else {
            await this.checkUserFollowStatus(targetUserUid, profileData);
        }
        
    } catch (e) {
        console.error("Profile Load Error:", e);
    }
}

async loadProfileData(uid) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Failed to load profile');
        
        const data = await res.json();
        return data;
        
    } catch (e) {
        console.error("Load Profile Data Error:", e);
        return null;
    }
}

// [FIX] Updated updateProfileUI to include coverURL mapping
    updateProfileUI(profileData) {
        if (!profileData) return;
        
        // Match DB Keys: photoURL, profileSong, joinDate, coverURL
        const handleEl = document.getElementById('profileHandle');
        const bioEl = document.getElementById('profileBio');
        const joinDateEl = document.getElementById('profileJoinDate');
        const avatarImg = document.getElementById('profileAvatar');
        const heroBackground = document.getElementById('heroBackground');
        
        if (handleEl) handleEl.textContent = profileData.handle || '@user';
        if (bioEl) bioEl.textContent = profileData.bio || 'No bio yet.';
        
        // Correctly parse Firestore Timestamp for joinDate
        if (joinDateEl && profileData.joinDate) {
            const seconds = profileData.joinDate._seconds || profileData.joinDate.seconds;
            const dateObj = seconds ? new Date(seconds * 1000) : new Date(profileData.joinDate);
            joinDateEl.textContent = `Joined ${dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
        }

        // Use photoURL for profile image
        if (avatarImg && profileData.photoURL) {
            avatarImg.src = profileData.photoURL;
        }

        // [NEW] Use coverURL for the hero background
        if (heroBackground && profileData.coverURL) {
            heroBackground.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${profileData.coverURL}')`;
        }
        
        // Use profileSong for anthem card
        this.loadAnthemCard(profileData.profileSong);
    }

    // [FIX] Added missing toggleProfileEditMode function
    toggleProfileEditMode() {
        const bioText = document.getElementById('profileBio');
        const editBtn = document.getElementById('editBtn');
        const saveControls = document.getElementById('saveControls');
        const avatarEditBtn = document.getElementById('avatarEditBtn');
        const coverEditBtn = document.getElementById('coverEditBtn');
        const anthemEditBtn = document.getElementById('anthemEditBtn');

        // Check current state (using saveControls visibility as a flag)
        const isCurrentlyEditing = saveControls && saveControls.style.display === 'flex';

        if (!isCurrentlyEditing) {
            // ENTER EDIT MODE
            if (bioText) {
                bioText.contentEditable = 'true';
                bioText.classList.add('editing');
                bioText.focus();
            }
            if (avatarEditBtn) avatarEditBtn.style.display = 'flex';
            if (coverEditBtn) coverEditBtn.style.display = 'flex';
            if (anthemEditBtn) anthemEditBtn.style.display = 'inline-block';
            
            if (editBtn) editBtn.style.display = 'none';
            if (saveControls) saveControls.style.display = 'flex';
        } else {
            // EXIT EDIT MODE (CANCEL)
            if (bioText) {
                bioText.contentEditable = 'false';
                bioText.classList.remove('editing');
                // Revert to original if we had a cache, or let refresh happen
                if (window.globalUserCache) bioText.textContent = window.globalUserCache.bio || 'No bio yet.';
            }
            if (avatarEditBtn) avatarEditBtn.style.display = 'none';
            if (coverEditBtn) coverEditBtn.style.display = 'none';
            if (anthemEditBtn) anthemEditBtn.style.display = 'none';
            
            if (editBtn) editBtn.style.display = 'flex';
            if (saveControls) saveControls.style.display = 'none';
        }
    }

// ==========================================
// CROPPER.JS IMAGE HANDLING
// ==========================================

setupProfileEditControls() {
    // 1. Unified Edit Mode Toggle
    const editBtn = document.getElementById('editBtn');
    if (editBtn) {
        editBtn.style.display = 'flex';
        editBtn.onclick = () => this.toggleProfileEditMode();
    }
    
    // 2. Fix Image Upload Listeners (Corrects the handleAvatarUpload/handleCoverUpload TypeErrors)
    const avatarInput = document.getElementById('avatarInput');
    if (avatarInput) {
        avatarInput.onchange = (e) => this.initCrop(e, 'avatar');
    }
    
    const coverInput = document.getElementById('coverInput');
    if (coverInput) {
        coverInput.onchange = (e) => this.initCrop(e, 'cover');
    }

    // 3. Bind Anthem Search input to real DB queries
    const anthemSearchInput = document.getElementById('anthemSearchInput');
    if (anthemSearchInput) {
        let searchTimeout;
        anthemSearchInput.oninput = (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            
            if (query.length < 2) {
                const results = document.getElementById('anthemSearchResults');
                if (results) results.innerHTML = '';
                return;
            }
            
            searchTimeout = setTimeout(() => {
                this.searchAnthemSongs(query);
            }, 300);
        };
    }
}

initCrop(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    this.currentCropType = type;
    const imageToCrop = document.getElementById('imageToCrop');
    const cropModal = document.getElementById('cropModal');

    const reader = new FileReader();
    reader.onload = (ev) => {
        if (imageToCrop) imageToCrop.src = ev.target.result;
        
        // Use flex to trigger the centering defined in CSS
        if (cropModal) {
            cropModal.style.display = 'flex'; 
        }
        
        if (this.cropper) this.cropper.destroy();
        
        const aspectRatio = type === 'avatar' ? 1 : (16 / 9);
        this.cropper = new Cropper(imageToCrop, {
            aspectRatio: aspectRatio,
            viewMode: 1,
            autoCropArea: 0.8,
            background: false
        });
    };
    reader.readAsDataURL(file);
    event.target.value = ''; 
}

cancelCrop() {
    const cropModal = document.getElementById('cropModal');
    if (cropModal) {
        cropModal.style.display = 'none';
    }
    if (this.cropper) {
        this.cropper.destroy();
        this.cropper = null;
    }
}

async saveCrop() {
    if (!this.cropper) return;
    
    const cropBtn = document.querySelector('#cropModal .btn-next');
    const originalText = cropBtn.innerText;
    cropBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    cropBtn.disabled = true;

    // Get cropped canvas
    const canvas = this.cropper.getCroppedCanvas({
        width: this.currentCropType === 'avatar' ? 400 : 1200,
        imageSmoothingEnabled: true, 
        imageSmoothingQuality: 'high',
    });

    canvas.toBlob(async (blob) => {
        const formData = new FormData();
        // 'avatar' or 'cover' matches the multer field name in backend
        formData.append(this.currentCropType, blob, `${this.currentCropType}.jpg`);

        try {
            const token = await auth.currentUser.getIdToken();
            // Call the new, smarter backend routes
            const endpoint = `/player/api/profile/upload-${this.currentCropType}`;
            
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                // 1. Strict DB Key mapping to match your Firestore schema
                const dbKey = this.currentCropType === 'avatar' ? 'photoURL' : 'coverURL';
                
                // 2. Update local SPA cache
                if (window.globalUserCache) {
                    window.globalUserCache[dbKey] = data.url;
                }
                
                // 3. [FIX] Force immediate UI repaint for Cover Photo
                if (this.currentCropType === 'cover') {
                    const heroBackground = document.getElementById('heroBackground');
                    if (heroBackground) {
                        heroBackground.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${data.url}')`;
                    }
                }

                // 4. Update the rest of the profile and sidebar
                this.updateProfileUI(window.globalUserCache);

                if (this.currentCropType === 'avatar') {
                    const sidebarPic = document.getElementById('profilePic');
                    if (sidebarPic) sidebarPic.src = data.url;
                }

                this.showToast('Photo updated successfully!');

            } else {
                throw new Error(data.error || 'Upload failed');
            }
        } catch (e) {
            console.error("Crop Upload Error:", e);
            this.showToast(e.message);
        } finally {
            this.cancelCrop();
            cropBtn.innerHTML = originalText;
            cropBtn.disabled = false;
        }
    }, 'image/jpeg', 0.9);
}

// ==========================================
// ANTHEM / SONG SEARCH LOGIC
// ==========================================

async searchAnthemSongs(query) {
        const resultsContainer = document.getElementById('anthemSearchResults');
        if (!resultsContainer) return;
        resultsContainer.innerHTML = '<div style="text-align:center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Searching database...</div>';

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/search?q=${encodeURIComponent(query)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            const songs = (data.results || []).filter(r => r.type === 'song');
            
            if (songs.length === 0) {
                resultsContainer.innerHTML = '<div style="text-align:center; padding: 20px;">No tracks found.</div>';
                return;
            }

            resultsContainer.innerHTML = songs.map(song => `
                <div class="search-result-item" style="cursor:pointer; display:flex; align-items:center; padding:10px; border-bottom:1px solid var(--border-color);" 
                     onclick='window.ui.selectAnthem(${JSON.stringify(song)})'>
                    <img src="${song.img}" class="result-img" style="width:40px; height:40px; border-radius:5px; margin-right:15px; object-fit:cover;">
                    <div class="result-info">
                        <div class="result-title" style="font-weight:bold;">${song.title}</div>
                        <div class="result-sub" style="font-size:0.8rem; color:var(--text-secondary);">${song.subtitle}</div>
                    </div>
                </div>
            `).join('');
        } catch (err) { resultsContainer.innerHTML = 'Search failed.'; }
    }

    async selectAnthem(song) {
        const newAnthem = { 
            songId: song.id, 
            title: song.title, 
            artist: song.subtitle, 
            img: song.img, 
            audioUrl: song.audioUrl, 
            duration: song.duration 
        };
        if (!window.globalUserCache) window.globalUserCache = {};
        window.globalUserCache.profileSong = newAnthem;
        this.loadAnthemCard(newAnthem);
        this.closeAnthemModal();
        this.showToast("Anthem updated!");

        try {
            const token = await auth.currentUser.getIdToken();
            await fetch('/player/api/profile/update', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ anthem: newAnthem })
            });
        } catch (e) { console.error("Anthem Save Error:", e); }
    }

    loadAnthemCard(anthem) {
        const anthemCard = document.getElementById('anthemPlayer');
        if (!anthemCard) return;
        
        if (anthem && anthem.title) {
            document.getElementById('anthemTitle').textContent = anthem.title;
            document.getElementById('anthemArtist').textContent = anthem.artist;
            if (anthem.img) document.getElementById('anthemArt').src = anthem.img;
            Object.assign(anthemCard.dataset, { 
                songId: anthem.songId, 
                songTitle: anthem.title, 
                songArtist: anthem.artist, 
                songImg: anthem.img, 
                audioUrl: anthem.audioUrl, 
                duration: anthem.duration 
            });
            anthemCard.classList.remove('empty');
        } else {
            anthemCard.classList.add('empty');
        }
    }

async loadProfileFollowingData(uid) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/following/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        
        // Populate artists grid
        const artistsGrid = document.getElementById('fullArtistsGrid');
        if (artistsGrid) {
            this.populateArtistsGrid(artistsGrid, data.artists || []);
        }
        
        // Populate users grid
        const usersGrid = document.getElementById('fullUsersGrid');
        if (usersGrid) {
            this.populateUsersGrid(usersGrid, data.users || []);
        }
        
    } catch (e) {
        console.error("Load Following Data Error:", e);
    }
}

populateArtistsGrid(grid, artists) {
    if (!grid) return;
    
    if (!artists || artists.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="text-align:center; padding:40px; color:#888">
                <i class="fas fa-music" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block;"></i>
                <p>No artists followed yet</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = '';
    
    artists.forEach(artist => {
        const card = document.createElement('div');
        card.className = 'artist-square';
        card.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
        
        card.innerHTML = `
            <img src="${artist.img || 'https://via.placeholder.com/150'}" alt="${artist.name}">
            <div class="artist-overlay">${artist.name}</div>
        `;
        
        grid.appendChild(card);
    });
}

populateUsersGrid(grid, users) {
    if (!grid) return;
    
    if (!users || users.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="text-align:center; padding:40px; color:#888">
                <i class="fas fa-user-friends" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block;"></i>
                <p>No users followed yet</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = '';
    
    users.forEach(user => {
        const card = document.createElement('div');
        card.className = 'user-card';
        card.onclick = (e) => {
            if (e.target.closest('.unfollow-btn')) return;
            const handle = user.handle.replace('@', '');
            window.navigateTo(`/player/u/${handle}`);
        };
        
        card.innerHTML = `
            <img src="${user.img || 'https://via.placeholder.com/50'}" alt="${user.name}">
            <div class="user-info">
                <div class="user-name">${user.name}</div>
                <div class="user-handle">${user.handle}</div>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

async loadTopArtists(uid) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/following/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        const artists = data.artists || [];
        
        const grid = document.getElementById('topArtistsGrid');
        if (!grid) return;
        
        const topArtists = artists.slice(0, 6);
        
        if (topArtists.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1; text-align:center; padding:40px; color:#888">
                    <i class="fas fa-music" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block;"></i>
                    <p>No artists followed yet</p>
                </div>
            `;
            return;
        }
        
        grid.innerHTML = '';
        
        topArtists.forEach(artist => {
            const card = document.createElement('div');
            card.className = 'artist-square';
            card.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
            
            card.innerHTML = `
                <img src="${artist.img || 'https://via.placeholder.com/150'}" alt="${artist.name}">
                <div class="artist-overlay">${artist.name}</div>
            `;
            
            grid.appendChild(card);
        });
        
    } catch (e) {
        console.error("Load Top Artists Error:", e);
    }
}

// Add these Modal Functions inside PlayerUIController (e.g., below setupProfileEditControls)

openAnthemModal() { document.getElementById('anthemModal').style.display = 'flex'; }
closeAnthemModal() { document.getElementById('anthemModal').style.display = 'none'; }
openQuestionModal() { document.getElementById('questionModal').style.display = 'flex'; }
closeQuestionModal() { document.getElementById('questionModal').style.display = 'none'; }
submitQuestion() { alert("Question sent!"); this.closeQuestionModal(); }

closeUnfollowModal() { 
    document.getElementById('unfollowModal').style.display = 'none'; 
    window.pendingUnfollow = null; 
}
confirmUnfollow() { 
    if (window.pendingUnfollow) window.pendingUnfollow(); 
    this.closeUnfollowModal(); 
}

async checkUserFollowStatus(uid, profileData) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/user/follow/check?userId=${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        const followBtn = document.getElementById('userFollowBtn');
        
        if (followBtn) {
            followBtn.style.display = 'flex';
            this.updateUserFollowButton(followBtn, data.following, uid, profileData);
        }
    } catch (e) {
        console.error("Check User Follow Error:", e);
    }
}

updateUserFollowButton(btn, isFollowing, uid, profileData) {
    if (isFollowing) {
        btn.innerHTML = '<i class="fas fa-user-check"></i><span>Following</span>';
        btn.style.background = '#666';
    } else {
        btn.innerHTML = '<i class="fas fa-user-plus"></i><span>Follow</span>';
        btn.style.background = '#88C9A1';
    }
    
    btn.onclick = () => this.toggleUserFollow(uid, profileData, btn);
}

async toggleUserFollow(uid, profileData, btn) {
    const isCurrentlyFollowing = btn.textContent.includes('Following');
    
    try {
        const token = await auth.currentUser.getIdToken();
        const endpoint = isCurrentlyFollowing ? '/player/api/user/unfollow' : '/player/api/user/follow';
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: uid,
                handle: profileData.handle,
                name: profileData.displayName || profileData.handle,
                avatar: profileData.avatar
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            this.updateUserFollowButton(btn, data.following, uid, profileData);
            this.showToast(data.following ? 'Now following!' : 'Unfollowed');
        }
    } catch (e) {
        console.error("Toggle User Follow Error:", e);
        this.showToast('Action failed');
    }
}

async getUserIdByHandle(handle) {
    try {
        const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
        
        // Call backend API to get user by handle
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/user/by-handle?handle=${encodeURIComponent(cleanHandle)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) return null;
        
        const data = await res.json();
        return data.uid || null;
        
    } catch (e) {
        console.error("Get User ID Error:", e);
        return null;
    }
}

// ==========================================
// SIGNATURE STACK (CRATES)
// ==========================================

async loadUserCrates(uid) {
    try {
        const token = await auth.currentUser.getIdToken();
        
        // Load created crates
        const createdRes = await fetch(`/player/api/crates/user/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const createdData = await createdRes.json();
        
        this.renderCratesGrid(createdData.crates || [], 'createdCratesGrid');
        
        // Load liked crates
        const likedRes = await fetch(`/player/api/crates/liked/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const likedData = await likedRes.json();
        
        this.renderCratesGrid(likedData.crates || [], 'likedCratesGrid');
        
    } catch (e) {
        console.error("Load User Crates Error:", e);
        const grids = ['createdCratesGrid', 'likedCratesGrid'];
        grids.forEach(gridId => {
            const grid = document.getElementById(gridId);
            if (grid) grid.innerHTML = '<div class="empty-state">Failed to load crates</div>';
        });
    }
}

renderCratesGrid(crates, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!crates || crates.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="text-align:center; padding:60px 20px; color:var(--text-secondary)">
                <i class="fas fa-box-open" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block"></i>
                <p style="margin:0; font-size:1rem">No crates yet</p>
            </div>`;
        return;
    }
    
    container.innerHTML = '';
    
    crates.forEach(crate => {
        const card = document.createElement('div');
        card.className = 'crate-card';
        card.onclick = () => window.navigateTo(`/player/crate/${crate.id}`);
        
        // Build genres display
        const genresHtml = (crate.genres && crate.genres.length > 0) 
            ? crate.genres.slice(0, 2).map(g => `<span class="genre-tag">${g}</span>`).join('')
            : '';
        
        card.innerHTML = `
            <div class="crate-img" style="background-image: url('${crate.img}')">
                <div class="crate-overlay">
                    <i class="fas fa-play-circle"></i>
                </div>
            </div>
            <div class="crate-info">
                <h4 class="crate-title">${crate.title}</h4>
                <div class="crate-meta">
                    <span><i class="fas fa-music"></i> ${crate.trackCount || 0} tracks</span>
                    ${crate.plays ? `<span><i class="fas fa-play"></i> ${crate.plays}</span>` : ''}
                </div>
                ${genresHtml ? `<div class="crate-genres">${genresHtml}</div>` : ''}
            </div>
        `;
        
        container.appendChild(card);
    });
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
                this.loadProfilePage();
                
                // Bind Save Button for Profile
                const saveBtn = document.getElementById('saveProfileBtn');
                if (saveBtn) saveBtn.onclick = () => this.saveProfileChanges();
                
                // Bind Cancel button
                const cancelBtn = document.getElementById('cancelEditBtn');
                if (cancelBtn) cancelBtn.onclick = () => this.toggleProfileEditMode();
                break;
            case 'settings':
                this.loadSettingsPage(currentPage);
                break;
            case 'artist-profile':
                // Buttons are hydrated at the end of this function
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
        this.hydrateGlobalButtons(); // Now correctly defined in the class
        this.loadUserWallet(); 
    }

    // [FIX] Moved inside the class so 'this.hydrateGlobalButtons' works
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

        // [RESTORED] Anthem Playback logic
       window.playAnthem = () => {
        const card = document.getElementById('anthemPlayer');
        if (!card || !card.dataset.songId) {
            this.showToast('No anthem set yet.');
            return;
        }
        
        // [FIX] Changed 'img' to 'artUrl' so the Player UI can render the background
        this.engine.play(card.dataset.songId, {
            title: card.dataset.songTitle,
            artist: card.dataset.songArtist,
            artUrl: card.dataset.songImg, // <--- This was the culprit
            audioUrl: card.dataset.audioUrl,
            duration: parseFloat(card.dataset.duration) || 0
            });
        };
        // [RESTORED] Missing Profile Tab Switcher
        window.switchProfileTab = (tab) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById(`tab-${tab}`);
            if(target) target.style.display = 'block';
            
            // Update active button state
            document.querySelectorAll('.tab-btn').forEach(btn => 
                btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(tab))
            );
        };

        // [FIX] Exposed switchSubTab to window
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

        // Switch between Created and Liked crates in Signature Stack
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
        
        // Navigation helper
        window.navigateTo = (url) => {
            window.location.href = url;
        };
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