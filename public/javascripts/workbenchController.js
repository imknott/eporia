/* public/javascripts/workbenchController.js */
// Tone is imported solely for setMainOutputDevice() which needs
// Tone.getContext().rawContext to call AudioContext.setSinkId().
// Do NOT call Tone.start() or Tone.context here — use engine.resumeAudioContext() instead.
import * as Tone from 'https://esm.sh/tone@14.7.77';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
        this.draftSaveTimer = null; // Auto-save timer
        this.hasDraft = false; // Track if draft exists

        // CDN base for client-side URL normalisation.
        // Matches the server-side CDN_URL so raw R2 dev URLs stored in
        // older Firestore docs are corrected before rendering <img> tags.
        this._cdnBase = 'https://cdn.eporiamusic.com';
        
        // Always initialise the cue HTMLAudioElement — the old guard
        // `if (!this.engine.cueBus)` was always false because audioEngine.js
        // sets cueBus in its own constructor, so cueAudio was never created.
        this.setupCueBus();

        // Cache the user reference the moment auth resolves so every method
        // in this class can rely on this._user instead of this._user
        // which can be null even when the session is active (Firebase async).
        this._user = auth.currentUser || null;
        onAuthStateChanged(auth, (user) => {
            this._user = user;
            if (user) {
                this.loadUserCrates();
                this.checkForDraft();
            }
        });

        // Register all window globals that workbench.pug onclicks depend on.
        // Must live here — NOT in a pug inline script — because appRouter.js
        // strips <script> tags on SPA navigation, so pug scripts only run on
        // a hard page load. Registering in the constructor means they're defined
        // once at app startup and survive every SPA navigation.
        this._registerGlobals();

        console.log('✅ Workbench initialized');
    }

    /**
     * Registers all page-level window globals for the workbench.
     * Separated from the constructor for clarity.
     */
    _registerGlobals() {
        // Output device panel toggle
        window.wbToggleOutputPanel = () => {
            const panel = document.getElementById('outputDevicePanel');
            const btn   = document.getElementById('wbOutputToggle');
            if (!panel) return;
            const opening = panel.style.display === 'none' || panel.style.display === '';
            panel.style.display = opening ? 'block' : 'none';
            if (btn) btn.classList.toggle('active', opening);
            if (opening) this.loadOutputDevices();
        };

        // Device permission banner
        window.initDeviceBanner = () => {
            const banner = document.getElementById('devicePermBanner');
            if (!banner) return;
            if (localStorage.getItem('eporia_devices_granted')   === '1') return;
            if (localStorage.getItem('eporia_devices_dismissed') === '1') return;
            if (typeof (new Audio()).setSinkId !== 'function') return;
            setTimeout(() => { banner.style.display = 'flex'; }, 800);
        };

        window.wbGrantAudioDevices = async () => {
            const banner = document.getElementById('devicePermBanner');
            if (banner) banner.style.display = 'none';
            localStorage.setItem('eporia_devices_granted', '1');
            window.wbToggleOutputPanel();
            await this.loadOutputDevices();
        };

        window.wbDismissDeviceBanner = () => {
            const banner = document.getElementById('devicePermBanner');
            if (banner) banner.style.display = 'none';
            localStorage.setItem('eporia_devices_dismissed', '1');
        };
    }

    // --- URL HELPER ---
    // Normalise a track image URL so it always points to the canonical CDN.
    // Handles three broken cases that appear in Firestore:
    //   1. Raw R2 dev domain  (pub-xxx.r2.dev/...) — saved before custom CDN was set
    //   2. Protocol-relative  (//cdn.eporiamusic.com/...)
    //   3. Bare path          (artists/xxx/art/cover.jpg)
    normalizeImgUrl(url) {
        const fallback = '/images/placeholder.png';
        if (!url) return fallback;

        // Already a correctly-formed https URL that isn't a raw R2 dev URL
        const R2_DEV = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;
        if (url.startsWith('https://') || url.startsWith('http://')) {
            return R2_DEV.test(url)
                ? url.replace(R2_DEV, this._cdnBase)
                : url;
        }

        // Protocol-relative
        if (url.startsWith('//')) return `https:${url}`;

        // Bare CDN host
        const cdnHost = this._cdnBase.replace(/^https?:\/\//, '');
        if (url.startsWith(cdnHost)) return `https://${url}`;

        // Relative path
        if (url.startsWith('/')) return url; // serve from same origin (placeholder etc.)
        return `${this._cdnBase}/${url}`;
    }

    // Same normalisation as normalizeImgUrl but for audio URLs.
    // Returns null instead of a placeholder so callers can gate on truthiness.
    // Critical: Firestore stores bare "cdn.eporiamusic.com/artists/..." paths.
    // Without https:// the browser prepends the page origin, giving
    // http://localhost:3000/player/cdn.eporiamusic.com/... which 404s.
    normalizeAudioUrl(url) {
        if (!url) return null;
        const R2_DEV = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;
        if (url.startsWith('https://') || url.startsWith('http://')) {
            return R2_DEV.test(url) ? url.replace(R2_DEV, this._cdnBase) : url;
        }
        if (url.startsWith('//')) return `https:${url}`;
        const cdnHost = this._cdnBase.replace(/^https?:\/\//, '');
        if (url.startsWith(cdnHost)) return `https://${url}`;
        if (url.startsWith('/')) return url;
        return `${this._cdnBase}/${url}`;
    }

    // --- A. AUDIO LOGIC ---

    /**
     * Cue bus is a plain HTMLAudioElement — NOT routed through Tone.js.
     * This is the only way to route audio to a *separate* output device
     * (e.g. headphones) while Tone handles the main speakers, because
     * Tone's entire graph shares a single AudioContext destination.
     * HTMLAudioElement.setSinkId() lets us pick the output independently.
     */
    setupCueBus() {
        this.cueAudio = new Audio();
        this.cueAudio.volume = 0.85;
        this.cueAudio.onended = () => this.showCueStatus('🎧 Cue ready', 'idle');

        // Shim so any legacy code that references engine.cueBus doesn't throw
        this.engine.cueBus = { _isCueAudioElement: true };
    }

    async cueTrack(audioUrl, title) {
        // Cancel any in-flight play promise from a previous cue attempt.
        // We track it so we can ignore its rejection when we abort it.
        if (this._cuePlayPromise) {
            this._cueAborted = true;
        }

        try {
            this.cueAudio.pause();
            this.cueAudio.currentTime = 0;
            this.showCueStatus(`🎧 Cueing: ${title}`, 'active');

            const resolved = this.normalizeAudioUrl(audioUrl);
            if (!resolved) {
                this.showCueStatus('⚠️ No audio URL', 'error');
                return;
            }
            this.cueAudio.src = resolved;
            // load() cancels any in-flight fetch and starts a clean one,
            // preventing the "fetching aborted" DOMException on rapid src changes.
            this.cueAudio.load();

            this._cueAborted = false;
            this._cuePlayPromise = this.cueAudio.play();
            await this._cuePlayPromise;
            this._cuePlayPromise = null;
        } catch (e) {
            this._cuePlayPromise = null;
            // AbortError is expected when stopCue() is called before the audio
            // has buffered — the browser cancels the pending play() promise.
            // Firefox reports this as DOMException with name "AbortError" and a
            // message containing "aborted". Suppress it silently in both browsers.
            const isAbort = e.name === 'AbortError'
                || (e instanceof DOMException && e.message.toLowerCase().includes('abort'))
                || this._cueAborted;
            if (!isAbort) {
                console.error('Cue Error:', e);
                this.showCueStatus('⚠️ Cue failed', 'error');
            } else {
                this.showCueStatus('🎧 Cue ready', 'idle');
            }
        }
    }

    stopCue() {
        this._cueAborted = true;
        if (this.cueAudio) {
            this.cueAudio.pause();
            this.cueAudio.currentTime = 0;
            this.cueAudio.src = '';
        }
        this._cuePlayPromise = null;
        this.currentCue = null;
        this.showCueStatus('🎧 Cue ready', 'idle');
    }

    // --- OUTPUT DEVICE MANAGEMENT ---

    /**
     * Enumerate audio output devices and populate both selector dropdowns.
     * Must be called after a user gesture (button click) because browsers
     * require a permission prompt before exposing device labels.
     */
    async loadOutputDevices() {
        const mainSelect = document.getElementById('mainOutputSelect');
        const cueSelect  = document.getElementById('cueOutputSelect');
        if (!mainSelect && !cueSelect) return;

        try {
            // Trigger the permission prompt so labels are visible
            await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (_) { /* permission denied — still try to enumerate */ }

        let devices = [];
        try {
            const all = await navigator.mediaDevices.enumerateDevices();
            devices = all.filter(d => d.kind === 'audiooutput');
        } catch (e) {
            console.error('Device enumeration failed:', e);
            this.showToast('Could not list audio devices', 'error');
            return;
        }

        if (devices.length === 0) {
            this.showToast('No audio output devices found', 'warning');
            return;
        }

        const options = devices.map((d, i) =>
            `<option value="${d.deviceId}">${d.label || `Output ${i + 1}`}</option>`
        ).join('');

        if (mainSelect) mainSelect.innerHTML = options;
        if (cueSelect)  cueSelect.innerHTML  = options;

        // Restore saved selections
        const savedMain = localStorage.getItem('eporia_main_output');
        const savedCue  = localStorage.getItem('eporia_cue_output');
        if (savedMain && mainSelect) mainSelect.value = savedMain;
        if (savedCue  && cueSelect)  cueSelect.value  = savedCue;

        this.showToast(`${devices.length} output device(s) found`, 'success');
    }

    /**
     * Route the entire Tone.js audio graph to a chosen output device.
     * Uses the Web Audio spec's AudioContext.setSinkId() method.
     */
    async setMainOutputDevice(deviceId) {
        try {
            const ctx = Tone.getContext().rawContext;
            if (typeof ctx.setSinkId !== 'function') {
                this.showToast('Main output routing not supported in this browser', 'warning');
                return;
            }
            await ctx.setSinkId(deviceId);
            localStorage.setItem('eporia_main_output', deviceId);
            this.showToast('Main output updated 🔊', 'success');
        } catch (e) {
            console.error('Main output error:', e);
            this.showToast('Failed to set main output', 'error');
        }
    }

    /**
     * Route the cue HTMLAudioElement to a chosen output device (e.g. headphones).
     * HTMLAudioElement.setSinkId() is broadly supported and works independently
     * of the Tone.js AudioContext.
     */
    async setCueOutputDevice(deviceId) {
        try {
            if (typeof this.cueAudio.setSinkId !== 'function') {
                this.showToast('Cue output routing not supported in this browser', 'warning');
                return;
            }
            await this.cueAudio.setSinkId(deviceId);
            localStorage.setItem('eporia_cue_output', deviceId);
            this.showToast('Cue output updated 🎧', 'success');
        } catch (e) {
            console.error('Cue output error:', e);
            this.showToast('Failed to set cue output', 'error');
        }
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
        
        // Ensure we have all required fields INCLUDING GENRES
        const track = {
            id: trackData.id,
            title: trackData.title,
            artist: trackData.subtitle || trackData.artist || trackData.artistName || 'Unknown Artist',
            // normalizeImgUrl fixes raw R2 dev URLs and bare paths from Firestore
            img: this.normalizeImgUrl(trackData.img || trackData.artUrl),
            // normalizeAudioUrl ensures bare CDN hostnames get https:// prepended
            audioUrl: this.normalizeAudioUrl(trackData.audioUrl),
            duration: trackData.duration || 0,
            genre: trackData.genre || null,
            subgenre: trackData.subgenre || null,
            artistId: trackData.artistId || null
        };
        
        this.stack.push(track);
        
        // IMPROVED: Update genre tracking for BOTH genre and subgenre
        const genres = this.getGenresFromSong(track);
        genres.forEach(genre => {
            this.genreMap[genre] = (this.genreMap[genre] || 0) + 1;
        });
        
        this.renderStack();
        this.updateDNA();
        this.showToast(`Added: ${track.title}`, 'success');

        // Mark that unsaved changes exist — draft will be saved when the
        // user navigates away from the workbench, not on every add.
        this._hasUnsavedChanges = true;

        // Animate addition
        const cards = document.querySelectorAll('.stack-card');
        if (cards.length > 0) {
            const lastCard = cards[cards.length - 1];
            lastCard.style.animation = 'slideInRight 0.3s ease-out';
        }
    }

    removeFromStack(index) {
        const removed = this.stack[index];
        
        // IMPROVED: Update genre tracking for all genres from removed track
        const genres = this.getGenresFromSong(removed);
        genres.forEach(genre => {
            if (this.genreMap[genre]) {
                this.genreMap[genre]--;
                if (this.genreMap[genre] === 0) {
                    delete this.genreMap[genre];
                }
            }
        });
        
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

        // ── Container-level drop zone ──────────────────────────────────────────
        // Without these, drops into empty space (or below the last card) are
        // silently swallowed because there is no .stack-card element to catch them.
        container.ondragover = (e) => {
            // Only intercept if no card handled it already
            if (!e.target.closest('.stack-card')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                container.classList.add('drag-over-container');
            }
        };
        container.ondragleave = (e) => {
            if (!container.contains(e.relatedTarget)) {
                container.classList.remove('drag-over-container');
            }
        };
        container.ondrop = (e) => {
            container.classList.remove('drag-over-container');
            // Only handle if the drop didn't land on a .stack-card (those have
            // their own handler for reordering)
            if (e.target.closest('.stack-card')) return;
            e.preventDefault();
            const jsonData = e.dataTransfer.getData('application/json');
            if (jsonData) {
                try { this.addToStack(JSON.parse(jsonData)); }
                catch (err) { console.error('Container drop error:', err); }
            }
        };
        // ──────────────────────────────────────────────────────────────────────

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

            card.addEventListener('dragstart', (e) => this.handleDragStart(e, index));
            card.addEventListener('dragover',  (e) => this.handleDragOver(e));
            card.addEventListener('drop',      (e) => this.handleDrop(e, index));
            card.addEventListener('dragenter', (e) => this.handleDragEnter(e));
            card.addEventListener('dragleave', (e) => this.handleDragLeave(e));

            const trackNum  = String(index + 1).padStart(2, '0');
            const canPlay   = !!track.audioUrl;
            const canCue    = !!track.audioUrl;
            const safeTitle = (track.title  || 'Unknown').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safeAudio = track.audioUrl || '';

            card.innerHTML = `
                <div class="stack-card-main">
                    <span class="stack-number">${trackNum}</span>
                    <div class="stack-grip"><i class="fas fa-grip-vertical"></i></div>
                    <img src="${this.normalizeImgUrl(track.img)}"
                         class="stack-art"
                         alt="${track.title}"
                         onerror="this.src='/images/placeholder.png'">
                    <div class="stack-info">
                        <div class="stack-title">${track.title || 'Unknown'}</div>
                        <div class="stack-meta">
                            <span class="stack-artist">${track.artist || 'Unknown Artist'}</span>
                            ${track.duration ? `<span class="stack-duration">${this.formatDuration(track.duration)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="stack-actions">
                    <button class="btn-play-stack ${!canPlay ? 'disabled' : ''}"
                            ${canPlay ? `onclick="event.stopPropagation(); workbench.playStackTrack(${index})"` : ''}
                            title="Play">
                        <i class="fas fa-play"></i> Play
                    </button>
                    <button class="btn-cue-stack ${!canCue ? 'disabled' : ''}"
                            ${canCue ? `onmousedown="event.stopPropagation(); workbench.cueTrack('${safeAudio}', '${safeTitle}')"
                                       onmouseup="event.stopPropagation(); workbench.stopCue()"
                                       ontouchstart="event.stopPropagation(); workbench.cueTrack('${safeAudio}', '${safeTitle}')"
                                       ontouchend="event.stopPropagation(); workbench.stopCue()"` : ''}
                            title="Hold to cue">
                        <i class="fas fa-headphones"></i> Cue
                    </button>
                    <button class="btn-remove"
                            onclick="event.stopPropagation(); workbench.removeFromStack(${index})"
                            title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;

            container.appendChild(card);
        });

        // Update track count
        this.updateTrackCount();
    }

    /** Play a stack track directly through the main audio engine. */
    async playStackTrack(index) {
        const track = this.stack[index];
        if (!track || !track.audioUrl) {
            this.showToast('No audio available for this track', 'warning');
            return;
        }
        try {
            await this.engine.resumeAudioContext?.();

            // Stack stores artwork as `img` but the engine/player UI reads `artUrl`.
            // Pass both so whichever field any component reads is populated.
            const toEngineTrack = (t) => ({
                ...t,
                artUrl:   t.img || t.artUrl || '',
                img:      t.img || t.artUrl || '',
                audioUrl: t.audioUrl, // already normalized by addToStack
                duration: t.duration ? parseFloat(t.duration) : 0,
            });

            // Queue everything after the selected track so auto-advance works
            this.engine.clearQueue();
            this.stack.slice(index + 1).forEach(t => {
                if (t.audioUrl) this.engine.addToQueue(toEngineTrack(t));
            });

            await this.engine.play(track.id, toEngineTrack(track));
            this.showToast(`▶ ${track.title}`, 'success');
        } catch (e) {
            console.error('playStackTrack error:', e);
            this.showToast('Playback failed', 'error');
        }
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
            const token = await this._user.getIdToken();
            
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
            
            // Normalize URLs at render time so inline onmousedown attrs get
            // clean https:// URLs — bare CDN paths would resolve as relative
            // and 404 against localhost.
            const safeAudioUrl = this.normalizeAudioUrl(track.audioUrl);
            const safeArtUrl   = this.normalizeImgUrl(track.img || track.artUrl);

            // Make entire card draggable
            div.draggable = !inStack;
            if (!inStack) {
                div.addEventListener('dragstart', (e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('application/json', JSON.stringify({
                        ...track,
                        audioUrl: safeAudioUrl,
                        img:      safeArtUrl,
                        artUrl:   safeArtUrl,
                    }));
                });
            }
            
            // Ensure audioUrl exists before allowing cue
            const canCue = !!safeAudioUrl && !inStack;
            
            // Artist name: search API returns it as 'subtitle'
            const trackArtist = track.subtitle || track.artist || track.artistName || 'Unknown Artist';
            
            // ADDED: Get genres for display
            const genres = this.getGenresFromSong(track);
            const genreDisplay = genres.length > 0 
                ? `<span class="wb-genre">${genres.slice(0, 2).join(', ')}</span>` 
                : '';

            // Escape title for use in inline event handlers
            const safeTitle = track.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            
            div.innerHTML = `
                <div class="wb-card-left">
                    <img src="${safeArtUrl}" 
                         class="wb-mini-art" 
                         alt="${track.title}"
                         loading="lazy"
                         onerror="this.src='/images/placeholder.png'">
                    <div class="wb-info">
                        <span class="wb-title">${track.title}</span>
                        <span class="wb-artist">${trackArtist}</span>
                        ${genreDisplay}
                        ${track.duration ? `<span class="wb-duration">${this.formatDuration(track.duration)}</span>` : ''}
                    </div>
                </div>
                <div class="wb-actions">
                    <button class="btn-cue ${!canCue ? 'disabled' : ''}" 
                            ${canCue ? `onmousedown="workbench.cueTrack('${safeAudioUrl}', '${safeTitle}')"
                                       onmouseup="workbench.stopCue()"
                                       ontouchstart="workbench.cueTrack('${safeAudioUrl}', '${safeTitle}')"
                                       ontouchend="workbench.stopCue()"` : ''}
                            title="${inStack ? 'Already in crate' : canCue ? 'Hold to preview' : 'No audio URL'}">
                        <i class="fas fa-${inStack ? 'check' : 'headphones'}"></i>
                    </button>
                    <button class="btn-add-to-stack ${inStack ? 'disabled' : ''}" 
                            ${!inStack ? `onclick='workbench.addToStack(${JSON.stringify({
                                ...track,
                                audioUrl: safeAudioUrl,
                                img:      safeArtUrl,
                                artUrl:   safeArtUrl,
                            }).replace(/'/g, "&#39;")})'` : ''}
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
            const token = await this._user.getIdToken();
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
                
                // Clear draft since we've saved
                this.clearDraft();
                
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
        
        // Calculate average BPM (placeholder - would calculate from actual BPM data)
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
            .slice(0, 8); // INCREASED: Show top 8 genres instead of 6
        
        if (genres.length === 0) {
            container.innerHTML = '<span class="tag-placeholder">No genres yet</span>';
            return;
        }
        
        genres.forEach(([genre, count]) => {
            const tag = document.createElement('span');
            tag.className = 'genre-tag';
            tag.textContent = genre;  // CHANGED: Just show genre name, not count
            tag.title = `${count} track${count > 1 ? 's' : ''}`;  // Count in tooltip
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
    
    // Normalize image URLs — matches server-side normalizeUrl() logic.
    // Handles: full https, bare CDN hostname, relative paths.
    fixImageUrl(url) {
        const CDN = 'https://cdn.eporiamusic.com';
        if (!url) return '/images/placeholder.png';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        if (url.startsWith('cdn.eporiamusic.com')) return `https://${url}`;
        return `${CDN}/${url.replace(/^\//, '')}`;
    }

    formatDuration(seconds) {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    // IMPROVED: Helper to extract genres from song object
    getGenresFromSong(song) {
        const genres = [];
        
        // Get primary genre
        if (song.genre) {
            genres.push(song.genre);
        }
        
        // Get subgenre (only if different from genre)
        if (song.subgenre && song.subgenre !== song.genre) {
            genres.push(song.subgenre);
        }
        
        return genres.filter(g => g && g.trim()); // Remove empty values
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
            if (!this._user) {
                console.log('No user logged in, skipping crate load');
                return;
            }

            const token = await this._user.getIdToken();
            const uid = this._user.uid;
            
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
        // Only render when the workbench page is currently in the DOM.
        // loadUserCrates() is also triggered by the constructor's onAuthStateChanged
        // callback at app startup — long before the workbench page is loaded.
        // Without this guard every startup produces a false-positive warning.
        const pageEl = document.querySelector('.content-scroll[data-page="workbench"]');
        if (!pageEl) return;  // silently skip — onNavigatedTo() will re-call this

        // Try ID first, fall back to class selector
        const menu = document.getElementById('userCratesList')
                  || document.querySelector('.crate-menu-list');
        if (!menu) {
            console.warn('[Workbench] userCratesList element not found in workbench.pug.');
            return;
        }

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
            <div class="crate-menu-item">
                <div class="crate-menu-item-header">
                    <span class="crate-menu-item-title">${crate.title}</span>
                    <span class="crate-menu-item-date">${this.formatDate(crate.createdAt)}</span>
                </div>
                <div class="crate-menu-item-meta">
                    <span><i class="fas fa-music"></i> ${crate.trackCount || 0} tracks</span>
                    <span><i class="fas fa-heart"></i> ${crate.likes || 0} likes</span>
                </div>
                <div class="crate-menu-item-actions">
                    <button class="btn-crate-edit"
                            onclick="window.workbench.loadCrateForEditing('${crate.id}')"
                            title="Load crate for editing">
                        <i class="fas fa-pencil-alt"></i> Edit
                    </button>
                    <button class="btn-crate-add"
                            onclick="window.workbench.addCrateTracksToStack('${crate.id}')"
                            title="Append this crate's tracks to the current stack">
                        <i class="fas fa-layer-group"></i> Add to Stack
                    </button>
                </div>
            </div>
        `).join('');
    }

    /**
     * Fetch a saved crate and APPEND its tracks to the current stack without
     * switching into edit-mode.  Duplicates are skipped automatically because
     * addToStack() already guards for them.
     */
    async addCrateTracksToStack(crateId) {
        try {
            this.toggleCrateMenu();
            this.showToast('Loading crate tracks…', 'info');

            const token = await this._user.getIdToken();
            const res   = await fetch(`/player/api/crate/${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (!data.tracks || data.tracks.length === 0) {
                this.showToast('Crate is empty', 'warning');
                return;
            }

            let added = 0;
            for (const track of data.tracks) {
                const normalised = {
                    id:       track.id,
                    title:    track.title,
                    artist:   track.artist,
                    img:      this.normalizeImgUrl(track.artUrl || track.img),
                    audioUrl: this.normalizeAudioUrl(track.audioUrl),
                    duration: track.duration,
                    genre:    track.genre,
                    subgenre: track.subgenre
                };
                if (!this.stack.some(t => t.id === normalised.id)) {
                    // Bypass showToast spam — call the core logic directly
                    this.stack.push(normalised);
                    const genres = this.getGenresFromSong(normalised);
                    genres.forEach(g => { this.genreMap[g] = (this.genreMap[g] || 0) + 1; });
                    added++;
                }
            }

            this.renderStack();
            this.updateDNA();
            this._hasUnsavedChanges = true;

            const skipped = data.tracks.length - added;
            const msg = skipped > 0
                ? `Added ${added} track(s) — ${skipped} duplicate(s) skipped`
                : `Added ${added} track(s) from "${data.title}"`;
            this.showToast(msg, 'success');

        } catch (e) {
            console.error('addCrateTracksToStack error:', e);
            this.showToast('Failed to load crate tracks', 'error');
        }
    }

    toggleCrateMenu() {
        // Try ID first, fall back to class selector.
        // The pug may use either id="crateLoadMenu" or just class="crate-menu".
        const menu = document.getElementById('crateLoadMenu')
                  || document.querySelector('.crate-menu');
        if (!menu) {
            console.warn('[Workbench] crateLoadMenu element not found — check workbench.pug for id="crateLoadMenu" on .crate-menu');
            return;
        }

        const isOpening = !menu.classList.contains('active');
        menu.classList.toggle('active');

        // Belt-and-braces: also toggle display in case the pug hides it with
        // style="display:none" rather than relying solely on the CSS opacity trick.
        if (isOpening) {
            menu.style.display = 'block';
        } else {
            // Small delay so the CSS close transition plays before we hide it
            setTimeout(() => {
                if (!menu.classList.contains('active')) menu.style.display = '';
            }, 300);
        }

        if (!isOpening) return;

        // If we already have crates cached, render immediately so the menu
        // is never blank on open while the fetch runs.
        if (this.userCrates?.length) {
            this.renderCrateMenu();
        }

        if (this._user) {
            this.loadUserCrates();
        } else {
            const list = document.getElementById('userCratesList')
                      || document.querySelector('.crate-menu-list');
            if (list && !this.userCrates?.length) {
                list.innerHTML = `
                    <div class="loading-crates">
                        <i class="fas fa-spinner fa-spin"></i>
                        <p>Loading your crates…</p>
                    </div>`;
            }
            let unsub;
            unsub = onAuthStateChanged(auth, (user) => {
                if (unsub) unsub();
                if (user) {
                    this._user = user;
                    this.loadUserCrates();
                }
            });
        }
    }

    async loadCrateForEditing(crateId) {
        try {
            // Close the menu
            this.toggleCrateMenu();
            
            // Show loading
            this.showToast('Loading crate...', 'info');
            
            const token = await this._user.getIdToken();
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
            
            // IMPROVED: Populate tracks with genre AND subgenre
            this.stack = data.tracks.map(track => ({
                id: track.id,
                title: track.title,
                artist: track.artist,
                // normalizeImgUrl handles raw R2 dev URLs from older Firestore docs
                img: this.normalizeImgUrl(track.artUrl || track.img),
                audioUrl: this.normalizeAudioUrl(track.audioUrl),
                duration: track.duration,
                genre: track.genre,
                subgenre: track.subgenre  // ADDED: Include subgenre when loading
            }));
            
            // Load cover image if exists
            if (data.coverImage) {
                this.loadCoverImage(data.coverImage);
            }
            
            // IMPROVED: Update genres from all tracks
            this.genreMap = {};
            this.stack.forEach(track => {
                const genres = this.getGenresFromSong(track);
                genres.forEach(genre => {
                    this.genreMap[genre] = (this.genreMap[genre] || 0) + 1;
                });
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

    // --- DRAFT AUTO-SAVE FUNCTIONALITY ---
    // --- DRAFT AUTO-SAVE FUNCTIONALITY (DATABASE-BACKED) ---
    scheduleDraftSave() {
        // Clear existing timer
        if (this.draftSaveTimer) {
            clearTimeout(this.draftSaveTimer);
        }

        // Save after 3 seconds of inactivity
        this.draftSaveTimer = setTimeout(() => {
            this.saveDraft();
        }, 3000);
    }

    async saveDraft() {
        // Don't save draft if editing an existing crate
        if (this.editMode) return;

        // Don't save empty drafts
        if (this.stack.length === 0) {
            this.clearDraft();
            return;
        }

        const titleInput = document.getElementById('crateTitleInput');
        const draftData = {
            title: titleInput?.value || '',
            tracks: this.stack,
            genreMap: this.genreMap,
            coverImage: this.coverImage
        };

        try {
            const token = await this._user.getIdToken();
            const res = await fetch('/player/api/draft/save', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(draftData)
            });

            const data = await res.json();
            
            if (data.success) {
                this.hasDraft = true;
                this.showDraftStatus();
                this.updateDraftMenuOption();
            }
        } catch (e) {
            console.error('Error saving draft:', e);
        }
    }

    async loadDraft() {
        try {
            const token = await this._user.getIdToken();
            const res = await fetch('/player/api/draft/get', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await res.json();
            
            if (!data.hasDraft) {
                this.showToast('No draft found', 'info');
                return;
            }

            // Close menu
            this.toggleCrateMenu();

            // Confirm if there's current work
            if (this.stack.length > 0) {
                if (!confirm('Load draft? Current work will be replaced.')) {
                    return;
                }
            }

            const draft = data.draft;

            // Load draft data
            this.stack = draft.tracks || [];
            this.genreMap = draft.genreMap || {};
            this.coverImage = draft.coverImage || null;

            // Update UI
            const titleInput = document.getElementById('crateTitleInput');
            if (titleInput && draft.title) {
                titleInput.value = draft.title;
            }

            if (this.coverImage) {
                this.loadCoverImage(this.coverImage);
            }

            this.renderStack();
            this.updateDNA();

            this.showToast('Draft loaded successfully', 'success');

        } catch (e) {
            console.error('Error loading draft:', e);
            this.showToast('Error loading draft', 'error');
        }
    }

    async checkForDraft() {
        if (!this._user) return;

        try {
            const token = await this._user.getIdToken();
            const res = await fetch('/player/api/draft/get', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await res.json();
            
            if (data.hasDraft) {
                this.hasDraft = true;
                this.updateDraftMenuOption();
            }
        } catch (e) {
            console.error('Error checking draft:', e);
        }
    }

    async clearDraft() {
        try {
            const token = await this._user.getIdToken();
            await fetch('/player/api/draft/delete', {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            this.hasDraft = false;
            this.hideDraftStatus();
            this.updateDraftMenuOption();
        } catch (e) {
            console.error('Error clearing draft:', e);
        }
        this.hasDraft = false;
        this.hideDraftStatus();
        this.updateDraftMenuOption();
    }
    

    showDraftStatus() {
        const indicator = document.getElementById('draftStatus');
        if (!indicator) return;

        // Clear any previous hide timer
        if (this._draftStatusTimer) clearTimeout(this._draftStatusTimer);

        indicator.style.display  = 'flex';
        indicator.style.opacity  = '1';
        indicator.style.transition = 'opacity 0.4s';

        // Fade out after 2 s then fully hide
        this._draftStatusTimer = setTimeout(() => {
            indicator.style.opacity = '0';
            setTimeout(() => {
                indicator.style.display = 'none';
                indicator.style.opacity = '1'; // reset for next show
            }, 420);
        }, 2000);
    }

    hideDraftStatus() {
        const indicator = document.getElementById('draftStatus');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    updateDraftMenuOption() {
        const draftOption = document.getElementById('draftOption');
        if (!draftOption) return;

        if (this.hasDraft && !this.editMode) {
            draftOption.style.display = 'block';
        } else {
            draftOption.style.display = 'none';
        }
    }

    getTimeSince(date) {
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 120) return '1 minute ago';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 7200) return '1 hour ago';
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return 'yesterday';
    }


    /**
     * Called by appRouter BEFORE navigating away from the workbench.
     * Saves the current stack as a draft if there are unsaved changes.
     */
    async saveDraftIfNeeded() {
        if (!this._hasUnsavedChanges || this.editMode) return;
        if (!this._user || this.stack.length === 0) return;
        await this.saveDraft();
        this._hasUnsavedChanges = false;
    }

    /**
     * Called by uiController.checkAndReloadViews() on every SPA navigation
     * to the workbench page. Re-renders the stack, refreshes the DNA panel,
     * and reloads crates + draft from the server so the sidebar is current.
     */
    onNavigatedTo() {
        this.renderStack();
        this.updateDNA();
        // Show the device permission banner if appropriate.
        // Must be called here (not just in the pug script) because appRouter
        // strips inline scripts on SPA navigation — _registerGlobals() ensures
        // window.initDeviceBanner is always defined.
        if (typeof window.initDeviceBanner === 'function') {
            window.initDeviceBanner();
        }
        if (this._user) {
            this.loadUserCrates();
            this.checkForDraft();
        } else {
            let unsub;
            unsub = onAuthStateChanged(auth, (user) => {
                if (unsub) unsub();
                if (user) {
                    this._user = user;
                    this.loadUserCrates();
                    this.checkForDraft();
                }
            });
        }
    }
}