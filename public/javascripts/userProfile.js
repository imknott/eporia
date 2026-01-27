/* public/javascripts/userProfile.js */
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase-config.js'; 

const auth = getAuth();
let profileData = null;
let profileUid = null; 
let isOwner = false;
let cropper = null;
let currentFileType = null;

// --- API HELPER ---
async function callApi(endpoint, method, body, isFormData = false) {
    const user = auth.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    const headers = { 'Authorization': `Bearer ${token}` };
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const response = await fetch(endpoint, {
        method: method,
        headers: headers,
        body: isFormData ? body : JSON.stringify(body)
    });
    return await response.json();
}

// --- INIT ---
export function initUserProfile() {
    const container = document.querySelector('.content-scroll');
    if (!container || (!container.dataset.viewMode && !container.dataset.targetHandle)) return;

    const viewMode = container.dataset.viewMode;
    const targetHandle = container.dataset.targetHandle;

    if (viewMode === 'public' && targetHandle) {
        loadProfileByHandle(targetHandle);
    } else {
        onAuthStateChanged(auth, (user) => {
            if (user) loadProfileByUid(user.uid);
        });
    }
}

async function loadProfileByHandle(handle) {
    try {
        const q = query(collection(db, "users"), where("handle", "==", '@' + handle));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            setupPage(doc.data(), doc.id);
        } else {
            setText('profileHandle', "User not found");
        }
    } catch (e) { console.error(e); }
}

async function loadProfileByUid(uid) {
    try {
        if (window.globalUserCache && window.globalUserCache.uid === uid) {
            setupPage(window.globalUserCache, uid);
        }
        const docSnap = await getDoc(doc(db, "users", uid));
        if (docSnap.exists()) {
            if (auth.currentUser && auth.currentUser.uid === uid) window.globalUserCache = docSnap.data();
            setupPage(docSnap.data(), uid);
        }
    } catch (e) { console.error(e); }
}

function setupPage(data, targetUid) {
    profileData = data;
    profileUid = targetUid;
    
    const currentUser = auth.currentUser;
    const myUid = currentUser ? currentUser.uid : null;
    isOwner = (myUid && myUid === targetUid);

    const rawHandle = data.handle || "User";
    setText('profileHandle', rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle);
    setText('profileRole', (data.role || "Member").toUpperCase());
    setText('profileBio', data.bio || "No bio yet.");
    
    if (data.joinDate) {
        let dateObj = data.joinDate.toDate ? data.joinDate.toDate() : new Date(data.joinDate);
        setText('profileJoinDate', `Joined ${dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}`);
    }

    if (data.photoURL) document.getElementById('profileAvatar').src = data.photoURL;
    if (data.coverURL) document.getElementById('heroBackground').style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.8), transparent), url('${data.coverURL}')`;

    updateAnthemUI(data.profileSong);
    renderTopArtists(data.sidebarArtists || []);

    if (isOwner) {
        show('editBtn'); show('avatarEditBtn'); show('coverEditBtn'); show('anthemEditBtn'); 
        if(!data.role || data.role !== 'admin') show('impactBadgeContainer');
    } else if (currentUser) {
        show('userFollowBtn');
        checkUserFollowStatus(targetUid);
    }

    if (data.role === 'admin' || isOwner) show('tabBtnWall');
}

// --- FOLLOWING TAB ---
let followingLoaded = false;

window.loadFollowingTab = async function() {
    if (followingLoaded || !profileUid) return;
    
    const artistGrid = document.getElementById('fullArtistsGrid');
    const userGrid = document.getElementById('fullUsersGrid');
    
    try {
        const res = await callApi(`/player/api/profile/following/${profileUid}`, 'GET');
        
        if (res.artists && res.artists.length > 0) {
            artistGrid.innerHTML = res.artists.map(a => `
                <div class="artist-square" style="background-image: url('${a.img || 'https://via.placeholder.com/150'}'); cursor:pointer; background-size:cover; border-radius:12px; aspect-ratio:1/1; position:relative; overflow:hidden;" onclick="window.navigateTo('/player/artist/${a.artistId}')">
                    <div class="artist-overlay" style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.6); padding:8px; color:white; font-size:0.8rem; font-weight:700;">
                        <span>${a.name}</span>
                    </div>
                </div>
            `).join('');
        } else {
            artistGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1; text-align:center; padding:30px; color:#888">Not following any artists.</div>';
        }

        if (res.users && res.users.length > 0) {
            userGrid.innerHTML = res.users.map(u => `
                <div class="user-row" style="display:flex; align-items:center; padding:10px; background:var(--input-bg); border-radius:10px; cursor:pointer;" onclick="window.navigateTo('/player/u/${u.handle.replace('@','')}')">
                    <img src="${u.img || 'https://via.placeholder.com/40'}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:15px">
                    <div style="flex:1">
                        <div style="font-weight:700; color:var(--text-main)">${u.handle}</div>
                        <div style="font-size:0.8rem; color:var(--text-secondary)">Member</div>
                    </div>
                    ${isOwner ? `<button onclick="triggerUnfollowModal('${u.uid}', '${u.handle}', this); event.stopPropagation()" class="btn-action-sm text" style="color:var(--danger)">Unfollow</button>` : ''}
                </div>
            `).join('');
        } else {
            userGrid.innerHTML = '<div class="empty-state" style="text-align:center; padding:30px; color:#888">Not following any users.</div>';
        }

        followingLoaded = true;
    } catch (e) { console.error("Following load failed", e); }
};

window.switchSubTab = function(type) {
    const btnArtists = document.getElementById('subBtnArtists');
    const btnUsers = document.getElementById('subBtnUsers');
    const viewArtists = document.getElementById('followingArtistsView');
    const viewUsers = document.getElementById('followingUsersView');

    if (type === 'artists') {
        btnArtists.style.opacity = '1'; btnArtists.style.color = 'var(--text-main)';
        btnUsers.style.opacity = '0.6'; btnUsers.style.color = 'var(--text-secondary)';
        viewArtists.style.display = 'block';
        viewUsers.style.display = 'none';
    } else {
        btnUsers.style.opacity = '1'; btnUsers.style.color = 'var(--text-main)';
        btnArtists.style.opacity = '0.6'; btnArtists.style.color = 'var(--text-secondary)';
        viewUsers.style.display = 'block';
        viewArtists.style.display = 'none';
    }
};

// [FIX] NEW MODAL TRIGGER LOGIC
window.triggerUnfollowModal = function(uid, handle, btnElement) {
    // 1. Set Modal Text
    const nameEl = document.getElementById('unfollowTargetName');
    if(nameEl) nameEl.innerText = handle;

    // 2. Set Pending Action
    window.pendingUnfollow = async () => {
        try {
            await callApi('/player/api/user/follow', 'POST', { targetUid: uid, targetHandle: handle });
            btnElement.closest('.user-row').remove(); // Remove UI Row
        } catch(e) { 
            alert("Error unfollowing"); 
        }
    };

    // 3. Show Modal
    document.getElementById('unfollowModal').style.display = 'flex';
};

window.switchProfileTab = (tabName) => {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    if(event) event.currentTarget.classList.add('active');
    if (tabName === 'following') window.loadFollowingTab();
};

function renderTopArtists(artists) {
    const grid = document.getElementById('topArtistsGrid');
    if (!grid) return;
    grid.innerHTML = ''; 
    if (!artists || artists.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="color:#888; grid-column: 1/-1; text-align:center;">No artists followed yet.</div>';
        return;
    }
    artists.forEach(artist => {
        grid.innerHTML += `
            <div class="artist-square" style="background-image: url('${artist.img || 'https://via.placeholder.com/150'}'); cursor:pointer; background-size:cover; border-radius:12px; aspect-ratio:1/1; position:relative; overflow:hidden;" onclick="window.navigateTo('/player/artist/${artist.id}')">
                <div class="artist-overlay" style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.6); padding:8px; color:white; font-size:0.8rem; font-weight:700;">
                    <span>${artist.name}</span>
                </div>
            </div>`;
    });
}

async function checkUserFollowStatus(targetUid) {
    try {
        const res = await callApi(`/player/api/user/follow/status?targetUid=${targetUid}`, 'GET');
        updateUserFollowButton(res.following);
    } catch (e) { console.error(e); }
}

window.toggleUserFollow = async function() {
    const btn = document.getElementById('userFollowBtn');
    if (!btn || !profileUid) return;
    const isFollowing = btn.classList.contains('following');
    updateUserFollowButton(!isFollowing);
    try {
        const res = await callApi('/player/api/user/follow', 'POST', { targetUid: profileUid, targetHandle: profileData.handle });
        updateUserFollowButton(res.following);
    } catch (e) { console.error(e); updateUserFollowButton(isFollowing); }
};

function updateUserFollowButton(isFollowing) {
    const btn = document.getElementById('userFollowBtn');
    const span = btn.querySelector('span');
    const icon = btn.querySelector('i');
    if (isFollowing) {
        btn.classList.add('following'); btn.style.background = 'transparent'; btn.style.border = '1px solid #FFF';
        span.innerText = 'Following'; icon.className = 'fas fa-check';
    } else {
        btn.classList.remove('following'); btn.style.background = '#88C9A1'; btn.style.border = 'none';
        span.innerText = 'Follow'; icon.className = 'fas fa-user-plus';
    }
}

window.toggleEditMode = function() {
    const bio = document.getElementById('profileBio');
    const isEditing = bio.classList.contains('editing');
    if (!isEditing) {
        hide('editBtn'); show('saveControls');
        bio.contentEditable = true; bio.classList.add('editing'); bio.focus();
    } else {
        show('editBtn'); hide('saveControls');
        bio.contentEditable = false; bio.classList.remove('editing');
        if(profileData) bio.innerText = profileData.bio || "No bio yet.";
    }
};

window.saveProfile = async function() {
    const newBio = document.getElementById('profileBio').innerText;
    const saveBtn = document.querySelector('#saveControls .btn-action-sm.success');
    saveBtn.innerText = "Saving...";
    try {
        const result = await callApi('/player/api/update-profile', 'POST', { bio: newBio });
        if(result.success) {
            if(window.globalUserCache) window.globalUserCache.bio = newBio;
            profileData.bio = newBio;
            const bio = document.getElementById('profileBio');
            bio.contentEditable = false; bio.classList.remove('editing');
            show('editBtn'); hide('saveControls');
        } else { throw new Error(result.error); }
    } catch (e) { alert("Save failed: " + e.message); } 
    finally { saveBtn.innerText = "Save Changes"; }
};

function setText(id, txt) { const el = document.getElementById(id); if(el) el.innerText = txt; }
function show(id) { const el = document.getElementById(id); if(el) el.style.display = 'flex'; }
function hide(id) { const el = document.getElementById(id); if(el) el.style.display = 'none'; }
function updateAnthemUI(song) {
    const card = document.getElementById('anthemPlayer');
    if(!card) return;
    if (song) {
        setText('anthemTitle', song.title); setText('anthemArtist', song.subtitle || song.artist);
        document.getElementById('anthemArt').src = song.img || 'https://via.placeholder.com/50';
        card.dataset.songId = song.id; card.dataset.songTitle = song.title; card.dataset.songArtist = song.subtitle || song.artist; card.dataset.songImg = song.img; card.dataset.audioUrl = song.audioUrl; card.dataset.duration = song.duration;
    } else { setText('anthemTitle', "No Anthem"); setText('anthemArtist', "-"); }
}
window.playAnthem = function() {
    const card = document.getElementById('anthemPlayer');
    if(!card || !card.dataset.songId) return;
    if(window.playSong) window.playSong(card.dataset.songId, card.dataset.songTitle, card.dataset.songArtist, card.dataset.songImg, card.dataset.audioUrl, card.dataset.duration);
};
window.closeCropperModal = function() { document.getElementById('cropperModal').style.display = 'none'; if (cropper) cropper.destroy(); };
const avatarInput = document.getElementById('avatarInput'); if (avatarInput) avatarInput.onchange = (e) => handleImageSelection(e, 'avatar');
const coverInput = document.getElementById('coverInput'); if (coverInput) coverInput.onchange = (e) => handleImageSelection(e, 'cover');
function handleImageSelection(e, type) {
    const file = e.target.files[0];
    if (!file) return;
    currentFileType = type; 
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = document.getElementById('imageToCrop');
        img.src = ev.target.result;
        document.getElementById('cropperModal').style.display = 'flex';
        if (cropper) cropper.destroy();
        cropper = new Cropper(img, { aspectRatio: type === 'avatar' ? 1 : 3.5, viewMode: 2 });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}
window.saveCrop = async function() {
    if (!cropper) return;
    const saveBtn = document.querySelector('#cropperModal .btn-action-sm.success');
    saveBtn.innerText = "Uploading...";
    cropper.getCroppedCanvas({ width: currentFileType === 'avatar' ? 500 : 1200 }).toBlob(async (blob) => {
        try {
            const formData = new FormData(); formData.append('image', blob); formData.append('type', currentFileType);
            const result = await callApi('/player/api/upload-image', 'POST', formData, true);
            if (result.success) {
                if(window.globalUserCache) { if(currentFileType === 'avatar') window.globalUserCache.photoURL = result.url; else window.globalUserCache.coverURL = result.url; }
                if(currentFileType === 'avatar') document.getElementById('profileAvatar').src = result.url; else document.getElementById('heroBackground').style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.8), transparent), url('${result.url}')`;
                document.getElementById('cropperModal').style.display = 'none';
            }
        } catch (e) { alert("Upload failed"); } finally { saveBtn.innerText = 'Save & Upload'; }
    });
};
document.addEventListener('DOMContentLoaded', initUserProfile);