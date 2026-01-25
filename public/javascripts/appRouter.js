/* public/javascripts/appRouter.js */
import { initUserProfile } from './userProfile.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; 

const auth = getAuth();

export async function navigateTo(url) {
    try {
        console.log(`🚀 SPA Navigation to: ${url}`);
        
        // [!] SECURE FETCH: Get Token (From your snippet)
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
        // 5. RE-INITIALIZE PAGE LOGIC (The New Fix)
        // ===============================================
        
        // Check what kind of page we just loaded
        const pageType = newContent.dataset.page;

        // A. Explore Page -> Force Grid Render
        if (pageType === 'explore' && window.filterLocations) {
            window.filterLocations('major');
        } 
        // B. Dashboard -> Force Moods Render
        else if (pageType === 'dashboard' && window.filterMoods) {
            window.filterMoods('all');
        }
        // C. User Profile -> Re-init Profile Logic
        else if (newContent.dataset.viewMode) {
            initUserProfile();
        }
        // D. Local Scene -> Force Local Grid
        else if (pageType === 'local') {
            // We assume the controller handles this, but if we exposed it globally:
            // window.renderLocalGrid(); 
            // Since we didn't expose it yet, let's just ensure the init runs via the class constructor if we reloaded.
            // Actually, best practice: Expose it.
            if(window.initLocalScene) window.initLocalScene();
        }
        
        // D. Settings -> Re-attach AutoSave listeners if needed
        // (Event delegation in enhancedPlayer.js handles this mostly, but good to be safe)

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