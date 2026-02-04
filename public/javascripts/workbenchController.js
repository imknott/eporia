/* public/javascripts/workbenchController.js */
import * as Tone from 'https://cdn.skypack.dev/tone';
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();

export class WorkbenchController {
    constructor(engine) {
        this.engine = engine;
        this.stack = []; // The active crate
        this.draggedItem = null;
        this.currentCue = null;
        this.searchCache = {}; // Cache search results
        this.genreMap = {}; // Track genres in crate
        this.coverImage = null; // Cover art for crate
        this.currentCrateId = null; // Track if editing existing crate
        this.editMode = false; // Are we editing or creating new?
        
        // Initialize cue bus if not already set up
        if (!this.engine.cueBus) {
            this.setupCueBus();
        }
        
        // Load user's crates on init
        this.loadUserCrates();
        
        console.log('✅ Workbench initialized');
    }

    // --- A. AUDIO LOGIC ---
    setupCueBus() {
        // Create independent cue bus for headphone preview
        this.engine.cueBus = new Tone.Gain(0.7).toDestination();
    }

    async cueTrack(audioUrl, title) {
        try {
            // Stop any existing cue
            if (this.currentCue) {
                this.currentCue.stop();
                this.currentCue.dispose();
            }
            
            // Visual feedback
            this.showCueStatus(`🎧 Cueing: ${title}`, 'active');
            
            // Play to CueBus (Headphones) - doesn't interrupt main player
            this.currentCue = new Tone.Player({
                url: audioUrl,
                autostart: true,
                volume: -5 
            }).connect(this.engine.cueBus);
            
            // Auto-stop after track ends
            this.currentCue.onstop = () => {
                this.showCueStatus('🎧 Cue ready', 'idle');
            };
            
        } catch (e) {
            console.error('Cue Error:', e);
            this.showCueStatus('⚠️ Cue failed', 'error');
        }
    }

    stopCue() {
        if (this.currentCue) {
            this.currentCue.stop();
            this.currentCue.dispose();
            this.currentCue = null;
        }
        this.showCueStatus('🎧 Cue ready', 'idle');
    }

    showCueStatus(message, state) {
        const statusEl = document.getElementById('cueStatus');
        if (!statusEl) return;
        
        statusEl.textContent = message;
        statusEl.className = 'cue-status ' + state;
        
        // Auto-hide if idle
        if (state === 'idle') {
            setTimeout(() => {
                if (statusEl.textContent === message) {
                    statusEl.style.opacity = '0.5';
                }
            }, 2000);
        } else {
            statusEl.style.opacity = '1';
        }
    }

    // --- B. STACK MANAGEMENT ---
    addToStack(trackData) {
        // Prevent duplicates
        if (this.stack.some(t => t.id === trackData.id)) {
            this.showToast('Track already in crate', 'warning');
            return;
        }
        
        // Ensure we have all required fields
        const track = {
            id: trackData.id,
            title: trackData.title,
            artist: trackData.subtitle || trackData.artist || trackData.artistName || 'Unknown Artist',
            img: trackData.img || trackData.artUrl || '/images/placeholder.png',
            audioUrl: trackData.audioUrl,
            duration: trackData.duration || 0,
            genre: trackData.genre || null,
            artistId: trackData.artistId || null
        };
        
        this.stack.push(track);
        
        // Update genre tracking
        if (track.genre) {
            this.genreMap[track.genre] = (this.genreMap[track.genre] || 0) + 1;
        }
        
        this.renderStack();
        this.updateDNA();
        this.showToast(`Added: ${track.title}`, 'success');
        
        // Animate addition
        const cards = document.querySelectorAll('.stack-card');
        if (cards.length > 0) {
            const lastCard = cards[cards.length - 1];
            lastCard.style.animation = 'slideInRight 0.3s ease-out';
        }
    }

    removeFromStack(index) {
        const removed = this.stack[index];
        
        // Update genre tracking
        if (removed.genre && this.genreMap[removed.genre]) {
            this.genreMap[removed.genre]--;
            if (this.genreMap[removed.genre] === 0) {
                delete this.genreMap[removed.genre];
            }
        }
        
        this.stack.splice(index, 1);
        this.renderStack();
        this.updateDNA();
        this.showToast(`Removed: ${removed.title}`, 'info');
    }

    moveTrack(fromIndex, toIndex) {
        const item = this.stack[fromIndex];
        this.stack.splice(fromIndex, 1);
        this.stack.splice(toIndex, 0, item);
        this.renderStack();
    }

    clearStack() {
        if (this.stack.length === 0) return;
        
        if (confirm('Clear all tracks from this crate?')) {
            this.stack = [];
            this.genreMap = {};
            this.renderStack();
            this.updateDNA();
            this.showToast('Crate cleared', 'info');
        }
    }

    renderStack() {
        const container = document.getElementById('crateWorkbench');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (this.stack.length === 0) {
            container.innerHTML = `
                <div class="empty-workbench-state">
                    <i class="fas fa-layer-group"></i>
                    <p>Drag songs here to build your stack</p>
                    <span class="empty-hint">Tip: Hold and drag to reorder</span>
                </div>`;
            return;
        }

        this.stack.forEach((track, index) => {
            const card = document.createElement('div');
            card.className = 'stack-card';
            card.draggable = true;
            card.dataset.index = index;
            
            // Drag events
            card.addEventListener('dragstart', (e) => this.handleDragStart(e, index));
            card.addEventListener('dragover', (e) => this.handleDragOver(e));
            card.addEventListener('drop', (e) => this.handleDrop(e, index));
            card.addEventListener('dragenter', (e) => this.handleDragEnter(e));
            card.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            
            // Calculate track number with leading zero
            const trackNum = String(index + 1).padStart(2, '0');
            
            card.innerHTML = `
                <div class="stack-number">${trackNum}</div>
                <div class="stack-grip"><i class="fas fa-grip-vertical"></i></div>
                <img src="${track.img}" class="stack-art" alt="${track.title}">
                <div class="stack-info">
                    <div class="stack-title">${track.title}</div>
                    <div class="stack-artist">${track.artist}</div>
                    ${track.duration ? `<div class="stack-duration">${this.formatDuration(track.duration)}</div>` : ''}
                </div>
                <div class="stack-actions">
                    <button class="btn-preview" onclick="workbench.previewTransition(${index})" title="Preview transition">
                        <i class="fas fa-headphones"></i>
                    </button>
                    <button class="btn-remove" onclick="workbench.removeFromStack(${index})" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
            
            container.appendChild(card);
        });
        
        // Update track count
        this.updateTrackCount();
    }

    // --- C. SEARCH LOGIC ---
    async searchTracks(query) {
        if (query.length < 2) {
            const resultsBox = document.getElementById('digResults');
            if (resultsBox) {
                resultsBox.innerHTML = `
                    <div class="search-empty">
                        <i class="fas fa-record-vinyl"></i>
                        <p>Start digging!</p>
                        <span class="search-hint">Type at least 2 characters to search</span>
                    </div>`;
            }
            return;
        }
        
        const resultsBox = document.getElementById('digResults');
        if (!resultsBox) return;

        // Check cache first
        if (this.searchCache[query]) {
            this.renderSearchResults(this.searchCache[query]);
            return;
        }

        // Show loading state
        resultsBox.innerHTML = '<div class="search-loading"><i class="fas fa-spinner fa-spin"></i> Digging...</div>';

        try {
            const token = await auth.currentUser.getIdToken();
            
            // Prefix with 's:' to search songs only
            const searchQuery = query.startsWith('s:') ? query : `s:${query}`;
            
            const res = await fetch(`/player/api/search?q=${encodeURIComponent(searchQuery)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            console.log('🔍 Search results:', data.results);
            
            // Cache results
            this.searchCache[query] = data.results;
            
            this.renderSearchResults(data.results);

        } catch (e) {
            console.error("Search failed", e);
            resultsBox.innerHTML = '<div class="search-error"><i class="fas fa-exclamation-triangle"></i> Search failed</div>';
        }
    }

    renderSearchResults(results) {
        const resultsBox = document.getElementById('digResults');
        resultsBox.innerHTML = '';
        
        // Filter only Songs
        const songs = results.filter(r => r.type === 'song');
        
        if (songs.length === 0) {
            resultsBox.innerHTML = `
                <div class="search-empty">
                    <i class="fas fa-music"></i>
                    <p>No tracks found</p>
                    <span class="search-hint">Try a different search</span>
                </div>`;
            return;
        }

        songs.forEach(track => {
            const div = document.createElement('div');
            div.className = 'workbench-result-card';
            
            // Check if already in stack
            const inStack = this.stack.some(t => t.id === track.id);
            
            // Make entire card draggable
            div.draggable = !inStack;
            if (!inStack) {
                div.addEventListener('dragstart', (e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('application/json', JSON.stringify(track));
                });
            }
            
            // Ensure audioUrl exists before allowing cue
            const canCue = track.audioUrl && !inStack;
            
            div.innerHTML = `
                <div class="wb-card-left">
                    <img src="${track.img || '/images/placeholder.png'}" 
                         class="wb-mini-art" 
                         alt="${track.title}"
                         loading="lazy">
                    <div class="wb-info">
                        <span class="wb-title">${track.title}</span>
                        <span class="wb-artist">${track.subtitle || track.artist || 'Unknown'}</span>
                        ${track.duration ? `<span class="wb-duration">${this.formatDuration(track.duration)}</span>` : ''}
                    </div>
                </div>
                <div class="wb-actions">
                    <button class="btn-cue ${!canCue ? 'disabled' : ''}" 
                            ${canCue ? `onmousedown="workbench.cueTrack('${track.audioUrl}', '${track.title.replace(/'/g, "\\'")}')" 
                            onmouseup="workbench.stopCue()"` : ''}
                            title="${inStack ? 'Already in crate' : canCue ? 'Preview (hold)' : 'No audio URL'}">
                        <i class="fas fa-${inStack ? 'check' : 'headphones'}"></i>
                    </button>
                    <button class="btn-add-to-stack ${inStack ? 'disabled' : ''}" 
                            ${!inStack ? `onclick='workbench.addToStack(${JSON.stringify(track).replace(/'/g, "&#39;")})'` : ''}
                            title="${inStack ? 'Already in crate' : 'Add to crate'}">
                        <i class="fas fa-${inStack ? 'check' : 'plus'}"></i>
                    </button>
                </div>
            `;
            
            resultsBox.appendChild(div);
        });
    }
    
    // --- D. SAVE LOGIC ---
    async saveCrate() {
        if (this.stack.length === 0) {
            this.showToast('Add some songs first!', 'warning');
            return;
        }
        
        const titleInput = document.querySelector('.crate-title-input');
        const title = titleInput?.value.trim();
        
        if (!title) {
            this.showToast('Please name your crate', 'warning');
            titleInput?.focus();
            return;
        }

        const btn = document.querySelector('.btn-save-crate');
        const oldText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        btn.disabled = true;

        try {
            const token = await auth.currentUser.getIdToken();
            const formData = new FormData();
            formData.append('title', title);
            formData.append('tracks', JSON.stringify(this.stack));
            formData.append('privacy', 'public');
            
            // Add metadata
            const metadata = {
                trackCount: this.stack.length,
                totalDuration: this.calculateTotalDuration(),
                genres: Object.keys(this.genreMap),
                avgBpm: this.calculateAvgBpm()
            };
            formData.append('metadata', JSON.stringify(metadata));

            // Add cover image if present
            if (this.coverFile) {
                formData.append('coverImage', this.coverFile);
            } else if (this.coverImage) {
                // If editing and keeping existing cover
                formData.append('existingCoverUrl', this.coverImage);
            }

            // Determine if creating or updating
            let url = '/player/api/crate/create';
            let method = 'POST';
            
            if (this.editMode && this.currentCrateId) {
                url = `/player/api/crate/update/${this.currentCrateId}`;
                method = 'PUT';
            }

            const res = await fetch(url, {
                method: method,
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const data = await res.json();
            
            if (data.success) {
                const message = this.editMode ? 'Crate updated! 🎉' : 'Crate saved! 🎉';
                this.showToast(message, 'success');
                
                // Reload user's crates
                await this.loadUserCrates();
                
                // Reset after delay
                setTimeout(() => {
                    this.newCrate(); // Use newCrate to properly reset everything
                }, 1500);
            } else {
                this.showToast('Error: ' + (data.error || 'Save failed'), 'error');
            }
        } catch (e) {
            console.error(e);
            this.showToast('Save failed - please try again', 'error');
        } finally {
            btn.innerHTML = oldText;
            btn.disabled = false;
        }
    }

    // --- E. DNA ANALYTICS ---
    updateDNA() {
        const bpmEl = document.getElementById('avgBpm');
        const energyBar = document.getElementById('energyBar');
        const trackCountEl = document.getElementById('trackCount');
        const durationEl = document.getElementById('totalDuration');
        const genreCloud = document.getElementById('crateTags');
        
        if (this.stack.length === 0) {
            if (bpmEl) bpmEl.textContent = '--';
            if (energyBar) energyBar.style.width = '0%';
            if (trackCountEl) trackCountEl.textContent = '0';
            if (durationEl) durationEl.textContent = '0:00';
            if (genreCloud) genreCloud.innerHTML = '<span class="tag-placeholder">No genres yet</span>';
            return;
        }
        
        // Calculate average BPM (placeholder - would need actual BPM data)
        const avgBpm = this.calculateAvgBpm();
        if (bpmEl) bpmEl.textContent = avgBpm;
        
        // Energy visualization (based on track count and variety)
        const energy = Math.min(100, (this.stack.length / 20) * 100);
        if (energyBar) {
            energyBar.style.width = `${energy}%`;
            energyBar.style.background = this.getEnergyColor(energy);
        }
        
        // Track count
        if (trackCountEl) trackCountEl.textContent = this.stack.length;
        
        // Total duration
        const totalDuration = this.calculateTotalDuration();
        if (durationEl) durationEl.textContent = this.formatDuration(totalDuration);
        
        // Genre cloud
        if (genreCloud) {
            this.renderGenreCloud(genreCloud);
        }
    }

    calculateAvgBpm() {
        // Placeholder - would calculate from actual track BPM data
        // For now, return a reasonable range based on stack size
        return this.stack.length > 0 ? Math.floor(118 + Math.random() * 15) : 0;
    }

    calculateTotalDuration() {
        return this.stack.reduce((sum, track) => {
            const dur = parseFloat(track.duration) || 0;
            return sum + dur;
        }, 0);
    }

    getEnergyColor(energy) {
        if (energy < 30) return 'var(--primary)';
        if (energy < 70) return 'var(--accent-orange)';
        return '#e74c3c';
    }

    renderGenreCloud(container) {
        container.innerHTML = '';
        
        const genres = Object.entries(this.genreMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6); // Top 6 genres
        
        if (genres.length === 0) {
            container.innerHTML = '<span class="tag-placeholder">No genres yet</span>';
            return;
        }
        
        genres.forEach(([genre, count]) => {
            const tag = document.createElement('span');
            tag.className = 'genre-tag';
            tag.textContent = `${genre} (${count})`;
            tag.style.fontSize = `${0.75 + (count / this.stack.length) * 0.5}rem`;
            container.appendChild(tag);
        });
    }

    // --- F. TRANSITION PREVIEW ---
    async previewTransition(index) {
        if (index >= this.stack.length - 1) {
            this.showToast('No next track to preview', 'info');
            return;
        }
        
        const currentTrack = this.stack[index];
        const nextTrack = this.stack[index + 1];
        
        this.showToast(`Previewing: ${currentTrack.title} → ${nextTrack.title}`, 'info');
        
        // TODO: Implement actual transition preview
        // Would play last 10s of current + first 10s of next
    }

    // --- G. DRAG & DROP HANDLERS ---
    handleDragStart(e, index) {
        this.draggedItem = index;
        e.dataTransfer.effectAllowed = 'move';
        e.target.style.opacity = '0.5';
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    handleDragEnter(e) {
        const card = e.target.closest('.stack-card');
        if (card && this.draggedItem !== null) {
            card.classList.add('drag-over');
        }
    }

    handleDragLeave(e) {
        const card = e.target.closest('.stack-card');
        if (card) {
            card.classList.remove('drag-over');
        }
    }

    handleDrop(e, targetIndex) {
        e.preventDefault();
        
        const card = e.target.closest('.stack-card');
        if (card) card.classList.remove('drag-over');
        
        // Check if dropping from search results
        const jsonData = e.dataTransfer.getData('application/json');
        if (jsonData) {
            try {
                const track = JSON.parse(jsonData);
                this.addToStack(track);
            } catch (err) {
                console.error('Drop error:', err);
            }
            return;
        }
        
        // Reordering within stack
        if (this.draggedItem !== null && this.draggedItem !== targetIndex) {
            this.moveTrack(this.draggedItem, targetIndex);
        }
        
        this.draggedItem = null;
        
        // Reset opacity
        document.querySelectorAll('.stack-card').forEach(c => c.style.opacity = '1');
    }

    // --- H. UTILITIES ---
    formatDuration(seconds) {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    updateTrackCount() {
        const countEl = document.querySelector('.stack-count');
        if (countEl) {
            countEl.textContent = `${this.stack.length} tracks`;
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `workbench-toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${this.getToastIcon(type)}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    getToastIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    // --- NEW: CRATE MANAGEMENT ---
    async loadUserCrates() {
        try {
            if (!auth.currentUser) {
                console.log('No user logged in, skipping crate load');
                return;
            }

            const token = await auth.currentUser.getIdToken();
            const uid = auth.currentUser.uid;
            
            const res = await fetch(`/player/api/crates/user/${uid}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await res.json();
            this.userCrates = data.crates || [];
            this.renderCrateMenu();
            
        } catch (e) {
            console.error('Error loading crates:', e);
        }
    }

    renderCrateMenu() {
        const menu = document.getElementById('userCratesList');
        if (!menu) return;

        if (!this.userCrates || this.userCrates.length === 0) {
            menu.innerHTML = `
                <div class="no-crates">
                    <i class="fas fa-box-open"></i>
                    <p>No crates yet</p>
                    <span>Create your first crate!</span>
                </div>
            `;
            return;
        }

        menu.innerHTML = this.userCrates.map(crate => `
            <div class="crate-menu-item" onclick="window.workbench.loadCrateForEditing('${crate.id}')">
                <div class="crate-menu-item-header">
                    <span class="crate-menu-item-title">${crate.title}</span>
                    <span class="crate-menu-item-date">${this.formatDate(crate.createdAt)}</span>
                </div>
                <div class="crate-menu-item-meta">
                    <span><i class="fas fa-music"></i> ${crate.trackCount || 0} tracks</span>
                    <span><i class="fas fa-heart"></i> ${crate.likes || 0} likes</span>
                </div>
            </div>
        `).join('');
    }

    toggleCrateMenu() {
        const menu = document.getElementById('crateLoadMenu');
        if (!menu) return;
        
        menu.classList.toggle('active');
        
        // Reload crates when opening
        if (menu.classList.contains('active')) {
            this.loadUserCrates();
        }
    }

    async loadCrateForEditing(crateId) {
        try {
            // Close the menu
            this.toggleCrateMenu();
            
            // Show loading
            this.showToast('Loading crate...', 'info');
            
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/crate/${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await res.json();
            
            if (!data.tracks) {
                this.showToast('Error loading crate', 'error');
                return;
            }

            // Set edit mode
            this.editMode = true;
            this.currentCrateId = crateId;
            
            // Populate title
            const titleInput = document.getElementById('crateTitleInput');
            if (titleInput) titleInput.value = data.title;
            
            // Populate tracks
            this.stack = data.tracks.map(track => ({
                id: track.id,
                title: track.title,
                artist: track.artist,
                img: track.artUrl || track.img,
                audioUrl: track.audioUrl,
                duration: track.duration,
                genre: track.genre
            }));
            
            // Load cover image if exists
            if (data.coverImage) {
                this.loadCoverImage(data.coverImage);
            }
            
            // Update genres
            this.genreMap = {};
            this.stack.forEach(track => {
                if (track.genre) {
                    this.genreMap[track.genre] = (this.genreMap[track.genre] || 0) + 1;
                }
            });
            
            // Re-render everything
            this.renderStack();
            this.updateDNA();
            
            // Update save button text
            const saveBtn = document.getElementById('saveCrateBtn');
            if (saveBtn) {
                saveBtn.querySelector('span').textContent = 'Update';
            }
            
            this.showToast('Crate loaded for editing', 'success');
            
        } catch (e) {
            console.error('Load crate error:', e);
            this.showToast('Failed to load crate', 'error');
        }
    }

    newCrate() {
        if (this.stack.length > 0) {
            if (!confirm('Start a new crate? Current progress will be lost.')) {
                return;
            }
        }
        
        // Reset everything
        this.editMode = false;
        this.currentCrateId = null;
        this.stack = [];
        this.genreMap = {};
        this.coverImage = null;
        
        // Clear UI
        const titleInput = document.getElementById('crateTitleInput');
        if (titleInput) titleInput.value = '';
        
        this.removeCover();
        this.renderStack();
        this.updateDNA();
        
        // Reset save button
        const saveBtn = document.getElementById('saveCrateBtn');
        if (saveBtn) {
            saveBtn.querySelector('span').textContent = 'Save';
        }
        
        this.showToast('New crate started', 'success');
    }

    // --- NEW: COVER IMAGE UPLOAD ---
    async handleCoverUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            this.showToast('Please upload an image file', 'error');
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            this.showToast('Image must be under 5MB', 'error');
            return;
        }

        // Preview the image immediately
        const reader = new FileReader();
        reader.onload = (e) => {
            this.coverImage = e.target.result;
            this.displayCoverPreview(e.target.result);
        };
        reader.readAsDataURL(file);

        // Store file for upload
        this.coverFile = file;
        
        this.showToast('Cover image added', 'success');
    }

    displayCoverPreview(imageUrl) {
        const preview = document.getElementById('coverPreview');
        const removeBtn = document.getElementById('removeCoverBtn');
        
        if (!preview) return;

        preview.innerHTML = `<img src="${imageUrl}" alt="Crate cover">`;
        preview.classList.add('has-image');
        
        // Show remove button
        if (removeBtn) {
            removeBtn.style.display = 'flex';
        }

        // Make preview clickable to change image
        preview.onclick = () => {
            document.getElementById('coverUploadInput').click();
        };
    }

    loadCoverImage(imageUrl) {
        this.coverImage = imageUrl;
        this.displayCoverPreview(imageUrl);
    }

    removeCover() {
        this.coverImage = null;
        this.coverFile = null;
        
        const preview = document.getElementById('coverPreview');
        const removeBtn = document.getElementById('removeCoverBtn');
        const input = document.getElementById('coverUploadInput');
        
        if (preview) {
            preview.innerHTML = `
                <div class="cover-placeholder">
                    <i class="fas fa-box-open"></i>
                    <p>No cover yet</p>
                    <span class="cover-hint">Click to upload</span>
                </div>
            `;
            preview.classList.remove('has-image');
            preview.onclick = () => {
                document.getElementById('coverUploadInput').click();
            };
        }
        
        if (removeBtn) {
            removeBtn.style.display = 'none';
        }
        
        if (input) {
            input.value = '';
        }
    }

    // Helper to format dates
    formatDate(timestamp) {
        if (!timestamp) return 'Unknown';
        
        let date;
        if (timestamp.toDate) {
            date = timestamp.toDate(); // Firestore timestamp
        } else if (timestamp._seconds) {
            date = new Date(timestamp._seconds * 1000);
        } else {
            date = new Date(timestamp);
        }
        
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        return date.toLocaleDateString();
    }
}