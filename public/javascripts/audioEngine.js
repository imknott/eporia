/* public/javascripts/audioEngine.js */
import * as Tone from 'https://esm.sh/tone@14.7.77';

export class AudioPlayerEngine {
    constructor() {
        this.masterBus = new Tone.Gain(1).toDestination();
        this.cueBus    = new Tone.Gain(1).toDestination();
        this.limiter   = new Tone.Compressor({ threshold: -24, ratio: 4, attack: 0.003, release: 0.25 }).connect(this.masterBus);
        this.eq        = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 400, highFrequency: 2500 }).connect(this.limiter);
        this.crossfader= new Tone.CrossFade(0).connect(this.eq);

        this.playerA = new Tone.Player({ fadeIn: 0.1, fadeOut: 0.1 });
        this.playerB = new Tone.Player({ fadeIn: 0.1, fadeOut: 0.1 });
        this.playerA.connect(this.crossfader.a);
        this.playerB.connect(this.crossfader.b);

        this.preloadPlayer  = new Tone.Player();
        this.preloadCache   = new Map();
        this.preloadQueue   = [];
        this.maxCacheSize   = 5;
        this.preloadAhead   = 2;

        this.activeDeck    = 'A';
        this.currentTrack  = null;
        this.queue         = [];
        this.history       = []; // FIX: history for go-back functionality

        this.startTime     = 0;
        this.pausedAt      = 0;
        this.isPlaying     = false;
        this.trackDuration = 0;

        // FIX: nonce prevents stale async play() calls from clobbering newer ones
        this._playCounter      = 0;
        // FIX: stored crossfade timeout so rapid track changes can cancel it
        this._crossfadeTimeout = null;

        this.audioQuality     = 'auto';
        this.supportedFormats = this.detectSupportedFormats();

        this.crossfadeTime      = 3;
        this.gaplessPlayback    = true;
        this.autoFadeOut        = true;
        this.fadeOutStartOffset = 5;

        this.playbackStats = { totalPlays: 0, totalListenTime: 0, buffering: false, lastBufferTime: 0 };

        this.listeners = {
            stateChange: [], progress: [], error: [], queueUpdate: [],
            bufferStart: [], bufferEnd: [], trackEnd: [], preloadComplete: [],
            historyUpdate: []
        };

        this.startProgressLoop();
        this.startPreloadManager();
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    /**
     * Resume the Tone.js AudioContext.  Called from enhancedPlayer.js on the
     * first user gesture so we never hit the "AudioContext prevented from
     * starting automatically" browser block.  Tone.start() is idempotent —
     * safe to call even if the context is already running.
     */
    async resumeAudioContext() {
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
    }

    /**
     * Route the entire Tone.js audio graph to a chosen hardware output.
     * Delegates to AudioContext.setSinkId() — available in Chrome/Edge 110+.
     * Returns a Promise that resolves when the switch is complete.
     */
    async setMainOutputDevice(deviceId) {
        const ctx = Tone.getContext().rawContext;
        if (typeof ctx.setSinkId !== 'function') {
            throw new Error('AudioContext.setSinkId() is not supported in this browser.');
        }
        await ctx.setSinkId(deviceId);
    }

    detectSupportedFormats() {
        const a = new Audio();
        return {
            flac: a.canPlayType('audio/flac')  !== '',
            alac: a.canPlayType('audio/x-m4a') !== '',
            wav:  a.canPlayType('audio/wav')   !== '',
            aiff: a.canPlayType('audio/aiff')  !== '',
            ogg:  a.canPlayType('audio/ogg')   !== '',
            opus: a.canPlayType('audio/opus')  !== '',
            mp3:  a.canPlayType('audio/mpeg')  !== '',
            aac:  a.canPlayType('audio/mp4')   !== ''
        };
    }

    selectBestAudioUrl(track) {
        const urls = track.audioUrls || {};
        if (track.audioUrl) return track.audioUrl;
        switch (this.audioQuality) {
            case 'lossless':
                if (urls.lossless && this.supportedFormats.flac) return urls.lossless;
                // fallthrough
            case 'high':   return urls.high   || urls.medium || urls.lossless;
            case 'medium': return urls.medium || urls.high;
            case 'auto': default:
                if (this.isGoodConnection() && urls.high) return urls.high;
                return urls.medium || urls.high || urls.lossless;
        }
    }

    isGoodConnection() {
        if ('connection' in navigator) {
            const c = navigator.connection;
            return c.effectiveType === '4g' || c.downlink > 5;
        }
        return true;
    }

    // Returns { label, tier } — attached to currentTrack as _qualityInfo
    _detectQuality(resolvedUrl, track) {
        // 1. Explicit quality metadata wins
        if (track.quality) {
            const q = track.quality.toLowerCase();
            if (q === 'flac' || q === 'lossless') return { label: 'FLAC', tier: 'lossless' };
            if (q === 'wav')                       return { label: 'WAV',  tier: 'lossless' };
            if (q === 'alac')                      return { label: 'ALAC', tier: 'lossless' };
            if (q === '320' || q === '320k')       return { label: '320K', tier: 'high' };
            if (q === '192' || q === '192k')       return { label: '192K', tier: 'standard' };
            return { label: track.quality.toUpperCase(), tier: 'standard' };
        }
        // 2. Match resolved URL against audioUrls tiers
        if (track.audioUrls && resolvedUrl) {
            if (resolvedUrl === track.audioUrls.lossless) return { label: 'FLAC', tier: 'lossless' };
            if (resolvedUrl === track.audioUrls.high)     return { label: '320K', tier: 'high' };
            if (resolvedUrl === track.audioUrls.medium)   return { label: '192K', tier: 'standard' };
        }
        // 3. URL sniffing fallback
        const u = (resolvedUrl || '').toLowerCase();
        if (u.includes('.flac'))                        return { label: 'FLAC', tier: 'lossless' };
        if (u.includes('.wav'))                         return { label: 'WAV',  tier: 'lossless' };
        if (u.includes('.m4a') && u.includes('alac'))   return { label: 'ALAC', tier: 'lossless' };
        if (u.includes('320'))                          return { label: '320K', tier: 'high' };
        if (u.includes('192'))                          return { label: '192K', tier: 'standard' };
        return { label: 'MP3', tier: 'standard' };
    }

    // play(trackId, metadata, { addToHistory })
    // addToHistory: false when called from playPrevious() so we don't
    // re-add the destination track to history while navigating back.
    async play(trackId, metadata = {}, { addToHistory = true } = {}) {
        if (Tone.context.state !== 'running') await Tone.start();

        // Each call gets a unique nonce. After every await we verify it's still
        // the latest call — if not, a newer play() was called while we were loading.
        const nonce = ++this._playCounter;

        // Cancel any crossfade timeout from the previous track
        if (this._crossfadeTimeout) {
            clearTimeout(this._crossfadeTimeout);
            this._crossfadeTimeout = null;
        }

        const fileUrl = this.selectBestAudioUrl(metadata);
        if (!fileUrl) {
            console.warn('[Engine] No audio URL for:', metadata.title);
            this.emit('error', new Error('No audio URL available'));
            return;
        }

        const loadingDeck = this.activeDeck === 'A' ? this.playerB : this.playerA;
        const nextDeckChar = this.activeDeck === 'A' ? 'B' : 'A';

        try {
            let buffer = this.preloadCache.get(trackId);
            if (buffer) {
                loadingDeck.buffer = buffer;
            } else {
                this.emit('bufferStart', { track: metadata });
                this.playbackStats.buffering = true;
                this.playbackStats.lastBufferTime = Date.now();

                await loadingDeck.load(fileUrl);

                // STALE CHECK: if user clicked another track while this was loading,
                // _playCounter has moved on — abort to prevent wrong audio/metadata mismatch
                if (nonce !== this._playCounter) {
                    console.log('[Engine] Stale load for "' + metadata.title + '" discarded.');
                    return;
                }

                this.playbackStats.buffering = false;
                this.emit('bufferEnd', { track: metadata });
                this.cacheBuffer(trackId, loadingDeck.buffer);
            }

            if (nonce !== this._playCounter) return; // final check before committing

            // Save current track to history before replacing it.
            // We snapshot the fully-resolved URL so playPrevious() can play
            // immediately from the preload cache or the buffer — no re-fetch needed.
            if (addToHistory && this.currentTrack) {
                this.history.push({ ...this.currentTrack });
                if (this.history.length > 50) this.history.shift();
                this.emit('historyUpdate', this.history);
            }

            this.trackDuration = metadata.duration || loadingDeck.buffer.duration;
            const oldDeck = this.activeDeck === 'A' ? this.playerA : this.playerB;

            // Halt progress loop for the old track so bar doesn't sit at old position
            this.isPlaying = false;

            if (this.crossfadeTime > 0 && oldDeck.state === 'started') {
                loadingDeck.start();
                this.crossfader.fade.rampTo(nextDeckChar === 'B' ? 1 : 0, this.crossfadeTime);
                this._crossfadeTimeout = setTimeout(() => {
                    oldDeck.stop();
                    this._crossfadeTimeout = null;
                }, this.crossfadeTime * 1000 + 100);
            } else {
                oldDeck.stop();
                loadingDeck.start();
                this.crossfader.fade.value = nextDeckChar === 'B' ? 1 : 0;
            }

            this.startTime  = Tone.now();
            this.pausedAt   = 0;
            this.isPlaying  = true;
            this.activeDeck = nextDeckChar;

            const qualityInfo = this._detectQuality(fileUrl, metadata);
            this.currentTrack = {
                id: trackId, ...metadata,
                duration:     this.trackDuration,
                _resolvedUrl: fileUrl,
                _qualityInfo: qualityInfo
            };

            this.playbackStats.totalPlays++;
            this.emit('stateChange', { track: this.currentTrack, isPlaying: true });
            // Queue update also triggers history section re-render in UI
            this.emit('queueUpdate', this.queue);
            this.triggerPreload();

        } catch (e) {
            if (nonce !== this._playCounter) return;
            console.error('[Engine] Play error:', e);
            this.playbackStats.buffering = false;
            this.emit('error', { error: e, track: metadata });
            if (e.message && (e.message.includes('network') || e.message.includes('fetch'))) {
                setTimeout(() => this.play(trackId, metadata), 2000);
            }
        }
    }

    // Go back to the previous track in history.
    // If called within 3 seconds of start, go to the actual previous track.
    // Otherwise just restart from the beginning (standard player convention).
    playPrevious() {
        const currentTime = this.isPlaying ? Tone.now() - this.startTime : this.pausedAt;

        // If we're more than 3 s in, just restart the current track
        if (currentTime > 3 && this.currentTrack) {
            this.seek(0);
            return;
        }

        if (this.history.length === 0) {
            this.seek(0);
            return;
        }

        const prev = this.history.pop();
        this.emit('historyUpdate', this.history);

        // Put current track back at the front of the queue so forward still works
        if (this.currentTrack) {
            this.queue.unshift({ ...this.currentTrack });
            this.emit('queueUpdate', this.queue);
        }

        // addToHistory:false prevents the track we're going back TO from being
        // immediately re-added to history on the play() call below
        this.play(prev.id, prev, { addToHistory: false });
    }

    async triggerPreload() {
        const tracksToPreload = this.queue.slice(0, this.preloadAhead);
        for (const track of tracksToPreload) {
            if (!this.preloadCache.has(track.id)) this.preloadQueue.push(track);
        }
    }

    async startPreloadManager() {
        const preloadNext = async () => {
            if (this.preloadQueue.length === 0 || this.playbackStats.buffering) {
                setTimeout(preloadNext, 1000);
                return;
            }
            const track = this.preloadQueue.shift();
            try {
                const fileUrl = this.selectBestAudioUrl(track);
                if (!fileUrl) { setTimeout(preloadNext, 100); return; }
                await this.preloadPlayer.load(fileUrl);
                this.cacheBuffer(track.id, this.preloadPlayer.buffer);
                this.emit('preloadComplete', { track });
            } catch (e) { console.warn('Preload failed for ' + track.title + ':', e); }
            setTimeout(preloadNext, 500);
        };
        preloadNext();
    }

    cacheBuffer(trackId, buffer) {
        if (this.preloadCache.size >= this.maxCacheSize) {
            const firstKey = this.preloadCache.keys().next().value;
            this.preloadCache.delete(firstKey);
        }
        this.preloadCache.set(trackId, buffer);
    }

    addToQueue(track) {
        this.queue.push(track);
        this.emit('queueUpdate', this.queue);
        this.triggerPreload();
    }

    removeFromQueue(index) {
        if (index >= 0 && index < this.queue.length) {
            const removed = this.queue.splice(index, 1)[0];
            this.emit('queueUpdate', this.queue);
            this.preloadCache.delete(removed.id);
            return removed;
        }
    }

    clearQueue() {
        this.queue = [];
        this.preloadQueue = [];
        this.emit('queueUpdate', this.queue);
    }

    clearHistory() {
        this.history = [];
        this.emit('queueUpdate', this.queue);
    }

    playNext() {
        if (this.queue.length > 0) {
            const nextTrack = this.queue.shift();
            this.emit('queueUpdate', this.queue);
            this.emit('trackEnd', { track: this.currentTrack });
            this.play(nextTrack.id, nextTrack);
        } else {
            this.gracefulStop();
        }
    }

    gracefulStop() {
        const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
        if (this.autoFadeOut) {
            deck.volume.rampTo(-60, 2);
            setTimeout(() => {
                deck.stop();
                this.isPlaying = false;
                this.emit('stateChange', { track: this.currentTrack, isPlaying: false });
                this.emit('trackEnd',    { track: this.currentTrack });
            }, 2000);
        } else {
            deck.stop();
            this.isPlaying = false;
            this.emit('stateChange', { track: this.currentTrack, isPlaying: false });
            this.emit('trackEnd',    { track: this.currentTrack });
        }
    }

    togglePlay() {
        const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
        if (this.isPlaying) {
            deck.stop();
            this.pausedAt  = Tone.now() - this.startTime;
            this.isPlaying = false;
        } else {
            if (this.currentTrack) {
                deck.start(0, this.pausedAt);
                this.startTime = Tone.now() - this.pausedAt;
                this.isPlaying = true;
            }
        }
        this.emit('stateChange', { track: this.currentTrack, isPlaying: this.isPlaying });
    }

    seek(seconds) {
        if (!this.currentTrack) return;
        const deck     = this.activeDeck === 'A' ? this.playerA : this.playerB;
        const seekTime = Math.max(0, Math.min(seconds, this.trackDuration));
        if (this.isPlaying) {
            deck.stop();
            deck.start(Tone.now(), seekTime);
            this.startTime = Tone.now() - seekTime;
        } else {
            this.pausedAt = seekTime;
        }
        this.emit('progress', { progress: seekTime / this.trackDuration, currentTime: seekTime, duration: this.trackDuration });
    }

    skipForward(seconds  = 10) { if (!this.currentTrack) return; const t = this.isPlaying ? (Tone.now() - this.startTime) : this.pausedAt; this.seek(t + seconds); }
    skipBackward(seconds = 10) { if (!this.currentTrack) return; const t = this.isPlaying ? (Tone.now() - this.startTime) : this.pausedAt; this.seek(t - seconds); }

    // ============================================================
    // PROGRESS LOOP
    //
    // BUG that was here: the gapless branch did `this.playNext(); return;`
    // which bypassed `requestAnimationFrame(update)` at the bottom, killing
    // the loop permanently. The progress bar would then freeze at whatever
    // position it was at when track end was detected.
    //
    // FIX: set isPlaying=false BEFORE calling playNext() so the loop stops
    // emitting stale events for the old track. Then let execution fall through
    // to requestAnimationFrame so the loop stays alive for the incoming track.
    // ============================================================
    startProgressLoop() {
        const update = () => {
            if (this.isPlaying && this.currentTrack && this.trackDuration > 0) {
                const currentTime = Tone.now() - this.startTime;

                if (this.gaplessPlayback && currentTime >= this.trackDuration - 0.1) {
                    this.isPlaying = false; // stop emitting for the old track
                    this.playNext();
                    // NO return — fall through to requestAnimationFrame below
                } else {
                    if (this.autoFadeOut &&
                        currentTime >= this.trackDuration - this.fadeOutStartOffset &&
                        currentTime < this.trackDuration - this.crossfadeTime) {
                        const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
                        deck.volume.rampTo(-6, this.fadeOutStartOffset - this.crossfadeTime);
                    }
                    this.playbackStats.totalListenTime += 0.1;
                    const clamped = Math.min(currentTime, this.trackDuration);
                    this.emit('progress', {
                        progress:    clamped / this.trackDuration,
                        currentTime: clamped,
                        duration:    this.trackDuration,
                        buffering:   this.playbackStats.buffering
                    });
                }
            }
            requestAnimationFrame(update); // ALWAYS called — loop never dies
        };
        requestAnimationFrame(update);
    }

    updateSettings(settings) {
        this.settings      = settings;
        this.crossfadeTime = parseFloat(settings.crossfade) || 3;
        if (settings.audioQuality) this.audioQuality = settings.audioQuality;
        if (settings.normalizeVolume) { this.limiter.threshold.value = -24; this.limiter.ratio.value = 4; }
        else { this.limiter.threshold.value = 0; this.limiter.ratio.value = 1; }
        if (settings.eqHigh !== undefined) this.eq.high.value = settings.eqHigh;
        if (settings.eqMid  !== undefined) this.eq.mid.value  = settings.eqMid;
        if (settings.eqLow  !== undefined) this.eq.low.value  = settings.eqLow;
        if (settings.gaplessPlayback !== undefined) this.gaplessPlayback = settings.gaplessPlayback;
        if (settings.preloadAhead) this.preloadAhead = parseInt(settings.preloadAhead);
    }

    setVolume(value) { this.masterBus.gain.rampTo(value, 0.1); }
    setEQ(low, mid, high) { this.eq.low.value = low; this.eq.mid.value = mid; this.eq.high.value = high; }

    replay() { if (this.currentTrack) { this.seek(0); if (!this.isPlaying) this.togglePlay(); } }

    shuffleQueue() {
        for (let i = this.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
        }
        this.emit('queueUpdate', this.queue);
    }

    getStats() {
        return { ...this.playbackStats, cacheSize: this.preloadCache.size, queueLength: this.queue.length, historyLength: this.history.length, currentTrack: this.currentTrack };
    }

    clearCache() { this.preloadCache.clear(); }

    cleanup() {
        if (this._crossfadeTimeout) clearTimeout(this._crossfadeTimeout);
        this.playerA.dispose(); this.playerB.dispose(); this.preloadPlayer.dispose();
        this.crossfader.dispose(); this.eq.dispose(); this.limiter.dispose();
        this.masterBus.dispose(); this.cueBus.dispose(); this.preloadCache.clear();
    }

    emit(event, data) { if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data)); }
    on(event, cb)     { if (this.listeners[event]) this.listeners[event].push(cb); }
    off(event, cb)    { if (this.listeners[event]) this.listeners[event] = this.listeners[event].filter(c => c !== cb); }
}