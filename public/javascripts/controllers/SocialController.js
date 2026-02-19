/* public/javascripts/controllers/SocialController.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export class SocialController {
    constructor(mainUI) {
        this.mainUI = mainUI;
        this.auth = getAuth();

        // Bind global functions to window
        window.ui.toggleSongLike = this.toggleSongLike.bind(this);
        window.ui.toggleFollow = this.toggleFollow.bind(this);
        window.ui.checkSongLikeStatus = this.checkSongLikeStatus.bind(this);
        window.ui.refreshLikeStates = this.mainUI.hydrateGlobalButtons.bind(this.mainUI);
        
        window.loadMoreArtists = this.loadMoreArtists.bind(this);
        window.loadMoreArtistsBatch = this.loadArtistsBatch.bind(this);
    }

    // ==========================================
    // 1. OMNI SEARCH
    // ==========================================

    setupOmniSearch() {
        window.toggleSearchFilter = () => {
            const menu = document.getElementById('searchFilterMenu');
            if (menu) menu.classList.toggle('active');
        };
        
        window.setSearchMode = (mode) => {
            const input = document.getElementById('mainSearchInput');
            const icon = document.getElementById('currentSearchIcon');
            const menu = document.getElementById('searchFilterMenu');
            let prefix = '', placeholder = 'Search...', iconClass = 'fa-search';

            switch(mode) {
                case 'artist': prefix = '@'; placeholder = 'Search artists...'; iconClass = 'fa-microphone-alt'; break;
                case 'song': prefix = 's:'; placeholder = 'Search songs...'; iconClass = 'fa-music'; break;
                case 'city': prefix = 'C:'; placeholder = 'Search cities...'; iconClass = 'fa-city'; break;
                default: prefix = ''; placeholder = 'Search...'; iconClass = 'fa-search';
            }

            if(icon) icon.className = `fas ${iconClass}`;
            if(menu) menu.classList.remove('active');
            
            if(input) {
                input.value = prefix; 
                input.placeholder = placeholder; 
                input.focus();
            }
        };
        
        let debounceTimer;
        document.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'mainSearchInput') {
                const query = e.target.value;
                const resultsBox = document.getElementById('searchResults');
                
                clearTimeout(debounceTimer);
                
                if (query.length < 2) { 
                    if(resultsBox) resultsBox.classList.remove('active'); 
                    return; 
                }

                debounceTimer = setTimeout(async () => {
                    if(resultsBox) {
                        resultsBox.innerHTML = '<div class="search-placeholder"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
                        resultsBox.classList.add('active');
                    }
                    
                    try {
                        const token = await this.auth.currentUser.getIdToken();
                        const res = await fetch(`/player/api/search?q=${encodeURIComponent(query)}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        const data = await res.json();
                        this.renderSearchResults(data.results);
                    } catch (err) { 
                        console.error("Search Error:", err); 
                    }
                }, 300);
            }
        });
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                document.getElementById('searchFilterMenu')?.classList.remove('active');
                document.getElementById('searchResults')?.classList.remove('active');
            }
        });
    }

    renderSearchResults(results) {
        const box = document.getElementById('searchResults');
        if (!box) return;
        
        box.innerHTML = '';
        if (!results || results.length === 0) {
            box.innerHTML = '<div class="search-placeholder">No results found.</div>';
            return;
        }
        
        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            
            let imgHtml = item.img ? `<img src="${item.img}" class="result-img">` : '<div class="result-img square"></div>';
            
            div.onclick = () => {
                if (item.type === 'song') {
                    window.playSong(item.id, item.title, item.subtitle, item.img, item.audioUrl, item.duration);
                } else if (item.url) {
                    window.navigateTo(item.url);
                }
                box.classList.remove('active');
            };
            
            div.innerHTML = `
                ${imgHtml}
                <div class="result-info">
                    <div class="result-title">${item.title}</div>
                    <div class="result-sub">${item.subtitle}</div>
                </div>`;
            box.appendChild(div);
        });
    }

    // ==========================================
    // 2. LIKES & FAVORITES
    // ==========================================

    async loadUserLikes() {
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/user/likes/ids', { headers: { 'Authorization': `Bearer ${token}` }});
            const data = await res.json();
            
            if(!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache.likedSongs = new Set(data.likedSongIds || []);
            
            this.mainUI.hydrateGlobalButtons();
        } catch(e) { 
            console.error("Like Cache Error", e); 
        }
    }

    checkSongLikeStatus(songId, iconElement) {
        if (!this.auth.currentUser || !iconElement) return;
        
        let isLiked = false;
        if (window.globalUserCache && window.globalUserCache.likedSongs) {
            isLiked = window.globalUserCache.likedSongs.has(songId);
        }
        
        if (isLiked) {
            iconElement.classList.remove('far'); 
            iconElement.classList.add('fas'); 
            iconElement.style.color = '#F4A261';
        } else {
            iconElement.classList.remove('fas'); 
            iconElement.classList.add('far'); 
            iconElement.style.color = '';
        }
    }

    async toggleSongLike(btn, songId, title, artist, artUrl, audioUrl, duration) {
        if (!this.auth.currentUser) return window.location.href = '/members/login';
        
        const icon = btn.tagName === 'I' ? btn : btn.querySelector('i');
        const isLiked = icon.classList.contains('fas');
        
        if (!window.globalUserCache) window.globalUserCache = {};
        if (!window.globalUserCache.likedSongs) window.globalUserCache.likedSongs = new Set();
        if (!window.globalUserCache.favorites) window.globalUserCache.favorites = [];

        if (isLiked) { 
            icon.classList.remove('fas'); 
            icon.classList.add('far'); 
            icon.style.color = '';
            
            window.globalUserCache.likedSongs.delete(songId);
            window.globalUserCache.favorites = window.globalUserCache.favorites.filter(s => s.id !== songId);
            
            const row = btn.closest('.track-row');
            if (row && document.getElementById('favoritesList')) {
                row.remove();
                if (window.globalUserCache.favorites.length === 0) {
                    document.getElementById('favoritesList').innerHTML = this.mainUI.createEmptyState("Go explore the scene and heart some tracks!");
                }
            }
        } else { 
            icon.classList.remove('far'); 
            icon.classList.add('fas'); 
            icon.style.color = '#F4A261';
            
            window.globalUserCache.likedSongs.add(songId);
            if (!window.globalUserCache.favorites.some(s => s.id === songId)) {
                window.globalUserCache.favorites.unshift({
                    id: songId, title: title, artist: artist, img: artUrl,
                    audioUrl: audioUrl, duration: parseFloat(duration) || 0
                });
            }
        }

        try {
            const token = await this.auth.currentUser.getIdToken();
            const method = isLiked ? 'DELETE' : 'POST';
            const url = isLiked ? `/player/api/user/like/${songId}` : '/player/api/user/like';
            
            await fetch(url, { 
                method: method, 
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, 
                body: method === 'POST' ? JSON.stringify({ songId, title, artist, artUrl, audioUrl, duration }) : undefined
            });
        } catch (e) { 
            console.error("Like failed", e); 
            this.checkSongLikeStatus(songId, icon); 
        }
    }

    // ==========================================
    // 3. FOLLOWS & ARTIST DISCOVERY
    // ==========================================

    async checkFollowStatus(artistId) {
        if (!this.auth.currentUser) return;
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/follow/check?artistId=${artistId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            this.updateFollowButtonUI(data.following);
        } catch (e) { console.error("Status check failed", e); }
    }

    updateFollowButtonUI(isFollowing) {
        const btn = document.getElementById('followBtn');
        if (!btn) return;
        if (isFollowing) {
            btn.classList.add('following');
            btn.innerHTML = 'Following';
            btn.style.background = 'transparent';
            btn.style.border = '1px solid #FFF';
            btn.style.color = '#FFF';
        } else {
            btn.classList.remove('following');
            btn.innerHTML = 'Follow';
            btn.style.background = '#88C9A1';
            btn.style.border = 'none';
            btn.style.color = '#FFF';
        }
    }

    async toggleFollow(btn) {
        if (!this.auth.currentUser) return window.location.href = '/members/login';
        const isFollowing = btn.classList.contains('following');
        this.updateFollowButtonUI(!isFollowing); 

        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/artist/follow', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    artistId: btn.dataset.artistId,
                    artistName: btn.dataset.artistName,
                    artistImg: btn.dataset.artistImg
                })
            });
            
            const data = await res.json();
            this.updateFollowButtonUI(data.following);
            
            if (window.globalUserCache) {
                window.globalUserCache.sidebarArtists = data.sidebar;
                if (this.mainUI.renderSidebarArtists) this.mainUI.renderSidebarArtists(data.sidebar);
            }
        } catch (e) {
            console.error("Follow error", e);
            this.updateFollowButtonUI(isFollowing); 
        }
    }

    async loadMoreArtists() {
        try {
            const modal = document.createElement('div');
            modal.className = 'artists-modal';
            modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1000;';
            modal.innerHTML = `
                <div class="modal-overlay" onclick="this.parentElement.remove()" 
                     style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                     background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);"></div>
                <div class="modal-content" style="position: relative; background: var(--card-bg); 
                     max-width: 900px; max-height: 85vh; margin: 5vh auto; border-radius: 20px; 
                     overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div class="modal-header" style="display: flex; justify-content: space-between; 
                         align-items: center; padding: 25px 30px; border-bottom: 1px solid var(--border-color);">
                        <h2 style="margin: 0; color: var(--text-main); font-size: 1.5rem; font-weight: 900;">
                            Artists in ${window.currentCity || 'Your City'}
                        </h2>
                        <button onclick="this.closest('.artists-modal').remove()" 
                                style="background: none; border: none; font-size: 1.5rem; cursor: pointer; 
                                color: var(--text-secondary); transition: 0.2s;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div id="allArtistsList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); 
                         gap: 20px; padding: 30px; max-height: calc(85vh - 150px); overflow-y: auto;">
                        <div style="grid-column: 1/-1; text-align: center; padding: 60px;">
                            <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: var(--primary);"></i>
                            <p style="margin-top: 15px; color: var(--text-secondary);">Loading artists...</p>
                        </div>
                    </div>
                    <div style="text-align: center; padding: 20px; border-top: 1px solid var(--border-color);">
                        <button id="loadMoreBtn" onclick="window.loadMoreArtistsBatch()" 
                                style="background: var(--primary); color: #000; padding: 12px 35px; 
                                border-radius: 25px; border: none; font-weight: 800; cursor: pointer; 
                                font-size: 0.95rem; transition: 0.2s;">
                            Load More
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            window.artistsOffset = 0;
            window.artistsLimit = 24;
            await this.loadArtistsBatch();

        } catch (e) { console.error("Load More Artists Error:", e); }
    }

    async loadArtistsBatch() {
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(
                `/player/api/artists/local?city=${encodeURIComponent(window.currentCity)}&offset=${window.artistsOffset}&limit=${window.artistsLimit}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            const data = await res.json();

            const container = document.getElementById('allArtistsList');
            if (window.artistsOffset === 0) container.innerHTML = '';

            if (data.artists && data.artists.length > 0) {
                data.artists.forEach(artist => {
                    const card = document.createElement('div');
                    card.className = 'artist-card-modal';
                    card.style.cssText = 'cursor: pointer; text-align: center; transition: 0.2s;';
                    card.onmouseenter = () => card.style.transform = 'translateY(-5px)';
                    card.onmouseleave = () => card.style.transform = 'translateY(0)';
                    card.onclick = () => {
                        window.navigateTo(`/player/artist/${artist.id}`);
                        document.querySelector('.artists-modal').remove();
                    };
                    card.innerHTML = `
                        <img src="${artist.img}" style="width: 100%; aspect-ratio: 1; border-radius: 50%; object-fit: cover; margin-bottom: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
                        <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main); margin-bottom: 4px;">${artist.name}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">${artist.followers || 0} followers</div>
                    `;
                    container.appendChild(card);
                });

                window.artistsOffset += data.artists.length;
                const loadMoreBtn = document.getElementById('loadMoreBtn');
                loadMoreBtn.style.display = data.artists.length < window.artistsLimit ? 'none' : 'inline-block';
            } else {
                if (window.artistsOffset === 0) {
                    container.innerHTML = `
                        <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                            <i class="fas fa-music" style="font-size: 3rem; color: var(--text-secondary); opacity: 0.3; margin-bottom: 15px;"></i>
                            <p style="color: var(--text-secondary); font-size: 1rem;">No artists found in ${window.currentCity} yet.</p>
                        </div>
                    `;
                }
                document.getElementById('loadMoreBtn').style.display = 'none';
            }
        } catch (e) {
            document.getElementById('allArtistsList').innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);"><p>Failed to load artists.</p></div>`;
        }
    }
}

// ==========================================
// 4. ARTIST COMMENTS MANAGER
// ==========================================
export class ArtistCommentsManager {
    constructor(artistId, currentUserId) {
        this.artistId = artistId;
        this.currentUserId = currentUserId;
        this.auth = getAuth();
        this.comments = [];
        this.canComment = false;
        this.isLoading = false;
        this.hasMore = true;
        this.lastTimestamp = null;
        
        this.submitComment = this.submitComment.bind(this);
    }

    async init() {
        await this.checkCommentPermission();
        await this.loadComments();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const form = document.getElementById('artistCommentForm');
        const input = document.getElementById('commentInput');
        const actions = document.getElementById('commentActions');
        const cancelBtn = document.getElementById('cancelCommentBtn');
        const submitBtn = document.getElementById('submitCommentBtn');
        const avatar = document.getElementById('currentUserAvatar');

        if (avatar && window.globalUserCache?.photoURL && window.ui) {
            avatar.src = window.ui.fixImageUrl(window.globalUserCache.photoURL);
            avatar.style.display = 'block';
        }

        if (input) {
            input.onfocus = () => {
                if (actions) {
                    actions.style.display = 'flex';
                    actions.classList.add('active');
                }
            };
            input.oninput = function() {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
                if (submitBtn) {
                    submitBtn.disabled = this.value.trim().length === 0;
                    submitBtn.classList.toggle('ready', this.value.trim().length > 0);
                }
            };
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => {
                if (input) {
                    input.value = '';
                    input.style.height = 'auto';
                    input.rows = 1;
                    input.blur();
                }
                if (actions) actions.style.display = 'none';
            };
        }

        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                await this.submitComment();
            };
        }
    }

    async submitComment() {
        const input = document.getElementById('commentInput');
        const submitBtn = document.getElementById('submitCommentBtn');
        const actions = document.getElementById('commentActions');
        
        const text = input ? input.value.trim() : '';
        if (!text) return;

        try {
            if (submitBtn) { submitBtn.innerText = 'Posting...'; submitBtn.disabled = true; }

            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/${this.artistId}/comment`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ comment: text })
            });

            const data = await res.json();
            if (data.success) {
                if (input) { input.value = ''; input.style.height = 'auto'; input.blur(); }
                if (actions) actions.style.display = 'none';
                
                this.comments.unshift(data.comment);
                this.renderComments();
                
                const countEl = document.getElementById('commentCount');
                if (countEl) countEl.innerText = `${this.comments.length} Comments`;
                
                if (window.ui) window.ui.showToast('Comment posted');
            } else { throw new Error(data.error); }
        } catch (e) {
            console.error(e);
            if (window.ui) window.ui.showToast(e.message || 'Failed to post comment');
        } finally {
            if (submitBtn) submitBtn.innerText = 'Comment';
        }
    }

    renderComments() {
        const container = document.getElementById('commentsList');
        if (!container) return;

        if (this.comments.length === 0) {
            container.innerHTML = '<div style="padding:40px; text-align:center; color:#888">No comments yet.</div>';
            return;
        }

        container.innerHTML = this.comments.map(c => {
            const isOwn = c.userId === this.currentUserId;
            const timeAgo = this.getTimeAgo(new Date(c.timestamp));
            const avatarUrl = window.ui ? window.ui.fixImageUrl(c.userAvatar) : (c.userAvatar || 'https://via.placeholder.com/40');

            return `
            <div class="comment-item" style="margin-bottom:20px; display:flex; gap:15px; background:transparent;">
                <img src="${avatarUrl}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-top:5px;">
                <div style="flex:1;">
                    <div style="margin-bottom:4px;">
                        <span style="font-weight:700; color:var(--text-main); font-size:0.9rem; margin-right:8px;">${c.userName}</span>
                        <span style="color:var(--text-secondary); font-size:0.8rem;">${timeAgo}</span>
                    </div>
                    <div style="color:var(--text-main); font-size:0.95rem; line-height:1.4; margin-bottom:8px; white-space: pre-wrap;">${this.sanitize(c.comment)}</div>
                    
                    <div style="display:flex; gap:15px; align-items:center;">
                        <button style="background:none; border:none; color:var(--text-secondary); cursor:pointer; display:flex; align-items:center; gap:5px; font-size:0.85rem;" title="Like">
                            <i class="far fa-thumbs-up"></i> ${c.likes || ''}
                        </button>
                        ${isOwn ? `
                            <button onclick="window.artistComments.deleteComment('${c.id}')" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:0.8rem; margin-left:auto;">Delete</button>
                        ` : `
                            <button onclick="window.artistComments.reportComment('${c.id}')" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:0.8rem; margin-left:auto;" title="Report"><i class="fas fa-flag"></i></button>
                        `}
                    </div>
                </div>
            </div>`
        }).join('');
    }

    async reportComment(commentId) {
        const reason = prompt("Why are you reporting this comment? (e.g. Spam, Harassment)");
        if (!reason) return;
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/${this.artistId}/comment/${commentId}/report`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
            const data = await res.json();
            if (data.success && window.ui) window.ui.showToast('Report submitted. Thanks for helping!');
        } catch (e) {
            console.error(e);
            if (window.ui) window.ui.showToast('Error submitting report');
        }
    }

    async deleteComment(commentId) {
        if (!confirm("Delete this comment?")) return;
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/${this.artistId}/comment/${commentId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                this.comments = this.comments.filter(c => c.id !== commentId);
                this.renderComments();
                const countEl = document.getElementById('commentCount');
                if (countEl) countEl.innerText = `${this.comments.length} Comments`;
                if (window.ui) window.ui.showToast('Comment deleted');
            }
        } catch (e) { console.error(e); }
    }

    async checkCommentPermission() {
        try {
            if (!this.auth.currentUser) {
                this.canComment = false;
                this.updateCommentUI();
                return;
            }
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/${this.artistId}/can-comment`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            this.canComment = data.canComment;
            this.updateCommentUI();
        } catch (e) { console.error(e); }
    }

    updateCommentUI() {
        const formContainer = document.getElementById('commentFormContainer');
        const prompt = document.getElementById('followToCommentPrompt');
        if (this.canComment) {
            if (formContainer) formContainer.style.display = 'block';
            if (prompt) prompt.style.display = 'none';
        } else {
            if (formContainer) formContainer.style.display = 'none';
            if (prompt) prompt.style.display = 'block';
        }
    }

    async loadComments(append = false) {
        if (this.isLoading) return;
        this.isLoading = true;
        const loader = document.getElementById('commentsLoading');
        if (loader) loader.style.display = 'block';

        try {
            const token = await this.auth.currentUser.getIdToken();
            let url = `/player/api/artist/${this.artistId}/comments?limit=20`;
            if (append && this.lastTimestamp) url += `&lastTimestamp=${this.lastTimestamp}`;

            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (append) this.comments.push(...data.comments);
            else this.comments = data.comments || [];

            this.hasMore = data.hasMore;
            if (data.comments.length > 0) this.lastTimestamp = data.comments[data.comments.length - 1].timestamp;

            this.renderComments();
            const countEl = document.getElementById('commentCount');
            if (countEl) countEl.innerText = `${this.comments.length} Comments`;

        } catch (e) { console.error(e); } 
        finally {
            this.isLoading = false;
            if (loader) loader.style.display = 'none';
        }
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        if (seconds < 60) return 'just now';
        const m = Math.floor(seconds / 60);
        if (m < 60) return `${m} minutes ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h} hours ago`;
        const d = Math.floor(h / 24);
        return `${d} days ago`;
    }

    sanitize(str) {
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }
}