/* public/javascripts/userProfile.js */
import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, collection, getDocs, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();

// Global state
let currentUserUid = null;
let targetUserUid = null;
let isOwnProfile = false;
let profileData = null;
let isEditMode = false;

// Track original values for cancel functionality
let originalData = {
    bio: '',
    avatar: '',
    coverURL: '',
    anthem: null
};

// Track pending changes (not yet saved)
let pendingChanges = {
    avatar: null,
    coverURL: null,
    anthem: null,
    bio: null
};

// ==========================================
// 1. INITIALIZE PROFILE
// ==========================================
async function initProfile() {
    const viewMode = document.querySelector('.content-scroll').dataset.viewMode;
    const targetHandle = document.querySelector('.content-scroll').dataset.targetHandle;
    
    // Wait for auth
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = '/login';
            return;
        }
        
        currentUserUid = user.uid;
        
        // Determine whose profile we're viewing
        if (viewMode === 'private') {
            targetUserUid = currentUserUid;
            isOwnProfile = true;
        } else {
            targetUserUid = await getUserIdByHandle(targetHandle);
            isOwnProfile = (targetUserUid === currentUserUid);
        }
        
        if (!targetUserUid) {
            console.error("Could not find user");
            return;
        }
        
        // Load profile data
        await loadProfileData();
        await loadFollowingData();
        await loadTopArtists();
        
        // Setup UI controls
        setupEditMode();
        setupTabSwitching();
        setupAnthemSearch();
    });
}

// ==========================================
// 2. LOAD PROFILE DATA
// ==========================================
async function loadProfileData() {
    try {
        const userDoc = await getDoc(doc(db, 'users', targetUserUid));
        
        if (!userDoc.exists()) {
            console.error("User not found");
            return;
        }
        
        profileData = userDoc.data();
        
        // Store original values
        originalData = {
            bio: profileData.bio || '',
            avatar: profileData.avatar || '',
            coverURL: profileData.coverURL || '',
            anthem: profileData.anthem || null
        };
        
        // Update UI elements
        updateProfileUI();
        
        // Show/hide buttons based on ownership
        if (isOwnProfile) {
            document.getElementById('editBtn').style.display = 'flex';
            // Don't show camera buttons until edit mode
        } else {
            await checkFollowStatus();
        }
        
    } catch (e) {
        console.error("Load Profile Error:", e);
    }
}

function updateProfileUI() {
    // Basic info
    document.getElementById('profileHandle').textContent = profileData.handle || '@user';
    document.getElementById('profileBio').textContent = profileData.bio || 'No bio yet.';
    document.getElementById('profileRole').textContent = profileData.role?.toUpperCase() || 'MEMBER';
    
    // Format join date
    if (profileData.createdAt) {
        const joinDate = profileData.createdAt.toDate ? 
            profileData.createdAt.toDate() : new Date(profileData.createdAt);
        const formatted = joinDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        document.getElementById('profileJoinDate').textContent = `Joined ${formatted}`;
    }
    
    // Load avatar
    const avatarImg = document.getElementById('profileAvatar');
    if (profileData.avatar) {
        avatarImg.src = profileData.avatar;
    }
    
    // Load cover image
    const heroBackground = document.getElementById('heroBackground');
    if (profileData.coverURL) {
        heroBackground.style.backgroundImage = 
            `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${profileData.coverURL}')`;
    }
    
    // Load anthem
    loadAnthem();
}

// ==========================================
// 3. LOAD ANTHEM
// ==========================================
function loadAnthem() {
    const anthemCard = document.getElementById('anthemPlayer');
    const anthemTitle = document.getElementById('anthemTitle');
    const anthemArtist = document.getElementById('anthemArtist');
    const anthemArt = document.getElementById('anthemArt');
    
    const currentAnthem = pendingChanges.anthem !== null ? pendingChanges.anthem : 
                          (profileData.anthem || null);
    
    if (currentAnthem) {
        anthemTitle.textContent = currentAnthem.title || '--';
        anthemArtist.textContent = currentAnthem.artist || '--';
        
        if (currentAnthem.img) {
            anthemArt.src = currentAnthem.img;
        }
        
        // Store data attributes for playback
        anthemCard.dataset.songId = currentAnthem.songId || '';
        anthemCard.dataset.songTitle = currentAnthem.title || '';
        anthemCard.dataset.songArtist = currentAnthem.artist || '';
        anthemCard.dataset.songImg = currentAnthem.img || '';
        anthemCard.dataset.audioUrl = currentAnthem.audioUrl || '';
        anthemCard.dataset.duration = currentAnthem.duration || '0';
        
        anthemCard.classList.remove('empty');
    } else {
        anthemTitle.textContent = 'No anthem set';
        anthemArtist.textContent = isEditMode ? 'Click edit to choose your signature track' : 'No anthem selected';
        anthemCard.classList.add('empty');
    }
}

// ==========================================
// 4. EDIT MODE FUNCTIONALITY
// ==========================================
function setupEditMode() {
    if (!isOwnProfile) return;
    
    // Avatar upload handler
    const avatarInput = document.getElementById('avatarInput');
    if (avatarInput) {
        avatarInput.addEventListener('change', handleAvatarUpload);
    }
    
    // Cover upload handler (we'll add this)
    const coverInput = document.getElementById('coverInput');
    if (coverInput) {
        coverInput.addEventListener('change', handleCoverUpload);
    }
}

window.toggleEditMode = function() {
    isEditMode = !isEditMode;
    
    const bioText = document.getElementById('profileBio');
    const editBtn = document.getElementById('editBtn');
    const saveControls = document.getElementById('saveControls');
    const avatarEditBtn = document.getElementById('avatarEditBtn');
    const coverEditBtn = document.getElementById('coverEditBtn');
    const anthemEditBtn = document.getElementById('anthemEditBtn');
    
    if (isEditMode) {
        // ENTER EDIT MODE
        
        // Make bio editable
        bioText.contentEditable = 'true';
        bioText.classList.add('editing');
        bioText.focus();
        
        // Show edit buttons
        if (avatarEditBtn) avatarEditBtn.style.display = 'flex';
        if (coverEditBtn) coverEditBtn.style.display = 'flex';
        if (anthemEditBtn) anthemEditBtn.style.display = 'inline-block';
        
        // Toggle control buttons
        editBtn.style.display = 'none';
        saveControls.style.display = 'flex';
        
        // Store current bio in pending changes
        pendingChanges.bio = bioText.textContent;
        
    } else {
        // EXIT EDIT MODE (CANCEL)
        
        // Revert all changes
        revertAllChanges();
        
        // Make bio non-editable
        bioText.contentEditable = 'false';
        bioText.classList.remove('editing');
        bioText.textContent = originalData.bio || 'No bio yet.';
        
        // Hide edit buttons
        if (avatarEditBtn) avatarEditBtn.style.display = 'none';
        if (coverEditBtn) coverEditBtn.style.display = 'none';
        if (anthemEditBtn) anthemEditBtn.style.display = 'none';
        
        // Toggle control buttons
        editBtn.style.display = 'flex';
        saveControls.style.display = 'none';
    }
};

function revertAllChanges() {
    // Revert avatar
    if (pendingChanges.avatar) {
        document.getElementById('profileAvatar').src = originalData.avatar || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    }
    
    // Revert cover
    if (pendingChanges.coverURL) {
        const heroBackground = document.getElementById('heroBackground');
        if (originalData.coverURL) {
            heroBackground.style.backgroundImage = 
                `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${originalData.coverURL}')`;
        } else {
            heroBackground.style.backgroundImage = 'linear-gradient(to right, #444, #222)';
        }
    }
    
    // Revert anthem
    if (pendingChanges.anthem) {
        pendingChanges.anthem = null;
        loadAnthem();
    }
    
    // Clear all pending changes
    pendingChanges = {
        avatar: null,
        coverURL: null,
        anthem: null,
        bio: null
    };
}

// ==========================================
// 5. PHOTO UPLOAD HANDLERS
// ==========================================
async function handleAvatarUpload(event) {
    if (!isEditMode) return;
    
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file
    if (!file.type.startsWith('image/')) {
        window.ui?.showToast('Please select an image file');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        window.ui?.showToast('Image must be less than 5MB');
        return;
    }
    
    try {
        // Show loading state
        const avatarImg = document.getElementById('profileAvatar');
        avatarImg.style.opacity = '0.5';
        
        // Create preview
        const reader = new FileReader();
        reader.onload = (e) => {
            avatarImg.src = e.target.result;
            avatarImg.style.opacity = '1';
        };
        reader.readAsDataURL(file);
        
        // Store file for later upload
        pendingChanges.avatar = file;
        
        window.ui?.showToast('Avatar preview updated. Click "Save Changes" to apply.');
        
    } catch (e) {
        console.error('Avatar preview error:', e);
        window.ui?.showToast('Failed to preview avatar');
        document.getElementById('profileAvatar').style.opacity = '1';
    }
}

async function handleCoverUpload(event) {
    if (!isEditMode) return;
    
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file
    if (!file.type.startsWith('image/')) {
        window.ui?.showToast('Please select an image file');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        window.ui?.showToast('Image must be less than 5MB');
        return;
    }
    
    try {
        // Create preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const heroBackground = document.getElementById('heroBackground');
            heroBackground.style.backgroundImage = 
                `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${e.target.result}')`;
        };
        reader.readAsDataURL(file);
        
        // Store file for later upload
        pendingChanges.coverURL = file;
        
        window.ui?.showToast('Cover preview updated. Click "Save Changes" to apply.');
        
    } catch (e) {
        console.error('Cover preview error:', e);
        window.ui?.showToast('Failed to preview cover');
    }
}

// ==========================================
// 6. SAVE PROFILE
// ==========================================
window.saveProfile = async function() {
    if (!isOwnProfile) return;
    
    const saveBtn = document.querySelector('#saveControls .btn-action-sm.success');
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        saveBtn.disabled = true;
    }
    
    try {
        const token = await auth.currentUser.getIdToken();
        const bioText = document.getElementById('profileBio').textContent;
        
        // Prepare update data
        const updates = {
            bio: bioText
        };
        
        // Upload avatar if changed
        if (pendingChanges.avatar) {
            const avatarUrl = await uploadImage(pendingChanges.avatar, 'avatar');
            if (avatarUrl) {
                updates.avatar = avatarUrl;
                originalData.avatar = avatarUrl;
            }
        }
        
        // Upload cover if changed
        if (pendingChanges.coverURL) {
            const coverUrl = await uploadImage(pendingChanges.coverURL, 'cover');
            if (coverUrl) {
                updates.coverURL = coverUrl;
                originalData.coverURL = coverUrl;
            }
        }
        
        // Update anthem if changed
        if (pendingChanges.anthem !== null) {
            updates.anthem = pendingChanges.anthem;
            originalData.anthem = pendingChanges.anthem;
        }
        
        // Save to database
        const res = await fetch('/player/api/profile/update', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });
        
        const data = await res.json();
        
        if (data.success) {
            // Update profile data
            profileData = { ...profileData, ...updates };
            originalData.bio = bioText;
            
            // Clear pending changes
            pendingChanges = {
                avatar: null,
                coverURL: null,
                anthem: null,
                bio: null
            };
            
            // Exit edit mode
            isEditMode = true; // Set to true so toggleEditMode will turn it off
            window.toggleEditMode();
            
            window.ui?.showToast('Profile updated successfully!');
            
            // Update sidebar if it exists
            if (window.globalUserCache) {
                window.globalUserCache.bio = bioText;
                if (updates.avatar) window.globalUserCache.avatar = updates.avatar;
            }
        } else {
            throw new Error(data.error || 'Update failed');
        }
        
    } catch (e) {
        console.error("Save Profile Error:", e);
        window.ui?.showToast('Failed to save profile');
    } finally {
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Save Changes';
            saveBtn.disabled = false;
        }
    }
};

async function uploadImage(file, type) {
    try {
        const formData = new FormData();
        formData.append(type === 'avatar' ? 'avatar' : 'cover', file);
        
        const token = await auth.currentUser.getIdToken();
        const endpoint = type === 'avatar' ? '/player/api/profile/upload-avatar' : '/player/api/profile/upload-cover';
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        const data = await res.json();
        
        if (data.url) {
            return data.url;
        } else {
            throw new Error('Upload failed');
        }
        
    } catch (e) {
        console.error(`Upload ${type} error:`, e);
        window.ui?.showToast(`Failed to upload ${type}`);
        return null;
    }
}

// ==========================================
// 7. ANTHEM SELECTION
// ==========================================
function setupAnthemSearch() {
    const searchInput = document.getElementById('anthemSearchInput');
    if (!searchInput) return;
    
    let searchTimeout;
    
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        
        if (query.length < 2) {
            document.getElementById('anthemSearchResults').innerHTML = '';
            return;
        }
        
        searchTimeout = setTimeout(() => {
            searchAnthemSongs(query);
        }, 300);
    });
}

async function searchAnthemSongs(searchQuery) {
    try {
        const token = await auth.currentUser.getIdToken();
        
        // Search songs in database
        const songsRef = collection(db, 'songs');
        const querySnapshot = await getDocs(songsRef);
        
        const results = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const searchLower = searchQuery.toLowerCase();
            
            // Match title or artist
            if (data.title?.toLowerCase().includes(searchLower) || 
                data.artist?.toLowerCase().includes(searchLower)) {
                results.push({
                    id: doc.id,
                    ...data
                });
            }
        });
        
        // Limit to 10 results
        displayAnthemResults(results.slice(0, 10));
        
    } catch (e) {
        console.error('Anthem search error:', e);
    }
}

function displayAnthemResults(songs) {
    const resultsContainer = document.getElementById('anthemSearchResults');
    
    if (songs.length === 0) {
        resultsContainer.innerHTML = `
            <div class="empty-search-state">
                <i class="fas fa-search" style="font-size: 2rem; opacity: 0.3; margin-bottom: 10px;"></i>
                <p style="color: var(--text-muted);">No songs found</p>
            </div>
        `;
        return;
    }
    
    resultsContainer.innerHTML = '';
    
    songs.forEach(song => {
        const songCard = document.createElement('div');
        songCard.className = 'anthem-search-result';
        
        songCard.innerHTML = `
            <img src="${song.artUrl || 'https://via.placeholder.com/50'}" alt="${song.title}">
            <div class="song-info">
                <div class="song-title">${song.title}</div>
                <div class="song-artist">${song.artist || 'Unknown Artist'}</div>
            </div>
            <button class="play-preview-btn" onclick="event.stopPropagation(); previewSong('${song.id}', '${song.audioUrl}', '${song.title}', '${song.artist}', '${song.artUrl}')">
                <i class="fas fa-play"></i>
            </button>
            <button class="select-anthem-btn">
                Select
            </button>
        `;
        
        // Click to select
        songCard.addEventListener('click', () => {
            selectAnthem(song);
        });
        
        resultsContainer.appendChild(songCard);
    });
}

function selectAnthem(song) {
    pendingChanges.anthem = {
        songId: song.id,
        title: song.title,
        artist: song.artist || 'Unknown Artist',
        img: song.artUrl || 'https://via.placeholder.com/50',
        audioUrl: song.audioUrl,
        duration: song.duration || 0
    };
    
    // Update UI
    loadAnthem();
    
    // Close modal
    window.closeAnthemModal();
    
    window.ui?.showToast(`Anthem set to "${song.title}". Click "Save Changes" to apply.`);
}

window.previewSong = function(id, audioUrl, title, artist, artUrl) {
    if (window.audioEngine && window.audioEngine.play) {
        window.audioEngine.play(id, {
            audioUrl: audioUrl,
            title: title,
            artist: artist,
            img: artUrl,
            duration: 0
        });
    }
};

// ==========================================
// 8. ANTHEM PLAYBACK
// ==========================================
window.playAnthem = function() {
    const card = document.getElementById('anthemPlayer');
    const songId = card.dataset.songId;
    const title = card.dataset.songTitle;
    const artist = card.dataset.songArtist;
    const img = card.dataset.songImg;
    const audioUrl = card.dataset.audioUrl;
    const duration = parseFloat(card.dataset.duration) || 0;
    
    if (songId && audioUrl && window.audioEngine) {
        window.audioEngine.play(songId, {
            audioUrl: audioUrl,
            title: title,
            artist: artist,
            img: img,
            duration: duration
        });
    } else {
        window.ui?.showToast('No anthem set');
    }
};

// ==========================================
// 9. FOLLOWING DATA
// ==========================================
async function loadFollowingData() {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/following/${targetUserUid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        
        populateArtistsGrid(data.artists || []);
        populateUsersGrid(data.users || []);
        
    } catch (e) {
        console.error("Load Following Error:", e);
    }
}

function populateArtistsGrid(artists) {
    const grid = document.getElementById('fullArtistsGrid');
    
    if (!artists || artists.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-music"></i>
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

function populateUsersGrid(users) {
    const grid = document.getElementById('fullUsersGrid');
    
    if (!users || users.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-friends"></i>
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
            ${isOwnProfile ? `
                <button class="unfollow-btn" onclick="unfollowUser('${user.id}', '${user.name}', event)">
                    Following
                </button>
            ` : ''}
        `;
        
        grid.appendChild(card);
    });
}

async function loadTopArtists() {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/following/${targetUserUid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        const artists = data.artists || [];
        
        const grid = document.getElementById('topArtistsGrid');
        grid.innerHTML = '';
        
        const topArtists = artists.slice(0, 6);
        
        if (topArtists.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <i class="fas fa-music"></i>
                    <p>No artists followed yet</p>
                </div>
            `;
            return;
        }
        
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

// ==========================================
// 10. FOLLOW/UNFOLLOW
// ==========================================
async function checkFollowStatus() {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/user/follow/check?userId=${targetUserUid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        const followBtn = document.getElementById('userFollowBtn');
        
        if (followBtn) {
            followBtn.style.display = 'flex';
            updateFollowButton(data.following);
        }
    } catch (e) {
        console.error("Check Follow Error:", e);
    }
}

function updateFollowButton(isFollowing) {
    const btn = document.getElementById('userFollowBtn');
    if (!btn) return;
    
    if (isFollowing) {
        btn.innerHTML = '<i class="fas fa-user-check"></i><span>Following</span>';
        btn.style.background = '#666';
    } else {
        btn.innerHTML = '<i class="fas fa-user-plus"></i><span>Follow</span>';
        btn.style.background = '#88C9A1';
    }
}

window.toggleUserFollow = async function() {
    const btn = document.getElementById('userFollowBtn');
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
                userId: targetUserUid,
                handle: profileData.handle,
                name: profileData.displayName || profileData.handle,
                avatar: profileData.avatar
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            updateFollowButton(data.following);
            window.ui?.showToast(data.following ? 'Now following!' : 'Unfollowed');
        }
    } catch (e) {
        console.error("Toggle Follow Error:", e);
        window.ui?.showToast('Action failed');
    }
};

window.unfollowUser = async function(userId, userName, event) {
    event.stopPropagation();
    
    window.pendingUnfollow = async () => {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/user/unfollow', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ userId })
            });
            
            const data = await res.json();
            
            if (data.success) {
                await loadFollowingData();
                window.ui?.showToast('Unfollowed');
            }
        } catch (e) {
            console.error("Unfollow Error:", e);
            window.ui?.showToast('Action failed');
        }
    };
    
    document.getElementById('unfollowTargetName').textContent = userName;
    document.getElementById('unfollowModal').style.display = 'flex';
};

// ==========================================
// 11. HELPER FUNCTIONS
// ==========================================
async function getUserIdByHandle(handle) {
    try {
        const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
        const usersRef = collection(db, 'users');
        const q = query(usersRef);
        const snapshot = await getDocs(q);
        
        let userId = null;
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.handle === cleanHandle) {
                userId = doc.id;
            }
        });
        
        return userId;
    } catch (e) {
        console.error("Get User ID Error:", e);
        return null;
    }
}

function setupTabSwitching() {
    window.switchProfileTab = function(tabName) {
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.style.display = 'none';
        });
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        document.getElementById(`tab-${tabName}`).style.display = 'block';
        event.target.classList.add('active');
    };
    
    window.switchSubTab = function(subTab) {
        if (subTab === 'artists') {
            document.getElementById('followingArtistsView').style.display = 'block';
            document.getElementById('followingUsersView').style.display = 'none';
            document.getElementById('subBtnArtists').classList.add('active');
            document.getElementById('subBtnUsers').classList.remove('active');
        } else {
            document.getElementById('followingArtistsView').style.display = 'none';
            document.getElementById('followingUsersView').style.display = 'block';
            document.getElementById('subBtnArtists').classList.remove('active');
            document.getElementById('subBtnUsers').classList.add('active');
        }
    };
}

// ==========================================
// INITIALIZE
// ==========================================
initProfile();