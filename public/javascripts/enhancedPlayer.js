/* public/javascripts/enhancedPlayer.js */
import { AudioPlayerEngine } from './audioEngine.js';
import { PlayerUIController } from './uiController.js';
// [NEW] Import the Workbench
import { WorkbenchController } from './workbenchController.js';

// Global Singleton
export const audioEngine = new AudioPlayerEngine();

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
    
    // Initialize UI Controller
    const ui = new PlayerUIController(audioEngine);

    // [NEW] Initialize Workbench & Expose to Window
    // We attach it to 'window.workbench' because your HTML onclick events 
    // (like onclick="workbench.addToStack(...)") look for it in the global scope.
    const workbench = new WorkbenchController(audioEngine);
    window.workbench = workbench;
});