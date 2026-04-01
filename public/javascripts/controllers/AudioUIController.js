/* public/javascripts/controllers/AudioUIController.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export class AudioUIController {
    constructor(mainUI) {
        this.mainUI = mainUI;
        this.engine = mainUI.engine;
        this.auth = getAuth();
        this.settingsSaveTimeout = null;

        // Bind queue actions to window.ui so HTML onclicks work
        window.ui.playQueueIndex = this.playQueueIndex.bind(this);
        window.ui.removeFromQueue = this.removeFromQueue.bind(this);

        // Bind global window functions
        window.togglePlay = () => this.engine.togglePlay();
        window.addToQueue = this.addToQueue.bind(this);
        window.playAllFavorites = this.playAllFavorites.bind(this);
        window.playAnthem = this.playAnthem.bind(this);
        window.toggleSongLike = this.toggleSongLike.bind(this);
        window.updateSetting = this.updateGlobalSetting.bind(this);
        window.updateEQ = this.updateEQ.bind(this);
        window.resetEQ = this.resetEQ.bind(this);
        window.sendCmd = this.sendCmd.bind(this);
        window.skipForward = (sec = 10) => { this.engine.skipForward(sec); this.mainUI.showToast(`⏩ +${sec}s`); };
        window.skipBackward = (sec = 10) => { this.engine.skipBackward(sec); this.mainUI.showToast(`⏪ -${sec}s`); };
        window.shuffleQueue = this.shuffleQueue.bind(this);
        window.clearQueue = this.clearQueue.bind(this);
        window.showStats = this.showPlaybackStats.bind(this);

        // Audio output device management (used by the settings panel)
        window.refreshOutputDevices  = this.refreshOutputDevices.bind(this);
        window.applyMainOutputDevice = this.applyMainOutputDevice.bind(this);
        window.applyCueOutputDevice  = this.applyCueOutputDevice.bind(this);

        // Up Next panel toggle
        window.toggleUpNext = this.toggleUpNext.bind(this);

        // Initialize Listeners
        this.setupEnhancedAudioListeners();
        this.setupSeekbar();
        this.setupKeyboardShortcuts();
    }

    // ==========================================
    // 1. ENGINE EVENT LISTENERS
    // ==========================================
    
    setupEnhancedAudioListeners() {
        this.engine.on('stateChange', (data) => {
            this.updatePlayPauseIcons(data.isPlaying);
            this.updatePlayerUI(data.track);
            if (data.isPlaying && this.mainUI.isMinimized) this.mainUI.togglePlayerSize();
        });

        this.engine.on('progress', (data) => this.updateProgressBar(data));

        this.engine.on('bufferStart', (data) => {
            this.showBuffering(true);
        });

        this.engine.on('bufferEnd', (data) => {
            this.showBuffering(false);
        });

        this.engine.on('preloadComplete', (data) => {
            this.markTrackAsPreloaded(data.track.id);
        });

        this.engine.on('trackEnd', (data) => {
            this.onTrackEnd(data.track);
        });

        this.engine.on('error', (data) => {
            this.mainUI.showToast(`Error playing ${data.track?.title || 'track'}`, 'error');
            console.error('Playback error:', data.error);
        });

        this.engine.on('queueUpdate', (queue) => {
            this.updateQueueUI(queue, this.engine.history);
            this.updateQueueCount(queue.length);
        });

        this.engine.on('historyUpdate', (history) => {
            this.updateQueueUI(this.engine.queue, history);
        });
    }

    // Track shuffle state for the toggle button
    get shuffleActive() { return this._shuffleActive || false; }
    set shuffleActive(v) {
        this._shuffleActive = v;
        const btn = document.getElementById('shuffleToggleBtn');
        if (btn) btn.classList.toggle('active', v);
    }

    //test
    // ==========================================
    // 2. PLAYER UI UPDATES
    // ==========================================

    updatePlayerUI(track) {
        if(!track) return;

        // 1. Update Title
        document.querySelectorAll('#d-title-full, #d-title-mini').forEach(el => el.innerText = track.title);
        
        // 2. Update Artist & Make it Clickable
        document.querySelectorAll('#d-artist-full, #d-artist-mini').forEach(el => {
            el.innerText = track.artist;
            
            if (track.artistId) {
                // Make it look like a link
                el.style.cursor = 'pointer';
                el.style.transition = 'color 0.2s ease';
                
                // Add hover effect dynamically (or use a CSS class)
                el.onmouseenter = () => el.style.color = 'var(--primary)';
                el.onmouseleave = () => el.style.color = '';

                el.onclick = (e) => {
                    e.stopPropagation(); // Prevent the mini-player from expanding when clicked
                    
                    // Navigate to the artist profile
                    if (window.navigateTo) {
                        window.navigateTo(`/player/artist/${track.artistId}`);
                    }
                    
                    // If the full player is currently open, minimize it so they can see the profile!
                    if (this.mainUI && !this.mainUI.isMinimized) {
                        this.mainUI.togglePlayerSize();
                    }
                };
            } else {
                // Reset if no artistId is available
                el.style.cursor = 'default';
                el.onmouseenter = null;
                el.onmouseleave = null;
                el.onclick = null;
            }
        });
        
        // 3. Update Duration
        if (track.duration) {
            const timeString = this.formatTime(track.duration);
            const totalEl = document.getElementById('totalTime');
            if (totalEl) totalEl.innerText = timeString;
        }

        // 4. Update Album Art
        const artElements = document.querySelectorAll('#d-art-full, #d-art-mini');
        if (track.artUrl && track.artUrl !== 'null') {
            artElements.forEach(el => {
                el.style.backgroundImage = `url('${track.artUrl}')`;
                if(el.id === 'd-art-full') el.style.backgroundSize = 'cover';
                el.classList.remove('art-placeholder');
            });
        }

        // 5. Hydrate Heart Icon
        const heartIcon = document.querySelector('.player-full .fa-heart') || document.querySelector('.mp-controls .fa-heart');
        if (heartIcon) {
            this.checkSongLikeStatus(track.id, heartIcon);
        }
        
        // 6. Update Quality Badge
        this.updateQualityBadge(track);
    }

    updatePlayPauseIcons(isPlaying) {
        document.querySelectorAll('.fa-play, .fa-pause').forEach(icon => {
            if (icon.parentElement.matches('.btn-play-hero, .btn-play-mini, .mp-play, .mini-play-btn')) {
                icon.classList.toggle('fa-pause', isPlaying);
                icon.classList.toggle('fa-play', !isPlaying);
            }
        });

        // Also target by ID for the mini player icon specifically
        const miniIcon = document.getElementById('miniPlayIcon');
        if (miniIcon) {
            miniIcon.classList.toggle('fa-pause', isPlaying);
            miniIcon.classList.toggle('fa-play', !isPlaying);
        }
    }

    showBuffering(isBuffering) {
        const spinner = document.getElementById('bufferingSpinner');
        const playBtn = document.getElementById('playPauseBtn');
        
        if (spinner) spinner.style.display = isBuffering ? 'block' : 'none';
        
        if (playBtn) {
            if (isBuffering) playBtn.classList.add('loading');
            else playBtn.classList.remove('loading');
        }
    }

    updateQualityBadge(track) {
        const badge = document.getElementById('qualityBadge');
        if (!badge) return;

        // Resolve raw format string from track metadata or URL
        let format = track.quality || 'MP3';
        if (!track.quality && track.audioUrl) {
            if      (track.audioUrl.match(/\.flac/i))       format = 'FLAC';
            else if (track.audioUrl.match(/\.m4a|alac/i))   format = 'ALAC';
            else if (track.audioUrl.match(/\.wav/i))        format = 'WAV';
            else if (track.audioUrl.match(/320/))            format = '320K';
            else if (track.audioUrl.match(/192/))            format = '192K';
            else                                             format = 'MP3';
        }

        // Map every possible format to one of three visual tiers:
        //   lossless  — FLAC / WAV / ALAC   (teal glow)
        //   high      — 320K / HQ            (blue tint)
        //   standard  — MP3 / 192K / default (subtle muted)
        const LOSSLESS = ['flac', 'wav', 'alac', 'aiff'];
        const HIGH     = ['320k', '320', 'hq', 'hd'];
        const fmtLower = format.toLowerCase();

        let tier;
        if (LOSSLESS.some(t => fmtLower.includes(t)))  tier = 'lossless';
        else if (HIGH.some(t => fmtLower.includes(t))) tier = 'high';
        else                                            tier = 'standard';

        badge.textContent   = format.toUpperCase();
        badge.className     = `quality-badge quality-${tier}`;
        badge.dataset.tier  = tier;
        badge.style.display = 'inline-flex';
    }

    // ==========================================
    // 3. PROGRESS BAR & SEEKING
    // ==========================================

    setupSeekbar() {
        const progressContainer = document.querySelector('.progress-track') || document.getElementById('progressBar')?.parentElement;
        
        if (progressContainer) {
            progressContainer.style.cursor = 'pointer';
            progressContainer.addEventListener('click', (e) => {
                if (!this.engine.currentTrack) return;
                
                const rect = progressContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const pct = Math.max(0, Math.min(1, clickX / rect.width)); 
                
                const seekTime = pct * this.engine.trackDuration;
                this.engine.seek(seekTime);
                
                this.updateProgressBar({ progress: pct, currentTime: seekTime });
            });
        }
    }

    updateProgressBar({ progress, currentTime, duration, buffering }) {
        const pct = `${progress * 100}%`;

        // Full player progress bar
        const bar = document.getElementById('progressBar');
        if (bar) {
            bar.style.width = pct;
            if (buffering) bar.classList.add('buffering');
            else bar.classList.remove('buffering');
        }

        // Mini player progress bar — synced independently so it works
        // even when the full player is hidden (display:none)
        const miniBar = document.getElementById('progressBarMini');
        if (miniBar) miniBar.style.width = pct;

        const timeEl = document.getElementById('currentTime');
        if (timeEl) timeEl.innerText = this.formatTime(currentTime);

        if (duration) {
            const durationEl = document.getElementById('totalTime');
            if (durationEl) durationEl.innerText = this.formatTime(duration);
        }
    }

    // ==========================================
    // 4. QUEUE MANAGEMENT
    // ==========================================

    addToQueue(id, title, artist, artUrl, audioUrl, duration) {
        if(event) event.stopPropagation();
        this.engine.addToQueue({ id, title, artist, artUrl, audioUrl, duration });
        this.mainUI.showToast(`Added to Queue: ${title}`);
    }

    updateQueueUI(queue, history) {
        const container = document.getElementById('queueList');
        if (!container) return;

        const hist = history || this.engine.history || [];
        const q    = queue  || this.engine.queue    || [];

        let html = '';

        // ── History section ──────────────────────────────────────────────
        if (hist.length > 0) {
            html += `
                <div class="queue-section-header">
                    <i class="fas fa-history"></i>
                    <span>Recently Played</span>
                    <span class="queue-section-count">${hist.length}</span>
                    <button class="queue-section-clear" onclick="window.audioEngine.clearHistory()" title="Clear history">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`;

            // Show most recent first (reverse without mutating)
            [...hist].reverse().forEach((track, i) => {
                const origIndex = hist.length - 1 - i;
                html += `
                <div class="queue-item queue-item--history"
                     title="Go back to ${track.title}"
                     onclick="window.audioEngine.history.splice(${origIndex + 1}); window.audioEngine.play('${track.id}', ${JSON.stringify(track).replace(/'/g, '&#39;')}, {addToHistory:false})">
                    <div class="queue-item-hist-icon"><i class="fas fa-history"></i></div>
                    <img src="${this.mainUI.fixImageUrl(track.artUrl || track.img)}"
                         class="queue-item-art"
                         alt="${track.title}"
                         onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2236%22 height=%2236%22%3E%3Crect width=%2236%22 height=%2236%22 fill=%22%23333%22 rx=%224%22/%3E%3C/svg%3E'">
                    <div class="queue-item-info">
                        <div class="queue-item-title">${track.title}</div>
                        <div class="queue-item-artist">${track.artist || ''}</div>
                    </div>
                    <div class="queue-item-duration">${this.formatTime(track.duration)}</div>
                </div>`;
            });
        }

        // ── Up Next section ──────────────────────────────────────────────
        if (q.length > 0) {
            html += `
                <div class="queue-section-header">
                    <i class="fas fa-list-ul"></i>
                    <span>Up Next</span>
                    <span class="queue-section-count">${q.length}</span>
                    <button class="queue-section-clear" onclick="window.clearQueue()" title="Clear queue">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`;

            q.forEach((track, index) => {
                html += `
                <div class="queue-item" data-track-id="${track.id}" onclick="window.ui.playQueueIndex(${index})">
                    <div class="queue-item-drag-handle"><i class="fas fa-grip-vertical"></i></div>
                    <img src="${this.mainUI.fixImageUrl(track.artUrl || track.img)}"
                         class="queue-item-art"
                         alt="${track.title}"
                         onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2236%22 height=%2236%22%3E%3Crect width=%2236%22 height=%2236%22 fill=%22%23333%22 rx=%224%22/%3E%3C/svg%3E'">
                    <div class="queue-item-info">
                        <div class="queue-item-title">${track.title}</div>
                        <div class="queue-item-artist">${track.artist || ''}</div>
                    </div>
                    <div class="queue-item-actions">
                        <span class="preload-status" id="preload-${track.id}">
                            <i class="fas fa-circle-notch fa-spin" style="display:none"></i>
                            <i class="fas fa-check-circle" style="display:none; color:var(--primary)"></i>
                        </span>
                        <button onclick="event.stopPropagation(); window.ui.removeFromQueue(${index})" class="btn-icon">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="queue-item-duration">${this.formatTime(track.duration)}</div>
                </div>`;
            });
        }

        if (!html) {
            html = '<div class="empty-queue">Add tracks to the queue to see them here</div>';
        }

        container.innerHTML = html;
    }

    markTrackAsPreloaded(trackId) {
        const statusEl = document.getElementById(`preload-${trackId}`);
        if (!statusEl) return;
        const spinner = statusEl.querySelector('.fa-spin');
        const check = statusEl.querySelector('.fa-check-circle');
        if (spinner) spinner.style.display = 'none';
        if (check) check.style.display = 'inline';
    }

    updateQueueCount(count) {
        // Update both the full-player Up Next badge and the mini player badge
        ['queueCountBadge', 'queueCountBadgeMini'].forEach(id => {
            const badge = document.getElementById(id);
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'flex' : 'none';
            }
        });
    }

    playQueueIndex(index) {
        if (index < 0 || index >= this.engine.queue.length) return;
        const track = this.engine.queue[index];
        this.engine.queue.splice(0, index + 1);
        this.engine.play(track.id, track);
    }

    removeFromQueue(index) {
        const removed = this.engine.removeFromQueue(index);
        if (removed) this.mainUI.showToast(`Removed ${removed.title} from queue`);
    }

    shuffleQueue() {
        if (this.engine.queue.length < 2) {
            this.mainUI.showToast('Need at least 2 tracks to shuffle');
            return;
        }
        this.engine.shuffleQueue();
        this.shuffleActive = !this.shuffleActive;
        this.mainUI.showToast(this.shuffleActive ? '🔀 Shuffle on' : '🔀 Shuffle off');
    }

    toggleUpNext() {
        const body    = document.getElementById('upNextBody');
        const chevron = document.getElementById('upNextChevron');
        const panel   = document.getElementById('upNextPanel');
        if (!body) return;

        const isOpen = body.classList.toggle('open');
        if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
        if (panel)   panel.classList.toggle('expanded', isOpen);

        // Render the current state when first opened
        if (isOpen) this.updateQueueUI(this.engine.queue, this.engine.history);
    }

    clearQueue() {
        if (this.engine.queue.length === 0) return this.mainUI.showToast('Queue is already empty');
        if (confirm(`Clear all ${this.engine.queue.length} tracks from queue?`)) {
            this.engine.clearQueue();
            this.mainUI.showToast('Queue cleared');
        }
    }

    onTrackEnd(track) {
        if (window.logTrackCompletion) window.logTrackCompletion(track.id);
    }

    sendCmd(cmd) {
        if (cmd === 'next') {
            this.engine.playNext();
            this.mainUI.showToast('Skipping ⏭️');
        } else if (cmd === 'prev') {
            this.engine.playPrevious();
        }
    }

    // ==========================================
    // 5. PLAYBACK SHORTCUTS & STATS
    // ==========================================

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea')) return;
            
            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    this.engine.togglePlay();
                    break;
                case 'ArrowRight':
                    if (e.shiftKey) { this.engine.playNext(); this.mainUI.showToast('⏭️ Next track'); } 
                    else { this.engine.skipForward(10); }
                    break;
                case 'ArrowLeft':
                    if (e.shiftKey) { this.engine.replay(); this.mainUI.showToast('⏮️ Restart'); } 
                    else { this.engine.skipBackward(10); }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    const currentVol = this.engine.masterBus.gain.value;
                    this.engine.setVolume(Math.min(currentVol + 0.1, 1));
                    this.mainUI.showToast(`🔊 Volume: ${Math.round((currentVol + 0.1) * 100)}%`);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    const vol = this.engine.masterBus.gain.value;
                    this.engine.setVolume(Math.max(vol - 0.1, 0));
                    this.mainUI.showToast(`🔉 Volume: ${Math.round((vol - 0.1) * 100)}%`);
                    break;
            }
        });
    }

    showPlaybackStats() {
        const stats = this.engine.getStats();
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content stats-modal">
                <h2>📊 Playback Statistics</h2>
                <div class="stats-grid">
                    <div class="stat-item"><span class="stat-label">Total Plays</span><span class="stat-value">${stats.totalPlays}</span></div>
                    <div class="stat-item"><span class="stat-label">Listen Time</span><span class="stat-value">${this.formatTime(stats.totalListenTime)}</span></div>
                    <div class="stat-item"><span class="stat-label">Cached Tracks</span><span class="stat-value">${stats.cacheSize} / ${this.engine.maxCacheSize}</span></div>
                    <div class="stat-item"><span class="stat-label">Queue Length</span><span class="stat-value">${stats.queueLength}</span></div>
                    <div class="stat-item"><span class="stat-label">Currently Playing</span><span class="stat-value">${stats.currentTrack ? stats.currentTrack.title : 'None'}</span></div>
                </div>
                <button class="btn-primary" onclick="this.closest('.modal-overlay').remove()">Close</button>
            </div>
        `;
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
    }

    showSupportedFormats() {
        const formatList = document.getElementById('supportedFormatsList');
        if (!formatList) return;
        const formats = this.engine.supportedFormats;
        const supported = Object.entries(formats).filter(([_, isSupported]) => isSupported).map(([format]) => format.toUpperCase());
        formatList.innerHTML = `<div class="settings-info"><i class="fas fa-info-circle"></i><span>Your browser supports: ${supported.join(', ')}</span></div>`;
    }

    // ==========================================
    // 6. FAVORITES & ANTHEM PLAYBACK
    // ==========================================

    async playAllFavorites() {
        if (!this.auth.currentUser) return;
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/favorites', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (data.songs && data.songs.length > 0) {
                const first = data.songs[0];
                window.playSong(first.id, first.title, first.artist, first.img, first.audioUrl, first.duration);
                for (let i = 1; i < data.songs.length; i++) {
                    const s = data.songs[i];
                    this.engine.addToQueue({ id: s.id, title: s.title, artist: s.artist, artUrl: s.img, audioUrl: s.audioUrl, duration: s.duration });
                }
                this.mainUI.showToast(`Playing ${data.songs.length} Liked Songs`);
            }
        } catch (e) { console.error(e); }
    }

    playAnthem() {
        const card = document.getElementById('anthemPlayer');
        if (!card || !card.dataset.songId) return this.mainUI.showToast('No anthem set yet.');
        
        // dataset values were written by loadAnthemCard after fixImageUrl,
        // but double-fix here as a safety net for any legacy data-* values
        // that may already be in the DOM from a server-side render.
        const artUrl  = this.mainUI.fixImageUrl(card.dataset.songImg);
        const audioUrl = this.mainUI.fixImageUrl(card.dataset.audioUrl);

        this.engine.play(card.dataset.songId, {
            title: card.dataset.songTitle,
            artist: card.dataset.songArtist,
            artUrl,
            audioUrl,
            duration: parseFloat(card.dataset.duration) || 0
        });
    }

    // ==========================================
    // 7. SETTINGS & EQ
    // ==========================================

    updateGlobalSetting(key, value) {
        if (!window.globalUserCache) window.globalUserCache = {};
        if (!window.globalUserCache.settings) window.globalUserCache.settings = {};
        
        window.globalUserCache.settings[key] = value;
        this.engine.updateSettings(window.globalUserCache.settings);
        
        if (key === 'theme') {
            this.mainUI.applyGenreTheme(value);
            this.mainUI.showToast(`Theme changed to ${value}`, 'success');
        }
        
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = "Save Changes"; saveBtn.style.opacity = "1"; }
        
        clearTimeout(this.settingsSaveTimeout);
        this.settingsSaveTimeout = setTimeout(() => this.saveSettings(), 1000);
    }

    async saveSettings() {
        const btn = document.getElementById('saveSettingsBtn');
        if (btn) { btn.innerText = "Saving..."; btn.disabled = true; }

        try {
            const token = await this.auth.currentUser.getIdToken();
            await fetch('/player/api/settings/save', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(window.globalUserCache.settings)
            });
            
            if (btn) {
                btn.innerText = "Saved!";
                setTimeout(() => { btn.innerText = "Save Changes"; }, 2000);
            }
            this.mainUI.showToast("Settings saved.");
        } catch (e) {
            console.error("Save Error:", e);
            this.mainUI.showToast("Failed to save settings.");
            if (btn) btn.disabled = false;
        }
    }

    async loadSettingsPage(container) {
        container.dataset.hydrated = "true";
        const emailEl = document.getElementById('settingsEmail');
        if (emailEl && this.auth.currentUser?.email) emailEl.innerText = this.auth.currentUser.email;

        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) saveBtn.onclick = () => this.saveSettings();

        // ── Tab switching — must be a window global because the pug onclick
        //    attrs are baked into the DOM on first render and call this by name.
        //    Re-assigned here on every settings navigation to ensure it's live.
        window.switchSettingsTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => {
                el.style.display = 'none';
            });
            const target = document.getElementById('tab-' + tabName);
            if (target) target.style.display = 'block';
            document.querySelectorAll('.settings-tabs .tab-btn').forEach(el => el.classList.remove('active'));
            if (event?.currentTarget) event.currentTarget.classList.add('active');
        };

        // ── Modal helpers — set as window globals so pug onclick attrs work ─
        window.openPasswordModal = () => {
            const m = document.getElementById('passwordModal');
            if (m) { m.classList.add('is-open'); document.getElementById('currentPassword')?.focus(); }
        };
        window.closePasswordModal = () => {
            const m = document.getElementById('passwordModal');
            if (m) m.classList.remove('is-open');
            ['currentPassword','newPassword','confirmPassword'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            const err = document.getElementById('passwordError');
            if (err) err.style.display = 'none';
        };
        window.openDeleteModal = () => {
            const m = document.getElementById('deleteAccountModal');
            if (m) { m.classList.add('is-open'); document.getElementById('deleteConfirmInput')?.focus(); }
        };
        window.closeDeleteModal = () => {
            const m = document.getElementById('deleteAccountModal');
            if (m) m.classList.remove('is-open');
            const inp = document.getElementById('deleteConfirmInput'); if (inp) inp.value = '';
            const btn = document.getElementById('confirmDeleteBtn');
            if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; btn.style.cursor = 'not-allowed'; }
            const err = document.getElementById('deleteError'); if (err) err.style.display = 'none';
        };
        window.onDeleteInputChange = (input) => {
            const btn     = document.getElementById('confirmDeleteBtn');
            const isMatch = input.value === 'DELETE';
            if (btn) {
                btn.disabled       = !isMatch;
                btn.style.opacity  = isMatch ? '1' : '0.4';
                btn.style.cursor   = isMatch ? 'pointer' : 'not-allowed';
            }
            input.classList.toggle('is-valid', isMatch);
        };

        // Wire the Account tab buttons to the modal openers
        const pwBtn = document.getElementById('changePasswordBtn');
        if (pwBtn) pwBtn.onclick = () => window.openPasswordModal();
        const deleteBtn = document.getElementById('deleteAccountBtn');
        if (deleteBtn) deleteBtn.onclick = () => window.openDeleteModal();

        // Close modals on backdrop click
        ['passwordModal','deleteAccountModal'].forEach(id => {
            const m = document.getElementById(id);
            if (m) m.onclick = (e) => { if (e.target === m) m.classList.remove('is-open'); };
        });

        // ── Manage Billing → Stripe Customer Portal ──────────────────
        const billingBtn = document.getElementById('manageBillingBtn');
        if (billingBtn) {
            billingBtn.onclick = async () => {
                const orig = billingBtn.innerHTML;
                billingBtn.disabled = true;
                billingBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Opening…';
                try {
                    const token = await this.auth.currentUser.getIdToken();
                    const res   = await fetch('/members/api/create-portal-session', {
                        method:  'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data  = await res.json();
                    if (data.url) {
                        window.open(data.url, '_blank');
                    } else {
                        this.mainUI.showToast(data.error || 'Could not open billing portal.', 'error');
                    }
                } catch (e) {
                    console.error('Portal Error:', e);
                    this.mainUI.showToast('Could not open billing portal.', 'error');
                } finally {
                    billingBtn.disabled = false;
                    billingBtn.innerHTML = orig;
                }
            };
        }

        // ── Change Password ───────────────────────────────────────────
        window.submitPasswordChange = async () => {
            const currentPw  = document.getElementById('currentPassword')?.value?.trim();
            const newPw      = document.getElementById('newPassword')?.value?.trim();
            const confirmPw  = document.getElementById('confirmPassword')?.value?.trim();
            const errorEl    = document.getElementById('passwordError');
            const submitBtn  = document.getElementById('submitPasswordBtn');

            const showErr = (msg) => {
                if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
            };
            if (errorEl) errorEl.style.display = 'none';

            if (!currentPw || !newPw || !confirmPw) return showErr('Please fill in all fields.');
            if (newPw.length < 8) return showErr('New password must be at least 8 characters.');
            if (newPw !== confirmPw) return showErr('New passwords do not match.');

            const orig = submitBtn?.innerHTML;
            if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

            try {
                const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } =
                    await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
                const user       = this.auth.currentUser;
                const credential = EmailAuthProvider.credential(user.email, currentPw);
                await reauthenticateWithCredential(user, credential);
                await updatePassword(user, newPw);
                window.closePasswordModal?.();
                this.mainUI.showToast('Password updated successfully! 🔒');
            } catch (e) {
                console.error('Password Change Error:', e);
                const msg = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
                    ? 'Current password is incorrect.'
                    : e.code === 'auth/too-many-requests'
                    ? 'Too many attempts. Please try again later.'
                    : 'Failed to update password. Please try again.';
                showErr(msg);
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = orig; }
            }
        };

        // ── Delete Account ────────────────────────────────────────────
        window.submitDeleteAccount = async () => {
            const confirmInput = document.getElementById('deleteConfirmInput');
            const errorEl      = document.getElementById('deleteError');
            const confirmBtn   = document.getElementById('confirmDeleteBtn');

            if (confirmInput?.value !== 'DELETE') return;

            const showErr = (msg) => {
                if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
            };
            if (errorEl) errorEl.style.display = 'none';

            const orig = confirmBtn?.innerHTML;
            if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting…'; }

            try {
                const token = await this.auth.currentUser.getIdToken();
                const res   = await fetch('/members/api/account/delete', {
                    method:  'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data  = await res.json();
                if (data.success) {
                    await this.auth.signOut();
                    window.location.href = '/members/signin?deleted=1';
                } else {
                    throw new Error(data.error || 'Deletion failed');
                }
            } catch (e) {
                console.error('Delete Account Error:', e);
                showErr(e.message || 'Could not delete account. Please try again.');
                if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerHTML = orig; }
            }
        };

        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/settings', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            
            if (!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache = {
                ...window.globalUserCache, ...data,
                settings: { ...window.globalUserCache.settings, ...data.settings }
            };
            
            const settings = window.globalUserCache.settings || {};
            
            const setVal = (name, val) => {
                const el = document.querySelector(`[name="${name}"]`);
                if (!el) return;
                if (el.type === 'checkbox') el.checked = val === true; 
                else el.value = val;
            };

            setVal('audioQuality', settings.audioQuality || 'auto');
            setVal('normalizeVolume', settings.normalizeVolume !== false); 
            setVal('crossfade', settings.crossfade || 3);
            if(document.getElementById('fadeVal')) document.getElementById('fadeVal').innerText = (settings.crossfade || 3) + 's';
            
            if(settings.eqHigh !== undefined) setVal('eqHigh', settings.eqHigh);
            if(settings.eqMid !== undefined) setVal('eqMid', settings.eqMid);
            if(settings.eqLow !== undefined) setVal('eqLow', settings.eqLow);

            setVal('allocationMode', settings.allocationMode || 'manual');
            setVal('publicReceipts', settings.publicReceipts !== false);
            setVal('ghostMode', settings.ghostMode === true);
            setVal('localVisibility', settings.localVisibility !== false);
            setVal('tasteMatch', settings.tasteMatch !== false);
            setVal('theme', settings.theme || 'electronic');
            
            this.updateEQ();
            this.showSupportedFormats();

        } catch (e) { 
            console.error("Settings Hydration Failed", e); 
            this.mainUI.showToast("Failed to load settings.");
        }
    }

    updateEQ() {
        const high = document.querySelector('input[name="eqHigh"]')?.value;
        const mid = document.querySelector('input[name="eqMid"]')?.value;
        const low = document.querySelector('input[name="eqLow"]')?.value;
        
        const highValEl = document.getElementById('eqHighVal');
        const midValEl = document.getElementById('eqMidVal');
        const lowValEl = document.getElementById('eqLowVal');
        
        if (highValEl && high !== undefined) highValEl.textContent = high + ' dB';
        if (midValEl && mid !== undefined) midValEl.textContent = mid + ' dB';
        if (lowValEl && low !== undefined) lowValEl.textContent = low + ' dB';
        
        if (high) this.updateGlobalSetting('eqHigh', parseFloat(high));
        if (mid) this.updateGlobalSetting('eqMid', parseFloat(mid));
        if (low) this.updateGlobalSetting('eqLow', parseFloat(low));
    }

    resetEQ() {
        const eqHigh = document.getElementById('eqHigh');
        const eqMid = document.getElementById('eqMid');
        const eqLow = document.getElementById('eqLow');
        
        if (eqHigh) eqHigh.value = 0;
        if (eqMid) eqMid.value = 0;
        if (eqLow) eqLow.value = 0;
        
        this.updateEQ();
        this.mainUI.showToast('EQ reset to flat');
    }

    // ==========================================
    // 8. HELPERS
    // ==========================================

    formatTime(seconds) {
        if (!seconds) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // ==========================================
    // 8b. AUDIO OUTPUT DEVICE MANAGEMENT
    // ==========================================

    /**
     * Enumerate audio output devices and populate the main / cue selector
     * dropdowns.  Should be wired to a "Refresh Devices" button click so the
     * browser can surface the permission prompt.
     *
     * Expects two <select> elements in the settings panel:
     *   #mainOutputSelect  — speakers / PA
     *   #cueOutputSelect   — headphones
     */
    async refreshOutputDevices() {
        const mainSelect = document.getElementById('mainOutputSelect');
        const cueSelect  = document.getElementById('cueOutputSelect');

        if (!mainSelect && !cueSelect) return;

        // Ask for mic permission so the browser reveals device labels.
        // We immediately stop the stream — we only need the labels.
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
        } catch (_) { /* labels may still appear if previously granted */ }

        let outputs = [];
        try {
            const all = await navigator.mediaDevices.enumerateDevices();
            outputs = all.filter(d => d.kind === 'audiooutput');
        } catch (e) {
            console.error('[Devices] enumeration failed:', e);
            this.mainUI.showToast('Could not list audio devices', 'error');
            return;
        }

        if (outputs.length === 0) {
            this.mainUI.showToast('No audio output devices found', 'warning');
            return;
        }

        const opts = outputs
            .map((d, i) => `<option value="${d.deviceId}">${d.label || `Output ${i + 1}`}</option>`)
            .join('');

        if (mainSelect) {
            mainSelect.innerHTML = opts;
            const saved = localStorage.getItem('eporia_main_output');
            if (saved) mainSelect.value = saved;
        }
        if (cueSelect) {
            cueSelect.innerHTML = opts;
            const saved = localStorage.getItem('eporia_cue_output');
            if (saved) cueSelect.value = saved;
        }

        this.mainUI.showToast(`${outputs.length} output device(s) found`, 'success');
    }

    /**
     * Route the Tone.js AudioContext to the selected main output device.
     * Delegates to engine.setMainOutputDevice() which calls
     * AudioContext.setSinkId() — Chrome / Edge 110+.
     */
    async applyMainOutputDevice() {
        const sel = document.getElementById('mainOutputSelect');
        if (!sel) return;
        const deviceId = sel.value;
        try {
            await this.engine.setMainOutputDevice(deviceId);
            localStorage.setItem('eporia_main_output', deviceId);
            this.mainUI.showToast('Main output updated 🔊', 'success');
        } catch (e) {
            console.error('[Devices] main output error:', e);
            this.mainUI.showToast(
                e.message.includes('not supported')
                    ? 'Output routing not supported in this browser'
                    : 'Failed to set main output',
                'error'
            );
        }
    }

    /**
     * Route the workbench cue HTMLAudioElement to the selected cue device.
     * Uses HTMLAudioElement.setSinkId() which works independently of Tone.js.
     * window.workbench must be initialised before calling this.
     */
    async applyCueOutputDevice() {
        const sel = document.getElementById('cueOutputSelect');
        if (!sel) return;
        const deviceId = sel.value;
        try {
            const wb = window.workbench;
            if (!wb?.cueAudio) throw new Error('Workbench cue audio not ready');
            if (typeof wb.cueAudio.setSinkId !== 'function') {
                throw new Error('not supported');
            }
            await wb.cueAudio.setSinkId(deviceId);
            localStorage.setItem('eporia_cue_output', deviceId);
            this.mainUI.showToast('Cue output updated 🎧', 'success');
        } catch (e) {
            console.error('[Devices] cue output error:', e);
            this.mainUI.showToast(
                e.message.includes('not supported')
                    ? 'Cue output routing not supported in this browser'
                    : 'Failed to set cue output',
                'error'
            );
        }
    }

    // ==========================================
    // 9. SONG LIKES
    // ==========================================

    async checkSongLikeStatus(songId, iconEl) {
        if (!songId || !iconEl) return;
        try {
            // Use cached liked IDs if available to avoid extra requests
            if (window._likedSongIds) {
                const liked = window._likedSongIds.has(songId);
                iconEl.classList.toggle('fas', liked);
                iconEl.classList.toggle('far', !liked);
                iconEl.style.color = liked ? '#e74c3c' : '';
                return;
            }
            const token = await this.auth.currentUser?.getIdToken();
            if (!token) return;
            const res  = await fetch('/player/api/user/likes/ids', { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            window._likedSongIds = new Set(data.likedSongIds || []);
            const liked = window._likedSongIds.has(songId);
            iconEl.classList.toggle('fas', liked);
            iconEl.classList.toggle('far', !liked);
            iconEl.style.color = liked ? '#e74c3c' : '';
        } catch (e) { console.error('[Like] check error:', e); }
    }

    async toggleSongLike() {
        const track = this.engine.currentTrack;
        if (!track?.id) return this.mainUI.showToast('Nothing playing', 'error');

        const heartIcon = document.querySelector('.player-full .fa-heart') || document.querySelector('.mp-controls .fa-heart');
        const isLiked = heartIcon?.classList.contains('fas');

        // Optimistic UI update
        if (heartIcon) {
            heartIcon.classList.toggle('fas', !isLiked);
            heartIcon.classList.toggle('far',  isLiked);
            heartIcon.style.color = !isLiked ? '#e74c3c' : '';
        }

        try {
            const token = await this.auth.currentUser?.getIdToken();
            if (!token) {
                // Revert optimistic update
                if (heartIcon) {
                    heartIcon.classList.toggle('fas', isLiked);
                    heartIcon.classList.toggle('far',  !isLiked);
                    heartIcon.style.color = isLiked ? '#e74c3c' : '';
                }
                return this.mainUI.showToast('Sign in to like tracks', 'error');
            }

            if (isLiked) {
                await fetch(`/player/api/user/like/${track.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` }
                });
                window._likedSongIds?.delete(track.id);
                this.mainUI.showToast('Removed from Liked Songs');
            } else {
                await fetch('/player/api/user/like', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        songId:   track.id,
                        title:    track.title,
                        artist:   track.artist,
                        artUrl:   track.artUrl,
                        audioUrl: track.audioUrl,
                        duration: track.duration,
                        artistId: track.artistId || null
                    })
                });
                window._likedSongIds?.add(track.id);
                this.mainUI.showToast('Added to Liked Songs ❤️');
            }
        } catch (e) {
            console.error('[Like] toggle error:', e);
            // Revert optimistic update on failure
            if (heartIcon) {
                heartIcon.classList.toggle('fas', isLiked);
                heartIcon.classList.toggle('far',  !isLiked);
                heartIcon.style.color = isLiked ? '#e74c3c' : '';
            }
            this.mainUI.showToast('Could not update like', 'error');
        }
    }
}