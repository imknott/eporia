/* public/javascripts/appRouter.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';

// getAuth(app) uses the already-initialized app instance from firebase-config.js
// instead of calling getAuth() standalone which throws if initializeApp hasn't run yet
const auth = getAuth(app);

// Navigation lock — prevents concurrent navigations from racing and both
// falling through to window.location.href (which causes a full page reload).
let _navigating = false;

export async function navigateTo(url) {
    // Deduplicate: ignore if already on this exact path
    if (window.location.pathname === url) return;

    // Lock guard: if a navigation is already in flight, queue this one
    // by waiting briefly rather than launching a second concurrent fetch.
    if (_navigating) {
        setTimeout(() => navigateTo(url), 80);
        return;
    }
    _navigating = true;

    try {
        console.log(`🚀 SPA Navigation to: ${url}`);
        let headers = {};
        if (auth.currentUser) {
            const token = await auth.currentUser.getIdToken();
            headers = { 'Authorization': `Bearer ${token}` };
        }

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        // Use the FINAL URL after any 301/302 redirects so pushState records
        // the canonical path (e.g. /player/artist/aventure) rather than the
        // ID-based URL that triggered the redirect.
        const finalUrl = new URL(response.url).pathname;

        // 🚀 FIX (Chrome): Per RFC 7235 / Fetch spec, browsers (especially Chrome)
        // strip the Authorization header when following a redirect, even same-origin.
        // If the slug route 301s → ID route, the second request arrives unauthenticated,
        // the server returns a login redirect/error page without .content-scroll, and
        // appRouter falls back to window.location.href — killing the music.
        // Fix: when a redirect occurred, re-fetch the canonical URL with a fresh token.
        let html;
        if (finalUrl !== url && auth.currentUser) {
            const freshToken = await auth.currentUser.getIdToken();
            const authResponse = await fetch(finalUrl, {
                headers: { 'Authorization': `Bearer ${freshToken}` }
            });
            if (!authResponse.ok) throw new Error(`HTTP Error after redirect: ${authResponse.status}`);
            html = await authResponse.text();
        } else {
            html = await response.text();
        }

        // 🚀 FIX: Completely bypass string manipulation and let the native DOMParser
        // handle the raw HTML. It is 100x faster and ignores script execution natively.
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const newContent = doc.querySelector('.content-scroll');
        const currentContent = document.querySelector('.content-scroll');

        if (!newContent || !currentContent) {
            // Content swap impossible — fall back to a hard navigate
            window.location.href = finalUrl;
            return;
        }

        // Remove any <script> tags baked into the new content body.
        newContent.querySelectorAll('script').forEach(s => s.remove());

        // Swap content and update browser history
        currentContent.replaceWith(newContent);
        window.history.pushState({}, '', finalUrl);

        // Reset hydration flag and let UIController re-hydrate the new view.
        // CRITICAL: wrapped in its own try/catch so a bug in any page controller
        // can NEVER propagate here and trigger window.location.href (full reload).
        newContent.dataset.hydrated = "false";
        try {
            if (window.ui?.checkAndReloadViews) {
                window.ui.checkAndReloadViews();
            }
        } catch (controllerErr) {
            console.error('[appRouter] controller hydration error (page loaded OK):', controllerErr);
        }

        // Workbench needs a manual trigger because it's not driven by checkAndReloadViews
        if (newContent.dataset.page === 'workbench' && window.workbench) {
            window.workbench.renderStack(); 
            window.workbench.updateDNA();
        }

    } catch (e) {
        console.error("Router Error:", e);
        // Only fall back to a hard reload if we really have no other option.
        window.location.href = url;
    } finally {
        // Always release the lock so future navigations are not blocked
        _navigating = false;
    }
}

window.addEventListener('popstate', () => navigateTo(window.location.pathname));
// Register on both names:
// window.navigateTo — direct calls from pug onclicks before stub was added
// window._navigateTo — picked up by the stub in player_shell.pug inline script
window.navigateTo  = navigateTo;
window._navigateTo = navigateTo;