/* public/javascripts/controllers/DashboardController.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { CitySoundscapeMap } from '../citySoundscapeMap.js';

export class DashboardController {
    constructor(mainUI) {
        this.mainUI = mainUI;
        this.auth   = getAuth();
        this.cityMap = null;

        // Active crate state — set in loadCrateView, read by play methods
        this.activeCrateData = null;
        this.currentCrateId  = null;

        // Bind to window.ui so pug onclick handlers can call them immediately
        window.ui.navigateToCity  = this.navigateToCity.bind(this);
        window.ui.openCitySearch  = this.openCitySearch.bind(this);
        window.ui.playCrate       = this.playCrate.bind(this);
        window.ui.playCrateTrack  = this.playCrateTrack.bind(this);
        window.ui.toggleCrateLike = this.toggleCrateLike.bind(this);
    }

    // ==========================================
    // 1. SCENE DASHBOARD FEED
    // ==========================================

    // ── sessionStorage cache helpers ──────────────────────────────────────────
    // Key format:  dash_v2__{cacheKey}
    // Value:       JSON { data, ts }
    // TTL:         15 minutes — fresh enough for a session, avoids redundant fetches
    //              while navigating between pages.
    // Why sessionStorage and not Firestore:
    //   Writing to Firestore to avoid Firestore reads is self-defeating — you pay
    //   a write on every cache miss and a read on every hit. sessionStorage is
    //   free, synchronous, and scoped to the tab session which is exactly right
    //   for a feed that should feel live but not hammer the DB on every nav.
    static CACHE_TTL     = 15 * 60 * 1000; // 15 min
    static CACHE_VERSION = 'dash_v2__';    // bump suffix to bust all cached entries

    _cacheGet(key) {
        try {
            const raw = sessionStorage.getItem(DashboardController.CACHE_VERSION + key);
            if (!raw) return null;
            const { data, ts } = JSON.parse(raw);
            if (Date.now() - ts > DashboardController.CACHE_TTL) {
                sessionStorage.removeItem(DashboardController.CACHE_VERSION + key);
                return null;
            }
            return data;
        } catch { return null; }
    }

    _cacheSet(key, data) {
        try {
            sessionStorage.setItem(
                DashboardController.CACHE_VERSION + key,
                JSON.stringify({ data, ts: Date.now() })
            );
        } catch { /* sessionStorage quota exceeded — silently skip */ }
    }

    async loadSceneDashboard(city = null, state = null, country = null) {
        const urlParams     = new URLSearchParams(window.location.search);
        const targetCity    = city    || urlParams.get('city');
        const targetState   = state   || urlParams.get('state');
        const targetCountry = country || urlParams.get('country');

        const cacheKey = targetCity
            ? `dashboard__${targetCity.toLowerCase().replace(/\s+/g, '_')}`
            : 'dashboard__home';

        const cached = this._cacheGet(cacheKey);
        if (cached) {
            this.renderSceneDashboard(cached);
            return;
        }

        this._renderLoadingSkeleton();

        try {
            const token = await this.auth.currentUser.getIdToken();
            let queryParams = '';
            if (targetCity) {
                queryParams = `?city=${encodeURIComponent(targetCity)}`;
                if (targetState)   queryParams += `&state=${encodeURIComponent(targetState)}`;
                if (targetCountry) queryParams += `&country=${encodeURIComponent(targetCountry)}`;
            }

            const res  = await fetch(`/player/api/dashboard${queryParams}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            this._cacheSet(cacheKey, data);
            this.renderSceneDashboard(data);

        } catch (e) {
            console.error('Dashboard Feed Load Error:', e);
            this.mainUI.showToast('Failed to load scene', 'error');
        }
    }

    _renderLoadingSkeleton() {
        ['localDropsContainer', 'localCratesContainer', 'localArtistsContainer'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.scrollLeft = 0;
            el.innerHTML  = Array.from({ length: 4 }, () => `
                <div class="media-card">
                    <div class="img-container skeleton-box" style="height:160px;border-radius:16px;"></div>
                    <div class="skeleton-box" style="height:14px;border-radius:6px;margin-top:10px;width:80%;"></div>
                    <div class="skeleton-box" style="height:12px;border-radius:6px;margin-top:6px;width:55%;"></div>
                </div>`).join('');
        });
    }

    renderSceneDashboard(data) {
        const dropsContainer   = document.getElementById('localDropsContainer');
        const cratesContainer  = document.getElementById('localCratesContainer');
        const artistsContainer = document.getElementById('localArtistsContainer');
        const forYouContainer  = document.getElementById('forYouArtistsContainer');
        const forYouSection    = document.getElementById('forYouSection');

        if (!dropsContainer) return;

        const sceneTitle    = document.querySelector('.scene-title');
        const sceneSubtitle = document.querySelector('.scene-subtitle');
        if (sceneTitle    && data.city)  sceneTitle.textContent    = `${data.city} Underground`;
        if (sceneSubtitle && data.state) sceneSubtitle.textContent = `Pulse of ${data.state}`;

        dropsContainer.innerHTML = '';
        if (!data.freshDrops || data.freshDrops.length === 0) {
            dropsContainer.innerHTML = this.mainUI.createEmptyState('Quiet in the city tonight.');
        } else {
            data.freshDrops.forEach(song => dropsContainer.appendChild(this.mainUI.createSongCard(song)));
        }

        if (forYouContainer && forYouSection) {
            if (data.forYou && data.forYou.length > 0) {
                forYouSection.style.display = 'block';
                forYouContainer.innerHTML   = '';
                data.forYou.forEach(a => forYouContainer.appendChild(this.mainUI.createArtistCircle(a, data.city)));
            } else {
                forYouSection.style.display = 'none';
            }
        }

        if (cratesContainer) {
            cratesContainer.innerHTML = '';
            if (!data.localCrates || data.localCrates.length === 0) {
                cratesContainer.innerHTML = this.mainUI.createEmptyState('No local crates yet.');
            } else {
                data.localCrates.forEach(c => cratesContainer.appendChild(this.mainUI.createCrateCard(c)));
            }
        }

        if (artistsContainer) {
            artistsContainer.innerHTML = '';
            if (data.topLocal) {
                data.topLocal.forEach(a => artistsContainer.appendChild(this.mainUI.createArtistCircle(a, data.city)));
            }
        }

        window.currentCity    = data.city;
        window.currentState   = data.state;
        window.currentCountry = data.country;
    }

    // ==========================================
    // 2. CITY NAVIGATION & SOUNDSCAPE MAP
    // ==========================================

    async navigateToCity(city, state, country) {
        const url = new URL(window.location);
        url.searchParams.set('city', city);
        if (state)   url.searchParams.set('state', state);
        if (country) url.searchParams.set('country', country);
        window.history.pushState({}, '', url);

        const sceneTitle    = document.querySelector('.scene-title');
        const sceneSubtitle = document.querySelector('.scene-subtitle');
        if (sceneTitle)    sceneTitle.textContent    = `${city} Underground`;
        if (sceneSubtitle) sceneSubtitle.textContent = state ? `Pulse of ${state}` : '';

        await this.loadSceneDashboard(city, state, country);
        this.mainUI.showToast(`Exploring ${city} Underground`, 'success');
    }

    initCityMap() {
        try {
            this.cityMap    = new CitySoundscapeMap();
            window.cityMap  = this.cityMap;
        } catch (e) {
            console.error('Failed to init city map:', e);
        }
    }

    async openCitySearch() {
        try {
            if (!this.cityMap) this.initCityMap();
            const userLocation = {
                city:        window.currentCity        || 'San Diego',
                coordinates: window.currentCityCoords  || [-117.1611, 32.7157],
            };
            const userGenres = window.globalUserCache?.userGenres || window.globalUserCache?.genres || [];
            await this.cityMap.init(userLocation, userGenres);
        } catch (e) {
            console.error('Failed to open city map:', e);
            this.mainUI.showToast('Unable to load city map', 'error');
        }
    }

    // ==========================================
    // 3. CRATE VIEW — hydration-first strategy
    // ==========================================

    /**
     * loadCrateView is called by uiController when data-page="crate-view" is detected.
     *
     * The page is already beautifully server-rendered by player.js/crate_view.pug.
     * window.__CRATE_DATA__ is embedded as a script tag at the bottom of the pug
     * template with fully-normalised URLs (https://cdn.eporiamusic.com/...).
     *
     * We NEVER re-render the DOM — we only:
     *   1. Load the track data into this.activeCrateData so play methods work
     *   2. Hydrate like button states from the cached liked-song set
     */
    async loadCrateView(crateId) {
        this.currentCrateId = crateId;

        // ── Primary path: use embedded JSON (server-rendered page) ──────────
        if (window.__CRATE_DATA__ && window.__CRATE_DATA__.id === crateId) {
            this.activeCrateData = window.__CRATE_DATA__;
            this._hydrateCrateViewPage();
            return;
        }

        // ── Fallback: SPA-navigate or stale __CRATE_DATA__ — fetch from API ──
        // Shows a spinner only if the page is blank (shouldn't normally happen).
        const container = document.querySelector('.content-scroll');
        if (container && !container.querySelector('.crate-hero')) {
            container.innerHTML = '<div style="display:flex;justify-content:center;padding:100px;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
        }

        try {
            const token = await this.auth.currentUser.getIdToken();
            const res   = await fetch(`/player/api/crate/${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Crate not found');
            const data = await res.json();

            this.activeCrateData = data;

            // Only re-render if the DOM is empty (SPA navigation without server render)
            if (container && !container.querySelector('.crate-hero')) {
                this.renderCrateView(data, container);
            }

            this._hydrateCrateViewPage();
            this.checkCrateLikeStatus(crateId);

        } catch (e) {
            console.error('Load Crate Error:', e);
            if (container && !container.querySelector('.crate-hero')) {
                container.innerHTML = `<div style="text-align:center;padding:50px;"><h2>Crate Not Found</h2><p>${e.message}</p></div>`;
            }
        }
    }

    /**
     * Hydrate the server-rendered crate page:
     * - Fill in heart states from the liked-songs cache
     * - Resolve and inject missing creatorHandle if the Firestore doc predates that field
     */
    _hydrateCrateViewPage() {
        const likedSongs = window.globalUserCache?.likedSongs;
        if (likedSongs instanceof Set) {
            document.querySelectorAll('.track-like-btn[data-song-id]').forEach(btn => {
                if (likedSongs.has(btn.dataset.songId)) {
                    const icon = btn.querySelector('i');
                    if (icon) {
                        icon.classList.remove('far');
                        icon.classList.add('fas');
                        btn.style.color = 'var(--primary)';
                    }
                }
            });
        }

        // ── Creator handle injection ──────────────────────────────────────────
        // If activeCrateData has a handle we can use it immediately.
        // If not (older crate docs predate the creatorHandle field), fetch the
        // owner's user doc from Firestore client-side using creatorId.
        const data = this.activeCrateData;
        if (data) {
            const handle = data.creatorHandle;
            if (handle && handle !== 'Unknown' && handle !== 'Anonymous') {
                this._injectCreatorHandle(handle);
            } else if (data.creatorId) {
                // One-time client-side lookup for stale docs missing the handle field
                this._resolveAndInjectHandle(data.creatorId);
            }
        }

        this.checkCrateLikeStatus(this.currentCrateId);
    }

    /** Write the resolved handle into every creator element in the DOM */
    _injectCreatorHandle(handle) {
        const page = document.querySelector('.content-scroll');
        if (!page) return;

        // Server-rendered <a class="creator-handle"> (hard refresh path)
        const link = page.querySelector('.creator-handle');
        if (link) {
            link.textContent = handle;
            link.style.cursor = 'pointer';
            link.style.textDecoration = 'underline';
            link.onclick = () => window.navigateTo(`/player/u/${handle.replace('@', '')}`);
            return; // link exists — no need to check spans
        }

        // Anonymous <span> fallback (when handle was null at server-render time)
        page.querySelectorAll('.creator-info span').forEach(s => {
            if (s.textContent.trim() === 'Anonymous' || s.textContent.trim() === 'Unknown') {
                s.textContent = handle;
                s.style.cursor = 'pointer';
                s.style.textDecoration = 'underline';
                s.style.color = 'white';
                s.style.fontWeight = '700';
                s.onclick = () => window.navigateTo(`/player/u/${handle.replace('@', '')}`);
            }
        });
    }

    /** Fetch handle from Firestore for crates that predate the creatorHandle field */
    async _resolveAndInjectHandle(creatorId) {
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res   = await fetch(`/player/api/profile/${creatorId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return;
            const profile = await res.json();
            const handle  = profile.handle;
            if (!handle) return;
            // Back-fill activeCrateData so subsequent calls don't re-fetch
            if (this.activeCrateData) this.activeCrateData.creatorHandle = handle;
            this._injectCreatorHandle(handle);
        } catch (e) {
            console.warn('[CrateView] handle resolve failed:', e.message);
        }
    }

    // ==========================================
    // 4. CRATE PLAYBACK
    // ==========================================

    /**
     * playCrate(crateId)   — called by Play All button: window.ui.playCrate('abc123')
     * playCrate(true)      — called by Shuffle button:   window.ui.playCrate(true)
     *
     * Both paths use this.activeCrateData which is populated by loadCrateView.
     * activeCrateData.tracks[*].audioUrl are fully-normalised https:// URLs
     * because player.js runs normalizeUrl on every track before embedding them
     * into window.__CRATE_DATA__ via crateDataJson.
     */
    async playCrate(crateIdOrShuffle = false) {
        let tracks = [];

        if (typeof crateIdOrShuffle === 'string') {
            // Play All button passes the crate ID as a string
            if (this.activeCrateData?.id === crateIdOrShuffle) {
                tracks = this.activeCrateData.tracks || [];
            } else {
                // activeCrateData not set yet — fetch (should be rare)
                try {
                    const token = await this.auth.currentUser.getIdToken();
                    const res   = await fetch(`/player/api/crate/${crateIdOrShuffle}`, {
                        headers: { 'Authorization': `Bearer ${token}` },
                    });
                    const data = await res.json();
                    tracks = data.tracks || [];
                    this.activeCrateData = data;
                } catch (e) {
                    return this.mainUI.showToast('Could not play crate', 'error');
                }
            }
        } else {
            // Shuffle (true) or generic play (false) — use cached data
            tracks = this.activeCrateData?.tracks || [];
        }

        if (tracks.length === 0) return this.mainUI.showToast('No tracks to play');

        // Shuffle if requested
        if (crateIdOrShuffle === true) {
            tracks = [...tracks].sort(() => Math.random() - 0.5);
        }

        const first = tracks[0];
        await this.mainUI.engine.play(first.id, {
            ...first,
            artUrl: this.mainUI.fixImageUrl(first.artUrl || first.img),
        });

        this.mainUI.engine.queue = [];
        for (let i = 1; i < tracks.length; i++) {
            this.mainUI.engine.addToQueue({
                ...tracks[i],
                artUrl: this.mainUI.fixImageUrl(tracks[i].artUrl || tracks[i].img),
            });
        }
    }

    async playCrateTrack(index) {
        const tracks = this.activeCrateData?.tracks || [];
        const track  = tracks[index];
        if (!track) {
            console.warn('[CrateView] playCrateTrack: no track at index', index, '— activeCrateData:', this.activeCrateData);
            return;
        }

        await this.mainUI.engine.play(track.id, {
            ...track,
            artUrl: this.mainUI.fixImageUrl(track.artUrl || track.img),
        });

        this.mainUI.engine.queue = [];
        for (let i = index + 1; i < tracks.length; i++) {
            this.mainUI.engine.addToQueue({
                ...tracks[i],
                artUrl: this.mainUI.fixImageUrl(tracks[i].artUrl || tracks[i].img),
            });
        }
    }

    // ==========================================
    // 5. CRATE LIKES
    // ==========================================

    async toggleCrateLike() {
        if (!this.currentCrateId) return;
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res   = await fetch('/player/api/crate/like/toggle', {
                method:  'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ crateId: this.currentCrateId }),
            });
            const data = await res.json();
            this.mainUI.showToast(data.liked ? 'Added to collection' : 'Removed from collection');
            this.checkCrateLikeStatus(this.currentCrateId);
        } catch (e) {
            console.error('Crate Like Error:', e);
        }
    }

    async checkCrateLikeStatus(crateId) {
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res   = await fetch(`/player/api/crate/like/check?crateId=${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            const btn  = document.querySelector('.btn-like-crate');
            if (btn) {
                btn.classList.toggle('liked', data.liked);
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fas', data.liked);
                    icon.classList.toggle('far', !data.liked);
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    // ==========================================
    // 6. SPA FALLBACK RENDERER
    //    Only used when the crate page is reached
    //    via SPA navigation with no server render.
    // ==========================================

    renderCrateView(crate, container) {
        const rawCover      = crate.coverImage || crate.tracks?.[0]?.artUrl || '';
        const coverImg      = this.mainUI.fixImageUrl(rawCover);
        const creatorAvatar = crate.creatorAvatar ? this.mainUI.fixImageUrl(crate.creatorAvatar) : '';

        let html = `
        <div class="crate-hero" style="background:linear-gradient(to bottom,rgba(0,0,0,0.6),var(--bg-main)),url('${coverImg}') center/cover;">
          <div class="crate-hero-inner" style="backdrop-filter:blur(20px);background:rgba(0,0,0,0.5);padding:40px;border-radius:20px;display:flex;gap:30px;align-items:flex-end;">
            <div class="crate-cover" style="width:220px;height:220px;flex-shrink:0;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
              <img src="${coverImg}" style="width:100%;height:100%;object-fit:cover;">
            </div>
            <div class="crate-info" style="flex:1;">
              <h1 class="crate-title" style="font-size:3.5rem;font-weight:900;margin-bottom:10px;">${crate.title}</h1>
              <div class="crate-meta" style="display:flex;align-items:center;gap:15px;margin-bottom:25px;">
                ${creatorAvatar ? `<img src="${creatorAvatar}" style="width:30px;height:30px;border-radius:50%;">` : '<i class="fas fa-user"></i>'}
                <span>Created by <strong>${crate.creatorHandle || 'Anonymous'}</strong></span>
                <span style="color:#666">•</span>
                <span>${crate.tracks?.length || 0} Songs</span>
              </div>
              <div class="crate-actions" style="display:flex;gap:15px;">
                <button onclick="window.ui.playCrate('${crate.id}')" style="padding:12px 30px;border-radius:50px;border:none;background:var(--primary);color:#000;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:8px;">
                  <i class="fas fa-play"></i> Play All
                </button>
                <button onclick="window.ui.playCrate(true)" title="Shuffle" style="width:48px;height:48px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                  <i class="fas fa-random"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="crate-tracks" style="margin-top:30px;padding:0 20px;">
          <div class="track-list-header" style="display:flex;padding:10px 15px;border-bottom:1px solid rgba(255,255,255,0.1);color:#888;font-size:0.85rem;text-transform:uppercase;letter-spacing:1px;">
            <div style="width:40px;text-align:center;">#</div>
            <div style="flex:1;">Title</div>
            <div style="flex:1;">Artist</div>
            <div style="width:60px;text-align:right;"><i class="far fa-clock"></i></div>
            <div style="width:80px;"></div>
          </div>
          <div class="track-list-body">`;

        (crate.tracks || []).forEach((track, index) => {
            const img        = this.mainUI.fixImageUrl(track.artUrl || track.img);
            const duration   = this._fmtTime(track.duration);
            const safeTitle  = (track.title  || '').replace(/'/g, "\\'");
            const safeArtist = (track.artist || '').replace(/'/g, "\\'");
            const artistId   = track.artistId || '';
            html += `
            <div class="track-row" data-song-id="${track.id}"
                 onclick="window.ui.playCrateTrack(${index})"
                 onmouseover="this.style.background='rgba(255,255,255,0.05)'"
                 onmouseout="this.style.background='transparent'"
                 style="display:flex;align-items:center;padding:12px 15px;border-radius:8px;cursor:pointer;transition:background 0.2s;border-bottom:1px solid rgba(255,255,255,0.05);">
              <div class="col-num" style="width:40px;text-align:center;color:#666;font-size:0.9rem;">
                <span class="track-number">${index + 1}</span>
                <i class="fas fa-play track-play-icon" style="display:none;color:var(--primary);font-size:0.8rem;"></i>
              </div>
              <div style="flex:1;display:flex;align-items:center;gap:15px;">
                <img src="${img}" style="width:40px;height:40px;border-radius:4px;object-fit:cover;">
                <div>
                  <div style="font-weight:700;">${track.title}</div>
                  <div style="font-size:0.8rem;color:#888;">${track.artist}</div>
                </div>
              </div>
              <div style="flex:1;color:#ccc;font-size:0.95rem;">${track.artist}</div>
              <div style="width:60px;text-align:right;color:#888;font-size:0.9rem;">${duration}</div>
              <div style="width:80px;display:flex;justify-content:flex-end;gap:10px;">
                <button class="track-like-btn" data-song-id="${track.id}"
                    onclick="event.stopPropagation();toggleSongLike(this,'${track.id}','${safeTitle}','${safeArtist}','${img}','${track.audioUrl || ''}','${track.duration || 0}','${artistId}')"
                    style="background:none;border:none;color:#666;cursor:pointer;font-size:1rem;transition:color 0.2s;"
                    onmouseover="this.style.color='var(--primary)'"
                    onmouseout="if(!this.querySelector('i').classList.contains('fas'))this.style.color='#666'">
                  <i class="far fa-heart"></i>
                </button>
              </div>
            </div>`;
        });

        html += '</div></div><div style="height:120px;"></div>';
        container.innerHTML = html;

        // Hydrate hearts after rendering
        const likedSongs = window.globalUserCache?.likedSongs;
        if (likedSongs instanceof Set) {
            container.querySelectorAll('.track-like-btn[data-song-id]').forEach(btn => {
                if (likedSongs.has(btn.dataset.songId)) {
                    const icon = btn.querySelector('i');
                    if (icon) { icon.classList.replace('far', 'fas'); }
                    btn.style.color = 'var(--primary)';
                }
            });
        }

        setTimeout(() => this.mainUI.hydrateGlobalButtons(), 100);
    }

    _fmtTime(seconds) {
        if (!seconds) return '—';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }
}