/* public/javascripts/appRouter.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';

// getAuth(app) uses the already-initialized app instance from firebase-config.js
// instead of calling getAuth() standalone which throws if initializeApp hasn't run yet
const auth = getAuth(app);

export async function navigateTo(url) {
    try {
        console.log(`🚀 SPA Navigation to: ${url}`);
        let headers = {};
        if (auth.currentUser) {
            const token = await auth.currentUser.getIdToken();
            headers = { 'Authorization': `Bearer ${token}` };
        }

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const html = await response.text();

        // Strip <head> before parsing — DOMParser speculatively fetches all <link>
        // and <script> tags in the parsed document even if it's never inserted into
        // the live DOM. This causes every navigation to reload main.css + all @imports.
        const bodyOnly = html.replace(/<head[\s\S]*?<\/head>/i, '');

        const parser = new DOMParser();
        const doc = parser.parseFromString(bodyOnly, 'text/html');
        
        const newContent = doc.querySelector('.content-scroll');
        const currentContent = document.querySelector('.content-scroll');

        if (!newContent || !currentContent) {
            window.location.href = url;
            return;
        }

        // Swap content and push state
        currentContent.replaceWith(newContent);
        window.history.pushState({}, '', url);

        // Reset hydration and let the main UI controller take over
        newContent.dataset.hydrated = "false";
        if (window.ui && window.ui.checkAndReloadViews) {
            window.ui.checkAndReloadViews();
        }

        // Workbench manual trigger
        if (newContent.dataset.page === 'workbench' && window.workbench) {
            window.workbench.renderStack(); 
            window.workbench.updateDNA();
        }

    } catch (e) {
        console.error("Router Error:", e);
        window.location.href = url; 
    }
}

window.addEventListener('popstate', () => navigateTo(window.location.pathname));
// Register on both names:
// window.navigateTo — direct calls from pug onclicks before stub was added
// window._navigateTo — picked up by the stub in player_shell.pug inline script
window.navigateTo  = navigateTo;
window._navigateTo = navigateTo;