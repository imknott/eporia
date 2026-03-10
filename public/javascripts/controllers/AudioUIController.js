/* public/javascripts/controllers/AudioUIController.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export class AudioUIController {
    constructor(mainUI) {
        this.mainUI = mainUI;
        this.engine = mainUI.engine;
        this.auth   = getAuth();
        this.settingsSaveTimeout = null;

        // Queue / history actions
        window.ui.playQueueIndex  = this.playQueueIndex.bind(this);
        window.ui.removeFromQueue = this.removeFromQueue.bind(this);
        window.ui.playFromHistory = this.playFromHistory.bind(this);

        // Global window functions
        window.togglePlay      = () => this.engine.togglePlay();
        window.playAllFavorites= this.playAllFavorites.bind(this);
        window.playAnthem      = this.playAnthem.bind(this);

        // Player-bar heart handler (reads currentTrack — no args needed)
        window.togglePlayerLike = this.toggleSongLike.bind(this);

        window.updateSetting = this.updateGlobalSetting.bind(this);
        window.updateEQ      = this.updateEQ.bind(this);
        window.resetEQ       = this.resetEQ.bind(this);
        window.sendCmd       = this.sendCmd.bind(this);
        window.skipForward   = (sec = 10) => { this.engine.skipForward(sec);  this.mainUI.showToast(`⏩ +${sec}s`); };
        window.skipBackward  = (sec = 10) => { this.engine.skipBackward(sec); this.mainUI.showToast(`⏪ -${sec}s`); };
        window.shuffleQueue  = this.shuffleQueue.bind(this);
        window.clearQueue    = this.clearQueue.bind(this);
        window.showStats     = this.showPlaybackStats.bind(this);

        this.setupEnhancedAudioListeners();
        this.setupSeekbar();
        this.setupKeyboardShortcuts();
    }

    // ==========================================
    // 1. ENGINE EVENT LISTENERS
    // ==========================================

    setupEnhancedAudioListeners() {
        this.engine.on('stateChange', (data) => {
            // FIX: Reset progress bar to 0 the moment a new track starts.
            // Without this the bar stays at the old track's position until
            // the first progress event fires (~100ms later), causing the
            // "stuck" appearance the user was seeing.
            if (data.isPlaying && data.track) {
                this.updateProgressBar({ progress: 0, currentTime: 0, duration: data.track.duration });
            }
            this.updatePlayPauseIcons(data.isPlaying);
            this.updatePlayerUI(data.track);
            if (data.isPlaying && this.mainUI.isMinimized) this.mainUI.togglePlayerSize();
        });

        this.engine.on('progress', (data) => this.updateProgressBar(data));

        this.engine.on('bufferStart', () => this.showBuffering(true));
        this.engine.on('bufferEnd',   () => this.showBuffering(false));

        this.engine.on('preloadComplete', (data) => this.markTrackAsPreloaded(data.track.id));

        this.engine.on('trackEnd', (data) => this.onTrackEnd(data.track));

        this.engine.on('error', (data) => {
            this.mainUI.showToast(`Error playing ${data.track?.title || 'track'}`, 'error');
            console.error('Playback error:', data.error);
        });

        // queueUpdate now also carries implicit history update — re-render both sections
        this.engine.on('queueUpdate', (queue) => {
            this.updateQueueUI(queue);
            this.updateQueueCount(queue.length);
        });
    }

    // ==========================================
    // 2. PLAYER UI UPDATES
    // ==========================================

    updatePlayerUI(track) {
        if (!track) return;

        // Title
        document.querySelectorAll('#d-title-full, #d-title-mini').forEach(el => el.innerText = track.title);

        // Artist (with clickable nav to artist page)
        document.querySelectorAll('#d-artist-full, #d-artist-mini').forEach(el => {
            el.innerText = track.artist;
            const pageArtistId   = document.querySelector('.content-scroll[data-artist-id]')?.dataset?.artistId || null;
            const resolvedArtistId = track.artistId || pageArtistId;
            if (resolvedArtistId) {
                el.style.cursor         = 'pointer';
                el.style.textDecoration = 'underline';
                el.style.transition     = 'color 0.2s ease';
                el.title = `Go to ${track.artist}'s page`;
                el.onmouseenter = () => el.style.color = 'var(--primary, #88C9A1)';
                el.onmouseleave = () => el.style.color = '';
                el.onclick = (e) => {
                    e.stopPropagation();
                    if (window.navigateTo) window.navigateTo(`/player/artist/${resolvedArtistId}`);
                    if (this.mainUI && !this.mainUI.isMinimized) this.mainUI.togglePlayerSize();
                };
            } else {
                el.style.cursor = 'default';
                el.style.textDecoration = '';
                el.style.color = '';
                el.title = '';
                el.onmouseenter = el.onmouseleave = el.onclick = null;
            }
        });

        // Duration
        if (track.duration) {
            const totalEl = document.getElementById('totalTime');
            if (totalEl) totalEl.innerText = this.formatTime(track.duration);
        }

        // Album art
        const artElements = document.querySelectorAll('#d-art-full, #d-art-mini');
        if (track.artUrl && track.artUrl !== 'null') {
            artElements.forEach(el => {
                el.style.backgroundImage = `url('${track.artUrl}')`;
                if (el.id === 'd-art-full') el.style.backgroundSize = 'cover';
                el.classList.remove('art-placeholder');
            });
        }

        // Heart icon
        const heartIcon = document.querySelector('.player-full .fa-heart') || document.querySelector('.mp-controls .fa-heart');
        if (heartIcon) this.checkSongLikeStatus(track.id, heartIcon);

        // Quality badge
        this.updateQualityBadge(track);
    }

    updatePlayPauseIcons(isPlaying) {
        document.querySelectorAll('.fa-play, .fa-pause').forEach(icon => {
            if (icon.parentElement.matches('.btn-play-hero, .btn-play-mini, .mp-play')) {
                icon.classList.toggle('fa-pause', isPlaying);
                icon.classList.toggle('fa-play',  !isPlaying);
            }
        });
    }

    showBuffering(isBuffering) {
        const spinner = document.getElementById('bufferingSpinner');
        const playBtn = document.getElementById('playPauseBtn');
        if (spinner) spinner.style.display = isBuffering ? 'block' : 'none';
        if (playBtn) playBtn.classList.toggle('loading', isBuffering);
    }

    // FIX: Uses _qualityInfo from track (set by engine._detectQuality) so the
    // badge correctly shows FLAC / WAV / ALAC for lossless masters rather than
    // always falling back to "MP3" when a plain audioUrl was provided.
    updateQualityBadge(track) {
        const badge = document.getElementById('qualityBadge');
        if (!badge) return;

        const q = track._qualityInfo || { label: 'MP3', tier: 'standard' };

        badge.textContent = q.label;
        badge.className   = `quality-badge quality-${q.tier}`;
        badge.style.display = 'block';

        // Tooltip
        const tips = {
            lossless: 'Lossless Master — Full studio quality',
            high:     'High Quality — 320 kbps',
            standard: 'Standard Quality'
        };
        badge.title = tips[q.tier] || '';

        // For lossless tracks add a small "MASTER" sub-label if there's room
        if (q.tier === 'lossless') {
            badge.setAttribute('data-tier', 'lossless');
        } else {
            badge.removeAttribute('data-tier');
        }
    }

    // ==========================================
    // 3. PROGRESS BAR & SEEKING
    // ==========================================

    setupSeekbar() {
        const progressContainer =
            document.querySelector('.progress-track') ||
            document.getElementById('progressBar')?.parentElement;

        if (progressContainer) {
            progressContainer.style.cursor = 'pointer';
            progressContainer.addEventListener('click', (e) => {
                if (!this.engine.currentTrack) return;
                const rect  = progressContainer.getBoundingClientRect();
                const pct   = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const seekTime = pct * this.engine.trackDuration;
                this.engine.seek(seekTime);
                this.updateProgressBar({ progress: pct, currentTime: seekTime });
            });
        }
    }

    updateProgressBar({ progress, currentTime, duration, buffering }) {
        const bar = document.getElementById('progressBar');
        if (bar) {
            bar.style.width = `${Math.min(progress * 100, 100)}%`;
            if (buffering) bar.classList.add('buffering');
            else           bar.classList.remove('buffering');
        }
        const timeEl = document.getElementById('currentTime');
        if (timeEl) timeEl.innerText = this.formatTime(currentTime);
        if (duration) {
            const durationEl = document.getElementById('totalTime');
            if (durationEl) durationEl.innerText = this.formatTime(duration);
        }
    }

    // ==========================================
    // 4. QUEUE & HISTORY MANAGEMENT
    // ==========================================

    addToQueue(id, title, artist, artUrl, audioUrl, duration) {
        if (event) event.stopPropagation();
        this.engine.addToQueue({ id, title, artist, artUrl, audioUrl, duration });
        this.mainUI.showToast(`Added to Queue: ${title}`);
    }

    // FIX: Renders both the history section (recently played) and the upcoming
    // queue in one panel. History lets users jump back to any previous track.
    updateQueueUI(queue) {
        const queueContainer = document.getElementById('queueList');
        if (!queueContainer) return;

        const history = this.engine.history || [];
        let html = '';

        // ── Recently Played (most recent first) ──────────────────────
        if (history.length > 0) {
            const recent = history.slice(-8).reverse();
            html += `
                <div class="queue-section-header">
                    <i class="fas fa-history"></i>
                    <span>Recently Played</span>
                    <button class="queue-section-clear" onclick="window.ui.clearHistory()" title="Clear history">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
            html += recent.map((track, i) => {
                const histIdx = history.length - 1 - i; // real index in history array
                return `
                <div class="queue-item queue-item--history" onclick="window.ui.playFromHistory(${histIdx})">
                    <div class="queue-item-hist-icon"><i class="fas fa-history"></i></div>
                    <img src="${this.mainUI.fixImageUrl(track.artUrl)}" class="queue-item-art" alt="${track.title}">
                    <div class="queue-item-info">
                        <div class="queue-item-title">${track.title}</div>
                        <div class="queue-item-artist">${track.artist}</div>
                    </div>
                    <div class="queue-item-duration">${this.formatTime(track.duration)}</div>
                </div>`;
            }).join('');
        }

        // ── Up Next ───────────────────────────────────────────────────
        if (queue.length > 0) {
            html += `
                <div class="queue-section-header" style="${history.length ? 'margin-top:12px' : ''}">
                    <i class="fas fa-list-ul"></i>
                    <span>Up Next</span>
                    <span class="queue-section-count">${queue.length} track${queue.length !== 1 ? 's' : ''}</span>
                </div>
            `;
            html += queue.map((track, index) => `
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
                            <i class="fas fa-check-circle"         style="display:none; color:var(--success)"></i>
                        </span>
                        <button onclick="event.stopPropagation(); window.ui.removeFromQueue(${index})" class="btn-icon">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="queue-item-duration">${this.formatTime(track.duration)}</div>
                </div>
            `).join('');
        }

        if (!history.length && !queue.length) {
            html = '<div class="empty-queue" style="padding:20px;text-align:center;color:var(--text-secondary)">Queue is empty</div>';
        }

        queueContainer.innerHTML = html;
    }

    markTrackAsPreloaded(trackId) {
        const statusEl = document.getElementById(`preload-${trackId}`);
        if (!statusEl) return;
        const spinner = statusEl.querySelector('.fa-spin');
        const check   = statusEl.querySelector('.fa-check-circle');
        if (spinner) spinner.style.display = 'none';
        if (check)   check.style.display   = 'inline';
    }

    updateQueueCount(count) {
        const badge = document.getElementById('queueCountBadge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
    }

    // FIX: playQueueIndex — tracks before the selected one are moved to history
    // (not silently dropped) so the user can still navigate back to them.
    // Also emits queueUpdate so the panel re-renders immediately.
    playQueueIndex(index) {
        if (index < 0 || index >= this.engine.queue.length) return;

        // Tracks before the clicked one — push them into history
        const skipped = this.engine.queue.splice(0, index);
        skipped.forEach(t => {
            this.engine.history.push(t);
            if (this.engine.history.length > 50) this.engine.history.shift();
        });

        // The track the user actually clicked
        const track = this.engine.queue.shift();

        // Emit before play() so the UI reflects the queue state during loading
        this.engine.emit('queueUpdate', this.engine.queue);
        this.engine.play(track.id, track);
    }

    // Play a track from history by its index in the history array.
    // The selected track is removed from history; current track goes back to queue.
    playFromHistory(historyIndex) {
        if (historyIndex < 0 || historyIndex >= this.engine.history.length) return;
        const track = this.engine.history.splice(historyIndex, 1)[0];
        if (this.engine.currentTrack) {
            this.engine.queue.unshift({ ...this.engine.currentTrack });
            this.engine.emit('queueUpdate', this.engine.queue);
        }
        this.engine.play(track.id, track, { addToHistory: false });
    }

    clearHistory() {
        this.engine.clearHistory();
        this.mainUI.showToast('History cleared');
    }

    removeFromQueue(index) {
        const removed = this.engine.removeFromQueue(index);
        if (removed) this.mainUI.showToast(`Removed ${removed.title} from queue`);
    }

    shuffleQueue() {
        if (this.engine.queue.length < 2) { this.mainUI.showToast('Need at least 2 tracks to shuffle'); return; }
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
            // FIX: actually go to previous track in history instead of just seeking to 0
            if (this.engine.history.length > 0) {
                this.engine.playPrevious();
                this.mainUI.showToast('⏮️ Previous track');
            } else {
                this.engine.seek(0);
                this.mainUI.showToast('⏮️ Restarting track');
            }
        }
    }

    // ==========================================
    // 5. KEYBOARD SHORTCUTS & STATS
    // ==========================================

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea')) return;
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    this.engine.togglePlay();
                    break;
                case 'ArrowRight':
                    if (e.shiftKey) { this.engine.playNext();     this.mainUI.showToast('⏭️ Next track'); }
                    else              this.engine.skipForward(10);
                    break;
                case 'ArrowLeft':
                    if (e.shiftKey) { this.engine.playPrevious(); this.mainUI.showToast('⏮️ Previous track'); }
                    else              this.engine.skipBackward(10);
                    break;
                case 'ArrowUp':
                    e.preventDefault(); {
                    const v = Math.min(this.engine.masterBus.gain.value + 0.1, 1);
                    this.engine.setVolume(v);
                    this.mainUI.showToast(`🔊 Volume: ${Math.round(v * 100)}%`);
                    } break;
                case 'ArrowDown':
                    e.preventDefault(); {
                    const v = Math.max(this.engine.masterBus.gain.value - 0.1, 0);
                    this.engine.setVolume(v);
                    this.mainUI.showToast(`🔉 Volume: ${Math.round(v * 100)}%`);
                    } break;
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
                    <div class="stat-item"><span class="stat-label">History</span><span class="stat-value">${stats.historyLength} tracks</span></div>
                    <div class="stat-item"><span class="stat-label">Now Playing</span><span class="stat-value">${stats.currentTrack ? stats.currentTrack.title : 'None'}</span></div>
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
        const supported = Object.entries(this.engine.supportedFormats)
            .filter(([, ok]) => ok).map(([f]) => f.toUpperCase());
        formatList.innerHTML = `<div class="settings-info"><i class="fas fa-info-circle"></i><span>Your browser supports: ${supported.join(', ')}</span></div>`;
    }

    // ==========================================
    // 6. FAVORITES & ANTHEM PLAYBACK
    // ==========================================

    async playAllFavorites() {
        if (!this.auth.currentUser) return;
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res   = await fetch('/player/api/favorites', { headers: { Authorization: `Bearer ${token}` } });
            const data  = await res.json();
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
        const artUrl   = this.mainUI.fixImageUrl(card.dataset.songImg);
        const audioUrl = this.mainUI.fixImageUrl(card.dataset.audioUrl);
        this.engine.play(card.dataset.songId, {
            title: card.dataset.songTitle, artist: card.dataset.songArtist,
            artUrl, audioUrl, duration: parseFloat(card.dataset.duration) || 0
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
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = 'Save Changes'; saveBtn.style.opacity = '1'; }
        clearTimeout(this.settingsSaveTimeout);
        this.settingsSaveTimeout = setTimeout(() => this.saveSettings(), 1000);
    }

    async saveSettings() {
        const btn = document.getElementById('saveSettingsBtn');
        if (btn) { btn.innerText = 'Saving...'; btn.disabled = true; }
        try {
            const token = await this.auth.currentUser.getIdToken();
            await fetch('/player/api/settings/save', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(window.globalUserCache.settings)
            });
            if (btn) { btn.innerText = 'Saved!'; setTimeout(() => { btn.innerText = 'Save Changes'; }, 2000); }
            this.mainUI.showToast('Settings saved.');
        } catch (e) {
            console.error('Save error:', e);
            this.mainUI.showToast('Failed to save settings.');
            if (btn) btn.disabled = false;
        }
    }

    async loadSettingsPage(container) {
        container.dataset.hydrated = 'true';
        const emailEl = document.getElementById('settingsEmail');
        if (emailEl && this.auth.currentUser.email) emailEl.innerText = this.auth.currentUser.email;
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) saveBtn.onclick = () => this.saveSettings();
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res   = await fetch('/player/api/settings', { headers: { Authorization: `Bearer ${token}` } });
            const data  = await res.json();
            if (!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache = { ...window.globalUserCache, ...data, settings: { ...window.globalUserCache.settings, ...data.settings } };
            const settings = window.globalUserCache.settings || {};
            const setVal   = (name, val) => {
                const el = document.querySelector(`[name="${name}"]`);
                if (!el) return;
                if (el.type === 'checkbox') el.checked = val === true;
                else el.value = val;
            };
            setVal('audioQuality',    settings.audioQuality   || 'auto');
            setVal('normalizeVolume', settings.normalizeVolume !== false);
            setVal('crossfade',       settings.crossfade       || 3);
            if (document.getElementById('fadeVal')) document.getElementById('fadeVal').innerText = (settings.crossfade || 3) + 's';
            if (settings.eqHigh !== undefined) setVal('eqHigh', settings.eqHigh);
            if (settings.eqMid  !== undefined) setVal('eqMid',  settings.eqMid);
            if (settings.eqLow  !== undefined) setVal('eqLow',  settings.eqLow);
            setVal('allocationMode',  settings.allocationMode  || 'manual');
            setVal('publicReceipts',  settings.publicReceipts  !== false);
            setVal('ghostMode',       settings.ghostMode       === true);
            setVal('localVisibility', settings.localVisibility !== false);
            setVal('tasteMatch',      settings.tasteMatch      !== false);
            setVal('theme',           settings.theme           || 'electronic');
            this.updateEQ();
            this.showSupportedFormats();
        } catch (e) {
            console.error('Settings hydration failed:', e);
            this.mainUI.showToast('Failed to load settings.');
        }
    }

    updateEQ() {
        const high = document.querySelector('input[name="eqHigh"]')?.value;
        const mid  = document.querySelector('input[name="eqMid"]')?.value;
        const low  = document.querySelector('input[name="eqLow"]')?.value;
        const highValEl = document.getElementById('eqHighVal');
        const midValEl  = document.getElementById('eqMidVal');
        const lowValEl  = document.getElementById('eqLowVal');
        if (highValEl && high !== undefined) highValEl.textContent = high + ' dB';
        if (midValEl  && mid  !== undefined) midValEl.textContent  = mid  + ' dB';
        if (lowValEl  && low  !== undefined) lowValEl.textContent  = low  + ' dB';
        if (high) this.updateGlobalSetting('eqHigh', parseFloat(high));
        if (mid)  this.updateGlobalSetting('eqMid',  parseFloat(mid));
        if (low)  this.updateGlobalSetting('eqLow',  parseFloat(low));
    }

    resetEQ() {
        ['eqHigh', 'eqMid', 'eqLow'].forEach(name => {
            const el = document.getElementById(name);
            if (el) el.value = 0;
        });
        this.updateEQ();
        this.mainUI.showToast('EQ reset to flat');
    }

    // ==========================================
    // 8. HELPERS
    // ==========================================

    formatTime(seconds) {
        if (!seconds) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // ==========================================
    // 9. SONG LIKES
    // ==========================================

    async checkSongLikeStatus(songId, iconEl) {
        if (!songId || !iconEl) return;
        try {
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
        const isLiked   = heartIcon?.classList.contains('fas');
        if (heartIcon) {
            heartIcon.classList.toggle('fas',  !isLiked);
            heartIcon.classList.toggle('far',   isLiked);
            heartIcon.style.color = !isLiked ? '#e74c3c' : '';
        }
        try {
            const token = await this.auth.currentUser?.getIdToken();
            if (!token) {
                if (heartIcon) { heartIcon.classList.toggle('fas', isLiked); heartIcon.classList.toggle('far', !isLiked); heartIcon.style.color = isLiked ? '#e74c3c' : ''; }
                return this.mainUI.showToast('Sign in to like tracks', 'error');
            }
            if (isLiked) {
                await fetch(`/player/api/user/like/${track.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                window._likedSongIds?.delete(track.id);
                this.mainUI.showToast('Removed from Liked Songs');
            } else {
                await fetch('/player/api/user/like', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ songId: track.id, title: track.title, artist: track.artist, artUrl: track.artUrl, audioUrl: track.audioUrl, duration: track.duration, artistId: track.artistId || null })
                });
                window._likedSongIds?.add(track.id);
                this.mainUI.showToast('Added to Liked Songs ❤️');
            }
        } catch (e) {
            console.error('[Like] toggle error:', e);
            if (heartIcon) { heartIcon.classList.toggle('fas', isLiked); heartIcon.classList.toggle('far', !isLiked); heartIcon.style.color = isLiked ? '#e74c3c' : ''; }
            this.mainUI.showToast('Could not update like', 'error');
        }
    }
}