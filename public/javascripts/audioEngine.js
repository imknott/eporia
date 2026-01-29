/* public/javascripts/audioEngine.js */
import * as Tone from 'https://cdn.skypack.dev/tone';

export class AudioPlayerEngine {
    constructor() {
        this.crossfader = new Tone.CrossFade(0).toDestination();
        this.limiter = new Tone.Compressor({ threshold: -24, ratio: 4 }).connect(Tone.Destination);
        this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 }).connect(this.limiter);
        this.crossfader.connect(this.eq);

        this.playerA = new Tone.Player();
        this.playerB = new Tone.Player();
        this.playerA.connect(this.crossfader.a);
        this.playerB.connect(this.crossfader.b);

        this.activeDeck = 'A'; 
        this.currentTrack = null;
        this.queue = []; 
        
        this.startTime = 0;
        this.pausedAt = 0;
        this.isPlaying = false;
        this.trackDuration = 0;

        this.listeners = { stateChange: [], progress: [], error: [], queueUpdate: [] };
        this.startProgressLoop(); 
    }

    async play(trackId, metadata = {}) {
        if (Tone.context.state !== 'running') await Tone.start();

        let fileUrl = metadata.audioUrl;
        if (!fileUrl) { console.warn("No audio URL"); return; }

        const loadingDeck = this.activeDeck === 'A' ? this.playerB : this.playerA;
        const nextDeckChar = this.activeDeck === 'A' ? 'B' : 'A';

        try {
            await loadingDeck.load(fileUrl);
            this.trackDuration = metadata.duration || loadingDeck.buffer.duration;
            
            const oldDeck = this.activeDeck === 'A' ? this.playerA : this.playerB;
            oldDeck.stop();

            loadingDeck.start();
            this.startTime = Tone.now(); 
            this.pausedAt = 0;
            this.isPlaying = true;

            this.crossfader.fade.value = nextDeckChar === 'B' ? 1 : 0;

            this.activeDeck = nextDeckChar;
            this.currentTrack = { id: trackId, ...metadata, duration: this.trackDuration };
            
            this.emit('stateChange', { track: this.currentTrack, isPlaying: true });

        } catch (e) {
            console.error("Play Error:", e);
            this.emit('error', e);
        }
    }

    addToQueue(track) {
        this.queue.push(track);
        this.emit('queueUpdate', this.queue);
        console.log("Added to queue:", track.title);
    }

    playNext() {
        if (this.queue.length > 0) {
            const nextTrack = this.queue.shift(); 
            this.emit('queueUpdate', this.queue); 
            this.play(nextTrack.id, nextTrack);
        } else {
            this.isPlaying = false;
            this.emit('stateChange', { track: this.currentTrack, isPlaying: false });
        }
    }

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
            this.emit('progress', { progress: seekTime / this.trackDuration, currentTime: seekTime });
        }
    }

    startProgressLoop() {
        const update = () => {
            if (this.isPlaying && this.currentTrack) {
                const now = Tone.now();
                let currentTime = now - this.startTime;
                
                if (currentTime >= this.trackDuration - 0.5) { 
                    this.playNext();
                    return; 
                }

                this.emit('progress', { 
                    progress: currentTime / this.trackDuration, 
                    currentTime: currentTime, 
                    duration: this.trackDuration 
                });
            }
            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    updateSettings(settings) {
        this.settings = settings;
        this.crossfadeTime = parseInt(settings.crossfade) || 3;
        if (settings.normalizeVolume) {
            this.limiter.threshold.value = -24; this.limiter.ratio.value = 4;
        } else {
            this.limiter.threshold.value = 0; this.limiter.ratio.value = 1;
        }
        if (settings.eqHigh !== undefined) this.eq.high.value = settings.eqHigh;
        if (settings.eqMid !== undefined) this.eq.mid.value = settings.eqMid;
        if (settings.eqLow !== undefined) this.eq.low.value = settings.eqLow;
    }

    setupRouting() {
        // [NEW] Master Bus (Speakers)
        this.masterBus = new Tone.Gain(1).toDestination();

        // [NEW] Cue Bus (Headphones / Preview)
        // Independent volume control for "Digging"
        this.cueBus = new Tone.Gain(1).toDestination(); 
        
        // Connect the main player to the Master Bus by default
        if(this.player) {
            this.player.disconnect();
            this.player.connect(this.masterBus);
        }
    }

    setEQ(low, mid, high) { this.eq.low.value = low; this.eq.mid.value = mid; this.eq.high.value = high; }
    emit(event, data) { if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data)); }
    on(event, cb) { if (this.listeners[event]) this.listeners[event].push(cb); }
}