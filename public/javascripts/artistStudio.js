/* artistStudio_enhanced.js */
import { 
    getAuth, 
    signInWithCustomToken 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';
import { GENRES } from '/javascripts/taxonomy.js';

let selectedSubgenres = [];
let albumTracks = []; // For album upload

const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', async () => {
    const artistIdInput = document.getElementById('artistIdRef');
    const artistId = artistIdInput ? artistIdInput.value : null;

    if (artistId) {
        await checkSecurityStatus(artistId);
    } else {
        loadDashboardData();
    }

    setupAudioDrop();
    setupArtDrop();
    setupAlbumUpload(); // NEW
    setupTaxonomySelectors();
    createToastContainer();
    
    const form = document.getElementById('trackUploadForm');
    if (form) form.addEventListener('submit', handleTrackUpload);
    
    const albumForm = document.getElementById('albumUploadForm');
    if (albumForm) albumForm.addEventListener('submit', handleAlbumUpload);
    
    setupSecurityForm();
});

// ==========================================
// TOAST SYSTEM
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
    
    const iconClass = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${iconClass}"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

// ==========================================
// UPLOAD PROGRESS MODAL
// ==========================================
function showUploadProgress() {
    const modal = document.createElement('div');
    modal.id = 'uploadProgressModal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content progress-modal">
            <div class="progress-header">
                <h2>Processing Upload</h2>
            </div>
            <div class="progress-steps">
                <div class="progress-step" id="step-copyright">
                    <div class="step-icon">
                        <i class="fas fa-spinner fa-spin"></i>
                    </div>
                    <div class="step-info">
                        <h4>Copyright Detection</h4>
                        <p class="step-status">Analyzing file...</p>
                    </div>
                </div>
                <div class="progress-step" id="step-analysis">
                    <div class="step-icon">
                        <i class="fas fa-circle"></i>
                    </div>
                    <div class="step-info">
                        <h4>Audio Analysis</h4>
                        <p class="step-status">Waiting...</p>
                    </div>
                </div>
                <div class="progress-step" id="step-upload">
                    <div class="step-icon">
                        <i class="fas fa-circle"></i>
                    </div>
                    <div class="step-info">
                        <h4>File Upload</h4>
                        <p class="step-status">Waiting...</p>
                    </div>
                </div>
                <div class="progress-step" id="step-database">
                    <div class="step-icon">
                        <i class="fas fa-circle"></i>
                    </div>
                    <div class="step-info">
                        <h4>Database Storage</h4>
                        <p class="step-status">Waiting...</p>
                    </div>
                </div>
            </div>
            <div class="completion-message" style="display: none;">
                <div class="success-checkmark">
                    <i class="fas fa-check-circle"></i>
                </div>
                <h3>Upload Complete!</h3>
                <p>Your track has been successfully uploaded.</p>
                <button class="btn-primary" onclick="closeUploadProgress()">Done</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function updateProgressStep(step, status, message, data = null) {
    const stepEl = document.getElementById(`step-${step}`);
    if (!stepEl) return;

    const icon = stepEl.querySelector('.step-icon i');
    const statusText = stepEl.querySelector('.step-status');

    // Update status text
    if (message) statusText.textContent = message;

    // Update icon based on status
    if (status === 'analyzing' || status === 'uploading' || status === 'saving') {
        icon.className = 'fas fa-spinner fa-spin';
        stepEl.classList.add('active');
    } else if (status === 'complete') {
        icon.className = 'fas fa-check-circle';
        stepEl.classList.add('complete');
        stepEl.classList.remove('active');
        
        // Add data if available
        if (data) {
            if (data.bpm) statusText.textContent += ` (${data.bpm} BPM, ${data.key})`;
        }
    } else if (status === 'warning') {
        icon.className = 'fas fa-exclamation-triangle';
        stepEl.classList.add('warning');
        stepEl.classList.remove('active');
    } else if (status === 'error') {
        icon.className = 'fas fa-times-circle';
        stepEl.classList.add('error');
        stepEl.classList.remove('active');
    }
}

function showCompletionMessage() {
    const steps = document.querySelector('.progress-steps');
    const completion = document.querySelector('.completion-message');
    
    if (steps) steps.style.display = 'none';
    if (completion) completion.style.display = 'block';
}

window.closeUploadProgress = function() {
    const modal = document.getElementById('uploadProgressModal');
    if (modal) {
        modal.remove();
        closeModal('uploadModal');
        loadDashboardData();
        
        // Reset form
        const form = document.getElementById('trackUploadForm');
        if (form) form.reset();
        document.getElementById('subgenreGrid').innerHTML = '<div class="empty-pill-state">Select a primary genre to see tags.</div>';
        selectedSubgenres = [];
    }
};

// ==========================================
// TAXONOMY LOGIC
// ==========================================
function setupTaxonomySelectors() {
    const primarySelect = document.getElementById('trackGenre');
    const subGrid = document.getElementById('subgenreGrid');

    if (!primarySelect || !subGrid) return;

    Object.values(GENRES).forEach(genre => {
        const option = document.createElement('option');
        option.value = genre.id;
        option.innerText = `${genre.icon} ${genre.name}`;
        primarySelect.appendChild(option);
    });

    primarySelect.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        const genreData = Object.values(GENRES).find(g => g.id === selectedId);
        
        selectedSubgenres = [];
        subGrid.innerHTML = '';

        if (genreData && genreData.subgenres) {
            genreData.subgenres.forEach(sub => {
                const pill = document.createElement('div');
                pill.className = 'studio-pill';
                pill.innerText = sub.name;
                pill.dataset.id = sub.id;
                pill.onclick = () => togglePillSelection(pill, sub.id);
                subGrid.appendChild(pill);
            });
        } else {
            subGrid.innerHTML = '<div class="empty-pill-state">No subgenres available.</div>';
        }
    });
}

function togglePillSelection(el, id) {
    if (selectedSubgenres.includes(id)) {
        selectedSubgenres = selectedSubgenres.filter(item => item !== id);
        el.classList.remove('active');
    } else {
        if (selectedSubgenres.length >= 2) {
            showToast("You can only select up to 2 subgenres.", "error");
            return;
        }
        selectedSubgenres.push(id);
        el.classList.add('active');
    }
}

// ==========================================
// AUDIO DROP ZONE
// ==========================================
function setupAudioDrop() {
    const zone = document.getElementById('audioDropZone');
    const input = document.getElementById('audioInput');
    const titleInput = document.getElementById('trackTitle');
    const display = document.getElementById('fileNameDisplay');
    const durationInput = document.getElementById('hiddenDuration');

    if (!zone || !input) return;

    const handleAudioFile = (file) => {
        zone.style.borderColor = '#88C9A1';
        zone.style.backgroundColor = 'rgba(136, 201, 161, 0.1)';
        if(display) { 
            display.innerText = file.name; 
            display.style.display = 'block'; 
        }

        if (titleInput && !titleInput.value) {
            const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
            titleInput.value = cleanName;
        }

        const audio = new Audio(URL.createObjectURL(file));
        audio.onloadedmetadata = () => {
            if(durationInput) durationInput.value = Math.round(audio.duration);
            console.log(`Duration calculated: ${audio.duration}s`);
        };
    };

    zone.onclick = () => input.click();
    input.onchange = () => { if(input.files[0]) handleAudioFile(input.files[0]); };
    zone.ondragover = (e) => { e.preventDefault(); zone.style.borderColor = '#88C9A1'; zone.style.background = '#222'; };
    zone.ondragleave = () => { if(!input.files[0]) { zone.style.borderColor = '#444'; zone.style.background = 'transparent'; } };
    zone.ondrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) {
            input.files = e.dataTransfer.files;
            handleAudioFile(input.files[0]);
        }
    };
}

// ==========================================
// ARTWORK DROP ZONE
// ==========================================
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

// ==========================================
// ENHANCED TRACK UPLOAD WITH STREAMING
// ==========================================
async function handleTrackUpload(e) {
    e.preventDefault();
    
    const audioInput = document.getElementById('audioInput');
    const artInput = document.getElementById('artInput');

    if(!audioInput.files[0] || !artInput.files[0]) {
        showToast("Please provide both an Audio file and Cover Art.", "error");
        return;
    }

    // Show progress modal
    showUploadProgress();

    const formData = new FormData();
    formData.append('audioFile', audioInput.files[0]);
    formData.append('artFile', artInput.files[0]);
    formData.append('title', document.getElementById('trackTitle').value);
    formData.append('genre', document.getElementById('trackGenre').value);
    formData.append('subgenre', selectedSubgenres.join(', '));
    formData.append('artistId', document.getElementById('hiddenArtistId').value);
    formData.append('artistName', document.getElementById('studioName').innerText);
    formData.append('duration', document.getElementById('hiddenDuration').value);

    const type = document.getElementById('typeAlbum')?.checked ? 'album' : 'track';
    formData.append('type', type);

    try {
        const response = await fetch('/artist/api/upload-track', {
            method: 'POST',
            body: formData
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(l => l.trim());

            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    
                    // Map backend steps to frontend steps
                    const stepMap = {
                        'copyright': 'copyright',
                        'analysis': 'analysis',
                        'upload_audio': 'upload',
                        'upload_art': 'upload',
                        'database': 'database'
                    };

                    const frontendStep = stepMap[data.step];
                    
                    if (frontendStep) {
                        updateProgressStep(frontendStep, data.status, data.message, data.data);
                    }

                    if (data.step === 'complete') {
                        showCompletionMessage();
                    }
                } catch (err) {
                    console.error('Error parsing progress:', err);
                }
            }
        }

    } catch (err) {
        console.error(err);
        showToast("Upload Failed: " + err.message, "error");
        closeUploadProgress();
    }
}

// ==========================================
// ALBUM UPLOAD SETUP
// ==========================================
function setupAlbumUpload() {
    const multiInput = document.getElementById('albumAudioInput');
    const trackList = document.getElementById('albumTrackList');
    const albumArtZone = document.getElementById('albumArtPreviewZone');
    const albumArtInput = document.getElementById('albumArtInput');
    const albumArtPreview = document.getElementById('albumArtPreviewImg');

    if (!multiInput || !trackList) return;

    // Handle audio file selection
    multiInput.addEventListener('change', () => {
        albumTracks = Array.from(multiInput.files);
        renderAlbumTrackList();
    });

    // Handle album artwork
    if (albumArtZone && albumArtInput && albumArtPreview) {
        albumArtZone.addEventListener('click', () => {
            albumArtInput.click();
        });

        albumArtInput.addEventListener('change', () => {
            if (albumArtInput.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    albumArtPreview.src = e.target.result;
                    albumArtPreview.style.display = 'block';
                    const placeholder = albumArtZone.querySelector('.album-art-placeholder');
                    if (placeholder) placeholder.style.display = 'none';
                };
                reader.readAsDataURL(albumArtInput.files[0]);
            }
        });
    }

    // Setup genre selector for album
    const albumGenreSelect = document.getElementById('albumGenre');
    const albumSubGrid = document.getElementById('albumSubgenreGrid');

    if (albumGenreSelect && albumSubGrid) {
        Object.values(GENRES).forEach(genre => {
            const option = document.createElement('option');
            option.value = genre.id;
            option.innerText = `${genre.icon} ${genre.name}`;
            albumGenreSelect.appendChild(option);
        });

        albumGenreSelect.addEventListener('change', (e) => {
            const selectedId = e.target.value;
            const genreData = Object.values(GENRES).find(g => g.id === selectedId);
            
            selectedSubgenres = [];
            albumSubGrid.innerHTML = '';

            if (genreData && genreData.subgenres) {
                genreData.subgenres.forEach(sub => {
                    const pill = document.createElement('div');
                    pill.className = 'studio-pill';
                    pill.innerText = sub.name;
                    pill.dataset.id = sub.id;
                    pill.onclick = () => togglePillSelection(pill, sub.id);
                    albumSubGrid.appendChild(pill);
                });
            } else {
                albumSubGrid.innerHTML = '<div class="empty-pill-state">No subgenres available.</div>';
            }
        });
    }
}

function renderAlbumTrackList() {
    const trackList = document.getElementById('albumTrackList');
    trackList.innerHTML = '';

    albumTracks.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'album-track-item';
        
        const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
        
        item.innerHTML = `
            <div class="track-number">${index + 1}</div>
            <input type="text" 
                   class="track-title-input" 
                   value="${cleanName}" 
                   placeholder="Track Title"
                   data-index="${index}">
            <div class="track-duration" data-index="${index}">--:--</div>
            <button type="button" class="btn-remove" onclick="removeAlbumTrack(${index})">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        trackList.appendChild(item);

        // Calculate duration
        const audio = new Audio(URL.createObjectURL(file));
        audio.onloadedmetadata = () => {
            const mins = Math.floor(audio.duration / 60);
            const secs = Math.floor(audio.duration % 60);
            const durationEl = item.querySelector('.track-duration');
            durationEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            durationEl.dataset.duration = Math.round(audio.duration);
        };
    });
}

window.removeAlbumTrack = function(index) {
    albumTracks.splice(index, 1);
    renderAlbumTrackList();
};

// ==========================================
// ALBUM UPLOAD HANDLER
// ==========================================
async function handleAlbumUpload(e) {
    e.preventDefault();

    if (albumTracks.length === 0) {
        showToast("Please add at least one track to the album.", "error");
        return;
    }

    const albumArtInput = document.getElementById('albumArtInput');
    if (!albumArtInput.files[0]) {
        showToast("Please provide album artwork.", "error");
        return;
    }

    // Show progress modal
    showUploadProgress();

    const formData = new FormData();
    
    // Add all audio files
    albumTracks.forEach(file => {
        formData.append('audioFiles', file);
    });
    
    formData.append('albumArt', albumArtInput.files[0]);
    formData.append('albumName', document.getElementById('albumName').value);
    formData.append('artistId', document.getElementById('hiddenArtistId').value);
    formData.append('artistName', document.getElementById('studioName').innerText);
    formData.append('genre', document.getElementById('albumGenre').value);
    formData.append('subgenres', JSON.stringify(selectedSubgenres));
    formData.append('releaseDate', document.getElementById('albumReleaseDate').value);

    // Collect track titles and durations
    const trackTitles = [];
    const trackDurations = [];
    
    document.querySelectorAll('.track-title-input').forEach(input => {
        trackTitles.push(input.value);
    });
    
    document.querySelectorAll('.track-duration').forEach(el => {
        trackDurations.push(parseInt(el.dataset.duration) || 0);
    });

    formData.append('trackTitles', JSON.stringify(trackTitles));
    formData.append('trackDurations', JSON.stringify(trackDurations));

    try {
        const response = await fetch('/artist/api/upload-album', {
            method: 'POST',
            body: formData
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(l => l.trim());

            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    
                    if (data.step === 'album_art') {
                        updateProgressStep('upload', data.status, data.message);
                    } else if (data.step === 'track_processing') {
                        updateProgressStep('analysis', 'analyzing', data.message);
                        updateProgressStep('copyright', 'complete', 'All tracks checked');
                    } else if (data.step === 'complete') {
                        updateProgressStep('database', 'complete', 'Album saved');
                        showCompletionMessage();
                    }
                } catch (err) {
                    console.error('Error parsing progress:', err);
                }
            }
        }

    } catch (err) {
        console.error(err);
        showToast("Album upload failed: " + err.message, "error");
        closeUploadProgress();
    }
}

// ==========================================
// SECURITY & DASHBOARD (unchanged)
// ==========================================
async function checkSecurityStatus(id) {
    try {
        const res = await fetch(`/artist/api/studio/check-status/${id}`);
        const data = await res.json();
        
        if (data.needsSetup) {
            document.getElementById('setupArtistName').innerText = data.artistName;
            document.getElementById('securityModal').classList.add('active');
            document.getElementById('securityModal').style.display = 'flex';
        } else {
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

            await signInWithCustomToken(auth, result.token);
            
            document.getElementById('securityModal').classList.remove('active');
            document.getElementById('securityModal').style.display = 'none';
            
            loadDashboardData();
        } catch (err) {
            showToast("Setup Failed: " + err.message, "error");
            btn.disabled = false;
            document.getElementById('setupBtnText').innerText = originalText;
        }
    });
}

async function loadDashboardData() {
    try {
        const user = auth.currentUser;
        if(!user) {
            setTimeout(loadDashboardData, 1000);
            return;
        }

        const token = await user.getIdToken();
        const res = await fetch('/artist/api/studio/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        if (data.error) return console.error(data.error);

        document.getElementById('studioName').innerText = data.profile.name;
        document.getElementById('studioHandle').innerText = data.profile.handle;
        if(data.profile.image) document.getElementById('studioAvatar').src = data.profile.image;

        document.getElementById('statListeners').innerText = data.stats.listeners.toLocaleString();
        document.getElementById('statFollowers').innerText = data.stats.followers.toLocaleString();
        document.getElementById('statTips').innerText = `$${data.stats.tipsTotal.toFixed(2)}`;

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

window.switchView = (viewId) => {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');
    if(event) event.currentTarget.classList.add('active');
};

window.openUploadModal = (type = 'track') => {
    const modal = document.getElementById('uploadModal');
    const trackForm = document.getElementById('trackUploadSection');
    const albumForm = document.getElementById('albumUploadSection');
    
    if (type === 'album') {
        trackForm.style.display = 'none';
        albumForm.style.display = 'block';
    } else {
        trackForm.style.display = 'block';
        albumForm.style.display = 'none';
    }
    
    modal.classList.add('active');
};

window.closeModal = (id) => {
    document.getElementById(id).classList.remove('active');
};

window.toggleUploadForm = () => {
    const trackSection = document.getElementById('trackUploadSection');
    const albumSection = document.getElementById('albumUploadSection');
    const isSingle = document.getElementById('typeSingle').checked;
    
    if (isSingle) {
        trackSection.style.display = 'block';
        albumSection.style.display = 'none';
    } else {
        trackSection.style.display = 'none';
        albumSection.style.display = 'block';
    }
};