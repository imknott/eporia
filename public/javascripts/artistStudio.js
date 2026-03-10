/* artistStudio_enhanced.js */
import { 
    getAuth, 
    signInWithCustomToken,
    updatePassword, // <- ADD THIS
    signOut         // <- ADD THIS
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

    // Bind form submit handlers — without these the browser does a native GET
    const pwdForm   = document.getElementById('passwordUpdateForm');
    const trackForm = document.getElementById('trackUploadForm');
    const albumForm = document.getElementById('albumUploadForm');

    if (pwdForm)   pwdForm.addEventListener('submit',   handlePasswordUpdate);
    if (trackForm) trackForm.addEventListener('submit',  handleTrackUpload);
    if (albumForm) albumForm.addEventListener('submit',  handleAlbumUpload);

    // Setup UI components
    setupAudioDrop();
    setupArtDrop();
    setupAlbumUpload();
    setupTaxonomySelectors();
    createToastContainer();
    setupSecurityForm();
    initPostsSection();
    initCreatePostForm();
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
// Expose globally so other ES modules (e.g. merchStudio.js) can call it
window.showToast = showToast;

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
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Analyzing Audio...`;
    btn.disabled = true;
    btn.style.opacity = "0.7";

    try {
        const fileInput = document.getElementById('audioInput');
        const file = fileInput.files[0];
        if (!file) throw new Error("No audio file selected");

        // STEP 1: Run Essentia analysis in the browser.
        // This gives us real BPM + key from signal processing — much more
        // accurate than ID3 tags, which artists almost never set.
        // Results are sent to the server and take priority over tag extraction.
        showUploadProgress();
        updateProgressStep('analysis', 'analyzing', 'Detecting BPM and key...');
        const analysis = await analyzeAudioInBrowser(file);

        if (analysis) {
            console.log("✅ Browser analysis:", analysis);
            updateProgressStep('analysis', 'complete',
                `BPM: ${analysis.bpm}, Key: ${analysis.key} ${analysis.mode}`, analysis);
        } else {
            console.warn("⚠ Browser analysis unavailable — server will use tag data");
            updateProgressStep('analysis', 'warning', 'Analysis skipped — BPM/key will use tag data if available');
        }

        // STEP 2: Build FormData — include Essentia results so server can use them
        updateProgressStep('upload', 'uploading', 'Uploading files...');
        const formData = new FormData(e.target);
        if (analysis) {
            formData.append('bpm',          analysis.bpm);
            formData.append('key',          analysis.key);
            formData.append('mode',         analysis.mode);
            formData.append('energy',       analysis.energy);
            formData.append('danceability', analysis.danceability);
            formData.append('duration',     analysis.duration);
        }

        // STEP 3: POST to server — it returns a jobId immediately without
        // waiting for transcode/upload to finish. No more timeout risk.
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/artist/api/upload-track', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server error ${response.status}`);
        }
        const { jobId } = await response.json();

        // STEP 4: Poll the background job every 2 s until done
        updateProgressStep('upload', 'uploading', 'Processing on server...');
        await pollUploadJob(jobId, token, {
            onProgress(job) {
                const last = job.progress[job.progress.length - 1];
                if (!last) return;
                if (last.step === 'upload' || last.step === 'transcode')
                    updateProgressStep('upload', 'uploading', last.message);
                else if (last.step === 'database')
                    updateProgressStep('database', 'saving', last.message);
            },
            onComplete(job) {
                updateProgressStep('upload',   'complete', 'Files uploaded');
                updateProgressStep('database', 'complete', 'Track saved to library');
                if (job.result?.bpm) {
                    updateProgressStep('analysis', 'complete',
                        `BPM: ${job.result.bpm}, Key: ${job.result.key} ${job.result.mode}`,
                        job.result);
                }
                showCompletionMessage();
            },
        });

        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.style.opacity = "1";

    } catch (error) {
        console.error("Upload Error:", error);
        showToast(error.message, "error");
        const modal = document.getElementById('uploadProgressModal');
        if (modal) modal.remove();
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

    // Elements may be inside a tab/modal not yet in DOM — retry up to 10 times
    if (!multiInput || !trackList) {
        let retries = 0;
        const interval = setInterval(() => {
            retries++;
            const mi = document.getElementById('albumAudioInput');
            const tl = document.getElementById('albumTrackList');
            if (mi && tl) { clearInterval(interval); setupAlbumUpload(); }
            if (retries >= 10) clearInterval(interval);
        }, 500);
        return;
    }

    // Handle audio file selection — accumulate, don't replace
    multiInput.addEventListener('change', () => {
        const incoming = Array.from(multiInput.files);
        incoming.forEach(newFile => {
            const dupe = albumTracks.some(f => f.name === newFile.name && f.size === newFile.size);
            if (!dupe) albumTracks.push(newFile);
        });
        multiInput.value = ''; // reset so same file can be re-added after removal
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

// Module-level drag state
let _dragSrcIndex = null;

function renderAlbumTrackList(overrideTitles = null, overrideDurations = null) {
    const trackList = document.getElementById('albumTrackList');
    if (!trackList) return;

    // Snapshot current user-edited titles + durations before wiping DOM
    const savedTitles    = overrideTitles    ? [...overrideTitles]    : [];
    const savedDurations = overrideDurations ? [...overrideDurations] : [];
    if (!overrideTitles) {
        trackList.querySelectorAll('.album-track-item').forEach(el => {
            const idx      = parseInt(el.dataset.index);
            const titleEl  = el.querySelector('.track-title-input');
            const durEl    = el.querySelector('.track-duration');
            savedTitles[idx]    = titleEl ? titleEl.value : '';
            savedDurations[idx] = durEl   ? { text: durEl.textContent, secs: durEl.dataset.duration || '' } : null;
        });
    }

    trackList.innerHTML = '';

    albumTracks.forEach((file, index) => {
        const item = document.createElement('div');
        item.className     = 'album-track-item';
        item.draggable     = true;
        item.dataset.index = index;

        const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
        const title     = (savedTitles[index] !== undefined && savedTitles[index] !== '')
                            ? savedTitles[index] : cleanName;
        const durSaved  = savedDurations[index] || null;

        item.innerHTML = `
            <div class="drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>
            <div class="track-number">${index + 1}</div>
            <input type="text"
                   class="track-title-input"
                   value="${title.replace(/"/g, '&quot;')}"
                   placeholder="Track Title"
                   data-index="${index}">
            <div class="track-duration" data-index="${index}"
                 data-duration="${durSaved ? (durSaved.secs || '') : ''}">${durSaved ? durSaved.text : '--:--'}</div>
            <button type="button" class="btn-remove" data-remove="${index}">
                <i class="fas fa-times"></i>
            </button>
        `;

        // Remove
        item.querySelector('[data-remove]').addEventListener('click', () => {
            albumTracks.splice(index, 1);
            renderAlbumTrackList();
        });

        // Duration — only calculate if not already known
        if (!durSaved || !durSaved.secs) {
            const audio = new Audio(URL.createObjectURL(file));
            audio.onloadedmetadata = () => {
                const durEl = item.querySelector('.track-duration');
                if (!durEl) return;
                const m = Math.floor(audio.duration / 60);
                const s = Math.floor(audio.duration % 60);
                durEl.textContent      = `${m}:${s.toString().padStart(2, '0')}`;
                durEl.dataset.duration = Math.round(audio.duration);
            };
        }

        // ── Drag events ──
        item.addEventListener('dragstart', (e) => {
            _dragSrcIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            requestAnimationFrame(() => item.classList.add('dragging'));
        });

        item.addEventListener('dragend', () => {
            _dragSrcIndex = null;
            item.classList.remove('dragging');
            trackList.querySelectorAll('.album-track-item').forEach(el =>
                el.classList.remove('drag-over-top', 'drag-over-bottom'));
            const ind = trackList.querySelector('.track-drop-indicator');
            if (ind) ind.remove();
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            trackList.querySelectorAll('.album-track-item').forEach(el =>
                el.classList.remove('drag-over-top', 'drag-over-bottom'));
            const midY  = item.getBoundingClientRect().top + item.offsetHeight / 2;
            const isTop = e.clientY < midY;
            item.classList.add(isTop ? 'drag-over-top' : 'drag-over-bottom');

            let ind = trackList.querySelector('.track-drop-indicator');
            if (!ind) { ind = document.createElement('div'); ind.className = 'track-drop-indicator'; }
            trackList.insertBefore(ind, isTop ? item : item.nextSibling);
        });

        item.addEventListener('dragleave', (e) => {
            if (!item.contains(e.relatedTarget))
                item.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const from = _dragSrcIndex;
            if (from === null || from === index) return;

            // Snapshot titles + durations in current DOM order before re-render
            const curTitles    = [];
            const curDurations = [];
            trackList.querySelectorAll('.album-track-item').forEach(el => {
                const i   = parseInt(el.dataset.index);
                const tEl = el.querySelector('.track-title-input');
                const dEl = el.querySelector('.track-duration');
                curTitles[i]    = tEl ? tEl.value : '';
                curDurations[i] = dEl ? { text: dEl.textContent, secs: dEl.dataset.duration || '' } : null;
            });

            const midY     = item.getBoundingClientRect().top + item.offsetHeight / 2;
            const isTop    = e.clientY < midY;
            const insertAt = isTop ? index : index + 1;
            const adjusted = insertAt > from ? insertAt - 1 : insertAt;

            // Reorder the file array
            const [movedFile] = albumTracks.splice(from, 1);
            albumTracks.splice(adjusted, 0, movedFile);

            // Reorder the title/duration arrays the same way
            const [movedTitle] = curTitles.splice(from, 1);
            curTitles.splice(adjusted, 0, movedTitle);
            const [movedDur] = curDurations.splice(from, 1);
            curDurations.splice(adjusted, 0, movedDur);

            renderAlbumTrackList(curTitles, curDurations);
        });

        trackList.appendChild(item);
    });
}

window.removeAlbumTrack = function(index) {
    albumTracks.splice(index, 1);
    renderAlbumTrackList();
};

// ==========================================
// ALBUM UPLOAD HANDLER
// ==========================================
// ==========================================
// BACKGROUND JOB POLLING HELPER
//
// The server now returns a jobId immediately on upload POST requests.
// All heavy work (transcode, R2 upload, analysis) runs in the background.
// This function polls /artist/api/upload-job/:jobId every 2 seconds and
// calls the appropriate callback when the job finishes.
//
// Callbacks:
//   onProgress(job) — called on each poll while status === 'processing'
//   onComplete(job) — called once when status === 'complete'
//
// Rejects with an Error if:
//   - job.status === 'failed'
//   - 30 minutes pass without completion (covers any song length + transcode)
// ==========================================
async function pollUploadJob(jobId, token, { onProgress, onComplete } = {}) {
    const INTERVAL  = 2000;           // poll every 2 seconds
    const MAX_WAIT  = 30 * 60 * 1000; // 30 minute ceiling
    const started   = Date.now();

    return new Promise((resolve, reject) => {
        const tick = async () => {
            try {
                if (Date.now() - started > MAX_WAIT) {
                    reject(new Error('Upload job timed out after 30 minutes'));
                    return;
                }
                const res = await fetch(`/artist/api/upload-job/${jobId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) { reject(new Error(`Job poll error: ${res.status}`)); return; }
                const job = await res.json();

                if (job.status === 'complete') {
                    if (onComplete) onComplete(job);
                    resolve(job);
                } else if (job.status === 'failed') {
                    reject(new Error(job.error || 'Upload failed on server'));
                } else {
                    if (onProgress) onProgress(job);
                    setTimeout(tick, INTERVAL);
                }
            } catch (err) {
                reject(err);
            }
        };
        setTimeout(tick, INTERVAL); // first poll after 2 s
    });
}

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

    showUploadProgress();
    updateProgressStep('copyright', 'analyzing', 'Analyzing tracks in browser...');

    // STEP 1: Run Essentia on every track in the browser sequentially.
    // Sequential (not parallel) so we don't saturate the audio thread.
    // Each result is stored by track index and sent to the server so it
    // has real BPM/key for every track — not just tag guesses.
    const trackAnalyses = [];
    for (let i = 0; i < albumTracks.length; i++) {
        const file = albumTracks[i];
        updateProgressStep('copyright', 'analyzing',
            `Analyzing ${i + 1}/${albumTracks.length}: ${file.name.replace(/\.[^/.]+$/, '')}`);
        try {
            const result = await analyzeAudioInBrowser(file);
            trackAnalyses.push(result || null);
            if (result) console.log(`✅ Track ${i + 1} — BPM: ${result.bpm}, Key: ${result.key} ${result.mode}`);
        } catch {
            trackAnalyses.push(null);
        }
    }
    const analyzedCount = trackAnalyses.filter(Boolean).length;
    updateProgressStep('copyright', 'complete',
        `Analysis done (${analyzedCount}/${albumTracks.length} tracks)`);

    // STEP 2: Collect UI data
    const trackTitles = [];
    document.querySelectorAll('.track-title-input').forEach(input => trackTitles.push(input.value));

    // STEP 3: Build FormData
    updateProgressStep('upload', 'uploading', 'Sending files to server...');
    const formData = new FormData();
    albumTracks.forEach(file => formData.append('audioFiles', file));
    formData.append('albumArt',      albumArtInput.files[0]);
    formData.append('albumName',     document.getElementById('albumName').value);
    formData.append('genre',         document.getElementById('albumGenre').value);
    formData.append('subgenres',     JSON.stringify(selectedSubgenres));
    formData.append('trackTitles',   JSON.stringify(trackTitles));
    formData.append('trackAnalyses', JSON.stringify(trackAnalyses));
    const releaseDateEl = document.getElementById('albumReleaseDate');
    if (releaseDateEl) formData.append('releaseDate', releaseDateEl.value);

    try {
        // STEP 4: POST — server responds with jobId immediately, no blocking
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/artist/api/upload-album', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server error ${response.status}`);
        }
        const { jobId, totalTracks } = await response.json();

        // STEP 5: Poll until all tracks are processed
        let lastTrackCount = 0;
        await pollUploadJob(jobId, token, {
            onProgress(job) {
                const done = job.progress.filter(p => p.step === 'track_done').length;
                if (done > lastTrackCount) {
                    lastTrackCount = done;
                    updateProgressStep('analysis', 'analyzing',
                        `Processing tracks: ${done}/${totalTracks || albumTracks.length}`);
                    const last = job.progress[job.progress.length - 1];
                    if (last) updateProgressStep('upload', 'uploading', last.message);
                }
            },
            onComplete(job) {
                const r = job.result;
                updateProgressStep('upload',   'complete', 'All files uploaded');
                updateProgressStep('analysis', 'complete',
                    r ? `${r.successCount} tracks saved` : 'Tracks saved');
                updateProgressStep('database', 'complete',
                    r?.failCount ? `Album saved (${r.failCount} track(s) had errors)` : 'Album saved');
                showCompletionMessage();
            },
        });

    } catch (err) {
        console.error(err);
        showToast("Album upload failed: " + err.message, "error");
        const modal = document.getElementById('uploadProgressModal');
        if (modal) modal.remove();
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

        // 1.5 Settings Form Pre-fill
        const bioEl = document.getElementById('settingsBio');
        const avatarPreview = document.getElementById('avatarSettingsPreview');
        const bannerPreview = document.getElementById('bannerSettingsPreview');

        if (bioEl) bioEl.value = data.profile.bio || "";
        if (avatarPreview && data.profile.image) avatarPreview.src = data.profile.image;
        if (bannerPreview && data.profile.banner) bannerPreview.src = data.profile.banner;

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

        // 4. Load Community Pulse (active tab)
        const activeTab = document.querySelector('.pulse-tab.active');
        const tab = activeTab?.dataset.tab || 'comments';
        if (tab === 'tips') {
            loadTipNotifications();
        } else {
            loadComments();
        }
        loadTipUnreadBadge();

    } catch (e) {
        console.error("Dashboard Load Error", e);
        showToast("Failed to connect to studio. Please refresh.", "error");
    }
}


// ==========================================
// SETTINGS: PROFILE CUSTOMIZATION
// ==========================================

// Image Previews
document.getElementById('avatarInput')?.addEventListener('change', (e) => previewImage(e, 'avatarSettingsPreview'));
document.getElementById('bannerInput')?.addEventListener('change', (e) => previewImage(e, 'bannerSettingsPreview'));
document.getElementById('artistProfileForm')?.addEventListener('submit', handleProfileUpdate);

function previewImage(event, previewId) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => document.getElementById(previewId).src = e.target.result;
        reader.readAsDataURL(file);
    }
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    const btn = document.getElementById('btnUpdateProfile');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const user = auth.currentUser;
        const token = await user.getIdToken();

        let updates = {
            bio: document.getElementById('settingsBio').value
        };

        // Upload Avatar if changed
        const avatarFile = document.getElementById('avatarInput').files[0];
        if (avatarFile) {
            const form = new FormData();
            form.append('file', avatarFile);
            form.append('type', 'avatar');
            const res = await fetch('/artist/api/upload-asset', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: form
            });
            const data = await res.json();
            if (data.success) updates.profileImage = data.url;
        }

        // Upload Banner if changed
        const bannerFile = document.getElementById('bannerInput').files[0];
        if (bannerFile) {
            const form = new FormData();
            form.append('file', bannerFile);
            form.append('type', 'banner');
            const res = await fetch('/artist/api/upload-asset', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: form
            });
            const data = await res.json();
            if (data.success) updates.bannerImage = data.url;
        }

        // Save to database
        const dbRes = await fetch('/artist/api/settings/update-profile', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });

        if (!dbRes.ok) throw new Error('Failed to update profile');

        showToast('Profile updated successfully!', 'success');
        loadDashboardData(); // Refresh UI with new images/bio

    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
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
        item.dataset.postId    = comment.postId || '';
        
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
                        ${!comment.read ? '<button class="act-btn" onclick="markCommentRead(\'' + comment.id + '\', \'' + (comment.postId||'') + '\')"><i class="fas fa-check"></i> Mark Read</button>' : ''}
                        <button class="act-btn flag" onclick="flagComment(\'' + comment.id + '\', \'' + (comment.postId||'') + '\')"><i class="fas fa-flag"></i> Flag</button>
                        <button class="act-btn delete" onclick="hideComment(\'' + comment.id + '\', \'' + (comment.postId||'') + '\')"><i class="fas fa-trash"></i> Hide</button>
                    </div>
                </div>
            </div>
        `;
        
        feed.appendChild(item);
    });
}

// ==========================================
// COMMUNITY PULSE — TAB NAVIGATION
// ==========================================

// Called from onclick on .pulse-tab buttons in the pug template
window.switchPulseTab = function(tab) {
    document.querySelectorAll('.pulse-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    if (tab === 'tips') {
        loadTipNotifications();
    } else {
        loadComments();
    }
};

// ==========================================
// TIP NOTIFICATIONS
// ==========================================

async function loadTipNotifications() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    try {
        const user = auth.currentUser;
        if (!user) return;

        feed.innerHTML = `
            <div style="text-align:center; padding:30px; opacity:0.5;">
                <i class="fas fa-spinner fa-spin" style="font-size:1.5rem;"></i>
            </div>`;

        const token = await user.getIdToken();
        const res   = await fetch('/artist/api/studio/tips?limit=30', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        displayTips(data.tips || []);

    } catch (e) {
        console.error('[tips] load error:', e);
        const feed = document.getElementById('activityFeed');
        if (feed) feed.innerHTML = `
            <div style="text-align:center;padding:30px;opacity:0.5;">
                <i class="fas fa-exclamation-circle"></i>
                <p style="margin-top:8px;font-size:0.9rem;">Failed to load tips</p>
            </div>`;
    }
}

function displayTips(tips) {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    feed.innerHTML = '';

    if (tips.length === 0) {
        feed.innerHTML = `
            <div style="text-align:center; padding:40px 20px; opacity:0.6;">
                <i class="fas fa-coins" style="font-size:2rem; margin-bottom:12px; display:block; color:#666;"></i>
                <p style="font-size:0.95rem; color:#999;">No tips yet</p>
                <p style="font-size:0.85rem; color:#666; margin-top:8px;">Tips from your fans will appear here</p>
            </div>`;
        return;
    }

    // "Mark all read" header row if there are unread tips
    const unread = tips.filter(t => !t.read).length;
    if (unread > 0) {
        const header = document.createElement('div');
        header.className = 'pulse-feed-header';
        header.innerHTML = `
            <span>${unread} unread tip${unread !== 1 ? 's' : ''}</span>
            <button class="act-btn" onclick="markAllTipsRead()">
                <i class="fas fa-check-double"></i> Mark all read
            </button>`;
        feed.appendChild(header);
    }

    tips.forEach(tip => {
        const item = document.createElement('div');
        item.className = `activity-item ${tip.read ? '' : 'unread'}`;
        item.dataset.tipId = tip.id;

        const timeAgo = tip.timestamp ? formatTimeAgo(new Date(tip.timestamp)) : '';
        const amount  = Number(tip.amount).toFixed(2);

        item.innerHTML = `
            <div class="act-icon" style="background:rgba(255,215,0,0.15);">
                <i class="fas fa-coins" style="color:#ffd700;"></i>
            </div>
            <div class="act-details">
                <div class="act-header">
                    <span class="act-text">
                        <strong>${escapeHtml(tip.handle)}</strong> tipped you
                        <span class="tip-amount">$${amount}</span>
                    </span>
                </div>
                ${tip.message ? `<p class="act-preview">"${escapeHtml(tip.message)}"</p>` : ''}
                <div class="act-footer">
                    <span class="act-time">${timeAgo}</span>
                    <div class="act-actions">
                        ${!tip.read
                            ? `<button class="act-btn" onclick="markTipRead('${tip.id}')">
                                <i class="fas fa-check"></i> Mark Read
                               </button>`
                            : ''}
                    </div>
                </div>
            </div>`;

        feed.appendChild(item);
    });
}

window.markTipRead = async function(tipId) {
    try {
        const user  = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();

        await fetch(`/artist/api/studio/tips/${tipId}/read`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // Update UI inline — remove unread class, hide button
        const item = document.querySelector(`[data-tip-id="${tipId}"]`);
        if (item) {
            item.classList.remove('unread');
            item.querySelector('.act-btn')?.remove();
        }
        loadTipUnreadBadge();
    } catch (e) {
        console.error('[tips] markTipRead error:', e);
    }
};

window.markAllTipsRead = async function() {
    try {
        const user  = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();

        await fetch('/artist/api/studio/tips/read-all', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // Refresh the whole list so the header row disappears
        loadTipNotifications();
        loadTipUnreadBadge();
    } catch (e) {
        console.error('[tips] markAllTipsRead error:', e);
    }
};

async function loadTipUnreadBadge() {
    try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();

        const res  = await fetch('/artist/api/studio/tips/unread-count', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const count = data.unreadCount || 0;

        // Update the badge on the Tips tab button
        const badge = document.getElementById('tipTabBadge');
        if (badge) {
            badge.textContent = count > 0 ? count : '';
            badge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
    } catch (e) {
        // Non-fatal — badge just won't show
    }
}

// ==========================================
// SETTINGS: UPDATE PASSWORD
// ==========================================
async function handlePasswordUpdate(e) {
    e.preventDefault();
    const newPwd = document.getElementById('newPassword').value;
    const confirmPwd = document.getElementById('confirmPassword').value;
    const btn = document.getElementById('btnUpdatePassword');

    if (newPwd !== confirmPwd) {
        return showToast('Passwords do not match', 'error');
    }

    const user = auth.currentUser;
    if (!user) return showToast('Not authenticated', 'error');

    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

    try {
        await updatePassword(user, newPwd);
        showToast('Password updated successfully!', 'success');
        document.getElementById('passwordUpdateForm').reset();
    } catch (err) {
        console.error(err);
        if (err.code === 'auth/requires-recent-login') {
            showToast('Security protocol: Please log out and log back in to change your password.', 'error');
        } else {
            showToast(err.message, 'error');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// ==========================================
// SETTINGS: DELETE ACCOUNT
// ==========================================
window.confirmAccountDeletion = async () => {
    const confirmation = prompt("To confirm deletion, type 'DELETE' in all caps. This will erase all your music and data permanently.");
    
    if (confirmation !== 'DELETE') {
        if (confirmation !== null) showToast("Deletion cancelled.", "error");
        return;
    }

    try {
        const user = auth.currentUser;
        const token = await user.getIdToken();
        
        showToast("Deleting account data...", "success");

        // Tell backend to delete Firestore records & Admin Auth
        const res = await fetch('/artist/api/settings/delete-account', {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Failed to delete backend data");

        // Sign the user out locally
        await signOut(auth);
        
        alert("Your account has been successfully deleted.");
        window.location.href = '/';

    } catch (err) {
        console.error(err);
        if (err.code === 'auth/requires-recent-login') {
            showToast('Security protocol: Please log out and log back in to delete your account.', 'error');
        } else {
            showToast(err.message || 'Error deleting account', 'error');
        }
    }
};

// Mark comment as read
window.markCommentRead = async (commentId, postId) => {
    const resolvedPostId = postId ||
        document.querySelector(`[data-comment-id="${commentId}"]`)?.dataset?.postId || '';
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
            body: JSON.stringify({ commentId, postId: resolvedPostId })
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
window.flagComment = async (commentId, postId) => {
    const reason = prompt('Why are you flagging this comment?\n(offensive, spam, harassment, etc.)');
    if (!reason) return;

    const resolvedPostId = postId ||
        document.querySelector(`[data-comment-id="${commentId}"]`)?.dataset?.postId || '';
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
            body: JSON.stringify({ commentId, postId: resolvedPostId, reason })
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
window.hideComment = async (commentId, postId) => {
    if (!confirm('Hide this comment? It will no longer be visible on your wall.')) return;

    const resolvedPostId = postId ||
        document.querySelector(`[data-comment-id="${commentId}"]`)?.dataset?.postId || '';
    try {
        const user = auth.currentUser;
        if (!user) return;

        const token = await user.getIdToken();
        
        const res = await fetch(`/artist/api/studio/comments/${commentId}?postId=${encodeURIComponent(resolvedPostId)}`, {
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
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');
    // Mark the clicked nav button active (event may not be present if called programmatically)
    if (typeof event !== 'undefined' && event?.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        const btn = document.querySelector(`.nav-btn[onclick*="${viewId}"]`);
        if (btn) btn.classList.add('active');
    }
    // Lazy-load section data on first visit
    if (viewId === 'music')  loadCatalogData();
    if (viewId === 'posts')  loadStudioPosts();
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

// ==========================================
// CATALOG — load & render
// ==========================================
let _catalogFilter  = 'all';
let _catalogLoaded  = false;

async function loadCatalogData(filter = null) {
    if (filter) _catalogFilter = filter;

    const grid    = document.getElementById('catalogGrid');
    const empty   = document.getElementById('catalogEmpty');
    const countEl = document.getElementById('catalogCount');
    if (!grid) return;

    grid.innerHTML = `
        <div class="catalog-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>Loading your catalog...</span>
        </div>`;

    try {
        const token = await auth.currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/catalog?filter=${_catalogFilter}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(await res.text());
        const { songs, albums } = await res.json();

        _catalogLoaded = true;

        if (countEl) countEl.textContent = `${songs.length} track${songs.length !== 1 ? 's' : ''}`;

        if (songs.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.style.display = 'flex';
            return;
        }
        if (empty) empty.style.display = 'none';

        grid.innerHTML = songs.map(s => {
            const mins = Math.floor(s.duration / 60);
            const secs = Math.floor(s.duration % 60);
            const dur  = s.duration ? `${mins}:${secs.toString().padStart(2,'0')}` : '--:--';
            const art  = s.artUrl || '/images/default-art.jpg';
            const tag  = s.isSingle ? 'Single' : (s.album || 'Album Track');
            const bpmKey = (s.bpm && s.key && s.key !== 'Unknown')
                ? `<span class="catalog-tag">${s.bpm} BPM</span><span class="catalog-tag">${s.key} ${s.mode || ''}</span>`
                : '';
            return `
            <div class="catalog-track-card">
                <div class="catalog-art">
                    <img src="${art}" alt="${s.title}" loading="lazy">
                    <div class="catalog-art-overlay">
                        <button class="catalog-play-btn" onclick="window.open('${s.audioUrl}','_blank')" title="Preview">
                            <i class="fas fa-play"></i>
                        </button>
                    </div>
                </div>
                <div class="catalog-info">
                    <p class="catalog-title">${s.title}</p>
                    <p class="catalog-meta">${tag}</p>
                    <div class="catalog-tags">
                        ${s.genre ? `<span class="catalog-tag catalog-tag--genre">${s.genre}</span>` : ''}
                        ${bpmKey}
                    </div>
                </div>
                <div class="catalog-stats">
                    <span class="catalog-dur">${dur}</span>
                    <span class="catalog-plays"><i class="fas fa-play"></i> ${s.plays || 0}</span>
                </div>
            </div>`;
        }).join('');

    } catch (e) {
        console.error('Catalog load error:', e);
        grid.innerHTML = `<p style="color:#888;text-align:center;padding:40px;grid-column:1/-1;">Could not load catalog: ${e.message}</p>`;
    }
}

window.switchCatalogFilter = (filter) => {
    _catalogFilter = filter;
    document.querySelectorAll('.catalog-filter-btn').forEach(b => b.classList.remove('active'));
    const active = document.querySelector(`.catalog-filter-btn[data-filter="${filter}"]`);
    if (active) active.classList.add('active');
    loadCatalogData(filter);
};

// ─────────────────────────────────────────────────────────────────
// 1. BIO PREVIEW & CHARACTER COUNTER
// Called after settingsBio is populated in loadDashboardData()
// ─────────────────────────────────────────────────────────────────
function initBioPreview() {
    const textarea   = document.getElementById('settingsBio');
    const counter    = document.getElementById('bioCharCount');
    const previewBox = document.getElementById('bioPreviewBox');
    const previewTxt = document.getElementById('bioPreviewText');

    if (!textarea) return;

    const update = () => {
        const val = textarea.value;
        if (counter) counter.textContent = val.length;
        if (previewBox && previewTxt) {
            if (val.trim().length > 0) {
                previewTxt.textContent = val;
                previewBox.style.display = 'block';
            } else {
                previewBox.style.display = 'none';
            }
        }
    };

    textarea.addEventListener('input', update);
    update(); // Run once on load to show existing bio
}

// ─────────────────────────────────────────────────────────────────
// 2. CREATE POST MODAL
// ─────────────────────────────────────────────────────────────────
function openCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    if (modal) modal.classList.add('active');
}

function closeCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    if (modal) modal.classList.remove('active');
    // Reset form
    const preview = document.getElementById('postImagePreview');
    const dz      = document.getElementById('postDzContent');
    const caption = document.getElementById('postCaption');
    const input   = document.getElementById('postImageInput');
    if (preview) { preview.style.display = 'none'; preview.src = ''; }
    if (dz)      dz.style.display = 'flex';
    if (caption) caption.value = '';
    if (input)   input.value = '';
    if (document.getElementById('postCaptionCount')) document.getElementById('postCaptionCount').textContent = '0';
}

// Wire image preview + caption counter once DOM is ready
function initCreatePostForm() {
    const imageInput   = document.getElementById('postImageInput');
    const preview      = document.getElementById('postImagePreview');
    const dzContent    = document.getElementById('postDzContent');
    const captionInput = document.getElementById('postCaption');
    const captionCount = document.getElementById('postCaptionCount');

    if (imageInput) {
        imageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (preview)   { preview.src = ev.target.result; preview.style.display = 'block'; }
                if (dzContent) dzContent.style.display = 'none';
            };
            reader.readAsDataURL(file);
        });
    }

    if (captionInput && captionCount) {
        captionInput.addEventListener('input', () => {
            captionCount.textContent = captionInput.value.length;
        });
    }
}

async function submitNewPost() {
    const imageInput = document.getElementById('postImageInput');
    const caption    = document.getElementById('postCaption')?.value?.trim();
    const submitBtn  = document.getElementById('submitPostBtn');

    if (!imageInput?.files[0]) {
        return showToast('Please select an image for your post.', true);
    }
    if (!caption) {
        return showToast('Please add a caption.', true);
    }

    try {
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i> Uploading...'; }

        const token = await auth.currentUser.getIdToken();

        const formData = new FormData();
        formData.append('postImage', imageInput.files[0]);
        formData.append('caption',   caption);

        const res  = await fetch('/artist/api/studio/posts/create', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body:    formData,
        });
        const data = await res.json();

        if (data.success) {
            showToast('Post shared! 🎉');
            closeCreatePostModal();
            await loadStudioPosts(); // Refresh the posts grid
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (e) {
        console.error('Submit Post Error:', e);
        showToast(e.message || 'Failed to create post', true);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:8px;"></i> Share Post'; }
    }
}

// ─────────────────────────────────────────────────────────────────
// 3. STUDIO POSTS FEED
// ─────────────────────────────────────────────────────────────────
async function loadStudioPosts() {
    const grid  = document.getElementById('studioPostsGrid');
    const empty = document.getElementById('studioPostsEmpty');
    const count = document.getElementById('studiPostCount');

    if (!grid) return;
    grid.innerHTML = '<div style="text-align:center; padding:30px; color:#555; grid-column:1/-1;"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem;"></i></div>';

    try {
        const token = await auth.currentUser.getIdToken();
        const res   = await fetch('/artist/api/studio/posts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data  = await res.json();
        const posts = data.posts || [];

        if (count) count.textContent = `${posts.length} post${posts.length !== 1 ? 's' : ''}`;

        if (posts.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.style.display = 'flex';
            return;
        }

        if (empty) empty.style.display = 'none';

        grid.innerHTML = posts.map(post => {
            const date = new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const shortCaption = post.caption.length > 60 ? post.caption.slice(0, 60) + '…' : post.caption;
            return `
            <div class="studio-post-card" data-post-id="${post.id}" data-img="${post.imageUrl}" data-caption="${shortCaption}">
                <div class="studio-post-img-wrap">
                    <img src="${post.imageUrl}" alt="Post" loading="lazy">
                    <button class="studio-post-delete-btn" onclick="deleteStudioPost('${post.id}', this)" title="Delete post">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
                <div class="studio-post-body">
                    <p class="studio-post-caption">${shortCaption}</p>
                    <div class="studio-post-stats">
                        <span><i class="fas fa-heart"></i> ${post.likes || 0}</span>
                        <span class="comment-badge" title="View &amp; reply to comments" style="cursor:pointer;">
                            <i class="fas fa-comment"></i> ${post.commentCount || 0}
                        </span>
                        <span class="studio-post-date">${date}</span>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Wire comment badge clicks — must happen after innerHTML is set
        grid.querySelectorAll('.studio-post-card').forEach(card => {
            const badge = card.querySelector('.comment-badge');
            if (badge) {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openCommentInbox(
                        card.dataset.postId,
                        card.dataset.img,
                        card.dataset.caption
                    );
                });
            }
        });

    } catch (e) {
        console.error('Load Studio Posts Error:', e);
        grid.innerHTML = '<p style="color:#888; text-align:center; padding:30px; grid-column:1/-1;">Could not load posts.</p>';
    }
}

async function deleteStudioPost(postId, btn) {
    if (!confirm('Delete this post? This cannot be undone.')) return;

    try {
        const token = await auth.currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/posts/${postId}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            const card = btn.closest('.studio-post-card');
            if (card) card.remove();
            showToast('Post deleted');
            // Refresh empty state if no posts left
            const grid = document.getElementById('studioPostsGrid');
            if (grid && grid.children.length === 0) {
                const empty = document.getElementById('studioPostsEmpty');
                if (empty) empty.style.display = 'flex';
            }
        } else { throw new Error(data.error); }
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Failed to delete post', true);
    }
}

// ─────────────────────────────────────────────────────────────────
// 4. INIT — call once after DOM is ready (e.g. inside DOMContentLoaded
//    or the existing studio init block)
// ─────────────────────────────────────────────────────────────────
function initPostsSection() {
    initCreatePostForm();
    initBioPreview();
}

// ─────────────────────────────────────────────────────────────────
// COMMENT INBOX — artist reads, likes, and replies to fan comments
// ─────────────────────────────────────────────────────────────────
let _inboxPostId = null;

function openCommentInbox(postId, imageUrl, caption) {
    _inboxPostId = postId;

    const modal  = document.getElementById('commentInboxModal');
    const thumb  = document.getElementById('inboxPostThumb');
    const capEl  = document.getElementById('inboxPostCaption');
    const list   = document.getElementById('inboxCommentList');
    if (!modal) { console.warn('[Inbox] #commentInboxModal not found in DOM'); return; }

    if (thumb) thumb.src          = imageUrl || '';
    if (capEl) capEl.textContent  = caption  || '';
    if (list)  list.innerHTML     = `<div style="text-align:center;padding:48px 0;color:#888;"><i class="fas fa-spinner fa-spin" style="font-size:1.6rem;"></i></div>`;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    _loadInboxComments(postId);
}

function closeCommentInbox() {
    const modal = document.getElementById('commentInboxModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    _inboxPostId = null;
}

async function _loadInboxComments(postId) {
    const list = document.getElementById('inboxCommentList');
    if (!list) return;
    try {
        const token = await auth.currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/post/${postId}/comments`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data  = await res.json();
        const comments = data.comments || [];
        if (comments.length === 0) {
            list.innerHTML = `<div style="text-align:center;padding:48px 22px;color:#888;"><i class="fas fa-comment-slash" style="font-size:2rem;display:block;margin-bottom:12px;"></i><p style="margin:0;font-size:0.88rem;">No comments yet.</p></div>`;
            return;
        }
        list.innerHTML = comments.map(c => _buildInboxComment(c, postId)).join('');
    } catch (e) {
        console.error('Load Inbox Comments Error:', e);
        if (list) list.innerHTML = `<p style="text-align:center;padding:30px;color:#888;">Could not load comments.</p>`;
    }
}

function _inboxEscape(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _inboxTimeAgo(date) {
    const diff = (Date.now() - new Date(date).getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff/60)+'m ago';
    if (diff < 86400) return Math.floor(diff/3600)+'h ago';
    return new Date(date).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

function _buildInboxComment(c, postId) {
    const esc    = _inboxEscape;
    const avatar = c.userAvatar
        ? `<img src="${esc(c.userAvatar)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;" alt="">`
        : `<div style="width:36px;height:36px;border-radius:50%;background:#222;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-user" style="color:#555;font-size:0.8rem;"></i></div>`;

    const handle     = esc(c.userHandle ? '@'+c.userHandle : c.userName || 'Fan');
    const likeColor  = c.artistLiked ? '#e74c3c' : 'var(--text-secondary,#888)';
    const likeClass  = c.artistLiked ? 'fas fa-heart' : 'far fa-heart';

    const replyHtml = c.artistReply
        ? `<div id="reply-bubble-${esc(c.id)}" style="margin-top:8px;padding:10px 14px;background:var(--bg-hover,#1e1e1e);border-left:3px solid var(--primary,#88C9A1);border-radius:0 8px 8px 0;">
               <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                   <div style="flex:1;">
                       <span style="font-size:0.7rem;font-weight:700;color:var(--primary,#88C9A1);display:block;margin-bottom:3px;"><i class="fas fa-reply" style="margin-right:3px;"></i>Your reply</span>
                       <p style="margin:0;font-size:0.84rem;color:#ddd;line-height:1.5;">${esc(c.artistReply.text)}</p>
                   </div>
                   <button onclick="deleteInboxReply('${esc(postId)}','${esc(c.id)}')" style="background:none;border:none;color:#555;cursor:pointer;padding:2px 6px;font-size:0.8rem;flex-shrink:0;" title="Delete reply"><i class="fas fa-times"></i></button>
               </div>
           </div>`
        : `<div id="reply-form-${esc(c.id)}" style="display:none;margin-top:8px;">
               <div style="display:flex;gap:8px;align-items:flex-end;">
                   <textarea id="reply-input-${esc(c.id)}" placeholder="Reply to this comment…" rows="1"
                       style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:8px 12px;color:#ddd;font-size:0.83rem;resize:none;outline:none;min-height:36px;max-height:100px;"
                       oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
                   <button id="reply-btn-${esc(c.id)}" onclick="submitInboxReply('${esc(postId)}','${esc(c.id)}')"
                       style="background:var(--primary,#88C9A1);border:none;border-radius:8px;color:#000;font-size:0.82rem;font-weight:700;padding:8px 14px;cursor:pointer;">Post</button>
               </div>
           </div>`;

    const replyToggle = c.artistReply ? '' :
        `<button onclick="toggleInboxReplyForm('${esc(c.id)}')"
            style="background:none;border:none;color:var(--primary,#88C9A1);font-size:0.76rem;font-weight:700;cursor:pointer;padding:0;margin-top:6px;">
            <i class="fas fa-reply" style="margin-right:4px;"></i>Reply
        </button>`;

    return `
    <div class="inbox-comment-item" data-comment-id="${esc(c.id)}" style="padding:14px 22px;border-bottom:1px solid var(--border-color,#1a1a1a);">
        <div style="display:flex;gap:10px;align-items:flex-start;">
            ${avatar}
            <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="font-size:0.78rem;font-weight:700;color:#aaa;">${handle}</span>
                    <span style="font-size:0.72rem;color:#555;flex-shrink:0;">${_inboxTimeAgo(c.createdAt)}</span>
                </div>
                <p style="margin:0;font-size:0.88rem;color:#ddd;line-height:1.5;word-break:break-word;">${esc(c.comment)}</p>
                <div style="display:flex;align-items:center;gap:12px;margin-top:8px;">
                    <button id="like-btn-${esc(c.id)}" onclick="likeInboxComment('${esc(postId)}','${esc(c.id)}')"
                        style="background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:5px;color:${likeColor};font-size:0.82rem;">
                        <i class="${likeClass}"></i>
                        <span id="like-count-${esc(c.id)}">${c.likes||0}</span>
                    </button>
                    ${replyToggle}
                </div>
                ${replyHtml}
            </div>
        </div>
    </div>`;
}

async function likeInboxComment(postId, commentId) {
    const btn     = document.getElementById(`like-btn-${commentId}`);
    const countEl = document.getElementById(`like-count-${commentId}`);
    const icon    = btn?.querySelector('i');
    if (btn) btn.disabled = true;
    try {
        const token = await auth.currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/post/${postId}/comment/${commentId}/like`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && icon && countEl) {
            icon.className  = data.liked ? 'fas fa-heart' : 'far fa-heart';
            btn.style.color = data.liked ? '#e74c3c' : 'var(--text-secondary,#888)';
            countEl.textContent = data.likes;
        }
    } catch (e) { console.error('Like Inbox Comment Error:', e); showToast('Could not like comment', 'error'); }
    if (btn) btn.disabled = false;
}

function toggleInboxReplyForm(commentId) {
    const form = document.getElementById(`reply-form-${commentId}`);
    if (!form) return;
    const open = form.style.display !== 'none';
    form.style.display = open ? 'none' : 'block';
    if (!open) document.getElementById(`reply-input-${commentId}`)?.focus();
}

async function submitInboxReply(postId, commentId) {
    const input = document.getElementById(`reply-input-${commentId}`);
    const btn   = document.getElementById(`reply-btn-${commentId}`);
    const text  = input?.value?.trim();
    if (!text) return;
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
        const token = await auth.currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/post/${postId}/comment/${commentId}/reply`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:   JSON.stringify({ text }),
        });
        const data = await res.json();
        if (data.success) {
            const form   = document.getElementById(`reply-form-${commentId}`);
            const bubble = document.createElement('div');
            bubble.id    = `reply-bubble-${commentId}`;
            bubble.style.cssText = 'margin-top:8px;padding:10px 14px;background:var(--bg-hover,#1e1e1e);border-left:3px solid var(--primary,#88C9A1);border-radius:0 8px 8px 0;';
            bubble.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="flex:1;">
                        <span style="font-size:0.7rem;font-weight:700;color:var(--primary,#88C9A1);display:block;margin-bottom:3px;"><i class="fas fa-reply" style="margin-right:3px;"></i>Your reply</span>
                        <p style="margin:0;font-size:0.84rem;color:#ddd;line-height:1.5;">${_inboxEscape(data.reply.text)}</p>
                    </div>
                    <button onclick="deleteInboxReply('${postId}','${commentId}')" style="background:none;border:none;color:#555;cursor:pointer;padding:2px 6px;font-size:0.8rem;" title="Delete reply"><i class="fas fa-times"></i></button>
                </div>`;
            // Hide the Reply toggle button
            const item   = document.querySelector(`.inbox-comment-item[data-comment-id="${commentId}"]`);
            const toggle = item?.querySelector('button[onclick*="toggleInboxReplyForm"]');
            if (toggle) toggle.style.display = 'none';
            if (form) form.replaceWith(bubble);
            showToast('Reply posted! ✅');
        } else { throw new Error(data.error || 'Reply failed'); }
    } catch (e) {
        console.error('Submit Reply Error:', e);
        showToast(e.message || 'Failed to post reply', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

async function deleteInboxReply(postId, commentId) {
    if (!confirm('Delete your reply?')) return;
    try {
        const token = await auth.currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/post/${postId}/comment/${commentId}/reply`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        });
        const data  = await res.json();
        if (data.success) {
            const bubble = document.getElementById(`reply-bubble-${commentId}`);
            if (bubble) {
                const form   = document.createElement('div');
                form.id      = `reply-form-${commentId}`;
                form.style.cssText = 'display:none;margin-top:8px;';
                form.innerHTML = `
                    <div style="display:flex;gap:8px;align-items:flex-end;">
                        <textarea id="reply-input-${commentId}" placeholder="Reply to this comment…" rows="1"
                            style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:8px 12px;color:#ddd;font-size:0.83rem;resize:none;outline:none;min-height:36px;max-height:100px;"
                            oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
                        <button id="reply-btn-${commentId}" onclick="submitInboxReply('${postId}','${commentId}')"
                            style="background:var(--primary,#88C9A1);border:none;border-radius:8px;color:#000;font-size:0.82rem;font-weight:700;padding:8px 14px;cursor:pointer;">Post</button>
                    </div>`;
                bubble.replaceWith(form);
                // Restore the Reply toggle
                const item   = document.querySelector(`.inbox-comment-item[data-comment-id="${commentId}"]`);
                const toggle = item?.querySelector('button[onclick*="toggleInboxReplyForm"]');
                if (toggle) toggle.style.display = '';
            }
            showToast('Reply deleted');
        }
    } catch (e) { console.error('Delete Reply Error:', e); showToast('Could not delete reply', 'error'); }
}

// Close inbox on backdrop click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('commentInboxModal');
    if (modal && e.target === modal) closeCommentInbox();
});

// ─────────────────────────────────────────────────────────────────
// EXPOSE globals so pug onclick attrs work
// ─────────────────────────────────────────────────────────────────
window.openCreatePostModal   = openCreatePostModal;
window.closeCreatePostModal  = closeCreatePostModal;
window.submitNewPost         = submitNewPost;
window.deleteStudioPost      = deleteStudioPost;
window.loadStudioPosts       = loadStudioPosts;
window.initPostsSection      = initPostsSection;
window.openCommentInbox      = openCommentInbox;
window.closeCommentInbox     = closeCommentInbox;
window.likeInboxComment      = likeInboxComment;
window.toggleInboxReplyForm  = toggleInboxReplyForm;
window.submitInboxReply      = submitInboxReply;
window.deleteInboxReply      = deleteInboxReply;