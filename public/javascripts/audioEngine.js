/* public/javascripts/audioEngine.js - Enhanced Version */
import * as Tone from 'https://esm.sh/tone@14.7.77';

export class AudioPlayerEngine {
    constructor() {
        // ========================================
        // AUDIO ROUTING & EFFECTS
        // ========================================
        this.masterBus = new Tone.Gain(1).toDestination();
        this.cueBus = new Tone.Gain(1).toDestination(); // Headphone/Preview bus
        
        this.limiter = new Tone.Compressor({ 
            threshold: -24, 
            ratio: 4,
            attack: 0.003,
            release: 0.25 
        }).connect(this.masterBus);
        
        this.eq = new Tone.EQ3({ 
            low: 0, 
            mid: 0, 
            high: 0,
            lowFrequency: 400,
            highFrequency: 2500
        }).connect(this.limiter);
        
        // Crossfader with exponential curve for smooth transitions
        this.crossfader = new Tone.CrossFade(0).connect(this.eq);

        // ========================================
        // DUAL DECK SYSTEM
        // ========================================
        this.playerA = new Tone.Player({ fadeIn: 0.1, fadeOut: 0.1 });
        this.playerB = new Tone.Player({ fadeIn: 0.1, fadeOut: 0.1 });
        this.playerA.connect(this.crossfader.a);
        this.playerB.connect(this.crossfader.b);

        // ========================================
        // PRELOAD SYSTEM
        // ========================================
        this.preloadPlayer = new Tone.Player(); // Dedicated preload player
        this.preloadCache = new Map(); // Buffer cache: trackId -> AudioBuffer
        this.preloadQueue = []; // Tracks queued for preloading
        this.maxCacheSize = 5; // Max number of tracks to cache
        this.preloadAhead = 2; // Number of tracks to preload ahead

        // ========================================
        // PLAYBACK STATE
        // ========================================
        this.activeDeck = 'A'; 
        this.currentTrack = null;
        this.queue = []; 
        
        this.startTime = 0;
        this.pausedAt = 0;
        this.isPlaying = false;
        this.trackDuration = 0;

        // ========================================
        // AUDIO QUALITY & FORMAT SUPPORT
        // ========================================
        this.audioQuality = 'auto'; // 'auto', 'lossless', 'high', 'medium'
        this.supportedFormats = this.detectSupportedFormats();
        
        // ========================================
        // TRANSITION SETTINGS
        // ========================================
        this.crossfadeTime = 3; // Seconds
        this.gaplessPlayback = true;
        this.autoFadeOut = true;
        this.fadeOutStartOffset = 5; // Start fade X seconds before track ends
        
        // ========================================
        // ANALYTICS & MONITORING
        // ========================================
        this.playbackStats = {
            totalPlays: 0,
            totalListenTime: 0,
            buffering: false,
            lastBufferTime: 0
        };

        // ========================================
        // EVENT SYSTEM
        // ========================================
        this.listeners = { 
            stateChange: [], 
            progress: [], 
            error: [], 
            queueUpdate: [],
            bufferStart: [],
            bufferEnd: [],
            trackEnd: [],
            preloadComplete: []
        };

        // ========================================
        // INITIALIZATION
        // ========================================
        this.startProgressLoop();
        this.startPreloadManager();
        
        // Auto-cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    // ========================================
    // FORMAT DETECTION
    // ========================================
    detectSupportedFormats() {
        const audio = new Audio();
        return {
            flac: audio.canPlayType('audio/flac') !== '',
            alac: audio.canPlayType('audio/x-m4a') !== '',
            wav: audio.canPlayType('audio/wav') !== '',
            aiff: audio.canPlayType('audio/aiff') !== '',
            ogg: audio.canPlayType('audio/ogg') !== '',
            opus: audio.canPlayType('audio/opus') !== '',
            mp3: audio.canPlayType('audio/mpeg') !== '',
            aac: audio.canPlayType('audio/mp4') !== ''
        };
    }

    // ========================================
    // SMART URL SELECTION (Lossless Support)
    // ========================================
    selectBestAudioUrl(track) {
        // Track can have multiple quality URLs:
        // track.audioUrls = {
        //   lossless: 'url_to_flac',
        //   high: 'url_to_320kbps_mp3',
        //   medium: 'url_to_192kbps_mp3'
        // }
        
        const urls = track.audioUrls || {};
        
        // If single URL provided (backward compatibility)
        if (track.audioUrl) return track.audioUrl;
        
        // Quality preference based on settings
        switch(this.audioQuality) {
            case 'lossless':
                if (urls.lossless && this.supportedFormats.flac) return urls.lossless;
                // Fallback to high
            case 'high':
                return urls.high || urls.medium || urls.lossless;
            case 'medium':
                return urls.medium || urls.high;
            case 'auto':
            default:
                // Auto-detect based on connection
                if (this.isGoodConnection() && urls.high) return urls.high;
                return urls.medium || urls.high || urls.lossless;
        }
    }

    isGoodConnection() {
        // Use Network Information API if available
        if ('connection' in navigator) {
            const conn = navigator.connection;
            return conn.effectiveType === '4g' || conn.downlink > 5;
        }
        return true; // Default to high quality
    }

    // ========================================
    // ENHANCED PLAY FUNCTION
    // ========================================
    async play(trackId, metadata = {}) {
        if (Tone.context.state !== 'running') await Tone.start();

        const fileUrl = this.selectBestAudioUrl(metadata);
        if (!fileUrl) { 
            console.warn("No audio URL"); 
            this.emit('error', new Error('No audio URL available'));
            return; 
        }

        const loadingDeck = this.activeDeck === 'A' ? this.playerB : this.playerA;
        const nextDeckChar = this.activeDeck === 'A' ? 'B' : 'A';

        try {
            // Check if already cached/preloaded
            let buffer = this.preloadCache.get(trackId);
            
            if (buffer) {
                console.log(`✨ Using preloaded buffer for: ${metadata.title}`);
                loadingDeck.buffer = buffer;
            } else {
                // Not preloaded - load now
                this.emit('bufferStart', { track: metadata });
                this.playbackStats.buffering = true;
                this.playbackStats.lastBufferTime = Date.now();
                
                await loadingDeck.load(fileUrl);
                
                this.playbackStats.buffering = false;
                this.emit('bufferEnd', { track: metadata });
                
                // Cache for future use
                this.cacheBuffer(trackId, loadingDeck.buffer);
            }
            
            this.trackDuration = metadata.duration || loadingDeck.buffer.duration;
            
            // ========================================
            // SMOOTH CROSSFADE TRANSITION
            // ========================================
            const oldDeck = this.activeDeck === 'A' ? this.playerA : this.playerB;
            
            if (this.isPlaying && this.crossfadeTime > 0) {
                // Crossfade from old to new
                loadingDeck.start();
                
                this.crossfader.fade.rampTo(
                    nextDeckChar === 'B' ? 1 : 0, 
                    this.crossfadeTime
                );
                
                // Stop old deck after crossfade completes
                setTimeout(() => {
                    oldDeck.stop();
                }, this.crossfadeTime * 1000 + 100);
                
            } else {
                // Hard cut (first track or instant play)
                oldDeck.stop();
                loadingDeck.start();
                this.crossfader.fade.value = nextDeckChar === 'B' ? 1 : 0;
            }

            this.startTime = Tone.now(); 
            this.pausedAt = 0;
            this.isPlaying = true;
            this.activeDeck = nextDeckChar;
            this.currentTrack = { id: trackId, ...metadata, duration: this.trackDuration };
            
            // Analytics
            this.playbackStats.totalPlays++;
            
            this.emit('stateChange', { track: this.currentTrack, isPlaying: true });
            
            // Trigger preloading of upcoming tracks
            this.triggerPreload();

        } catch (e) {
            console.error("Play Error:", e);
            this.playbackStats.buffering = false;
            this.emit('error', { error: e, track: metadata });
            
            // Auto-retry on network error
            if (e.message.includes('network') || e.message.includes('fetch')) {
                console.log('Network error detected, retrying in 2s...');
                setTimeout(() => this.play(trackId, metadata), 2000);
            }
        }
    }

    // ========================================
    // PRELOAD MANAGEMENT
    // ========================================
    async triggerPreload() {
        // Preload next N tracks in queue
        const tracksToPreload = this.queue.slice(0, this.preloadAhead);
        
        for (const track of tracksToPreload) {
            if (!this.preloadCache.has(track.id)) {
                this.preloadQueue.push(track);
            }
        }
    }

    async startPreloadManager() {
        // Background process that preloads tracks
        const preloadNext = async () => {
            if (this.preloadQueue.length === 0) {
                setTimeout(preloadNext, 1000);
                return;
            }

            // Don't preload if actively buffering
            if (this.playbackStats.buffering) {
                setTimeout(preloadNext, 1000);
                return;
            }

            const track = this.preloadQueue.shift();
            
            try {
                console.log(`📦 Preloading: ${track.title}`);
                
                const fileUrl = this.selectBestAudioUrl(track);
                if (!fileUrl) {
                    setTimeout(preloadNext, 100);
                    return;
                }

                await this.preloadPlayer.load(fileUrl);
                this.cacheBuffer(track.id, this.preloadPlayer.buffer);
                
                this.emit('preloadComplete', { track });
                
            } catch (e) {
                console.warn(`Preload failed for ${track.title}:`, e);
            }
            
            // Small delay before next preload
            setTimeout(preloadNext, 500);
        };

        preloadNext();
    }

    cacheBuffer(trackId, buffer) {
        // LRU cache management
        if (this.preloadCache.size >= this.maxCacheSize) {
            const firstKey = this.preloadCache.keys().next().value;
            this.preloadCache.delete(firstKey);
        }
        
        this.preloadCache.set(trackId, buffer);
    }

    // ========================================
    // QUEUE MANAGEMENT
    // ========================================
    addToQueue(track) {
        this.queue.push(track);
        this.emit('queueUpdate', this.queue);
        console.log("Added to queue:", track.title);
        
        // Auto-trigger preload
        this.triggerPreload();
    }

    removeFromQueue(index) {
        if (index >= 0 && index < this.queue.length) {
            const removed = this.queue.splice(index, 1)[0];
            this.emit('queueUpdate', this.queue);
            
            // Remove from preload cache if present
            this.preloadCache.delete(removed.id);
            return removed;
        }
    }

    clearQueue() {
        this.queue = [];
        this.preloadQueue = [];
        this.emit('queueUpdate', this.queue);
    }

    // ========================================
    // AUTO-PLAY NEXT (Seamless Transitions)
    // ========================================
    playNext() {
        if (this.queue.length > 0) {
            const nextTrack = this.queue.shift(); 
            this.emit('queueUpdate', this.queue); 
            this.emit('trackEnd', { track: this.currentTrack });
            this.play(nextTrack.id, nextTrack);
        } else {
            // No more tracks - graceful ending
            this.gracefulStop();
        }
    }

    gracefulStop() {
        // Fade out smoothly instead of abrupt stop
        const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
        
        if (this.autoFadeOut) {
            deck.volume.rampTo(-60, 2); // 2 second fade out
            setTimeout(() => {
                deck.stop();
                this.isPlaying = false;
                this.emit('stateChange', { track: this.currentTrack, isPlaying: false });
                this.emit('trackEnd', { track: this.currentTrack });
            }, 2000);
        } else {
            deck.stop();
            this.isPlaying = false;
            this.emit('stateChange', { track: this.currentTrack, isPlaying: false });
            this.emit('trackEnd', { track: this.currentTrack });
        }
    }

    // ========================================
    // PLAYBACK CONTROLS
    // ========================================
    togglePlay() {
        const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
        
        if (this.isPlaying) {
            deck.stop(); 
            this.pausedAt = Tone.now() - this.startTime;
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
        
        const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
        let seekTime = Math.max(0, Math.min(seconds, this.trackDuration));

        if (this.isPlaying) {
            deck.stop();
            deck.start(Tone.now(), seekTime);
            this.startTime = Tone.now() - seekTime;
        } else {
            this.pausedAt = seekTime;
        }
        
        this.emit('progress', { 
            progress: seekTime / this.trackDuration, 
            currentTime: seekTime,
            duration: this.trackDuration
        });
    }

    skipForward(seconds = 10) {
        if (!this.currentTrack) return;
        const currentTime = this.isPlaying ? (Tone.now() - this.startTime) : this.pausedAt;
        this.seek(currentTime + seconds);
    }

    skipBackward(seconds = 10) {
        if (!this.currentTrack) return;
        const currentTime = this.isPlaying ? (Tone.now() - this.startTime) : this.pausedAt;
        this.seek(currentTime - seconds);
    }

    // ========================================
    // PROGRESS MONITORING
    // ========================================
    startProgressLoop() {
        const update = () => {
            if (this.isPlaying && this.currentTrack) {
                const now = Tone.now();
                let currentTime = now - this.startTime;
                
                // Auto-advance before track completely ends (gapless)
                if (this.gaplessPlayback && currentTime >= this.trackDuration - 0.1) { 
                    this.playNext();
                    return; 
                }
                
                // Optional: Start fading out near end
                if (this.autoFadeOut && 
                    currentTime >= this.trackDuration - this.fadeOutStartOffset &&
                    currentTime < this.trackDuration - this.crossfadeTime) {
                    
                    const deck = this.activeDeck === 'A' ? this.playerA : this.playerB;
                    // Gentle fade
                    deck.volume.rampTo(-6, this.fadeOutStartOffset - this.crossfadeTime);
                }

                // Update analytics
                this.playbackStats.totalListenTime += 0.1; // Rough estimate

                this.emit('progress', { 
                    progress: currentTime / this.trackDuration, 
                    currentTime: currentTime, 
                    duration: this.trackDuration,
                    buffering: this.playbackStats.buffering
                });
            }
            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    // ========================================
    // AUDIO SETTINGS
    // ========================================
    updateSettings(settings) {
        this.settings = settings;
        
        // Crossfade duration
        this.crossfadeTime = parseFloat(settings.crossfade) || 3;
        
        // Audio quality
        if (settings.audioQuality) {
            this.audioQuality = settings.audioQuality;
        }
        
        // Normalization/Limiting
        if (settings.normalizeVolume) {
            this.limiter.threshold.value = -24;
            this.limiter.ratio.value = 4;
        } else {
            this.limiter.threshold.value = 0;
            this.limiter.ratio.value = 1;
        }
        
        // EQ
        if (settings.eqHigh !== undefined) this.eq.high.value = settings.eqHigh;
        if (settings.eqMid !== undefined) this.eq.mid.value = settings.eqMid;
        if (settings.eqLow !== undefined) this.eq.low.value = settings.eqLow;
        
        // Gapless playback
        if (settings.gaplessPlayback !== undefined) {
            this.gaplessPlayback = settings.gaplessPlayback;
        }
        
        // Preload settings
        if (settings.preloadAhead) {
            this.preloadAhead = parseInt(settings.preloadAhead);
        }
    }

    setVolume(value) {
        // 0 to 1
        this.masterBus.gain.rampTo(value, 0.1);
    }

    setEQ(low, mid, high) { 
        this.eq.low.value = low; 
        this.eq.mid.value = mid; 
        this.eq.high.value = high; 
    }

    // ========================================
    // ADVANCED FEATURES
    // ========================================
    
    // Replay current track from beginning
    replay() {
        if (this.currentTrack) {
            this.seek(0);
            if (!this.isPlaying) this.togglePlay();
        }
    }

    // Shuffle queue
    shuffleQueue() {
        for (let i = this.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
        }
        this.emit('queueUpdate', this.queue);
    }

    // Get playback stats
    getStats() {
        return {
            ...this.playbackStats,
            cacheSize: this.preloadCache.size,
            queueLength: this.queue.length,
            currentTrack: this.currentTrack
        };
    }

    // Manual buffer clearing
    clearCache() {
        this.preloadCache.clear();
        console.log('Cache cleared');
    }

    // ========================================
    // CLEANUP
    // ========================================
    cleanup() {
        this.playerA.dispose();
        this.playerB.dispose();
        this.preloadPlayer.dispose();
        this.crossfader.dispose();
        this.eq.dispose();
        this.limiter.dispose();
        this.masterBus.dispose();
        this.cueBus.dispose();
        this.preloadCache.clear();
    }

    // ========================================
    // EVENT SYSTEM
    // ========================================
    emit(event, data) { 
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data)); 
        }
    }
    
    on(event, cb) { 
        if (this.listeners[event]) {
            this.listeners[event].push(cb); 
        }
    }

    off(event, cb) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(callback => callback !== cb);
        }
    }
}