/* public/javascripts/appRouter.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';

const auth = getAuth(app);
let _navigating = false;

export async function navigateTo(url) {
    if (window.location.pathname === url) return;

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

        // Record the final URL after any server 301/302 redirects so pushState
        // always records the canonical path (e.g. /player/artist/neon-echoes)
        // rather than the ID-based URL that triggered the redirect.
        const finalUrl = new URL(response.url).pathname;

        // ── Why we NO LONGER do a second fetch on redirect ────────────────────
        //
        // The original second-fetch was added because:
        //   slug URL → 301 → ID URL  (old flow — auth header stripped on redirect)
        //
        // The flow is now reversed:
        //   ID URL → 301 → slug URL  (new canonical flow)
        //
        // In this new flow the browser follows the redirect automatically and
        // the response body is already the correct artist page HTML.  Even
        // though the Authorization header is stripped on redirect, the session
        // cookie IS still sent (cookies are never stripped), so `verifyUser`
        // resolves req.uid from the cookie and the page renders with full user
        // context.  A second fetch is therefore redundant AND a failure point:
        // any error in the second fetch throws → catch → window.location.href
        // → full page reload → music stops.
        //
        // We simply use `response.text()` always — it contains the correct,
        // fully rendered HTML regardless of whether a redirect occurred.
        const html = await response.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const newContent = doc.querySelector('.content-scroll');
        const currentContent = document.querySelector('.content-scroll');

        if (!newContent || !currentContent) {
            // Content swap impossible — fall back to a hard navigate
            window.location.href = finalUrl;
            return;
        }

        newContent.querySelectorAll('script').forEach(s => {
            const text = s.textContent || '';
            if (text.includes('__CRATE_DATA__')) {
                try {
                    // Find the '=' in 'window.__CRATE_DATA__ = {...}'
                    const eq = text.indexOf('=');
                    if (eq !== -1) {
                        const afterEq = text.slice(eq + 1).trimStart();
                        const startCh = afterEq[0]; // '{' or '['
                        // Walk forward matching braces to find the exact JSON boundary.
                        // This handles the case where other JS functions follow in the
                        // same script block — we stop at the matching close brace rather
                        // than at the end of the entire script text.
                        if (startCh === '{' || startCh === '[') {
                            const closeCh = startCh === '{' ? '}' : ']';
                            let depth = 0, inStr = false, esc = false, i = 0;
                            for (; i < afterEq.length; i++) {
                                const ch = afterEq[i];
                                if (esc)               { esc = false; continue; }
                                if (ch === '\\' && inStr) { esc = true; continue; }
                                if (ch === '"')        { inStr = !inStr; continue; }
                                if (inStr)             continue;
                                if (ch === startCh)    depth++;
                                if (ch === closeCh)    { depth--; if (depth === 0) break; }
                            }
                            window.__CRATE_DATA__ = JSON.parse(afterEq.slice(0, i + 1));
                        } else {
                            // Fallback: strip trailing semicolon and attempt parse
                            const jsonStr = afterEq.replace(/;\s*$/, '');
                            window.__CRATE_DATA__ = JSON.parse(jsonStr);
                        }
                    }
                } catch (e) {
                    console.warn('[appRouter] __CRATE_DATA__ parse failed:', e.message);
                }
            }
            s.remove();
        });

        // Swap content and push the CANONICAL URL (post-redirect) to history
        currentContent.replaceWith(newContent);
        window.history.pushState({}, '', finalUrl);

        newContent.dataset.hydrated = "false";
        try {
            if (window.ui?.checkAndReloadViews) {
                window.ui.checkAndReloadViews();
            }
        } catch (controllerErr) {
            console.error('[appRouter] controller hydration error (page loaded OK):', controllerErr);
        }

        if (newContent.dataset.page === 'workbench' && window.workbench) {
            // onNavigatedTo() re-renders the stack, refreshes DNA, and reloads
            // the user's crates list + draft from the server — covers everything
            // renderStack() + updateDNA() did plus the crate menu population.
            if (typeof window.workbench.onNavigatedTo === 'function') {
                window.workbench.onNavigatedTo();
            } else {
                window.workbench.renderStack();
                window.workbench.updateDNA();
            }
        }

    } catch (e) {
        console.error("Router Error:", e);
        window.location.href = url;
    } finally {
        _navigating = false;
    }
}

window.addEventListener('popstate', () => navigateTo(window.location.pathname));
window.navigateTo  = navigateTo;
window._navigateTo = navigateTo;