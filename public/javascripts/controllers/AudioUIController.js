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
        window.updateSetting = this.updateGlobalSetting.bind(this);
        window.updateEQ = this.updateEQ.bind(this);
        window.resetEQ = this.resetEQ.bind(this);
        window.sendCmd = this.sendCmd.bind(this);
        window.skipForward = (sec = 10) => { this.engine.skipForward(sec); this.mainUI.showToast(`⏩ +${sec}s`); };
        window.skipBackward = (sec = 10) => { this.engine.skipBackward(sec); this.mainUI.showToast(`⏪ -${sec}s`); };
        window.shuffleQueue = this.shuffleQueue.bind(this);
        window.clearQueue = this.clearQueue.bind(this);
        window.showStats = this.showPlaybackStats.bind(this);

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
            this.updateQueueUI(queue);
            this.updateQueueCount(queue.length);
        });
    }

    // ==========================================
    // 2. PLAYER UI UPDATES
    // ==========================================

    updatePlayerUI(track) {
        if(!track) return;

        document.querySelectorAll('#d-title-full, #d-title-mini').forEach(el => el.innerText = track.title);
        document.querySelectorAll('#d-artist-full, #d-artist-mini').forEach(el => el.innerText = track.artist);
        
        if (track.duration) {
            const timeString = this.formatTime(track.duration);
            const totalEl = document.getElementById('totalTime');
            if (totalEl) totalEl.innerText = timeString;
        }

        const artElements = document.querySelectorAll('#d-art-full, #d-art-mini');
        if (track.artUrl && track.artUrl !== 'null') {
            artElements.forEach(el => {
                el.style.backgroundImage = `url('${track.artUrl}')`;
                if(el.id === 'd-art-full') el.style.backgroundSize = 'cover';
                el.classList.remove('art-placeholder');
            });
        }

        const heartIcon = document.querySelector('.player-full .fa-heart') || document.querySelector('.mp-controls .fa-heart');
        if (heartIcon && this.mainUI.socialController) {
            this.mainUI.socialController.checkSongLikeStatus(track.id, heartIcon);
        }
        
        this.updateQualityBadge(track);
    }

    updatePlayPauseIcons(isPlaying) {
        document.querySelectorAll('.fa-play, .fa-pause').forEach(icon => {
            if (icon.parentElement.matches('.btn-play-hero, .btn-play-mini, .mp-play')) {
                icon.classList.toggle('fa-pause', isPlaying);
                icon.classList.toggle('fa-play', !isPlaying);
            }
        });
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
        
        let quality = track.quality || 'MP3';
        if (!track.quality && track.audioUrl) {
            if (track.audioUrl.includes('.flac')) quality = 'FLAC';
            else if (track.audioUrl.includes('.m4a')) quality = 'ALAC';
            else if (track.audioUrl.includes('320')) quality = '320';
            else if (track.audioUrl.includes('192')) quality = '192';
        }
        
        badge.textContent = quality;
        badge.className = 'quality-badge quality-' + quality.toLowerCase();
        badge.style.display = 'block';
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
        const bar = document.getElementById('progressBar'); 
        if (bar) {
            bar.style.width = `${progress * 100}%`;
            if (buffering) bar.classList.add('buffering');
            else bar.classList.remove('buffering');
        }
        
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

    updateQueueUI(queue) {
        const queueContainer = document.getElementById('queueList');
        if (!queueContainer) return;
        
        if (queue.length === 0) {
            queueContainer.innerHTML = '<div class="empty-queue" style="padding:20px; text-align:center; color:var(--text-secondary)">Queue is empty</div>';
            return;
        }
        
        queueContainer.innerHTML = queue.map((track, index) => `
            <div class="queue-item" data-track-id="${track.id}" onclick="window.ui.playQueueIndex(${index})">
                <div class="queue-item-drag-handle"><i class="fas fa-grip-vertical"></i></div>
                <img src="${this.mainUI.fixImageUrl(track.artUrl)}" class="queue-item-art" alt="${track.title}">
                <div class="queue-item-info">
                    <div class="queue-item-title">${track.title}</div>
                    <div class="queue-item-artist">${track.artist}</div>
                </div>
                <div class="queue-item-actions">
                    <span class="preload-status" id="preload-${track.id}">
                        <i class="fas fa-circle-notch fa-spin" style="display:none"></i>
                        <i class="fas fa-check-circle" style="display:none; color:var(--success)"></i>
                    </span>
                    <button onclick="event.stopPropagation(); window.ui.removeFromQueue(${index})" class="btn-icon">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="queue-item-duration">${this.formatTime(track.duration)}</div>
            </div>
        `).join('');
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
        const badge = document.getElementById('queueCountBadge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
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
        this.mainUI.showToast('🔀 Queue shuffled');
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
            this.mainUI.showToast('Skipping to next track... ⏭️');
        } else if (cmd === 'prev') {
            this.engine.seek(0);
            this.mainUI.showToast('Replaying track ⏮️');
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
        
        this.engine.play(card.dataset.songId, {
            title: card.dataset.songTitle,
            artist: card.dataset.songArtist,
            artUrl: card.dataset.songImg, 
            audioUrl: card.dataset.audioUrl,
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
        if (emailEl && this.auth.currentUser.email) emailEl.innerText = this.auth.currentUser.email;

        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) saveBtn.onclick = () => this.saveSettings();

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
}