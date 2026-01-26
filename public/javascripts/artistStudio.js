/* artistStudio.js */
import { 
    getAuth, 
    signInWithCustomToken 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';
import { GENRES } from '/javascripts/taxonomy.js';

let selectedSubgenres = []; // [NEW] Track selection state

const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check if we have an ID from the signup flow
    const artistIdInput = document.getElementById('artistIdRef');
    const artistId = artistIdInput ? artistIdInput.value : null;

    if (artistId) {
        // BETA FLOW: Check if we need to force setup
        await checkSecurityStatus(artistId);
    } else {
        // NORMAL FLOW: Just load dashboard (assumes already logged in)
        loadDashboardData();
    }

    setupAudioDrop();
    setupArtDrop();
    // [NEW] Initialize the Genre/Subgenre logic
    setupTaxonomySelectors();
    createToastContainer(); // [NEW] Init Toasts
    
    // [FIX] Listener for form
    const form = document.getElementById('trackUploadForm');
    if (form) form.addEventListener('submit', handleTrackUpload);
    setupSecurityForm();
});

// ==========================================
// 1. TOAST SYSTEM
// ==========================================
function createToastContainer() {
    if (!document.querySelector('.toast-container')) {
        const container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
}

function showToast(message, type = 'success') {
    const container = document.querySelector('.toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    const iconClass = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    toast.innerHTML = `<i class="fas ${iconClass}"></i><span>${message}</span>`;
    container.appendChild(toast);

    // Remove after 3s
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

// ==========================================
// [NEW] TAXONOMY LOGIC
// ==========================================
// ==========================================
// 2. DYNAMIC PILL GENERATOR
// ==========================================
function setupTaxonomySelectors() {
    const primarySelect = document.getElementById('trackGenre');
    const subGrid = document.getElementById('subgenreGrid');

    if (!primarySelect || !subGrid) return;

    // A. Populate Primary Dropdown
    Object.values(GENRES).forEach(genre => {
        const option = document.createElement('option');
        option.value = genre.id;
        option.innerText = `${genre.icon} ${genre.name}`;
        primarySelect.appendChild(option);
    });

    // B. Handle Change -> Render Pills
    primarySelect.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        const genreData = Object.values(GENRES).find(g => g.id === selectedId);
        
        // Reset State
        selectedSubgenres = []; 
        subGrid.innerHTML = ''; 

        if (genreData && genreData.subgenres) {
            genreData.subgenres.forEach(sub => {
                // Create Pill
                const pill = document.createElement('div');
                pill.className = 'studio-pill';
                pill.innerText = sub.name;
                pill.dataset.id = sub.id;
                
                // Click Handler
                pill.onclick = () => togglePillSelection(pill, sub.id);
                
                subGrid.appendChild(pill);
            });
        } else {
            subGrid.innerHTML = '<div class="empty-pill-state">No subgenres available.</div>';
        }
    });
}

function togglePillSelection(el, id) {
    // If already selected, remove it
    if (selectedSubgenres.includes(id)) {
        selectedSubgenres = selectedSubgenres.filter(item => item !== id);
        el.classList.remove('active');
    } 
    // If not selected, add it (Check limit 2)
    else {
        if (selectedSubgenres.length >= 2) {
            // Optional: Shake animation or toast warning
            alert("You can only select up to 2 subgenres.");
            return;
        }
        selectedSubgenres.push(id);
        el.classList.add('active');
    }
}

// 1. AUDIO DROP ZONE + DURATION CALC + AUTO-TITLE
function setupAudioDrop() {
    const zone = document.getElementById('audioDropZone');
    const input = document.getElementById('audioInput');
    const titleInput = document.getElementById('trackTitle');
    const display = document.getElementById('fileNameDisplay');
    const durationInput = document.getElementById('hiddenDuration'); // [NEW]

    if (!zone || !input) return;

    const handleAudioFile = (file) => {
        // A. Visuals
        zone.style.borderColor = '#88C9A1';
        zone.style.backgroundColor = 'rgba(136, 201, 161, 0.1)';
        if(display) { display.innerText = file.name; display.style.display = 'block'; }

        // B. Auto-Fill Title
        if (titleInput && !titleInput.value) {
            const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
            titleInput.value = cleanName;
        }

        // C. [NEW] CALCULATE DURATION
        const audio = new Audio(URL.createObjectURL(file));
        audio.onloadedmetadata = () => {
            if(durationInput) durationInput.value = Math.round(audio.duration); // Seconds
            console.log(`Duration calculated: ${audio.duration}s`);
        };
    };

    // Events
    zone.onclick = () => input.click();
    input.onchange = () => { if(input.files[0]) handleAudioFile(input.files[0]); };

    zone.ondragover = (e) => { e.preventDefault(); zone.style.borderColor = '#88C9A1'; zone.style.background = '#222'; };
    zone.ondragleave = () => { if(!input.files[0]) { zone.style.borderColor = '#444'; zone.style.background = 'transparent'; } };
    
    zone.ondrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) {
            input.files = e.dataTransfer.files; // Assign to input
            handleAudioFile(input.files[0]);
        }
    };
}

// 2. ARTWORK DROP ZONE + PREVIEW
function setupArtDrop() {
    const zone = document.getElementById('artDropZone');
    const input = document.getElementById('artInput');
    const preview = document.getElementById('artPreview');
    const placeholder = zone.querySelector('.dz-placeholder');

    if (!zone || !input) return;

    const handleImageFile = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.src = e.target.result;
            preview.style.display = 'block';
            if(placeholder) placeholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
    };

    zone.onclick = () => input.click();
    input.onchange = () => { if(input.files[0]) handleImageFile(input.files[0]); };

    zone.ondragover = (e) => { e.preventDefault(); zone.style.borderColor = '#88C9A1'; };
    zone.ondragleave = () => { zone.style.borderColor = '#444'; };
    
    zone.ondrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) {
            input.files = e.dataTransfer.files;
            handleImageFile(input.files[0]);
        }
    };
}

// 3. UPLOAD HANDLER (Modified for Multiple Files)
async function handleTrackUpload(e) {
    e.preventDefault();
    const btn = document.querySelector('.btn-upload');
    const originalText = btn.innerText;
    btn.innerText = "Uploading...";
    btn.disabled = true;

    const formData = new FormData();
    
    // Files
    const audioInput = document.getElementById('audioInput');
    const artInput = document.getElementById('artInput');

    if(!audioInput.files[0] || !artInput.files[0]) {
        alert("Please provide both an Audio file and Cover Art.");
        btn.innerText = originalText;
        btn.disabled = false;
        return;
    }

    formData.append('audioFile', audioInput.files[0]);
    formData.append('artFile', artInput.files[0]);

    // Metadata
    formData.append('title', document.getElementById('trackTitle').value);
    formData.append('genre', document.getElementById('trackGenre').value);
    
    // [NEW] Send pills as comma-separated string or array
    // Backend expects 'subgenre' (singular field usually), so let's join them for now
    // or send the primary one. If backend supports arrays, send JSON.
    // For now: "Synthwave, Retrowave"
    formData.append('subgenre', selectedSubgenres.join(', ')); 

    formData.append('artistId', document.getElementById('hiddenArtistId').value);
    formData.append('artistName', document.getElementById('studioName').innerText);
    formData.append('duration', document.getElementById('hiddenDuration').value);

    // Determine Type (Single vs Album) from the new Toggle
    const type = document.getElementById('typeAlbum').checked ? 'album' : 'track';
    formData.append('type', type);

    try {
        const res = await fetch('/artist/api/upload-track', {
            method: 'POST',
            body: formData
        });

        const result = await res.json();
        if (result.success) {
            closeModal('uploadModal');
            loadDashboardData(); 
            // Reset form
            document.getElementById('trackUploadForm').reset();
            document.getElementById('subgenreGrid').innerHTML = '<div class="empty-pill-state">Select a primary genre to see tags.</div>';
            selectedSubgenres = [];
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        console.error(err);
        showToast("Upload Failed: " + err.message, "error");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// --- SECURITY LOGIC ---
async function checkSecurityStatus(id) {
    try {
        const res = await fetch(`/artist/api/studio/check-status/${id}`);
        const data = await res.json();
        
        if (data.needsSetup) {
            // SHOW BLOCKING MODAL
            document.getElementById('setupArtistName').innerText = data.artistName;
            document.getElementById('securityModal').classList.add('active');
            document.getElementById('securityModal').style.display = 'flex';
        } else {
            // Already setup? Try to load data
            loadDashboardData();
        }
    } catch (e) {
        console.error("Status Check Failed", e);
    }
}

function setupSecurityForm() {
    const form = document.getElementById('securityForm');
    if(!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.querySelector('#securityForm button');
        const originalText = document.getElementById('setupBtnText').innerText;
        btn.disabled = true;
        document.getElementById('setupBtnText').innerText = "Securing Account...";

        const artistId = document.getElementById('artistIdRef').value;
        const email = document.getElementById('setupEmail').value;
        const pass = document.getElementById('setupPass').value;

        try {
            const res = await fetch('/artist/api/studio/setup-credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artistId, email, password: pass })
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error);

            // AUTO LOGIN
            await signInWithCustomToken(auth, result.token);
            
            // REMOVE MODAL
            document.getElementById('securityModal').classList.remove('active');
            document.getElementById('securityModal').style.display = 'none';
            
            // LOAD DASHBOARD
            loadDashboardData();

        } catch (err) {
            alert("Setup Failed: " + err.message);
            btn.disabled = false;
            document.getElementById('setupBtnText').innerText = originalText;
        }
    });
}

// 1. FETCH & RENDER DATA
async function loadDashboardData() {
    try {
        const user = auth.currentUser;
        if(!user) {
            // Try waiting a second in case auth is initializing
            setTimeout(loadDashboardData, 1000);
            return;
        }

        const token = await user.getIdToken();
        const res = await fetch('/artist/api/studio/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        
        if (data.error) return console.error(data.error);

        // Render Profile
        document.getElementById('studioName').innerText = data.profile.name;
        document.getElementById('studioHandle').innerText = data.profile.handle;
        if(data.profile.image) document.getElementById('studioAvatar').src = data.profile.image;

        // Render Stats
        document.getElementById('statListeners').innerText = data.stats.listeners.toLocaleString();
        document.getElementById('statFollowers').innerText = data.stats.followers.toLocaleString();
        document.getElementById('statTips').innerText = `$${data.stats.tipsTotal.toFixed(2)}`;

        // Render Feed
        const feed = document.getElementById('activityFeed');
        feed.innerHTML = '';
        data.recentActivity.forEach(act => {
            const el = document.createElement('div');
            el.className = `activity-item ${act.type}`;
            el.innerHTML = `
                <div class="activity-header">
                    <span class="user-name">${act.user}</span>
                    <span class="timestamp">${act.time}</span>
                </div>
                ${act.message ? `<div class="activity-msg">${act.message}</div>` : ''}
                ${act.amount ? `<span class="tip-amount">+$${act.amount.toFixed(2)}</span>` : ''}
            `;
            feed.appendChild(el);
        });

    } catch (e) {
        console.error("Dashboard Load Error", e);
    }
}

// 2. VIEW NAVIGATION
window.switchView = (viewId) => {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');
    if(event) event.currentTarget.classList.add('active');
};

// 3. MODALS
window.openUploadModal = (type = 'track') => {
    document.getElementById('uploadModal').classList.add('active');
};

window.closeModal = (id) => {
    document.getElementById(id).classList.remove('active');
};

window.toggleUploadForm = () => {
    console.log("Switching form type...");
};