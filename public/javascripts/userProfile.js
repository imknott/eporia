/* public/javascripts/userProfile.js */
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase-config.js'; 

const auth = getAuth();
let profileData = null;
let profileUid = null;
let isEditing = false;
let cropper = null;
let currentFileType = null;

// [!] NEW: Artist Data for rendering the grid
const ARTIST_DB = {
    '1': { name: 'Neon Echoes', img: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=300' },
    '2': { name: 'The Fold', img: 'https://images.unsplash.com/photo-1493225255756-d9584f8606e9?w=300' },
    '3': { name: 'Mono', img: 'https://images.unsplash.com/photo-1619983081563-430f63602796?w=300' },
    '4': { name: 'M83', img: 'https://images.unsplash.com/photo-1514525253440-b393452e8d26?w=300' },
    '5': { name: 'ODESZA', img: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300' }
};

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
    if (!container || !container.dataset.viewMode) return;

    const viewMode = container.dataset.viewMode;
    const targetHandle = container.dataset.targetHandle;

    if (viewMode === 'public' && targetHandle) {
        loadProfileByHandle(targetHandle);
    } else {
        onAuthStateChanged(auth, (user) => {
            if (user) loadProfileByUid(user.uid);
        });
    }
    setupEventListeners();
}

document.addEventListener('DOMContentLoaded', initUserProfile);

function setupEventListeners() {
    const searchInput = document.getElementById('anthemSearchInput');
    if (searchInput) searchInput.oninput = (e) => renderSearchResults(e.target.value);
    
    const avatarInput = document.getElementById('avatarInput');
    if (avatarInput) avatarInput.onchange = (e) => handleImageSelection(e, 'avatar');

    const coverInput = document.getElementById('coverInput');
    if (coverInput) coverInput.onchange = (e) => handleImageSelection(e, 'cover');
}

// --- DATA READING ---
async function loadProfileByUid(uid) {
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) setupPage(snap.data(), uid);
    } catch (e) { console.error(e); }
}

async function loadProfileByHandle(handle) {
    try {
        const q = query(collection(db, "users"), where("handle", "==", `@${handle}`));
        const snap = await getDocs(q);
        if (!snap.empty) setupPage(snap.docs[0].data(), snap.docs[0].id);
    } catch (e) { console.error(e); }
}

function setupPage(data, uid) {
    profileData = data;
    profileUid = uid;

    setText('profileHandle', data.handle);
    setText('profileRole', (data.role || "Member").toUpperCase());
    setText('profileBio', data.bio || "No bio yet.");

    if (data.photoURL) document.getElementById('profileAvatar').src = data.photoURL;
    if (data.coverURL) {
        document.getElementById('heroBackground').style.backgroundImage = 
            `linear-gradient(to top, rgba(0,0,0,0.8), transparent), url('${data.coverURL}')`;
    }

    if (data.joinDate && data.joinDate.toDate) {
        const dateStr = data.joinDate.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        setText('profileJoinDate', `Joined ${dateStr}`);
    }

    updateAnthemUI(data.profileSong);

    // [!] FIX: Render the Top Artists Grid
    if (data.topArtists && Array.isArray(data.topArtists)) {
        renderTopArtists(data.topArtists);
    }

    // ADMIN Logic
    if (data.role === 'admin') {
        show('tabBtnWall'); hide('impactBadgeContainer');
        if (auth.currentUser?.uid !== uid) show('adminAskBtn');
    }

    // OWNER Logic
    onAuthStateChanged(auth, (user) => {
        if (user && user.uid === uid) {
            show('editBtn'); show('avatarEditBtn'); show('coverEditBtn'); show('anthemEditBtn'); show('tabBtnWall');
        }
    });
}

// [!] NEW: Function to Build the Artist Grid
function renderTopArtists(artistIds) {
    const grid = document.getElementById('topArtistsGrid');
    if (!grid) return;
    
    grid.innerHTML = ''; // Clear previous

    if (artistIds.length === 0) {
        grid.innerHTML = '<div class="empty-state">No artists selected.</div>';
        return;
    }

    artistIds.forEach(id => {
        // Handle ID if it's an object or string
        const artistId = typeof id === 'object' ? id.id : id;
        const artist = ARTIST_DB[artistId];
        
        if (artist) {
            // [!] Use window.navigateTo to keep music playing!
            const html = `
                <div class="artist-square" style="background-image: url('${artist.img}');" onclick="window.navigateTo('/player/artist/${artistId}')">
                    <div class="artist-overlay">
                        <span>${artist.name}</span>
                    </div>
                </div>
            `;
            grid.innerHTML += html;
        }
    });
}

// --- ACTIONS (SECURED via Backend API) ---
window.saveProfile = async function() {
    const newBio = document.getElementById('profileBio').innerText;
    const saveBtn = document.querySelector('#saveControls .btn-action-sm.success');
    saveBtn.innerText = "Saving...";
    try {
        const result = await callApi('/player/api/update-profile', 'POST', { bio: newBio });
        if(result.success) {
            profileData.bio = newBio;
            window.toggleEditMode(); 
        } else { throw new Error(result.error); }
    } catch (e) { alert("Save failed: " + e.message); } finally { saveBtn.innerText = "Save Changes"; }
};

function handleImageSelection(e, type) {
    const file = e.target.files[0];
    if (!file || !profileUid) return;
    currentFileType = type; 
    const reader = new FileReader();
    reader.onload = (ev) => {
        const imageElement = document.getElementById('imageToCrop');
        imageElement.src = ev.target.result;
        document.getElementById('cropperModal').style.display = 'flex';
        if (cropper) cropper.destroy();
        cropper = new Cropper(imageElement, { aspectRatio: type === 'avatar' ? 1 : 3.5, viewMode: 2, autoCropArea: 1 });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

window.saveCrop = async function() {
    if (!cropper) return;
    const saveBtn = document.querySelector('#cropperModal .btn-action-sm.success');
    saveBtn.innerText = "Uploading...";
    const canvas = cropper.getCroppedCanvas({ width: currentFileType === 'avatar' ? 500 : 1200, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });

    canvas.toBlob(async (blob) => {
        try {
            const formData = new FormData();
            formData.append('image', blob);
            formData.append('type', currentFileType);
            const result = await callApi('/player/api/upload-image', 'POST', formData, true);

            if (result.success) {
                if(currentFileType === 'avatar') document.getElementById('profileAvatar').src = result.url;
                else document.getElementById('heroBackground').style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.8), transparent), url('${result.url}')`;
                document.getElementById('cropperModal').style.display = 'none';
            } else { throw new Error(result.error); }
        } catch (e) { console.error(e); alert("Upload failed: " + e.message); } finally { saveBtn.innerHTML = '<i class="fas fa-check"></i> Save & Upload'; }
    }, 'image/jpeg', 0.9);
};

// --- SEARCH & UI HELPERS ---
const MOCK_SONGS = [
    { title: "Midnight City", artist: "M83", img: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100" },
    { title: "Intro", artist: "The xx", img: "https://images.unsplash.com/photo-1493225255756-d9584f8606e9?w=100" },
    { title: "Strobe", artist: "Deadmau5", img: "https://images.unsplash.com/photo-1619983081563-430f63602796?w=100" }
];

function renderSearchResults(query) {
    const container = document.getElementById('anthemSearchResults');
    container.innerHTML = '';
    const lowerQ = query.toLowerCase();
    const matches = query.length === 0 ? MOCK_SONGS : MOCK_SONGS.filter(s => s.title.toLowerCase().includes(lowerQ));

    matches.forEach(song => {
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML = `<img src="${song.img}"><div><h4>${song.title}</h4><p>${song.artist}</p></div>`;
        item.onclick = async () => {
            try {
                await callApi('/player/api/update-profile', 'POST', { profileSong: song });
                updateAnthemUI(song);
                document.getElementById('anthemModal').style.display = 'none';
            } catch(e) { alert("Failed to update anthem"); }
        };
        container.appendChild(item);
    });
}

window.toggleEditMode = function() {
    isEditing = !isEditing;
    const bio = document.getElementById('profileBio');
    if (isEditing) {
        hide('editBtn'); show('saveControls');
        bio.contentEditable = true; bio.classList.add('editing'); bio.focus();
    } else {
        show('editBtn'); hide('saveControls');
        bio.contentEditable = false; bio.classList.remove('editing');
        bio.innerText = profileData.bio || "No bio yet.";
    }
};

window.playAnthem = function() {
    const card = document.getElementById('anthemPlayer');
    if(!card) return;
    const id = card.dataset.songId;
    console.log("Playing anthem:", id);
    if(window.playSong && id) window.playSong(id, card.dataset.songTitle, card.dataset.songArtist, card.dataset.songImg);
};

window.closeCropperModal = function() { document.getElementById('cropperModal').style.display = 'none'; if (cropper) cropper.destroy(); };
function setText(id, txt) { const el = document.getElementById(id); if(el) el.innerText = txt; }
function show(id) { const el = document.getElementById(id); if(el) el.style.display = 'flex'; }
function hide(id) { const el = document.getElementById(id); if(el) el.style.display = 'none'; }
function updateAnthemUI(song) {
    const card = document.getElementById('anthemPlayer');
    if(!card) return;
    if (song) {
        setText('anthemTitle', song.title);
        setText('anthemArtist', song.artist);
        document.getElementById('anthemArt').src = song.img;
        card.dataset.songTitle = song.title;
        card.dataset.songArtist = song.artist;
        card.dataset.songImg = song.img;
        card.dataset.songId = "mock_id";
    } else {
        setText('anthemTitle', "No Anthem");
        setText('anthemArtist', "-");
    }
}