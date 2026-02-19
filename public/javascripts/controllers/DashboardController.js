/* public/javascripts/controllers/DashboardController.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { CitySoundscapeMap } from '../citySoundscapeMap.js';

export class DashboardController {
    constructor(mainUI) {
        this.mainUI = mainUI;
        this.auth = getAuth();
        this.cityMap = null;
        
        // State for active crate view
        this.activeCrateData = null;
        this.currentCrateId = null;

        // Bind global functions to window.ui so they are accessible to HTML onclick events
        window.ui.navigateToCity = this.navigateToCity.bind(this);
        window.ui.openCitySearch = this.openCitySearch.bind(this);
        window.ui.playCrate = this.playCrate.bind(this);
        window.ui.playCrateTrack = this.playCrateTrack.bind(this);
        window.ui.toggleCrateLike = this.toggleCrateLike.bind(this);
    }

    // ==========================================
    // 1. SCENE DASHBOARD FEED
    // ==========================================

    async loadSceneDashboard(city = null, state = null, country = null) {
        const CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes
        const now = Date.now();
        
        // Use URL params if not provided explicitly
        const urlParams = new URLSearchParams(window.location.search);
        const targetCity = city || urlParams.get('city');
        const targetState = state || urlParams.get('state');
        const targetCountry = country || urlParams.get('country');

        // Check Cache for default loads
        if (!targetCity && window.globalUserCache?.dashboard && 
           (now - window.globalUserCache.dashboardTimestamp < CACHE_DURATION)) {
            this.renderSceneDashboard(window.globalUserCache.dashboard);
            return;
        }

        try {
            const token = await this.auth.currentUser.getIdToken();
            let queryParams = '';
            if (targetCity) {
                queryParams = `?city=${encodeURIComponent(targetCity)}`;
                if (targetState) queryParams += `&state=${encodeURIComponent(targetState)}`;
                if (targetCountry) queryParams += `&country=${encodeURIComponent(targetCountry)}`;
            }
            
            const res = await fetch(`/player/api/dashboard${queryParams}`, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            const data = await res.json();

            if (!window.globalUserCache) window.globalUserCache = {};
            if (!targetCity) {
                window.globalUserCache.dashboard = data;
                window.globalUserCache.dashboardTimestamp = now;
            }

            this.renderSceneDashboard(data);
            this.loadCityPills();

        } catch (e) { 
            console.error("Dashboard Feed Load Error:", e); 
            this.mainUI.showToast("Failed to load scene", "error");
        }
    }

    renderSceneDashboard(data) {
        const dropsContainer = document.getElementById('localDropsContainer');
        const cratesContainer = document.getElementById('localCratesContainer');
        const artistsContainer = document.getElementById('localArtistsContainer');
        const forYouContainer = document.getElementById('forYouArtistsContainer');
        const forYouSection = document.getElementById('forYouSection');
        
        if (!dropsContainer) return;

        // Update Headers based on City [cite: 12]
        const sceneTitle = document.querySelector('.scene-title');
        const sceneSubtitle = document.querySelector('.scene-subtitle');
        if (sceneTitle && data.city) sceneTitle.textContent = `${data.city} Underground`;
        if (sceneSubtitle && data.state) sceneSubtitle.textContent = `Pulse of ${data.state}`;

        // Render Grids [cite: 11]
        dropsContainer.innerHTML = '';
        if (!data.freshDrops || data.freshDrops.length === 0) {
            dropsContainer.innerHTML = this.mainUI.createEmptyState("Quiet in the city tonight.");
        } else {
            data.freshDrops.forEach(song => dropsContainer.appendChild(this.mainUI.createSongCard(song)));
        }

        if (forYouContainer && forYouSection) {
            if (data.forYou && data.forYou.length > 0) {
                forYouSection.style.display = 'block';
                forYouContainer.innerHTML = '';
                data.forYou.forEach(artist => forYouContainer.appendChild(this.mainUI.createArtistCircle(artist, data.city)));
            } else {
                forYouSection.style.display = 'none';
            }
        }

        if (cratesContainer) {
            cratesContainer.innerHTML = '';
            if (!data.localCrates || data.localCrates.length === 0) {
                 cratesContainer.innerHTML = this.mainUI.createEmptyState("No local crates yet.");
            } else {
                data.localCrates.forEach(crate => cratesContainer.appendChild(this.mainUI.createCrateCard(crate)));
            }
        }

        if (artistsContainer) {
            artistsContainer.innerHTML = '';
            if (data.topLocal) {
                data.topLocal.forEach(artist => artistsContainer.appendChild(this.mainUI.createArtistCircle(artist, data.city)));
            }
        }
        
        // Update Globals
        window.currentCity = data.city;
        window.currentState = data.state;
        window.currentCountry = data.country;
    }

    // ==========================================
    // 2. CITY NAVIGATION & SOUNDSCAPE MAP
    // ==========================================

    async loadCityPills() {
        const container = document.getElementById('cityPillsContainer');
        if (!container) return;

        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/cities/active', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            this.renderCityPills(data.cities);
        } catch (e) { console.error("City Pills Load Error:", e); }
    }

    renderCityPills(cities) {
        const container = document.getElementById('cityPillsContainer');
        if (!container) return;
        container.innerHTML = '';
        
        if (!cities || cities.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        cities.forEach(cityData => {
            const pill = document.createElement('button');
            pill.className = 'city-pill';
            if (cityData.city === window.currentCity) pill.classList.add('active');
            
            pill.innerHTML = `
                <span class="city-pill-name">${cityData.city}</span>
                <span class="city-pill-state">${cityData.state || cityData.country}</span>
            `;
            
            pill.onclick = () => this.navigateToCity(cityData.city, cityData.state, cityData.country);
            container.appendChild(pill);
        });
    }

    async navigateToCity(city, state, country) {
        const url = new URL(window.location);
        url.searchParams.set('city', city);
        if (state) url.searchParams.set('state', state);
        if (country) url.searchParams.set('country', country);
        window.history.pushState({}, '', url);
        
        await this.loadSceneDashboard(city, state, country);
        this.mainUI.showToast(`Exploring ${city} Underground`, 'success');
    }

    initCityMap() {
        try {
            this.cityMap = new CitySoundscapeMap();
            window.cityMap = this.cityMap;
        } catch (error) {
            console.error('Failed to initialize city map:', error);
        }
    }

    async openCitySearch() {
        try {
            if (!this.cityMap) this.initCityMap();
            
            const userLocation = {
                city: window.currentCity || 'San Diego',
                coordinates: window.currentCityCoords || [-117.1611, 32.7157]
            };
            const userGenres = window.globalUserCache?.userGenres || window.globalUserCache?.genres || [];
            
            await this.cityMap.init(userLocation, userGenres);
        } catch (error) {
            console.error('Failed to open city map:', error);
            this.mainUI.showToast('Unable to load city map', 'error');
        }
    }

    // ==========================================
    // 3. CRATE VIEWING & PLAYBACK [cite: 12]
    // ==========================================

    async loadCrateView(crateId) {
        const container = document.querySelector('.content-scroll');
        if (!container) return;
        this.currentCrateId = crateId;

        container.innerHTML = '<div style="display:flex; justify-content:center; padding:100px;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/crate/${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) throw new Error("Crate not found");
            const crateData = await res.json();
            
            this.activeCrateData = crateData;
            this.renderCrateView(crateData, container);
            this.checkCrateLikeStatus(crateId);

        } catch (e) {
            console.error("Load Crate Error:", e);
            container.innerHTML = `<div style="text-align:center; padding:50px;"><h2>Crate Not Found</h2><p>${e.message}</p></div>`;
        }
    }

    renderCrateView(crate, container) {
        // Ensure URLs use the CDN prefix via the main UI helper [cite: 12]
        const rawCover = crate.coverImage || (crate.tracks?.length ? (crate.tracks[0].artUrl || crate.tracks[0].img) : '') || '';
        const coverImg = this.mainUI.fixImageUrl(rawCover);
        const creatorAvatar = crate.creatorAvatar ? this.mainUI.fixImageUrl(crate.creatorAvatar) : '';

        const headerHtml = `
        <div class="crate-hero" style="background: linear-gradient(to bottom, rgba(0,0,0,0.6), var(--bg-main)), url('${coverImg}') center/cover;">
            <div class="crate-hero-inner" style="backdrop-filter: blur(20px); background: rgba(0,0,0,0.5); padding: 40px; border-radius: 20px; display: flex; gap: 30px; align-items: flex-end;">
                <div class="crate-cover" style="width: 220px; height: 220px; flex-shrink: 0; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border-radius: 12px; overflow: hidden;">
                    <img src="${coverImg}" style="width: 100%; height: 100%; object-fit: cover;">
                </div>
                <div class="crate-info" style="flex: 1;">
                    <h1 class="crate-title" style="font-size: 3.5rem; font-weight: 900; margin-bottom: 10px;">${crate.title}</h1>
                    <div class="crate-meta" style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
                        ${creatorAvatar ? `<img src="${creatorAvatar}" style="width:30px; height:30px; border-radius:50%">` : '<i class="fas fa-user"></i>'}
                        <span>Created by <strong>${crate.creatorHandle || 'Anonymous'}</strong></span>
                        <span style="color:#666">•</span>
                        <span>${crate.tracks?.length || 0} Songs</span>
                    </div>
                    <div class="crate-actions" style="display: flex; gap: 15px;">
                        <button class="btn-play-all" onclick="window.ui.playCrate('${crate.id}')" style="padding: 12px 30px; border-radius: 50px; border: none; background: var(--primary); color: #000; font-weight: 800; cursor: pointer;">
                            <i class="fas fa-play"></i> Play All
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        let tracksHtml = '<div class="crate-tracks" style="margin-top:30px; padding:0 20px"><div class="track-list-body">';
        
        if (crate.tracks?.length > 0) {
            crate.tracks.forEach((track, index) => {
                const img = this.mainUI.fixImageUrl(track.artUrl || track.img);
                tracksHtml += `
                <div class="track-row" onclick="window.ui.playCrateTrack(${index})" style="display: flex; align-items: center; padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;">
                    <div style="width:40px; text-align:center; color:#666">${index + 1}</div>
                    <div style="flex:1; display:flex; align-items:center; gap:15px">
                        <img src="${img}" style="width:40px; height:40px; border-radius:4px; object-fit:cover">
                        <div>
                            <div style="font-weight:700;">${track.title}</div>
                            <div style="font-size:0.8rem; color:#888;">${track.artist}</div>
                        </div>
                    </div>
                </div>`;
            });
        } else {
            tracksHtml += '<div style="text-align:center; padding:50px; color:#666">Crate is empty</div>';
        }
        tracksHtml += '</div></div>'; 
        
        container.innerHTML = headerHtml + tracksHtml;
        setTimeout(() => this.mainUI.hydrateGlobalButtons(), 100);
    }

    async playCrate(crateIdOrShuffle = false) {
        let tracks = [];
        if (typeof crateIdOrShuffle === 'string') {
            try {
                const token = await this.auth.currentUser.getIdToken();
                const res = await fetch(`/player/api/crate/${crateIdOrShuffle}`, { headers: { 'Authorization': `Bearer ${token}` } });
                const data = await res.json();
                tracks = data.tracks || [];
            } catch(e) { return this.mainUI.showToast('Could not play crate', 'error'); }
        } else {
            tracks = this.activeCrateData?.tracks || [];
        }

        if (tracks.length === 0) return this.mainUI.showToast("No tracks to play");

        const first = tracks[0];
        await this.mainUI.engine.play(first.id, {
            ...first,
            artUrl: this.mainUI.fixImageUrl(first.artUrl || first.img)
        });

        this.mainUI.engine.queue = []; 
        for (let i = 1; i < tracks.length; i++) {
            this.mainUI.engine.addToQueue({
                ...tracks[i],
                artUrl: this.mainUI.fixImageUrl(tracks[i].artUrl || tracks[i].img)
            });
        }
    }

    async playCrateTrack(index) {
        const tracks = this.activeCrateData?.tracks || [];
        const track = tracks[index];
        if (!track) return;

        await this.mainUI.engine.play(track.id, {
            ...track,
            artUrl: this.mainUI.fixImageUrl(track.artUrl || track.img)
        });

        this.mainUI.engine.queue = [];
        for (let i = index + 1; i < tracks.length; i++) {
            this.mainUI.engine.addToQueue({
                ...tracks[i],
                artUrl: this.mainUI.fixImageUrl(tracks[i].artUrl || tracks[i].img)
            });
        }
    }

    async toggleCrateLike() {
        if (!this.currentCrateId) return;
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/crate/like/toggle', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ crateId: this.currentCrateId })
            });
            const data = await res.json();
            this.mainUI.showToast(data.liked ? 'Added to collection' : 'Removed from collection');
            this.checkCrateLikeStatus(this.currentCrateId);
        } catch (e) { console.error("Crate Like Error:", e); }
    }

    async checkCrateLikeStatus(crateId) {
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/crate/like/check?crateId=${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            const btn = document.querySelector('.btn-like-crate');
            if (btn) {
                btn.classList.toggle('liked', data.liked);
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fas', data.liked);
                    icon.classList.toggle('far', !data.liked);
                }
            }
        } catch (e) { console.error(e); }
    }
}