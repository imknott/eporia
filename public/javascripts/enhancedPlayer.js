/* public/javascripts/enhancedPlayer.js */
import { AudioPlayerEngine } from './audioEngine.js';
import { PlayerUIController } from './uiController.js';
import { WorkbenchController } from './workbenchController.js';

// Import router for SPA navigation
import './appRouter.js'; 

// Global Singleton — constructed immediately so window.audioEngine is
// available, but the underlying AudioContext stays suspended until the
// first user gesture (click / keydown / touch) so the browser never
// blocks it and we avoid the "AudioContext was prevented from starting
// automatically" console flood from Tone.js's feature-detection suite.
export const audioEngine = new AudioPlayerEngine();

// One-shot listener: resume the Tone.js AudioContext on the first
// meaningful user interaction. Delegating to audioEngine.resumeAudioContext()
// avoids a dynamic import of Tone (which has no default export on esm.sh and
// throws "Tone is undefined"). The engine already has Tone in its own module
// scope so it can call Tone.start() safely.
function _resumeAudioContext() {
    audioEngine.resumeAudioContext?.().catch(() => {});
}
['click', 'keydown', 'touchend', 'pointerdown'].forEach(evt => {
    document.addEventListener(evt, _resumeAudioContext, { once: true, capture: true });
});

document.addEventListener('DOMContentLoaded', () => {
    // 1. Theme
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-theme');
    }

    // 2. Initialize Controllers
    const ui        = new PlayerUIController(audioEngine);
    const workbench = new WorkbenchController(audioEngine);

    // 3. Expose to window for HTML onclick events & debugging
    window.workbench    = workbench;
    window.ui           = ui;
    window.audioEngine  = audioEngine;

    console.log('🎵 Enhanced Player Initialized');
});