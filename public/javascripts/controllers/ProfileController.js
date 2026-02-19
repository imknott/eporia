/* public/javascripts/controllers/ProfileController.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export class ProfileController {
    constructor(mainUI) {
        this.mainUI = mainUI;
        this.auth = getAuth();
        this.cropper = null;
        this.currentCropType = null;

        // Bind UI functions to window for HTML onclicks
        window.ui.triggerProfileUpload = this.triggerProfileUpload?.bind(this);
        window.ui.saveProfileChanges = this.saveProfileChanges.bind(this);
        window.ui.selectAnthem = this.selectAnthem.bind(this);
        
        // Modals
        window.ui.openAnthemModal = this.openAnthemModal.bind(this);
        window.ui.closeAnthemModal = this.closeAnthemModal.bind(this);
        window.ui.openQuestionModal = this.openQuestionModal.bind(this);
        window.ui.closeQuestionModal = this.closeQuestionModal.bind(this);
        window.ui.submitQuestion = this.submitQuestion.bind(this);
        window.ui.closeUnfollowModal = this.closeUnfollowModal.bind(this);
        window.ui.confirmUnfollow = this.confirmUnfollow.bind(this);
    }

    // ==========================================
    // 1. PAGE LOADERS & UI
    // ==========================================

    async loadProfilePage() {
        const contentScroll = document.querySelector('.content-scroll');
        if (!contentScroll) return;

        const viewMode = contentScroll.dataset.viewMode;
        const targetHandle = contentScroll.dataset.targetHandle;
        
        let targetUserUid = null;
        let isOwnProfile = false;
        let profileData = null;

        if (viewMode === 'private') {
            targetUserUid = this.auth.currentUser.uid;
            isOwnProfile = true;
            if (window.globalUserCache) {
                this.updateProfileUI(window.globalUserCache);
            }
        } else {
            targetUserUid = await this.getUserIdByHandle(targetHandle);
            isOwnProfile = (targetUserUid === this.auth.currentUser.uid);
        }

        if (!targetUserUid) return;

        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/profile/${targetUserUid}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (res.ok) {
                profileData = await res.json();
                if (isOwnProfile) {
                    window.globalUserCache = { ...window.globalUserCache, ...profileData };
                }
                this.updateProfileUI(profileData);
            }
            
            await this.loadProfileFollowingData(targetUserUid);
            await this.loadTopArtists(targetUserUid);
            await this.loadUserCrates(targetUserUid);
            
            if (isOwnProfile) {
                this.setupProfileEditControls();
            } else {
                await this.checkUserFollowStatus(targetUserUid, profileData);
            }
        } catch (e) {
            console.error("Profile Load Error:", e);
        }
    }

    updateProfileUI(profileData) {
        if (!profileData) return;

        // Use the main UI helper to ensure URLs have the https://cdn... prefix
        const cleanAvatar = this.mainUI.fixImageUrl(profileData.photoURL || profileData.avatar);
        const cleanCover  = this.mainUI.fixImageUrl(profileData.coverURL);

        const handleEl = document.getElementById('profileHandle');
        const bioEl = document.getElementById('profileBio');
        const avatarImg = document.getElementById('profileAvatar');
        const heroBackground = document.getElementById('heroBackground');
        
        if (handleEl) handleEl.textContent = profileData.handle || '@user';
        if (bioEl) bioEl.textContent = profileData.bio || 'No bio yet.';
        if (avatarImg) avatarImg.src = cleanAvatar;

        if (heroBackground && cleanCover) {
            heroBackground.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${cleanCover}')`;
        }
        
        this.loadAnthemCard(profileData.profileSong);
    }

    // ==========================================
    // 2. EDIT MODE & SAVING
    // ==========================================

    setupProfileEditControls() {
        requestAnimationFrame(() => {
            const editBtn = document.getElementById('editBtn');
            if (editBtn) {
                editBtn.onclick = () => this.toggleProfileEditMode();
                editBtn.style.display = 'inline-flex'; 
            }
            
            const saveBtn = document.getElementById('saveProfileBtn');
            if (saveBtn) saveBtn.onclick = () => this.saveProfileChanges();
            
            const cancelBtn = document.getElementById('cancelEditBtn');
            if (cancelBtn) cancelBtn.onclick = () => this.toggleProfileEditMode();
            
            const avatarInput = document.getElementById('avatarInput');
            if (avatarInput) avatarInput.onchange = (e) => this.initCrop(e, 'avatar');
            
            const coverInput = document.getElementById('coverInput');
            if (coverInput) coverInput.onchange = (e) => this.initCrop(e, 'cover');

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
                    searchTimeout = setTimeout(() => this.searchAnthemSongs(query), 300);
                };
            }
        });
    }

    toggleProfileEditMode() {
        const editBtn = document.getElementById('editBtn');
        const saveControls = document.getElementById('saveControls');
        const isCurrentlyEditing = editBtn && editBtn.style.display === 'none';
        
        if (editBtn) editBtn.style.display = isCurrentlyEditing ? 'inline-flex' : 'none';
        if (saveControls) saveControls.style.display = isCurrentlyEditing ? 'none' : 'flex';
        
        const bioText = document.getElementById('profileBio');
        const bioInput = document.getElementById('bioInput');
        
        if (bioText && bioInput) {
            if (isCurrentlyEditing) {
                bioText.style.display = 'block';
                bioInput.style.display = 'none';
            } else {
                const currentText = bioText.textContent.trim();
                bioInput.value = currentText === 'No bio yet.' ? '' : currentText;
                bioText.style.display = 'none';
                bioInput.style.display = 'block';
                bioInput.disabled = false;
                setTimeout(() => bioInput.focus(), 50);
            }
        }
        
        const cams = ['coverEditBtn', 'avatarEditBtn', 'anthemEditBtn'];
        cams.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.style.display = isCurrentlyEditing ? 'none' : 'inline-flex';
        });
    }

    async saveProfileChanges() {
        const saveBtn = document.getElementById('saveProfileBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        try {
            const bioInput = document.getElementById('bioInput');
            const handleInput = document.getElementById('editHandle');
            const locationInput = document.getElementById('editLocation');
            
            const payload = {};
            if (bioInput) payload.bio = bioInput.value.trim();
            if (handleInput && handleInput.value) payload.handle = handleInput.value.trim();
            if (locationInput && locationInput.value) payload.location = locationInput.value.trim();

            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/profile/update', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error("Update failed");

            const bioText = document.getElementById('profileBio');
            if (bioText) bioText.textContent = payload.bio || "No bio yet.";
            
            if (window.globalUserCache) {
                if (payload.bio !== undefined) window.globalUserCache.bio = payload.bio;
                if (payload.handle) {
                    window.globalUserCache.handle = payload.handle;
                    const sidebarName = document.getElementById('profileName');
                    if(sidebarName) sidebarName.innerText = payload.handle;
                }
            }

            this.mainUI.showToast("Profile saved!", "success");
            
            // If we are currently in inline-edit mode (from setupProfileEditControls)
            if (bioInput && bioInput.style.display === 'block') {
                this.toggleProfileEditMode();
            }

        } catch (e) {
            console.error("Save Error:", e);
            this.mainUI.showToast("Could not save profile.", "error");
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-check"></i> <span>Save Changes</span>';
            }
        }
    }

    // ==========================================
    // 3. IMAGE CROPPING (CROPPER.JS)
    // ==========================================

    initCrop(event, type) {
        const file = event.target.files[0];
        if (!file) return;

        this.currentCropType = type;
        const imageToCrop = document.getElementById('imageToCrop');
        const cropModal = document.getElementById('cropModal');

        const reader = new FileReader();
        reader.onload = (ev) => {
            if (imageToCrop) imageToCrop.src = ev.target.result;
            if (cropModal) cropModal.style.display = 'flex'; 
            
            if (this.cropper) this.cropper.destroy();
            
            const aspectRatio = type === 'avatar' ? 1 : (16 / 9);
            this.cropper = new Cropper(imageToCrop, {
                aspectRatio: aspectRatio,
                viewMode: 1,
                autoCropArea: 0.8,
                background: false
            });
            
            // Bind the save button in the modal
            const cropBtn = document.querySelector('#cropModal .btn-next');
            if (cropBtn) cropBtn.onclick = () => this.saveCrop();
            
            const cancelBtn = document.querySelector('#cropModal .btn-cancel');
            if (cancelBtn) cancelBtn.onclick = () => this.cancelCrop();
        };
        reader.readAsDataURL(file);
        event.target.value = ''; 
    }

    cancelCrop() {
        const cropModal = document.getElementById('cropModal');
        if (cropModal) cropModal.style.display = 'none';
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

        const canvas = this.cropper.getCroppedCanvas({
            width: this.currentCropType === 'avatar' ? 400 : 1200,
            imageSmoothingEnabled: true, 
            imageSmoothingQuality: 'high',
        });

        canvas.toBlob(async (blob) => {
            const formData = new FormData();
            formData.append(this.currentCropType, blob, `${this.currentCropType}.jpg`);

            try {
                const token = await this.auth.currentUser.getIdToken();
                const res = await fetch(`/player/api/profile/upload-${this.currentCropType}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                const data = await res.json();

                if (data.success) {
                    const dbKey = this.currentCropType === 'avatar' ? 'photoURL' : 'coverURL';
                    const displayUrl = data.url;               

                    if (window.globalUserCache) {
                        window.globalUserCache[dbKey] = displayUrl;
                    }

                    if (this.currentCropType === 'cover') {
                        const heroBackground = document.getElementById('heroBackground');
                        if (heroBackground) {
                            heroBackground.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${displayUrl}')`;
                        }
                    }

                  if (this.currentCropType === 'avatar') {
                        const avatarImg  = document.getElementById('profileAvatar');
                        const sidebarPic = document.getElementById('profilePic');
                        
                        if (avatarImg) {
                            avatarImg.src = displayUrl;
                            // Fallback if the CDN 404s
                            avatarImg.onerror = () => avatarImg.src = 'https://ui-avatars.com/api/?name=User&background=EEE&color=333'; 
                        }
                        if (sidebarPic) {
                            sidebarPic.src = displayUrl;
                            sidebarPic.onerror = () => sidebarPic.src = 'https://ui-avatars.com/api/?name=User&background=EEE&color=333';
                        }
                    }
                    
                    this.mainUI.showToast('Photo updated successfully!');

                } else {
                    throw new Error(data.error || 'Upload failed');
                }
            } catch (e) {
                console.error("Crop Upload Error:", e);
                this.mainUI.showToast(e.message);
            } finally {
                this.cancelCrop();
                cropBtn.innerHTML = originalText;
                cropBtn.disabled = false;
            }
        }, 'image/jpeg', 0.9);
    }

    // ==========================================
    // 4. ANTHEMS / PROFILE SONGS
    // ==========================================

    async searchAnthemSongs(query) {
        const resultsContainer = document.getElementById('anthemSearchResults');
        if (!resultsContainer) return;
        resultsContainer.innerHTML = '<div style="text-align:center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Searching database...</div>';

        try {
            const token = await this.auth.currentUser.getIdToken();
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
        this.mainUI.showToast("Anthem updated!");

        try {
            const token = await this.auth.currentUser.getIdToken();
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
                artistId: anthem.artistId,
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

    // ==========================================
    // 5. CONNECTIONS & CRATES
    // ==========================================

    async loadProfileFollowingData(uid) {
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/profile/following/${uid}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            const artistsGrid = document.getElementById('fullArtistsGrid');
            if (artistsGrid) this.populateArtistsGrid(artistsGrid, data.artists || []);
            
            const usersGrid = document.getElementById('fullUsersGrid');
            if (usersGrid) this.populateUsersGrid(usersGrid, data.users || []);
            
        } catch (e) { console.error("Load Following Data Error:", e); }
    }

    populateArtistsGrid(grid, artists) {
        if (!grid) return;
        if (!artists || artists.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="text-align:center; padding:40px; color:#888">
                    <i class="fas fa-music" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block;"></i>
                    <p>No artists followed yet</p>
                </div>`;
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
                </div>`;
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
            const token = await this.auth.currentUser.getIdToken();
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
                    </div>`;
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
        } catch (e) { console.error("Load Top Artists Error:", e); }
    }

    async checkUserFollowStatus(uid, profileData) {
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/user/follow/check?userId=${uid}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            const followBtn = document.getElementById('userFollowBtn');
            
            if (followBtn) {
                followBtn.style.display = 'flex';
                this.updateUserFollowButton(followBtn, data.following, uid, profileData);
            }
        } catch (e) { console.error("Check User Follow Error:", e); }
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
            const token = await this.auth.currentUser.getIdToken();
            const endpoint = isCurrentlyFollowing ? '/player/api/user/unfollow' : '/player/api/user/follow';
            
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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
                this.mainUI.showToast(data.following ? 'Now following!' : 'Unfollowed');
            }
        } catch (e) {
            console.error("Toggle User Follow Error:", e);
            this.mainUI.showToast('Action failed');
        }
    }

    async getUserIdByHandle(handle) {
        try {
            const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
            const token = await this.auth.currentUser.getIdToken();
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

    async loadUserCrates(uid) {
        try {
            const token = await this.auth.currentUser.getIdToken();
            
            const createdRes = await fetch(`/player/api/crates/user/${uid}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const createdData = await createdRes.json();
            this.renderCratesGrid(createdData.crates || [], 'createdCratesGrid');
            
            const likedRes = await fetch(`/player/api/crates/liked/${uid}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const likedData = await likedRes.json();
            this.renderCratesGrid(likedData.crates || [], 'likedCratesGrid');
            
        } catch (e) {
            console.error("Load User Crates Error:", e);
            ['createdCratesGrid', 'likedCratesGrid'].forEach(gridId => {
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
                <div class="empty-state" style="text-align:center; padding:60px 20px; color:var(--text-secondary); width:100%;">
                    <i class="fas fa-box-open" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block"></i>
                    <p style="margin:0; font-size:1rem">No crates found</p>
                </div>`;
            container.style.display = 'flex';
            container.style.justifyContent = 'center';
            return;
        }
        
        container.innerHTML = '';
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';
        container.style.gap = '20px';
        
        crates.forEach(crate => {
            const card = this.mainUI.createCrateCard(crate);
            card.style.minWidth = 'auto'; 
            card.style.width = '100%';
            container.appendChild(card);
        });
    }

    // ==========================================
    // 6. MODALS & UTILS
    // ==========================================

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
}