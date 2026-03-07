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
            <div class="studio-post-card" data-post-id="${post.id}">
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
                        <span><i class="fas fa-comment"></i> ${post.commentCount || 0}</span>
                        <span class="studio-post-date">${date}</span>
                    </div>
                </div>
            </div>`;
        }).join('');

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