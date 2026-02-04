/* public/javascripts/enhancedPlayer.js */
import { AudioPlayerEngine } from './audioEngine.js';
import { PlayerUIController } from './uiController.js';
import { WorkbenchController } from './workbenchController.js';

// [FIX] Import the router so 'navigateTo' is available globally
import './appRouter.js'; 

// Global Singleton
export const audioEngine = new AudioPlayerEngine();

document.addEventListener('DOMContentLoaded', () => {
    // 1. Theme Check
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
    
    // 2. Initialize Controllers
    const ui = new PlayerUIController(audioEngine);
    const workbench = new WorkbenchController(audioEngine);

    // 3. Expose to Window for HTML onclick events
    window.workbench = workbench;
    window.ui = ui; // Useful for debugging
});