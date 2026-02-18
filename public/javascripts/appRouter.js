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

        const pageType = newContent.dataset.page;

        // Always update sidebar active state
        if (window.ui?.updateSidebarState) window.ui.updateSidebarState();

        // Profile -> hydrate avatar, cover, bio, top artists
        if (pageType === 'profile') {
            if (window.ui?.loadProfilePage) window.ui.loadProfilePage();
        }
        // Dashboard
        else if (pageType === 'dashboard') {
            if (window.filterMoods) window.filterMoods('all');
            if (window.ui?.loadSceneDashboard) window.ui.loadSceneDashboard();
        }
        // Favorites
        else if (pageType === 'favorites') {
            if (window.ui?.loadFavorites) window.ui.loadFavorites();
        }
        // Workbench
        else if (pageType === 'workbench') {
            if (window.workbench) { window.workbench.renderStack(); window.workbench.updateDNA(); }
        }
        // Wallet
        else if (pageType === 'wallet') {
            if (window.ui?.initWalletPage) window.ui.initWalletPage();
        }
        // Settings
        else if (pageType === 'settings') {
            const container = document.querySelector('[data-view="settings"]');
            if (container && window.ui?.loadSettingsPage) window.ui.loadSettingsPage(container);
        }
        // Crate View
        else if (pageType === 'crate-view') {
            const crateId = newContent.dataset.crateId;
            if (crateId && window.ui?.initCrateView) window.ui.initCrateView(crateId);
        }

        // Always hydrate like/heart buttons
        if (window.ui?.hydrateGlobalButtons) {
            setTimeout(() => window.ui.hydrateGlobalButtons(), 50);
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