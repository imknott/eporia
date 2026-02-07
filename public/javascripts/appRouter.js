/* public/javascripts/appRouter.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; 

const auth = getAuth();

export async function navigateTo(url) {
    try {
        console.log(`🚀 SPA Navigation to: ${url}`);
        
        // [!] SECURE FETCH: Get Token
        let headers = {};
        if (auth.currentUser) {
            const token = await auth.currentUser.getIdToken();
            headers = { 'Authorization': `Bearer ${token}` };
        }

        // [!] SEND TOKEN WITH REQUEST
        const response = await fetch(url, { headers });
        
        if (response.status === 401 || response.status === 403) {
            console.warn("Unauthorized! Redirecting to login...");
            window.location.href = '/members/login'; 
            return;
        }

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const html = await response.text();

        // 3. Parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const newContent = doc.querySelector('.content-scroll');
        const currentContent = document.querySelector('.content-scroll');

        if (!newContent || !currentContent) {
            console.warn("SPA Content missing. Reloading...");
            window.location.href = url;
            return;
        }

        // 4. Swap Content
        currentContent.replaceWith(newContent);
        window.history.pushState({}, '', url);

        // ===============================================
        // 5. RE-INITIALIZE PAGE LOGIC
        // ===============================================
        
        // Check what kind of page we just loaded
        const pageType = newContent.dataset.page;

        // A. Update Sidebar Active State
        if (window.ui && window.ui.updateSidebarState) {
            window.ui.updateSidebarState();
        }

        // B. Dashboard -> Force Moods Render & Re-hydrate Hearts
        if (pageType === 'dashboard') {
            if (window.filterMoods) {
                window.filterMoods('all');
            }
            
            // [FIX] Re-apply heart states after DOM is loaded
            if (window.ui && window.ui.hydrateGlobalButtons) {
                // Small delay to ensure DOM is ready
                setTimeout(() => {
                    window.ui.hydrateGlobalButtons();
                    console.log('✅ Dashboard hearts re-hydrated');
                }, 50);
            }
        }
        
        // C. Favorites Page -> Re-hydrate Hearts
        else if (pageType === 'favorites') {
            if (window.ui && window.ui.hydrateGlobalButtons) {
                setTimeout(() => {
                    window.ui.hydrateGlobalButtons();
                    console.log('✅ Favorites hearts re-hydrated');
                }, 50);
            }
        }
        
        // D. Explore/Search -> Re-hydrate Hearts
        else if (pageType === 'explore' || pageType === 'search') {
            if (window.ui && window.ui.hydrateGlobalButtons) {
                setTimeout(() => {
                    window.ui.hydrateGlobalButtons();
                    console.log('✅ Explore hearts re-hydrated');
                }, 50);
            }
        }
        
        // E. Workbench -> Initialize crate builder
        else if (pageType === 'workbench') {
            if (window.workbench) {
                window.workbench.renderStack();
                window.workbench.updateDNA();
            }
        }
        
        // F. Wallet -> Init Wallet Page
        else if (pageType === 'wallet') {
            if (window.ui && window.ui.initWalletPage) {
                window.ui.initWalletPage();
            }
        }
        
        // G. Settings -> Init Settings Page
        else if (pageType === 'settings') {
            const container = document.querySelector('[data-view="settings"]');
            if (container && window.ui && window.ui.loadSettingsPage) {
                window.ui.loadSettingsPage(container);
            }
        }

        // [GLOBAL] Always re-hydrate buttons for any page navigation
        // This catches any page that might have heart buttons
        if (window.ui && window.ui.hydrateGlobalButtons && !['dashboard', 'favorites', 'explore', 'search'].includes(pageType)) {
            setTimeout(() => {
                window.ui.hydrateGlobalButtons();
                console.log(`✅ ${pageType || 'page'} buttons re-hydrated`);
            }, 50);
        }

    } catch (e) {
        console.error("Router Error:", e);
        // Fallback to hard reload if router fails
        window.location.href = url; 
    }
}

// Handle Browser "Back" Button
window.addEventListener('popstate', () => {
    navigateTo(window.location.pathname);
});

// Expose to window so onclick="navigateTo(...)" works in HTML
window.navigateTo = navigateTo;