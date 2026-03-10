/* public/javascripts/controllers/ArtistPostsWallController.js
 *
 * Manages the Community tab post wall on the artist profile page.
 * Instantiated by PlayerUIController when artist-profile page loads.
 * Triggered to fetch posts when the Community tab is first opened.
 */

import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();

export class ArtistPostsWallController {
    constructor(ui) {
        this.ui           = ui;
        this.artistId     = null;
        this.artistName   = null;
        this.artistAvatar = null;
        this.currentPostId = null;
        this.lastCreatedAt = null;
        this.hasMore      = false;
        this.loading      = false;
        this.postsLoaded  = false;

        this._injectStyles();
    }

    // ─────────────────────────────────────────────────────────────
    // INIT — called by checkAndReloadViews on artist-profile page
    // ─────────────────────────────────────────────────────────────
    init(artistId, artistName, artistAvatar) {
        this.artistId     = artistId;
        this.artistName   = artistName   || '';
        this.artistAvatar = artistAvatar || '';
        this.postsLoaded  = false;
        this.lastCreatedAt = null;

        // Expose globals the pug onclick attrs need
        window.artistPosts = {
            closeModal:       () => this.closeModal(),
            togglePostLike:   () => this.togglePostLike(),
            loadMore:         () => this.loadMore(),
            deleteComment:    (id) => this.deleteComment(id),
            toggleCommentLike: (btn, commentId) => this.toggleCommentLike(btn, commentId),
        };

        // Patch switchArtistTab ONCE — guard against re-wrapping on every SPA
        // navigation to an artist page. Re-wrapping creates an ever-growing
        // closure chain that eventually calls loadPosts multiple times per tab
        // click and causes unpredictable state as old closures linger.
        if (!window._postWallTabPatched) {
            window._postWallTabPatched = true;
            const originalSwitch = window.switchArtistTab;
            window.switchArtistTab = (tabName) => {
                if (typeof originalSwitch === 'function') originalSwitch(tabName);
                // Always delegate to the controller's current state — "this" in the
                // closure below always points to the singleton controller instance,
                // so it correctly reflects whichever artist is currently loaded.
                if (tabName === 'community' && !this.postsLoaded) {
                    this.loadPosts(true);
                }
            };
        }

        this._bindModalClose();
    }

    // ─────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────
    async _getToken() {
        try {
            const user = auth.currentUser;
            return user ? await user.getIdToken() : null;
        } catch { return null; }
    }

    _authHeaders(token) {
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    _timeAgo(date) {
        const diff = (Date.now() - new Date(date).getTime()) / 1000;
        if (diff < 60)    return 'just now';
        if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    _escape(str = '') {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _toast(msg, isError = false) {
        this.ui?.showToast?.(msg, isError ? 'error' : 'info');
    }

    // ─────────────────────────────────────────────────────────────
    // LOAD POSTS
    // ─────────────────────────────────────────────────────────────
    async loadPosts(reset = false) {
        if (this.loading || !this.artistId) return;
        this.loading = true;

        const grid    = document.getElementById('wallGrid');
        const empty   = document.getElementById('wallEmpty');
        const loadEl  = document.getElementById('wallLoading');
        const moreBtn = document.getElementById('wallLoadMoreBtn');

        if (reset) {
            this.lastCreatedAt = null;
            if (grid)    grid.innerHTML = '';
            if (empty)   empty.style.display  = 'none';
            if (moreBtn) moreBtn.style.display = 'none';
        }

        if (loadEl) loadEl.style.display = reset ? 'grid' : 'none';

        try {
            const token = await this._getToken();
            let url = `/player/api/artist/${this.artistId}/posts?limit=12`;
            if (this.lastCreatedAt) url += `&lastCreatedAt=${encodeURIComponent(this.lastCreatedAt)}`;

            const res   = await fetch(url, { headers: this._authHeaders(token) });
            const data  = await res.json();
            const posts = data.posts || [];
            this.hasMore = data.hasMore || false;

            if (loadEl) loadEl.style.display = 'none';

            if (posts.length === 0 && reset) {
                if (empty) empty.style.display = 'flex';
                this.loading = false;
                this.postsLoaded = true;
                return;
            }

            posts.forEach(post => grid?.appendChild(this._buildCard(post)));

            if (posts.length > 0) {
                this.lastCreatedAt = posts[posts.length - 1].createdAt;
            }

            if (moreBtn) moreBtn.style.display = this.hasMore ? 'inline-flex' : 'none';
            this.postsLoaded = true;

        } catch (e) {
            console.error('[Wall] load error:', e);
            if (loadEl) loadEl.style.display = 'none';
            if (grid && reset) {
                grid.innerHTML = '<p style="color:#555;text-align:center;padding:40px;grid-column:1/-1;">Could not load posts.</p>';
            }
        }

        this.loading = false;
    }

    loadMore() {
        if (this.hasMore) this.loadPosts(false);
    }

    // ─────────────────────────────────────────────────────────────
    // BUILD CARD
    // ─────────────────────────────────────────────────────────────
    _buildCard(post) {
        const card = document.createElement('div');
        card.className = 'wall-card';
        card.dataset.postId = post.id;

        const caption = post.caption.length > 72
            ? post.caption.slice(0, 72) + '…'
            : post.caption;

        card.innerHTML = `
            <div class="wall-card-img-wrap">
                <img class="wall-card-img" src="${this._escape(post.imageUrl)}" alt="Post" loading="lazy">
                <div class="wall-card-overlay">
                    <span><i class="fas fa-heart"></i> ${post.likes || 0}</span>
                    <span><i class="fas fa-comment"></i> ${post.commentCount || 0}</span>
                </div>
            </div>
            <div class="wall-card-body">
                <p class="wall-card-caption">${this._escape(caption)}</p>
                <span class="wall-card-time">${this._timeAgo(post.createdAt)}</span>
            </div>`;

        card.addEventListener('click', () => this.openModal(post));
        return card;
    }

    // ─────────────────────────────────────────────────────────────
    // MODAL — OPEN
    // ─────────────────────────────────────────────────────────────
    async openModal(post) {
        this.currentPostId = post.id;

        const $ = id => document.getElementById(id);
        const modal = $('postModal');
        if (!modal) return;

        if ($('postModalImage'))       $('postModalImage').src           = post.imageUrl;
        if ($('postModalAvatar'))      $('postModalAvatar').src          = this.artistAvatar;
        if ($('postModalArtistName'))  $('postModalArtistName').textContent  = this.artistName;
        if ($('postModalTime'))        $('postModalTime').textContent        = this._timeAgo(post.createdAt);
        if ($('postModalCaption'))     $('postModalCaption').textContent     = post.caption;
        if ($('postModalLikeCount'))   $('postModalLikeCount').textContent   = ` ${post.likes || 0}`;
        if ($('postModalCommentCount')) $('postModalCommentCount').textContent = ` ${post.commentCount || 0}`;

        const likeIcon = $('postModalLikeIcon');
        if (likeIcon) {
            likeIcon.className   = post.likedByMe ? 'fas fa-heart' : 'far fa-heart';
            likeIcon.style.color = post.likedByMe ? '#e74c3c' : '';
        }

        const commentForm = $('postModalCommentForm');
        const followGate  = $('postModalFollowGate');
        if (commentForm) commentForm.style.display = 'none';
        if (followGate)  followGate.style.display  = 'none';

        const user = auth.currentUser;
        if (user) {
            const token = await this._getToken();
            let canComment = false;
            try {
                const r = await fetch(`/player/api/artist/${this.artistId}/can-comment`, {
                    headers: this._authHeaders(token)
                });
                if (r.ok) canComment = (await r.json()).canComment || false;
            } catch { /* treat as not following */ }

            if (canComment) {
                if (commentForm) commentForm.style.display = 'flex';
                const userAvatar = $('postModalUserAvatar');
                if (userAvatar) {
                    // auth.currentUser.photoURL is null for email/password users
                    // who have a custom CDN avatar — fall back to globalUserCache
                    const avatarUrl = user.photoURL || window.globalUserCache?.photoURL || '';
                    if (avatarUrl) userAvatar.src = avatarUrl;
                }
            } else {
                if (followGate) followGate.style.display = 'flex';
            }
        } else {
            if (followGate) followGate.style.display = 'flex';
        }

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        this._wireCommentInput();

        if ($('postModalComments'))       $('postModalComments').innerHTML = '';
        if ($('postModalCommentsLoading')) $('postModalCommentsLoading').style.display = 'block';
        await this._loadComments();
    }

    // ─────────────────────────────────────────────────────────────
    // MODAL — CLOSE
    // ─────────────────────────────────────────────────────────────
    closeModal() {
        const modal = document.getElementById('postModal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
        this.currentPostId = null;

        const input = document.getElementById('postModalCommentInput');
        const btn   = document.getElementById('postModalSubmitBtn');
        if (input) input.value = '';
        if (btn)   btn.disabled = true;
    }

    _bindModalClose() {
        if (window._postWallModalBound) return;
        window._postWallModalBound = true;
        document.addEventListener('click', (e) => {
            if (e.target.id === 'postModal') this.closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.currentPostId) this.closeModal();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // COMMENT LIKE — fan can heart a comment
    // ─────────────────────────────────────────────────────────────
    async toggleCommentLike(btn, commentId) {
        if (!commentId) return;
        const token = await this._getToken();
        if (!token) return this._toast('Sign in to like comments', true);
        if (btn) btn.disabled = true;

        try {
            const res  = await fetch(`/player/api/artist/${this.artistId}/post/${this.currentPostId}/comment/${commentId}/like`, {
                method: 'POST', headers: this._authHeaders(token),
            });
            const data = await res.json();
            if (data.success) {
                const icon    = document.querySelector(`#clb-${commentId} i`);
                const countEl = document.getElementById(`clc-${commentId}`);
                if (icon) {
                    icon.className = data.liked ? 'fas fa-heart' : 'far fa-heart';
                    btn.style.color = data.liked ? '#e74c3c' : 'var(--text-secondary,#888)';
                }
                if (countEl) countEl.textContent = data.likes;
            }
        } catch (e) { console.error('[Wall] comment like error:', e); }
        if (btn) btn.disabled = false;
    }

    // ─────────────────────────────────────────────────────────────
    // LIKE
    // ─────────────────────────────────────────────────────────────
    async togglePostLike() {
        if (!this.currentPostId) return;
        const token = await this._getToken();
        if (!token) return this._toast('Sign in to like posts', true);

        const likeBtn   = document.getElementById('postModalLikeBtn');
        const likeIcon  = document.getElementById('postModalLikeIcon');
        const likeCount = document.getElementById('postModalLikeCount');
        if (likeBtn) likeBtn.disabled = true;

        try {
            const res  = await fetch(`/player/api/artist/${this.artistId}/post/${this.currentPostId}/like`, {
                method: 'POST', headers: this._authHeaders(token),
            });
            const data = await res.json();
            if (data.success) {
                if (likeIcon) {
                    likeIcon.className   = data.liked ? 'fas fa-heart' : 'far fa-heart';
                    likeIcon.style.color = data.liked ? '#e74c3c' : '';
                }
                if (likeCount) likeCount.textContent = ` ${data.likes}`;

                const card = document.querySelector(`.wall-card[data-post-id="${this.currentPostId}"]`);
                const spans = card?.querySelectorAll('.wall-card-overlay span');
                if (spans?.[0]) spans[0].innerHTML = `<i class="fas fa-heart"></i> ${data.likes}`;
            }
        } catch (e) { console.error('[Wall] like error:', e); }

        if (likeBtn) likeBtn.disabled = false;
    }

    // ─────────────────────────────────────────────────────────────
    // COMMENTS — LOAD
    // ─────────────────────────────────────────────────────────────
    async _loadComments() {
        if (!this.currentPostId) return;
        const list   = document.getElementById('postModalComments');
        const loadEl = document.getElementById('postModalCommentsLoading');

        try {
            const token = await this._getToken();
            const res   = await fetch(`/player/api/artist/${this.artistId}/post/${this.currentPostId}/comments`, {
                headers: this._authHeaders(token),
            });
            const { comments = [] } = await res.json();

            if (loadEl) loadEl.style.display = 'none';
            if (!list) return;

            list.innerHTML = comments.length === 0
                ? '<p style="color:#444;font-size:0.82rem;text-align:center;padding:20px 0;">No comments yet. Be the first!</p>'
                : comments.map(c => this._buildComment(c)).join('');

        } catch (e) {
            console.error('[Wall] load comments error:', e);
            if (loadEl) loadEl.style.display = 'none';
        }
    }

    _buildComment(c) {
        const avatar = c.userAvatar
            ? `<img src="${this._escape(c.userAvatar)}" class="post-comment-avatar" alt="">`
            : `<div class="post-comment-avatar post-comment-avatar--placeholder"><i class="fas fa-user"></i></div>`;

        const deleteBtn = c.isOwn
            ? `<button class="comment-delete-btn" onclick="window.artistPosts.deleteComment('${this._escape(c.id)}')" title="Delete"><i class="fas fa-times"></i></button>`
            : '';

        // Comment like button — available to all logged-in users
        const likeIcon  = c.likedByMe ? 'fas fa-heart' : 'far fa-heart';
        const likeColor = c.likedByMe ? '#e74c3c' : '';
        const likeBtn   = `
            <button class="comment-like-btn" id="clb-${this._escape(c.id)}"
                onclick="window.artistPosts.toggleCommentLike(this, '${this._escape(c.id)}')"
                style="background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:4px;font-size:0.76rem;color:${likeColor || 'var(--text-secondary,#888)'};">
                <i class="${likeIcon}" style="font-size:0.78rem;"></i>
                <span id="clc-${this._escape(c.id)}">${c.likes || 0}</span>
            </button>`;

        // Artist reply bubble — shown if the artist has responded
        const replyBubble = c.artistReply ? `
            <div class="artist-reply-bubble" style="margin-top:8px; padding:8px 12px; background:var(--bg-hover,#1a1a1a); border-left:3px solid var(--primary,#88C9A1); border-radius:0 8px 8px 0;">
                <span style="font-size:0.7rem; font-weight:700; color:var(--primary,#88C9A1); display:block; margin-bottom:3px;">
                    <i class="fas fa-reply" style="margin-right:3px;"></i>${this._escape(c.artistReply.artistName || 'Artist')}
                </span>
                <span style="font-size:0.82rem; color:var(--text-main,#ddd); line-height:1.45; white-space:pre-wrap; word-break:break-word;">${this._escape(c.artistReply.text)}</span>
            </div>` : '';

        return `
        <div class="post-comment-item" data-comment-id="${this._escape(c.id)}">
            ${avatar}
            <div class="post-comment-content">
                <span class="post-comment-handle">${this._escape(c.userHandle || c.userName || 'User')}</span>
                <span class="post-comment-text">${this._escape(c.comment)}</span>
                <div style="display:flex; align-items:center; gap:10px; margin-top:4px;">
                    <span class="post-comment-time">${this._timeAgo(c.createdAt)}</span>
                    ${likeBtn}
                </div>
                ${replyBubble}
            </div>
            ${deleteBtn}
        </div>`;
    }

    // ─────────────────────────────────────────────────────────────
    // COMMENTS — SUBMIT
    // ─────────────────────────────────────────────────────────────
    _wireCommentInput() {
        const input  = document.getElementById('postModalCommentInput');
        const submit = document.getElementById('postModalSubmitBtn');
        if (!input || !submit) return;

        const newInput  = input.cloneNode(true);
        const newSubmit = submit.cloneNode(true);
        input.replaceWith(newInput);
        submit.replaceWith(newSubmit);

        newInput.addEventListener('input', () => {
            newSubmit.disabled = newInput.value.trim().length === 0;
            newInput.style.height = 'auto';
            newInput.style.height = newInput.scrollHeight + 'px';
        });
        newSubmit.addEventListener('click', () => this._submitComment(newInput, newSubmit));
        newInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !newSubmit.disabled) {
                e.preventDefault();
                this._submitComment(newInput, newSubmit);
            }
        });
    }

    async _submitComment(input, btn) {
        const text = input?.value?.trim();
        if (!text || !this.currentPostId) return;

        const token = await this._getToken();
        if (!token) return;

        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const res  = await fetch(`/player/api/artist/${this.artistId}/post/${this.currentPostId}/comment`, {
                method:  'POST',
                headers: { ...this._authHeaders(token), 'Content-Type': 'application/json' },
                body:    JSON.stringify({ comment: text }),
            });
            const data = await res.json();

            if (data.success) {
                input.value = '';
                input.style.height = 'auto';
                btn.disabled = true;

                const list = document.getElementById('postModalComments');
                if (list) {
                    list.querySelector('p')?.remove();
                    list.insertAdjacentHTML('afterbegin', this._buildComment({ ...data.comment, isOwn: true }));
                }

                const cc = document.getElementById('postModalCommentCount');
                if (cc) cc.textContent = ` ${parseInt(cc.textContent || 0) + 1}`;

                const card  = document.querySelector(`.wall-card[data-post-id="${this.currentPostId}"]`);
                const spans = card?.querySelectorAll('.wall-card-overlay span');
                if (spans?.[1]) {
                    const cur = parseInt(spans[1].textContent) || 0;
                    spans[1].innerHTML = `<i class="fas fa-comment"></i> ${cur + 1}`;
                }
            } else if (data.requiresFollow) {
                document.getElementById('postModalCommentForm').style.display = 'none';
                document.getElementById('postModalFollowGate').style.display  = 'flex';
            } else {
                throw new Error(data.error || 'Could not post comment');
            }
        } catch (e) {
            console.error('[Wall] comment error:', e);
            this._toast(e.message || 'Failed to post comment', true);
        }

        btn.innerHTML = originalHtml;
        if (input.value.trim().length > 0) btn.disabled = false;
    }

    // ─────────────────────────────────────────────────────────────
    // COMMENTS — DELETE
    // ─────────────────────────────────────────────────────────────
    async deleteComment(commentId) {
        if (!confirm('Delete this comment?')) return;
        const token = await this._getToken();
        if (!token) return;

        try {
            const res  = await fetch(`/player/api/artist/${this.artistId}/post/${this.currentPostId}/comment/${commentId}`, {
                method: 'DELETE', headers: this._authHeaders(token),
            });
            const data = await res.json();
            if (data.success) {
                document.querySelector(`.post-comment-item[data-comment-id="${commentId}"]`)?.remove();
                const cc = document.getElementById('postModalCommentCount');
                if (cc) cc.textContent = ` ${Math.max(0, parseInt(cc.textContent || 0) - 1)}`;
            }
        } catch (e) { console.error('[Wall] delete comment error:', e); }
    }

    // ─────────────────────────────────────────────────────────────
    // STYLES — injected once, no extra request
    // ─────────────────────────────────────────────────────────────
    _injectStyles() {
        if (document.getElementById('artist-posts-wall-styles')) return;
        const style = document.createElement('style');
        style.id = 'artist-posts-wall-styles';
        style.textContent = `
            .post-comment-item { display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-bottom:1px solid #1a1a1a; position:relative; }
            .post-comment-item:last-child { border-bottom:none; }
            .post-comment-content { flex:1; display:flex; flex-direction:column; gap:2px; }
            .post-comment-handle  { font-size:0.78rem; font-weight:700; color:#aaa; }
            .post-comment-text    { font-size:0.85rem; color:#ddd; line-height:1.4; white-space:pre-wrap; word-break:break-word; }
            .post-comment-time    { font-size:0.72rem; color:#444; margin-top:2px; }
            .post-comment-avatar--placeholder { width:32px; height:32px; border-radius:50%; background:#222; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
            .post-comment-avatar--placeholder i { color:#555; font-size:0.75rem; }
            .comment-delete-btn { background:none; border:none; color:#333; cursor:pointer; padding:2px 6px; font-size:0.75rem; transition:color 0.15s; align-self:center; }
            .comment-delete-btn:hover { color:#e74c3c; }
            .post-modal-comments { flex:1; overflow-y:auto; padding:0 16px; display:flex; flex-direction:column; }
            .post-modal-loading  { text-align:center; padding:20px; color:#555; }
            .post-follow-gate { display:flex; flex-direction:column; align-items:center; gap:10px; padding:16px; color:#555; font-size:0.85rem; text-align:center; border-top:1px solid #1a1a1a; }
            .post-follow-gate i { font-size:1.4rem; color:#333; }
            .post-modal-input-area { display:flex; align-items:flex-end; gap:10px; padding:12px 16px; border-top:1px solid #1a1a1a; }
            .post-comment-input-wrap { flex:1; display:flex; align-items:flex-end; gap:8px; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:20px; padding:8px 14px; }
            .post-comment-input { flex:1; background:none; border:none; color:#ddd; font-size:0.85rem; resize:none; outline:none; max-height:100px; overflow-y:auto; line-height:1.4; }
            .post-comment-submit { background:none; border:none; color:var(--primary,#88C9A1); cursor:pointer; font-size:0.9rem; padding:0; transition:opacity 0.2s; }
            .post-comment-submit:disabled { opacity:0.3; cursor:default; }
            .post-like-btn { background:none; border:none; color:#aaa; cursor:pointer; font-size:0.9rem; display:flex; align-items:center; gap:5px; padding:0; transition:color 0.2s; }
            .post-like-btn:hover { color:#e74c3c; }
        `;
        document.head.appendChild(style);
    }
}