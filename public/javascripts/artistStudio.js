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

// Replace your existing DOMContentLoaded listener with this:
document.addEventListener('DOMContentLoaded', () => {
    const auth = getAuth(app);

    // This is the most reliable way to handle Firebase Auth in the browser
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log("👤 Artist Authenticated:", user.email);
            
            // Now that we have a user, get the ID and load data
            const artistIdInput = document.getElementById('artistIdRef');
            const artistId = artistIdInput ? artistIdInput.value : null;

            if (artistId) {
                await checkSecurityStatus(artistId);
            } else {
                await loadDashboardData();
            }
        } else {
            console.warn("No user found, redirecting to login...");
            window.location.href = '/artist/login';
        }
    });

    // Setup UI components
    setupAudioDrop();
    setupArtDrop();
    setupAlbumUpload();
    setupTaxonomySelectors();
    createToastContainer();
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
// 2. CLIENT-SIDE AUDIO ANALYSIS (The New Engine)
// ==========================================

async function analyzeAudioInBrowser(file) {
    console.log("⚡ Starting Browser Analysis...");

    // Helper: Wait for library globals to load
    const waitForLib = async () => {
        for (let i = 0; i < 20; i++) { // Try for 2 seconds
            if (window.EssentiaWASM && window.Essentia) return true;
            await new Promise(r => setTimeout(r, 100));
        }
        return false;
    };

    try {
        const ready = await waitForLib();
        if (!ready) {
            console.warn("⚠ Audio libraries not loaded. Skipping analysis.");
            return null; 
        }

        // Initialize Audio Context
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // [FIX] Call the global factory function directly
        // Previous error was caused by calling window.EssentiaWASM.EssentiaWASM
        const wasmModule = await window.EssentiaWASM({
            // Explicitly point to the WASM file on the CDN
            locateFile: (path) => {
                if (path.endsWith('.wasm')) {
                    return "https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia-wasm.web.wasm";
                }
                return path;
            }
        });

        // Initialize Essentia with the WASM module
        const essentia = new window.Essentia(wasmModule);
        
        // Decode Audio
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Prepare Data (Mono)
        const channelData = audioBuffer.getChannelData(0);
        const audioVector = essentia.arrayToVector(channelData);
        
        console.log("  ↳ Audio decoded. Running algorithms...");

        // Run Algorithms
        const bpmAlgo = essentia.RhythmExtractor2013(audioVector);
        const keyAlgo = essentia.KeyExtractor(audioVector);
        const energyAlgo = essentia.DynamicComplexity(audioVector);
        
        // Calculate Stats
        const energy = (energyAlgo.loudness + 60) / 60;
        const danceability = calculateDanceability(bpmAlgo.bpm, energy);

        const results = {
            bpm: Math.round(bpmAlgo.bpm),
            key: keyAlgo.key,
            mode: keyAlgo.scale,
            energy: parseFloat(energy.toFixed(2)),
            danceability: parseFloat(danceability.toFixed(2)),
            duration: audioBuffer.duration
        };

        console.log("✅ Analysis Complete:", results);
        return results;

    } catch (error) {
        console.error("Analysis Failed:", error);
        return null; // Return null to allow upload to proceed without stats
    }
}

function calculateDanceability(bpm, energy) {
    if (!bpm) return 0;
    const idealBpm = 125;
    const distance = Math.abs(bpm - idealBpm);
    const bpmScore = Math.max(0, 1 - (distance / 40)); // 0-1 score
    // Danceability is a mix of good tempo + high energy
    return (bpmScore * 0.6) + (Math.max(0, Math.min(1, energy)) * 0.4);
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
window.handleTrackUpload = async (e) => {
    e.preventDefault();
    
    const btn = e.target.querySelector('.btn-upload');
    const originalText = btn.innerHTML;
    
    // UI Feedback
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Analyzing Audio...`;
    btn.disabled = true;
    btn.style.opacity = "0.7";

    try {
        // [FIX] Use the IDs from your specific Pug structure
        const fileInput = document.getElementById('audioInput'); 
        const file = fileInput.files[0];

        if (!file) throw new Error("No audio file selected");

        // STEP 1: Run Analysis in Browser
        const analysis = await analyzeAudioInBrowser(file);
        
        if (analysis) {
            console.log("✅ Analysis Results:", analysis);
            btn.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Uploading...`;
        } else {
            console.warn("⚠ Analysis skipped/failed, proceeding with upload...");
        }

        // STEP 2: Prepare Data
        const formData = new FormData(e.target);
        
        // Append analysis data to form
        if (analysis) {
            formData.append('bpm', analysis.bpm);
            formData.append('key', analysis.key);
            formData.append('mode', analysis.mode);
            formData.append('energy', analysis.energy);
            formData.append('danceability', analysis.danceability);
            formData.append('duration', analysis.duration);
        }

        // STEP 3: Send to Server
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/artist/api/upload-track', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        // Handle Response
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Server upload failed");
        }

        // Handle Stream Response (Progress Updates)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');
            
            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    if (data.status === 'success') {
                        showToast("Upload Successful!", "success");
                        setTimeout(() => window.location.reload(), 1500);
                        return;
                    }
                    if (data.status === 'failed') throw new Error(data.error);
                } catch (e) { /* Ignore parse errors for partial chunks */ }
            }
        }

    } catch (error) {
        console.error("Upload Error:", error);
        showToast(error.message, "error");
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.style.opacity = "1";
    }
};

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
        
        // If Auth isn't ready yet, retry in 500ms
        if (!user) {
            setTimeout(loadDashboardData, 500);
            return;
        }

        const token = await user.getIdToken();
        
        // Fetch data from the updated backend route
        const res = await fetch('/artist/api/studio/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        
        const data = await res.json();

        // [CRITICAL FIX] Redirect to pending page if not fully approved
        if (data.isPending) {
            window.location.href = `/artist/pending-status?id=${data.artistId}&status=${data.status}`;
            return;
        }
        
        if (data.error) {
            console.error("API Error:", data.error);
            showToast(data.error, 'error');
            return;
        }

        console.log("✅ Studio Data Loaded:", data);

        // Inject Artist ID into ALL hidden form inputs for uploads
        if (data.artistId) {
            window.currentArtistId = data.artistId; // Store globally just in case

            const refInput = document.getElementById('artistIdRef');
            if (refInput) refInput.value = data.artistId;

            const trackInput = document.getElementById('hiddenArtistId');
            if (trackInput) trackInput.value = data.artistId;

            const albumInput = document.getElementById('hiddenArtistIdAlbum');
            if (albumInput) albumInput.value = data.artistId;
        }

        // --- UPDATE UI ELEMENTS ---

        // 1. Profile Header
        const nameEl = document.getElementById('studioName');
        const handleEl = document.getElementById('studioHandle');
        const avatarEl = document.getElementById('studioAvatar');

        if (nameEl) nameEl.innerText = data.profile.name || "Artist";
        if (handleEl) handleEl.innerText = data.profile.handle || "@";
        if (avatarEl && data.profile.image) avatarEl.src = data.profile.image;

        // 2. Stats Cards
        const listenEl = document.getElementById('statListeners');
        const followEl = document.getElementById('statFollowers');
        const tipEl = document.getElementById('statTips');

        if (listenEl) listenEl.innerText = (data.stats.listeners || 0).toLocaleString();
        if (followEl) followEl.innerText = (data.stats.followers || 0).toLocaleString();
        if (tipEl) tipEl.innerText = `$${(data.stats.tipsTotal || 0).toFixed(2)}`;

        // 3. Activity Feed
        const feed = document.getElementById('activityFeed');
        if (feed) {
            feed.innerHTML = ''; // Clear skeleton loader
            
            if (data.recentActivity && data.recentActivity.length > 0) {
                data.recentActivity.forEach(act => {
                    const item = document.createElement('div');
                    item.className = 'activity-item';
                    item.innerHTML = `
                        <div class="act-icon"><i class="fas fa-bolt"></i></div>
                        <div class="act-details">
                            <span class="act-text">${act.message}</span>
                            <span class="act-time">${new Date(act.timestamp._seconds * 1000).toLocaleDateString()}</span>
                        </div>
                    `;
                    feed.appendChild(item);
                });
            } else {
                feed.innerHTML = `
                    <div style="text-align:center; padding: 20px; opacity: 0.6;">
                        <i class="fas fa-stream" style="margin-bottom:8px;"></i>
                        <p style="font-size:0.9rem;">No recent activity</p>
                    </div>`;
            }
        }

        // 4. Load Comments in Community Pulse
        loadComments();

    } catch (e) {
        console.error("Dashboard Load Error", e);
        showToast("Failed to connect to studio. Please refresh.", "error");
    }
}

// ==========================================
// COMMUNITY PULSE - COMMENTS DISPLAY
// ==========================================
async function loadComments() {
    try {
        const user = auth.currentUser;
        if (!user) return;

        const token = await user.getIdToken();
        
        const res = await fetch('/artist/api/studio/comments?limit=20', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            console.warn("Failed to load comments:", res.status);
            return;
        }

        const data = await res.json();
        displayComments(data.comments || []);

    } catch (e) {
        console.error("Comment Load Error:", e);
    }
}

function displayComments(comments) {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    feed.innerHTML = ''; // Clear existing

    if (comments.length === 0) {
        feed.innerHTML = `
            <div style="text-align:center; padding: 40px 20px; opacity: 0.6;">
                <i class="fas fa-comment" style="font-size: 2rem; margin-bottom: 12px; display: block; color: #666;"></i>
                <p style="font-size: 0.95rem; color: #999;">No comments yet</p>
                <p style="font-size: 0.85rem; color: #666; margin-top: 8px;">Comments from fans will appear here</p>
            </div>`;
        return;
    }

    comments.forEach(comment => {
        const item = document.createElement('div');
        item.className = `activity-item ${comment.read ? '' : 'unread'}`;
        item.dataset.commentId = comment.id;
        
        const timeAgo = formatTimeAgo(new Date(comment.timestamp));
        
        item.innerHTML = `
            <div class="act-icon" style="background: rgba(136, 201, 161, 0.2);">
                <i class="fas fa-comment" style="color: #88C9A1;"></i>
            </div>
            <div class="act-details">
                <div class="act-header">
                    ${comment.userAvatar ? `<img src="${comment.userAvatar}" class="act-avatar" alt="${comment.userName}">` : ''}
                    <span class="act-text"><strong>${comment.userName}</strong> commented</span>
                </div>
                <p class="act-preview">"${escapeHtml(comment.comment)}"</p>
                <div class="act-footer">
                    <span class="act-time">${timeAgo}</span>
                    <div class="act-actions">
                        ${!comment.read ? '<button class="act-btn" onclick="markCommentRead(\'' + comment.id + '\')"><i class="fas fa-check"></i> Mark Read</button>' : ''}
                        <button class="act-btn flag" onclick="flagComment(\'' + comment.id + '\')"><i class="fas fa-flag"></i> Flag</button>
                        <button class="act-btn delete" onclick="hideComment(\'' + comment.id + '\')"><i class="fas fa-trash"></i> Hide</button>
                    </div>
                </div>
            </div>
        `;
        
        feed.appendChild(item);
    });
}

// Mark comment as read
window.markCommentRead = async (commentId) => {
    try {
        const user = auth.currentUser;
        if (!user) return;

        const token = await user.getIdToken();
        
        const res = await fetch('/artist/api/studio/comments/mark-read', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ commentId })
        });

        if (res.ok) {
            // Fade out and remove the comment
            const item = document.querySelector(`[data-comment-id="${commentId}"]`);
            if (item) {
                item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                item.style.opacity = '0';
                item.style.transform = 'translateX(-20px)';
                
                setTimeout(() => {
                    item.remove();
                    
                    // Check if feed is now empty
                    const feed = document.getElementById('activityFeed');
                    if (feed && feed.children.length === 0) {
                        feed.innerHTML = `
                            <div style="text-align:center; padding: 40px 20px; opacity: 0.6;">
                                <i class="fas fa-comment" style="font-size: 2rem; margin-bottom: 12px; display: block; color: #666;"></i>
                                <p style="font-size: 0.95rem; color: #999;">All caught up!</p>
                                <p style="font-size: 0.85rem; color: #666; margin-top: 8px;">No unread comments</p>
                            </div>`;
                    }
                }, 300);
            }
            showToast('Comment archived', 'success');
        }

    } catch (e) {
        console.error('Mark Read Error:', e);
        showToast('Failed to mark as read', 'error');
    }
};

// Flag comment as offensive
window.flagComment = async (commentId) => {
    const reason = prompt('Why are you flagging this comment?\n(offensive, spam, harassment, etc.)');
    if (!reason) return;

    try {
        const user = auth.currentUser;
        if (!user) return;

        const token = await user.getIdToken();
        
        const res = await fetch('/artist/api/studio/comments/flag', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ commentId, reason })
        });

        if (res.ok) {
            showToast('Comment flagged for review', 'success');
        }

    } catch (e) {
        console.error('Flag Error:', e);
        showToast('Failed to flag comment', 'error');
    }
};

// Hide comment from wall
window.hideComment = async (commentId) => {
    if (!confirm('Hide this comment? It will no longer be visible on your wall.')) return;

    try {
        const user = auth.currentUser;
        if (!user) return;

        const token = await user.getIdToken();
        
        const res = await fetch(`/artist/api/studio/comments/${commentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            // Remove from UI
            const item = document.querySelector(`[data-comment-id="${commentId}"]`);
            if (item) item.remove();
            
            // Check if feed is now empty
            const feed = document.getElementById('activityFeed');
            if (feed && feed.children.length === 0) {
                feed.innerHTML = `
                    <div style="text-align:center; padding: 40px 20px; opacity: 0.6;">
                        <i class="fas fa-comment" style="font-size: 2rem; margin-bottom: 12px; display: block; color: #666;"></i>
                        <p style="font-size: 0.95rem; color: #999;">No comments</p>
                    </div>`;
            }
            
            showToast('Comment hidden', 'success');
        }

    } catch (e) {
        console.error('Hide Error:', e);
        showToast('Failed to hide comment', 'error');
    }
};

function formatTimeAgo(date) {
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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