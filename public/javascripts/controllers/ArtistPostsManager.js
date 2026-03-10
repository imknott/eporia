// ─────────────────────────────────────────────────────────────────
// 1. BIO PREVIEW & CHARACTER COUNTER
// Called after settingsBio is populated in loadDashboardData()
// ─────────────────────────────────────────────────────────────────
function initBioPreview() {
    const textarea   = document.getElementById('settingsBio');
    const counter    = document.getElementById('bioCharCount');
    const previewBox = document.getElementById('bioPreviewBox');
    const previewTxt = document.getElementById('bioPreviewText');

    if (!textarea) return;

    const update = () => {
        const val = textarea.value;
        if (counter) counter.textContent = val.length;
        if (previewBox && previewTxt) {
            if (val.trim().length > 0) {
                previewTxt.textContent = val;
                previewBox.style.display = 'block';
            } else {
                previewBox.style.display = 'none';
            }
        }
    };

    textarea.addEventListener('input', update);
    update(); // Run once on load to show existing bio
}

// ─────────────────────────────────────────────────────────────────
// 2. CREATE POST MODAL
// ─────────────────────────────────────────────────────────────────
function openCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    if (modal) modal.classList.add('active');
}

function closeCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    if (modal) modal.classList.remove('active');
    // Reset form
    const preview = document.getElementById('postImagePreview');
    const dz      = document.getElementById('postDzContent');
    const caption = document.getElementById('postCaption');
    const input   = document.getElementById('postImageInput');
    if (preview) { preview.style.display = 'none'; preview.src = ''; }
    if (dz)      dz.style.display = 'flex';
    if (caption) caption.value = '';
    if (input)   input.value = '';
    if (document.getElementById('postCaptionCount')) document.getElementById('postCaptionCount').textContent = '0';
}

// Wire image preview + caption counter once DOM is ready
function initCreatePostForm() {
    const imageInput   = document.getElementById('postImageInput');
    const preview      = document.getElementById('postImagePreview');
    const dzContent    = document.getElementById('postDzContent');
    const captionInput = document.getElementById('postCaption');
    const captionCount = document.getElementById('postCaptionCount');

    if (imageInput) {
        imageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (preview)   { preview.src = ev.target.result; preview.style.display = 'block'; }
                if (dzContent) dzContent.style.display = 'none';
            };
            reader.readAsDataURL(file);
        });
    }

    if (captionInput && captionCount) {
        captionInput.addEventListener('input', () => {
            captionCount.textContent = captionInput.value.length;
        });
    }
}

async function submitNewPost() {
    const imageInput = document.getElementById('postImageInput');
    const caption    = document.getElementById('postCaption')?.value?.trim();
    const submitBtn  = document.getElementById('submitPostBtn');

    if (!imageInput?.files[0]) {
        return showToast('Please select an image for your post.', true);
    }
    if (!caption) {
        return showToast('Please add a caption.', true);
    }

    try {
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i> Uploading...'; }

        const token = await firebase.auth().currentUser.getIdToken();

        const formData = new FormData();
        formData.append('postImage', imageInput.files[0]);
        formData.append('caption',   caption);

        const res  = await fetch('/artist/api/studio/posts/create', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body:    formData,
        });
        const data = await res.json();

        if (data.success) {
            showToast('Post shared! 🎉');
            closeCreatePostModal();
            await loadStudioPosts(); // Refresh the posts grid
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (e) {
        console.error('Submit Post Error:', e);
        showToast(e.message || 'Failed to create post', true);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:8px;"></i> Share Post'; }
    }
}

// ─────────────────────────────────────────────────────────────────
// 3. STUDIO POSTS FEED
// ─────────────────────────────────────────────────────────────────
async function loadStudioPosts() {
    const grid  = document.getElementById('studioPostsGrid');
    const empty = document.getElementById('studioPostsEmpty');
    const count = document.getElementById('studiPostCount');

    if (!grid) return;
    grid.innerHTML = '<div style="text-align:center; padding:30px; color:#555; grid-column:1/-1;"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem;"></i></div>';

    try {
        const token = await firebase.auth().currentUser.getIdToken();
        const res   = await fetch('/artist/api/studio/posts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data  = await res.json();
        const posts = data.posts || [];

        if (count) count.textContent = `${posts.length} post${posts.length !== 1 ? 's' : ''}`;

        if (posts.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.style.display = 'flex';
            return;
        }

        if (empty) empty.style.display = 'none';

        grid.innerHTML = posts.map(post => {
            const date = new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const shortCaption = post.caption.length > 60 ? post.caption.slice(0, 60) + '…' : post.caption;
            return `
            <div class="studio-post-card" data-post-id="${post.id}"
                data-img="${post.imageUrl.replace(/"/g, '&quot;')}"
                data-caption="${shortCaption.replace(/"/g, '&quot;')}">
                <div class="studio-post-img-wrap">
                    <img src="${post.imageUrl}" alt="Post" loading="lazy">
                    <button class="studio-post-delete-btn" onclick="deleteStudioPost('${post.id}', this)" title="Delete post">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
                <div class="studio-post-body">
                    <p class="studio-post-caption">${shortCaption}</p>
                    <div class="studio-post-stats">
                        <span><i class="fas fa-heart"></i> ${post.likes || 0}</span>
                        <span class="post-comment-badge" title="View & reply to comments" style="cursor:pointer;">
                            <i class="fas fa-comment"></i> ${post.commentCount || 0}
                        </span>
                        <span class="studio-post-date">${date}</span>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Wire comment badge clicks after innerHTML is set
        _injectInboxStyles();
        grid.querySelectorAll('.studio-post-card').forEach(card => {
            const badge = card.querySelector('.post-comment-badge');
            if (badge) {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openCommentInbox(card.dataset.postId, card.dataset.img, card.dataset.caption);
                });
            }
        });

    } catch (e) {
        console.error('Load Studio Posts Error:', e);
        grid.innerHTML = '<p style="color:#888; text-align:center; padding:30px; grid-column:1/-1;">Could not load posts.</p>';
    }
}

async function deleteStudioPost(postId, btn) {
    if (!confirm('Delete this post? This cannot be undone.')) return;

    try {
        const token = await firebase.auth().currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/posts/${postId}`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            const card = btn.closest('.studio-post-card');
            if (card) card.remove();
            showToast('Post deleted');
            // Refresh empty state if no posts left
            const grid = document.getElementById('studioPostsGrid');
            if (grid && grid.children.length === 0) {
                const empty = document.getElementById('studioPostsEmpty');
                if (empty) empty.style.display = 'flex';
            }
        } else { throw new Error(data.error); }
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Failed to delete post', true);
    }
}

// ─────────────────────────────────────────────────────────────────
// 4. INIT — call once after DOM is ready (e.g. inside DOMContentLoaded
//    or the existing studio init block)
// ─────────────────────────────────────────────────────────────────
function initPostsSection() {
    initCreatePostForm();
    initBioPreview();
}

// ─────────────────────────────────────────────────────────────────
// EXPOSE globals so pug onclick attrs work
// ─────────────────────────────────────────────────────────────────
window.openCreatePostModal  = openCreatePostModal;
window.closeCreatePostModal = closeCreatePostModal;
window.submitNewPost        = submitNewPost;
window.deleteStudioPost     = deleteStudioPost;
window.loadStudioPosts      = loadStudioPosts;
window.initPostsSection     = initPostsSection;
// ─────────────────────────────────────────────────────────────────
// COMMENT INBOX — used in studio to read, like, and reply to fans
// ─────────────────────────────────────────────────────────────────

// Current post context for the open inbox
let _inboxPostId   = null;
let _inboxPostImg  = null;

function _injectInboxStyles() {
    if (document.getElementById('comment-inbox-styles')) return;
    const s = document.createElement('style');
    s.id = 'comment-inbox-styles';
    s.textContent = `
        #commentInboxModal {
            position: fixed !important;
            inset: 0 !important;
            background: rgba(0,0,0,0.88) !important;
            backdrop-filter: blur(8px) !important;
            z-index: 3000 !important;
            display: none;
            align-items: center !important;
            justify-content: center !important;
            padding: 20px !important;
        }
        #commentInboxModal .inbox-card,
        #commentInboxModal .modal-content {
            background: #111 !important;
            border: 1px solid #222 !important;
            border-radius: 16px !important;
            width: 660px !important;
            max-width: 95vw !important;
            max-height: 88vh !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
            box-shadow: 0 24px 64px rgba(0,0,0,0.6) !important;
            color: #ddd !important;
            animation: inboxPop 0.22s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes inboxPop {
            from { opacity:0; transform:scale(0.95); }
            to   { opacity:1; transform:scale(1); }
        }
        #commentInboxModal .modal-header,
        #commentInboxModal .inbox-header {
            background: #141414 !important;
            border-bottom: 1px solid #222 !important;
            padding: 18px 22px !important;
            display: flex !important;
            align-items: center !important;
            gap: 14px !important;
            flex-shrink: 0 !important;
        }
        #commentInboxModal .modal-header h3,
        #commentInboxModal p {
            color: #fff !important;
            margin: 0 !important;
        }
        #commentInboxModal span,
        #commentInboxModal .modal-footer {
            color: #888 !important;
        }
        #commentInboxModal button.close-modal,
        #commentInboxModal .inbox-close-btn {
            background: none !important;
            border: none !important;
            color: #666 !important;
            font-size: 1.1rem !important;
            cursor: pointer !important;
            padding: 6px !important;
            border-radius: 8px !important;
            transition: color 0.15s !important;
            flex-shrink: 0 !important;
            margin-left: auto !important;
        }
        #commentInboxModal button.close-modal:hover,
        #commentInboxModal .inbox-close-btn:hover { color: #fff !important; }
        #inboxPostCaption { color: #888 !important; font-size: 0.78rem !important; }
        #inboxCommentList { background: #111 !important; flex: 1 !important; overflow-y: auto !important; }
        #inboxCommentList::-webkit-scrollbar { width: 4px; }
        #inboxCommentList::-webkit-scrollbar-track { background: #111; }
        #inboxCommentList::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
    `;
    document.head.appendChild(s);
}

function _ensureCommentInboxModal() {
    _injectInboxStyles();
    if (document.getElementById('commentInboxModal')) return;
    // Fallback: build the modal entirely in JS if pug didn't render it
    const el = document.createElement('div');
    el.id = 'commentInboxModal';
    el.innerHTML = `
        <div class="inbox-card">
            <div class="inbox-header">
                <img id="inboxPostThumb" src="" alt=""
                    style="width:46px;height:46px;border-radius:10px;object-fit:cover;background:#222;flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                    <p style="margin:0;font-weight:800;font-size:0.95rem;color:#fff;">Comments</p>
                    <span id="inboxPostCaption"></span>
                </div>
                <button class="inbox-close-btn" onclick="closeCommentInbox()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div id="inboxCommentList" style="flex:1;overflow-y:auto;min-height:200px;"></div>
            <div style="padding:10px 22px;border-top:1px solid #1e1e1e;font-size:0.73rem;color:#555;text-align:center;flex-shrink:0;background:#111;">
                <i class="fas fa-globe" style="margin-right:5px;"></i>Replies and likes update live on your artist profile
            </div>
        </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closeCommentInbox(); });
}

function openCommentInbox(postId, imageUrl, caption) {
    _ensureCommentInboxModal();
    _inboxPostId  = postId;
    _inboxPostImg = imageUrl;

    const modal = document.getElementById('commentInboxModal');
    const thumb = document.getElementById('inboxPostThumb');
    const capEl = document.getElementById('inboxPostCaption');
    const list  = document.getElementById('inboxCommentList');

    if (!modal) return;

    if (thumb) thumb.src          = imageUrl || '';
    if (capEl) capEl.textContent  = caption  || '';
    if (list)  list.innerHTML     = '<div style="text-align:center;padding:48px 0;color:#666;"><i class="fas fa-spinner fa-spin" style="font-size:1.6rem;color:#555;"></i></div>';

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    _loadInboxComments(postId);
}

function closeCommentInbox() {
    const modal = document.getElementById('commentInboxModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    _inboxPostId = null;
}

async function _loadInboxComments(postId) {
    const list = document.getElementById('inboxCommentList');
    if (!list) return;

    try {
        const token = await firebase.auth().currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/post/${postId}/comments`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data  = await res.json();
        const comments = data.comments || [];

        if (comments.length === 0) {
            list.innerHTML = `
                <div style="text-align:center; padding:48px 22px; color:var(--text-secondary,#888);">
                    <i class="fas fa-comment-slash" style="font-size:2rem; margin-bottom:12px; display:block;"></i>
                    <p style="margin:0; font-size:0.88rem;">No comments yet.</p>
                </div>`;
            return;
        }

        list.innerHTML = comments.map(c => _buildInboxComment(c, postId)).join('');

    } catch (e) {
        console.error('Load Inbox Comments Error:', e);
        list.innerHTML = `<p style="text-align:center; padding:30px; color:#888;">Could not load comments.</p>`;
    }
}

function _inboxTimeAgo(date) {
    const diff = (Date.now() - new Date(date).getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function _escape(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _buildInboxComment(c, postId) {
    const avatar = c.userAvatar
        ? `<img src="${_escape(c.userAvatar)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;" alt="">`
        : `<div style="width:36px;height:36px;border-radius:50%;background:#222;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-user" style="color:#555;font-size:0.8rem;"></i></div>`;

    const handle = _escape(c.userHandle ? `@${c.userHandle}` : c.userName || 'Fan');

    const likeColor  = c.artistLiked ? '#e74c3c' : 'var(--text-secondary,#888)';
    const likeClass  = c.artistLiked ? 'fas fa-heart' : 'far fa-heart';

    // Artist reply bubble
    const replySection = c.artistReply
        ? `<div class="inbox-reply-bubble" id="reply-bubble-${_escape(c.id)}" style="margin-top:10px; padding:10px 14px; background:var(--bg-hover,#1e1e1e); border-left:3px solid var(--primary,#88C9A1); border-radius:0 8px 8px 0;">
               <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                   <div style="flex:1;">
                       <span style="font-size:0.72rem; font-weight:700; color:var(--primary,#88C9A1); display:block; margin-bottom:4px;">
                           <i class="fas fa-reply" style="margin-right:4px;"></i> Your reply
                       </span>
                       <p style="margin:0; font-size:0.84rem; color:var(--text-main,#ddd); line-height:1.5;" id="reply-text-${_escape(c.id)}">${_escape(c.artistReply.text)}</p>
                   </div>
                   <button onclick="deleteInboxReply('${_escape(postId)}', '${_escape(c.id)}')" title="Delete reply"
                       style="background:none;border:none;color:#555;cursor:pointer;padding:2px 6px;font-size:0.8rem;flex-shrink:0;">
                       <i class="fas fa-times"></i>
                   </button>
               </div>
           </div>`
        : `<div class="inbox-reply-form" id="reply-form-${_escape(c.id)}" style="margin-top:10px; display:none;">
               <div style="display:flex; gap:8px; align-items:flex-end;">
                   <textarea id="reply-input-${_escape(c.id)}" placeholder="Reply to this comment…"
                       style="flex:1; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:10px; padding:8px 12px; color:#ddd; font-size:0.83rem; resize:none; outline:none; min-height:36px; max-height:100px; line-height:1.4;"
                       rows="1" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
                   <button id="reply-btn-${_escape(c.id)}"
                       onclick="submitInboxReply('${_escape(postId)}', '${_escape(c.id)}')"
                       style="background:var(--primary,#88C9A1); border:none; border-radius:8px; color:#000; font-size:0.82rem; font-weight:700; padding:8px 14px; cursor:pointer; white-space:nowrap;">
                       Post
                   </button>
               </div>
           </div>`;

    const showReplyToggle = !c.artistReply
        ? `<button onclick="toggleInboxReplyForm('${_escape(c.id)}')"
               style="background:none;border:none;color:var(--primary,#88C9A1);font-size:0.76rem;font-weight:700;cursor:pointer;padding:0;margin-top:6px;">
               <i class="fas fa-reply" style="margin-right:4px;"></i>Reply
           </button>`
        : '';

    return `
    <div class="inbox-comment-item" data-comment-id="${_escape(c.id)}" style="padding:14px 22px; border-bottom:1px solid var(--border-color,#1a1a1a);">
        <div style="display:flex; gap:10px; align-items:flex-start;">
            ${avatar}
            <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px;">
                    <span style="font-size:0.78rem; font-weight:700; color:var(--text-secondary,#aaa);">${handle}</span>
                    <span style="font-size:0.72rem; color:#555; flex-shrink:0;">${_inboxTimeAgo(c.createdAt)}</span>
                </div>
                <p style="margin:0; font-size:0.88rem; color:var(--text-main,#ddd); line-height:1.5; word-break:break-word;">${_escape(c.comment)}</p>
                <div style="display:flex; align-items:center; gap:12px; margin-top:8px;">
                    <button id="like-btn-${_escape(c.id)}"
                        onclick="likeInboxComment('${_escape(postId)}', '${_escape(c.id)}')"
                        style="background:none; border:none; cursor:pointer; padding:0; display:flex; align-items:center; gap:5px; color:${likeColor}; font-size:0.82rem;">
                        <i class="${likeClass}"></i>
                        <span id="like-count-${_escape(c.id)}">${c.likes || 0}</span>
                    </button>
                    ${showReplyToggle}
                </div>
                ${replySection}
            </div>
        </div>
    </div>`;
}

async function likeInboxComment(postId, commentId) {
    const btn       = document.getElementById(`like-btn-${commentId}`);
    const countEl   = document.getElementById(`like-count-${commentId}`);
    const icon      = btn?.querySelector('i');
    if (btn) btn.disabled = true;

    try {
        const token = await firebase.auth().currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/post/${postId}/comment/${commentId}/like`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && icon && countEl) {
            icon.className   = data.liked ? 'fas fa-heart' : 'far fa-heart';
            btn.style.color  = data.liked ? '#e74c3c' : 'var(--text-secondary,#888)';
            countEl.textContent = data.likes;
        }
    } catch (e) {
        console.error('Like Inbox Comment Error:', e);
        showToast('Could not like comment', true);
    }
    if (btn) btn.disabled = false;
}

function toggleInboxReplyForm(commentId) {
    const form = document.getElementById(`reply-form-${commentId}`);
    if (!form) return;
    const isOpen = form.style.display !== 'none';
    form.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        const input = document.getElementById(`reply-input-${commentId}`);
        if (input) input.focus();
    }
}

async function submitInboxReply(postId, commentId) {
    const input = document.getElementById(`reply-input-${commentId}`);
    const btn   = document.getElementById(`reply-btn-${commentId}`);
    const text  = input?.value?.trim();

    if (!text) return;

    const origLabel = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    try {
        const token = await firebase.auth().currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/post/${postId}/comment/${commentId}/reply`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text }),
        });
        const data = await res.json();

        if (data.success) {
            // Replace the reply form with the reply bubble in-place
            const form   = document.getElementById(`reply-form-${commentId}`);
            const bubble = document.createElement('div');
            bubble.id    = `reply-bubble-${commentId}`;
            bubble.className = 'inbox-reply-bubble';
            bubble.style.cssText = 'margin-top:10px; padding:10px 14px; background:var(--bg-hover,#1e1e1e); border-left:3px solid var(--primary,#88C9A1); border-radius:0 8px 8px 0;';
            bubble.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                    <div style="flex:1;">
                        <span style="font-size:0.72rem; font-weight:700; color:var(--primary,#88C9A1); display:block; margin-bottom:4px;">
                            <i class="fas fa-reply" style="margin-right:4px;"></i> Your reply
                        </span>
                        <p style="margin:0; font-size:0.84rem; color:var(--text-main,#ddd); line-height:1.5;">${_escape(data.reply.text)}</p>
                    </div>
                    <button onclick="deleteInboxReply('${postId}', '${commentId}')" title="Delete reply"
                        style="background:none;border:none;color:#555;cursor:pointer;padding:2px 6px;font-size:0.8rem;flex-shrink:0;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`;

            // Also hide the "Reply" toggle button
            const replyToggle = form?.previousElementSibling;
            if (replyToggle && replyToggle.querySelector('i.fa-reply')) replyToggle.style.display = 'none';

            if (form) form.replaceWith(bubble);
            showToast('Reply posted! ✅');
        } else {
            throw new Error(data.error || 'Reply failed');
        }
    } catch (e) {
        console.error('Submit Inbox Reply Error:', e);
        showToast(e.message || 'Failed to post reply', true);
        if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
    }
}

async function deleteInboxReply(postId, commentId) {
    if (!confirm('Delete your reply?')) return;
    try {
        const token = await firebase.auth().currentUser.getIdToken();
        const res   = await fetch(`/artist/api/studio/post/${postId}/comment/${commentId}/reply`, {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            const bubble = document.getElementById(`reply-bubble-${commentId}`);
            if (bubble) {
                // Swap bubble back to an empty reply form
                const form = document.createElement('div');
                form.id        = `reply-form-${commentId}`;
                form.className = 'inbox-reply-form';
                form.style.display = 'none';
                form.style.marginTop = '10px';
                form.innerHTML = `
                    <div style="display:flex; gap:8px; align-items:flex-end;">
                        <textarea id="reply-input-${commentId}" placeholder="Reply to this comment…"
                            style="flex:1; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:10px; padding:8px 12px; color:#ddd; font-size:0.83rem; resize:none; outline:none; min-height:36px; max-height:100px;"
                            rows="1" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
                        <button id="reply-btn-${commentId}" onclick="submitInboxReply('${postId}', '${commentId}')"
                            style="background:var(--primary,#88C9A1); border:none; border-radius:8px; color:#000; font-size:0.82rem; font-weight:700; padding:8px 14px; cursor:pointer;">
                            Post
                        </button>
                    </div>`;
                bubble.replaceWith(form);

                // Re-show the "Reply" toggle
                const item   = document.querySelector(`.inbox-comment-item[data-comment-id="${commentId}"]`);
                const toggle = item?.querySelector('button[onclick*="toggleInboxReplyForm"]');
                if (toggle) toggle.style.display = '';
            }
            showToast('Reply deleted');
        }
    } catch (e) {
        console.error('Delete Reply Error:', e);
        showToast('Could not delete reply', true);
    }
}

// ─────────────────────────────────────────────────────────────────
// PATCH loadStudioPosts to wire comment badge → open inbox
// Called after the base loadStudioPosts is defined above.
// ─────────────────────────────────────────────────────────────────
const _originalLoadStudioPosts = window.loadStudioPosts;
window.loadStudioPosts = async function() {
    await _originalLoadStudioPosts();
    // Re-wire comment count spans in all studio post cards to open the inbox
    document.querySelectorAll('.studio-post-card').forEach(card => {
        const postId    = card.dataset.postId;
        const imgEl     = card.querySelector('img');
        const captionEl = card.querySelector('.studio-post-caption');
        const commentSpan = card.querySelector('.studio-post-stats span:nth-child(2)');
        if (commentSpan && postId) {
            commentSpan.style.cursor = 'pointer';
            commentSpan.title = 'View & reply to comments';
            commentSpan.onclick = (e) => {
                e.stopPropagation();
                openCommentInbox(postId, imgEl?.src || '', captionEl?.textContent || '');
            };
        }
    });
};

// Close inbox when clicking outside the card
document.addEventListener('click', (e) => {
    const modal = document.getElementById('commentInboxModal');
    if (modal && e.target === modal) closeCommentInbox();
});

// Expose new globals
window.openCommentInbox    = openCommentInbox;
window.closeCommentInbox   = closeCommentInbox;
window.likeInboxComment    = likeInboxComment;
window.toggleInboxReplyForm = toggleInboxReplyForm;
window.submitInboxReply    = submitInboxReply;
window.deleteInboxReply    = deleteInboxReply;