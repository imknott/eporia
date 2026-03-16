/* public/javascripts/profileStudio.js
 *
 * Drives the Public Profile customization tab in the artist studio.
 * Wired in by artistStudio.js: if (viewId === 'profile') window.initProfileView?.()
 *
 * Backend:
 *   GET  /artist/api/studio/public-profile
 *   POST /artist/api/studio/public-profile
 */

import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { app }     from './firebase-config.js';

const auth = getAuth(app);

async function authHeaders(json = false) {
    const token = await auth.currentUser.getIdToken();
    const h = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

// ── State ─────────────────────────────────────────────────────────────────────
let _catalog        = [];
let _featuredIds    = [];
let _bandMembers    = [];
let _producers      = [];
let _initialized    = false;
let _stagedAvatar   = null;   // File object staged for upload
let _stagedBanner   = null;   // File object staged for upload

// ── Load ──────────────────────────────────────────────────────────────────────
async function load() {
    try {
        const headers = await authHeaders();
        const res = await fetch('/artist/api/studio/public-profile', { headers });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        _catalog     = data.catalog        || [];
        _featuredIds = data.featuredTrackIds || [];
        _bandMembers = data.credits?.bandMembers  || [];
        _producers   = data.credits?.producers    || [];

        // Social links
        const sl = data.socialLinks || {};
        ['instagram','tiktok','youtube','spotify','soundcloud','website','email'].forEach(key => {
            const el = document.getElementById(`social${key.charAt(0).toUpperCase()}${key.slice(1)}`);
            if (el) el.value = sl[key] || '';
        });

        // Acknowledgements
        const ackEl = document.getElementById('acknowledgementsInput');
        if (ackEl) {
            ackEl.value = data.credits?.acknowledgements || '';
            updateCharCount(ackEl);
        }

        // Bio — pre-filled from dashboard data via window._dashboardProfile
        const bioEl = document.getElementById('profileBio');
        if (bioEl && window._dashboardProfile?.bio) {
            bioEl.value = window._dashboardProfile.bio;
        }

        // Avatar / banner previews — pre-filled from dashboard data
        const avatarEl = document.getElementById('profileAvatarPreview');
        if (avatarEl && window._dashboardProfile?.image) avatarEl.src = window._dashboardProfile.image;
        const bannerEl = document.getElementById('profileBannerPreview');
        if (bannerEl && window._dashboardProfile?.banner) bannerEl.src = window._dashboardProfile.banner;

        // Wire image file inputs
        document.getElementById('profileAvatarInput')?.addEventListener('change', e => {
            previewAndStageImage(e.target, 'profileAvatarPreview', 'avatar');
        });
        document.getElementById('profileBannerInput')?.addEventListener('change', e => {
            previewAndStageImage(e.target, 'profileBannerPreview', 'banner');
        });

        // Bio char counter
        const bioCnt = document.getElementById('profileBioCount');
        if (bioEl && bioCnt) {
            bioEl.addEventListener('input', () => {
                bioCnt.textContent = `${bioEl.value.length} / 600`;
            });
        }

        // Wire public profile link using slug from dashboard if available
        const viewBtn = document.getElementById('viewPublicProfileBtn');
        if (viewBtn) {
            const slug = window._dashboardProfile?.slug;
            const artistId = document.getElementById('artistIdRef')?.value;
            viewBtn.href = slug ? `/artist/${slug}` : `/artist/${artistId}`;
        }

        renderFeaturedSlots();
        renderCatalogPicker('');
        renderBandMembers();
        renderProducers();

    } catch (err) {
        console.error('[profileStudio] load error:', err);
        if (window.showToast) window.showToast('Failed to load profile data', 'error');
    }
}

// ── Featured tracks ───────────────────────────────────────────────────────────

function getFeaturedTracks() {
    return _featuredIds.map(id => _catalog.find(t => t.id === id)).filter(Boolean);
}

function renderFeaturedSlots() {
    const wrap = document.getElementById('featuredTrackSlots');
    if (!wrap) return;

    const featured = getFeaturedTracks();

    if (featured.length === 0) {
        wrap.innerHTML = `<div class="featured-empty">
            <i class="fas fa-star"></i>
            <p>No featured tracks yet. Pick up to 6 from your catalog below.</p>
        </div>`;
    } else {
        wrap.innerHTML = featured.map((t, i) => `
            <div class="featured-slot" draggable="true" data-id="${t.id}">
                ${t.artUrl ? `<img src="${t.artUrl}" class="featured-slot-art">` : '<div class="featured-slot-art featured-slot-art-placeholder"><i class="fas fa-music"></i></div>'}
                <div class="featured-slot-info">
                    <span class="featured-slot-title">${esc(t.title)}</span>
                    ${t.album ? `<span class="featured-slot-album">${esc(t.album)}</span>` : ''}
                </div>
                <button class="featured-slot-remove" onclick="window.profileStudio?.removeFeatured('${t.id}')" title="Remove">
                    <i class="fas fa-times"></i>
                </button>
            </div>`).join('');
    }

    // Refresh catalog picker to reflect updated selection state
    renderCatalogPicker(_currentFilter || '');
}

let _currentFilter = '';

function renderCatalogPicker(filter = '') {
    _currentFilter = filter;
    const list = document.getElementById('catalogPickerList');
    if (!list) return;

    const filtered = _catalog.filter(t =>
        !filter || t.title.toLowerCase().includes(filter.toLowerCase())
    );

    if (filtered.length === 0) {
        list.innerHTML = `<div class="catalog-empty">No tracks found.</div>`;
        return;
    }

    list.innerHTML = filtered.map(t => {
        const isFeatured = _featuredIds.includes(t.id);
        const atLimit    = _featuredIds.length >= 6 && !isFeatured;
        return `<div class="catalog-picker-row ${isFeatured ? 'selected' : ''} ${atLimit ? 'disabled' : ''}"
                     onclick="window.profileStudio?.toggleFeatured('${t.id}')">
            ${t.artUrl ? `<img src="${t.artUrl}" class="catalog-picker-art">` : '<div class="catalog-picker-art catalog-art-placeholder"><i class="fas fa-music"></i></div>'}
            <div class="catalog-picker-info">
                <span class="catalog-picker-title">${esc(t.title)}</span>
                ${t.album ? `<span class="catalog-picker-album">${esc(t.album)}</span>` : ''}
            </div>
            <div class="catalog-picker-check">
                ${isFeatured ? '<i class="fas fa-check-circle" style="color:var(--primary)"></i>' : '<i class="far fa-circle" style="opacity:0.3"></i>'}
            </div>
        </div>`;
    }).join('');
}

function toggleFeatured(id) {
    if (_featuredIds.includes(id)) {
        _featuredIds = _featuredIds.filter(x => x !== id);
    } else {
        if (_featuredIds.length >= 6) {
            if (window.showToast) window.showToast('Maximum 6 featured tracks', 'warning');
            return;
        }
        _featuredIds.push(id);
    }
    renderFeaturedSlots();
}

function removeFeatured(id) {
    _featuredIds = _featuredIds.filter(x => x !== id);
    renderFeaturedSlots();
}

function filterCatalog(val) {
    renderCatalogPicker(val);
}

// ── Image staging + identity save ─────────────────────────────────────────────

function previewAndStageImage(input, previewId, type) {
    const file = input.files?.[0];
    if (!file) return;
    if (type === 'avatar') _stagedAvatar = file;
    if (type === 'banner') _stagedBanner = file;
    const reader = new FileReader();
    reader.onload = e => {
        const el = document.getElementById(previewId);
        if (el) el.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function saveIdentity() {
    const btn = document.getElementById('saveIdentityBtn');
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...'; }

    try {
        const token = await auth.currentUser.getIdToken();
        const updates = {};

        // Upload avatar if staged
        if (_stagedAvatar) {
            const form = new FormData();
            form.append('file', _stagedAvatar);
            form.append('type', 'avatar');
            const res = await fetch('/artist/api/upload-asset', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: form,
            });
            const data = await res.json();
            if (data.success) updates.profileImage = data.url;
            _stagedAvatar = null;
        }

        // Upload banner if staged
        if (_stagedBanner) {
            const form = new FormData();
            form.append('file', _stagedBanner);
            form.append('type', 'banner');
            const res = await fetch('/artist/api/upload-asset', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: form,
            });
            const data = await res.json();
            if (data.success) updates.bannerImage = data.url;
            _stagedBanner = null;
        }

        // Always save bio
        const bioVal = document.getElementById('profileBio')?.value || '';
        updates.bio = bioVal;

        const res = await fetch('/artist/api/settings/update-profile', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');

        // Refresh the sidebar avatar in the studio header
        if (updates.profileImage) {
            const studioAvatar = document.getElementById('studioAvatar');
            if (studioAvatar) studioAvatar.src = updates.profileImage;
        }
        // Keep window._dashboardProfile in sync
        if (window._dashboardProfile) {
            if (updates.profileImage) window._dashboardProfile.image  = updates.profileImage;
            if (updates.bannerImage)  window._dashboardProfile.banner = updates.bannerImage;
            window._dashboardProfile.bio = bioVal;
        }

        if (window.showToast) window.showToast('Profile saved!', 'success');
    } catch (err) {
        console.error('[profileStudio] saveIdentity error:', err);
        if (window.showToast) window.showToast(err.message || 'Save failed', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

// ── Band members ──────────────────────────────────────────────────────────────

function renderBandMembers() {
    const list = document.getElementById('bandMembersList');
    if (!list) return;

    if (_bandMembers.length === 0) {
        list.innerHTML = `<p class="profile-empty-hint">No band members added yet.</p>`;
        return;
    }

    list.innerHTML = _bandMembers.map((m, i) => `
        <div class="band-member-row">
            <input class="studio-input" value="${esc(m.name)}" placeholder="Name"
                   oninput="window.profileStudio?.updateBandMember(${i}, 'name', this.value)">
            <input class="studio-input" value="${esc(m.role)}" placeholder="Role (e.g. Guitar, Vocals)"
                   oninput="window.profileStudio?.updateBandMember(${i}, 'role', this.value)">
            <button class="btn-icon-danger" onclick="window.profileStudio?.removeBandMember(${i})" title="Remove">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>`).join('');
}

function addBandMember() {
    _bandMembers.push({ name: '', role: '' });
    renderBandMembers();
    // Focus the first empty input in the new row
    setTimeout(() => {
        const inputs = document.querySelectorAll('.band-member-row input');
        const last = inputs[inputs.length - 2];
        if (last) last.focus();
    }, 50);
}

function updateBandMember(index, field, value) {
    if (_bandMembers[index]) _bandMembers[index][field] = value;
}

function removeBandMember(index) {
    _bandMembers.splice(index, 1);
    renderBandMembers();
}

// ── Producers ─────────────────────────────────────────────────────────────────

function renderProducers() {
    const list = document.getElementById('producersList');
    if (!list) return;

    if (_producers.length === 0) {
        list.innerHTML = `<p class="profile-empty-hint">No producers added yet.</p>`;
        return;
    }

    list.innerHTML = `<div class="producers-tags-wrap">` +
        _producers.map((p, i) => `
            <div class="producer-tag">
                <span>${esc(p)}</span>
                <button onclick="window.profileStudio?.removeProducer(${i})" title="Remove">
                    <i class="fas fa-times"></i>
                </button>
            </div>`).join('') +
        `</div>`;
}

function addProducer() {
    const input = document.getElementById('newProducerInput');
    const val   = input?.value.trim();
    if (!val) return;
    _producers.push(val);
    input.value = '';
    renderProducers();
}

function removeProducer(index) {
    _producers.splice(index, 1);
    renderProducers();
}

// ── Char count hint ───────────────────────────────────────────────────────────

function updateCharCount(el) {
    const hint = el.closest('.profile-section')?.querySelector('.char-count-hint');
    if (hint) hint.textContent = `${el.value.length} / 500`;
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function save() {
    const btn       = document.getElementById('saveProfileBtn');
    const statusEl  = document.getElementById('profileSaveStatus');
    const origHtml  = btn.innerHTML;

    btn.disabled  = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';
    if (statusEl) statusEl.textContent = '';

    // Collect social links
    const socialLinks = {};
    ['instagram','tiktok','youtube','spotify','soundcloud','website','email'].forEach(key => {
        const el = document.getElementById(`social${key.charAt(0).toUpperCase()}${key.slice(1)}`);
        const val = el?.value.trim();
        if (val) socialLinks[key] = val;
    });

    const acknowledgements = document.getElementById('acknowledgementsInput')?.value.trim() || '';

    // Clean band members — drop empty rows
    const cleanMembers = _bandMembers.filter(m => m.name.trim());

    try {
        const headers = await authHeaders(true);
        const res = await fetch('/artist/api/studio/public-profile', {
            method: 'POST', headers,
            body: JSON.stringify({
                featuredTrackIds: _featuredIds,
                socialLinks,
                credits: {
                    bandMembers:     cleanMembers,
                    producers:       _producers.filter(Boolean),
                    acknowledgements,
                },
            }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');

        if (window.showToast) window.showToast('Profile saved!', 'success');
        if (statusEl) {
            statusEl.textContent = '✓ Saved';
            statusEl.style.color = 'var(--primary)';
            setTimeout(() => { statusEl.textContent = ''; }, 3000);
        }
    } catch (err) {
        console.error('[profileStudio] save error:', err);
        if (window.showToast) window.showToast(err.message || 'Save failed', 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = origHtml;
    }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function initProfileView() {
    if (!_initialized) {
        _initialized = true;
        await load();

        // Wire up acknowledments char count
        const ackEl = document.getElementById('acknowledgementsInput');
        if (ackEl) ackEl.addEventListener('input', () => updateCharCount(ackEl));
    }
}

// Expose everything needed by pug onclicks
window.profileStudio = {
    toggleFeatured,
    removeFeatured,
    filterCatalog,
    previewAndStageImage,
    saveIdentity,
    addBandMember,
    updateBandMember,
    removeBandMember,
    addProducer,
    removeProducer,
    save,
};

window.initProfileView = initProfileView;