/**
 * public/javascripts/merchStudio.js
 *
 * Handles all merch CRUD in the artist studio including the
 * new sample track feature — artists can either:
 *   A) Link an existing song from their catalog (searchable picker)
 *   B) Upload a standalone audio clip via /artist/api/upload-merch-sample
 *
 * The linked/uploaded track is saved as merch.sampleTrack and rendered
 * as a Bandcamp-style mini player on the store item page.
 */

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';

const auth = getAuth(app);

// ─── State ────────────────────────────────────────────────────
let _artistId   = null;
let _authToken  = null;
let _editingId  = null;
let _photoFiles = [null, null, null, null];
let _photoUrls  = [null, null, null, null];

// Sample track state
let _sampleTrack     = null;    // { songId?, streamUrl, title, artUrl, duration? }
let _sampleMode      = 'link';  // 'link' | 'upload'
let _sampleAudio     = null;    // HTMLAudioElement for the studio preview
let _sampleSearchTimer = null;

// ─── Init ─────────────────────────────────────────────────────
// artistIdRef is filled asynchronously by artistStudio.js after a
// check-status API call. We must wait for it before reading it,
// otherwise _artistId is always "" and nothing works.
onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    _authToken = await user.getIdToken();

    _artistId = await waitForArtistId(6000);
    if (!_artistId) {
        console.error('[merch] artistId never resolved after 6 s — check studio init');
        showMerchToast('Studio not fully loaded. Please refresh.', 'error');
        return;
    }

    console.log('[merch] artistId ready:', _artistId);
    loadMerchItems();
    bindCategoryRadios();
    bindFulfillmentRadios();
    bindSampleAudioDrop();
    // bindFormSubmit kept for keyboard-enter submit compat
    bindFormSubmit();
});

/**
 * Poll #artistIdRef.value until it is a non-empty string.
 * artistStudio.js sets it after its check-status API call, which
 * can take 300–1500 ms after auth resolves.
 */
async function waitForArtistId(maxMs = 6000) {
    const step = 80;
    let elapsed = 0;
    while (elapsed < maxMs) {
        const val = (document.getElementById('artistIdRef')?.value || '').trim();
        if (val) return val;
        await new Promise(r => setTimeout(r, step));
        elapsed += step;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────
// LOAD & RENDER
// ─────────────────────────────────────────────────────────────
async function loadMerchItems() {
    try {
        const res  = await apiFetch(`/artist/api/merch?artistId=${_artistId}`);
        const data = await res.json();
        renderGrid(data.items || []);
    } catch (e) {
        console.error('[merch] load failed:', e);
        showMerchToast('Could not load merch items.', 'error');
    }
}

function renderGrid(items) {
    const grid  = document.getElementById('merchGrid');
    const empty = document.getElementById('merchEmptyState');

    grid.querySelectorAll('.merch-item-card').forEach(el => el.remove());

    if (items.length === 0) {
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'merch-item-card';
        card.dataset.id = item.id;

        const thumb       = item.photos?.[0] || '/images/merch-placeholder.jpg';
        const statusClass = item.status === 'active'   ? 'status-active'
                          : item.status === 'sold_out' ? 'status-sold'
                          : 'status-draft';
        const hasSample   = !!(item.sampleTrack?.streamUrl);

        card.innerHTML = `
            <div class="merch-card-img" style="background-image:url('${thumb}')">
                <span class="merch-status-badge ${statusClass}">${item.status === 'sold_out' ? 'Sold Out' : item.status}</span>
                ${hasSample ? '<span class="merch-sample-badge"><i class="fas fa-headphones"></i></span>' : ''}
            </div>
            <div class="merch-card-body">
                <p class="merch-card-category">${categoryLabel(item.category)}</p>
                <h4 class="merch-card-name">${esc(item.name)}</h4>
                <p class="merch-card-price">$${Number(item.price).toFixed(2)}</p>
            </div>
            <div class="merch-card-actions">
                <button class="btn-icon-sm" title="Edit" onclick="editMerchItem('${item.id}')">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-icon-sm btn-danger-sm" title="Delete" onclick="deleteMerchItem('${item.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>`;
        grid.appendChild(card);
    });
}

// ─────────────────────────────────────────────────────────────
// MODAL OPEN / CLOSE
// ─────────────────────────────────────────────────────────────
window.openMerchModal = function() {
    _editingId  = null;
    _photoFiles = [null, null, null, null];
    _photoUrls  = [null, null, null, null];
    _sampleTrack = null;

    document.getElementById('merchModalTitle').innerText   = 'Add Merch Item';
    document.getElementById('saveMerchBtnText').innerText  = ' Save Item';
    document.getElementById('merchForm').reset();
    clearPhotoSlots();
    showSubSections(null);
    clearSampleTrack();
    switchSampleMode('link');
    document.getElementById('sampleSearchInput').value = '';
    document.getElementById('sampleSearchResults').innerHTML = '';

    document.getElementById('merchModal').classList.add('active');
};

window.closeMerchModal = function() {
    stopSamplePreview();
    document.getElementById('merchModal').classList.remove('active');
};

window.editMerchItem = async function(itemId) {
    try {
        const res  = await apiFetch(`/artist/api/merch/${itemId}?artistId=${_artistId}`);
        const item = await res.json();

        _editingId  = itemId;
        _photoFiles = [null, null, null, null];
        _photoUrls  = item.photos || [null, null, null, null];
        _sampleTrack = item.sampleTrack || null;

        document.getElementById('merchModalTitle').innerText   = 'Edit Item';
        document.getElementById('saveMerchBtnText').innerText  = ' Update Item';
        document.getElementById('merchItemId').value = itemId;

        // Populate base fields
        const f = document.getElementById('merchForm');
        const catRadio = f.querySelector(`input[name="merchCategory"][value="${item.category}"]`);
        if (catRadio) catRadio.checked = true;
        document.getElementById('merchName').value    = item.name        || '';
        document.getElementById('merchDesc').value    = item.description || '';
        document.getElementById('merchPrice').value   = item.price       || '';
        document.getElementById('merchStock').value   = item.stock       || '';
        document.getElementById('merchStatus').value  = item.status      || 'active';

        showSubSections(item.category);

        if (item.category === 'clothing') {
            document.getElementById('clothingType').value = item.clothingType || 'tshirt';
            (item.sizes || []).forEach(s => {
                const cb = f.querySelector(`input[name="sizes"][value="${s}"]`);
                if (cb) cb.checked = true;
            });
        }
        if (item.category === 'vinyl')   document.getElementById('vinylFormat').value   = item.vinylFormat   || 'vinyl_12';
        if (item.category === 'digital') document.getElementById('digitalFormat').value = item.digitalFormat || 'mp3';

        // Shipping rates
        if (item.category !== 'digital' && item.shippingRates) {
            const r = item.shippingRates;
            document.getElementById('rateUsDomFirst').value  = r.usDomestic?.first      ?? '';
            document.getElementById('rateUsDomAdd').value    = r.usDomestic?.additional  ?? '';
            document.getElementById('rateCanadaFirst').value = r.canada?.first           ?? '';
            document.getElementById('rateCanadaAdd').value   = r.canada?.additional      ?? '';
            document.getElementById('rateEuropeFirst').value = r.europe?.first           ?? '';
            document.getElementById('rateEuropeAdd').value   = r.europe?.additional      ?? '';
            document.getElementById('rateWorldFirst').value  = r.restOfWorld?.first      ?? '';
            document.getElementById('rateWorldAdd').value    = r.restOfWorld?.additional ?? '';
            if (r.freeShippingEnabled) {
                document.getElementById('freeShippingEnabled').checked = true;
                document.querySelector('.free-shipping-threshold').style.display = 'flex';
                document.getElementById('freeShippingHint').style.display = 'inline';
                document.getElementById('freeShippingThreshold').value = r.freeShippingThreshold || '';
            }
        }

        if (item.shipFromAddress) document.getElementById('shipFromAddress').value = item.shipFromAddress;

        // Photos
        _photoUrls.forEach((url, i) => { if (url) previewPhotoUrl(url, i); });

        // Restore sample track
        clearSampleTrack();
        switchSampleMode('link');
        if (_sampleTrack) {
            document.getElementById('sampleSearchInput').value = '';
            document.getElementById('sampleSearchResults').innerHTML = '';
            showSamplePreview(_sampleTrack);
        }

        document.getElementById('merchModal').classList.add('active');
    } catch (e) {
        console.error('[merch] edit load failed:', e);
    }
};

window.deleteMerchItem = async function(itemId) {
    if (!confirm('Delete this item? This cannot be undone.')) return;
    try {
        const res = await apiFetch(`/artist/api/merch/${itemId}?artistId=${_artistId}`, 'DELETE');
        if (!res.ok) throw new Error(await res.text());
        showMerchToast('Item deleted.', 'success');
        loadMerchItems();
    } catch (e) {
        showMerchToast('Delete failed: ' + e.message, 'error');
    }
};

// ─────────────────────────────────────────────────────────────
// FORM SUBMIT
// saveMerchItem() is the single entry point — called by:
//   • the save button's onclick (type=button in pug)
//   • the form's submit event (keyboard enter / accessibility)
// ─────────────────────────────────────────────────────────────
window.saveMerchItem = async function() {
    if (!_artistId) {
        showMerchToast('Studio not ready — please wait a moment and try again.', 'error');
        return;
    }

    const btn = document.getElementById('saveMerchBtn');
    const btnText = document.getElementById('saveMerchBtnText');
    btn.disabled = true;
    if (btnText) btnText.innerText = ' Saving...';

    try {
        // 1. Upload any pending photos first
        const uploadedUrls = await uploadPendingPhotos();
        const finalPhotos  = _photoUrls
            .map((existing, i) => uploadedUrls[i] || existing || null)
            .filter(Boolean);

        // 2. Collect form data
        const form      = document.getElementById('merchForm');
        const category  = form.querySelector('input[name="merchCategory"]:checked')?.value;
        const sizes     = [...form.querySelectorAll('input[name="sizes"]:checked')].map(cb => cb.value);
        const isDigital = category === 'digital';

        if (!category) {
            showMerchToast('Please select a category.', 'error');
            return;
        }

        // Shipping rates
        const shippingRates = isDigital ? null : {
            usDomestic:  { first: parseFloat(document.getElementById('rateUsDomFirst').value)  || 0, additional: parseFloat(document.getElementById('rateUsDomAdd').value)   || 0 },
            canada:      { first: parseFloat(document.getElementById('rateCanadaFirst').value) || 0, additional: parseFloat(document.getElementById('rateCanadaAdd').value)  || 0 },
            europe:      { first: parseFloat(document.getElementById('rateEuropeFirst').value) || 0, additional: parseFloat(document.getElementById('rateEuropeAdd').value)  || 0 },
            restOfWorld: { first: parseFloat(document.getElementById('rateWorldFirst').value)  || 0, additional: parseFloat(document.getElementById('rateWorldAdd').value)   || 0 },
            freeShippingEnabled:   document.getElementById('freeShippingEnabled').checked,
            freeShippingThreshold: document.getElementById('freeShippingEnabled').checked
                ? (parseFloat(document.getElementById('freeShippingThreshold').value) || null)
                : null
        };

        const payload = {
            artistId:    _artistId,
            category,
            name:        document.getElementById('merchName').value.trim(),
            description: document.getElementById('merchDesc').value.trim(),
            price:       parseFloat(document.getElementById('merchPrice').value),
            stock:       document.getElementById('merchStock').value
                ? parseInt(document.getElementById('merchStock').value) : null,
            status:      document.getElementById('merchStatus').value,
            photos:      finalPhotos,
            shippingRates,
            shipFromAddress: isDigital
                ? null : (document.getElementById('shipFromAddress').value.trim() || null),
            clothingType:  category === 'clothing' ? document.getElementById('clothingType').value : null,
            sizes:         category === 'clothing' ? sizes : [],
            vinylFormat:   category === 'vinyl'    ? document.getElementById('vinylFormat').value : null,
            digitalFormat: category === 'digital'  ? document.getElementById('digitalFormat').value : null,
            sampleTrack:   _sampleTrack || null,
        };

        // 3. POST (create) or PUT (update)
        const method = _editingId ? 'PUT' : 'POST';
        const url    = _editingId
            ? `/artist/api/merch/${_editingId}`
            : '/artist/api/merch';

        const res  = await apiFetch(url, method, payload);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || JSON.stringify(data));

        const isNew = !_editingId;
        closeMerchModal();
        await loadMerchItems();

        showMerchToast(
            isNew
                ? `"${payload.name}" added to your store!`
                : `"${payload.name}" updated.`,
            'success'
        );

    } catch (err) {
        console.error('[merch] save error:', err);
        showMerchToast('Save failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        if (btnText) btnText.innerText = _editingId ? ' Update Item' : ' Save Item';
    }
};

function bindFormSubmit() {
    const form = document.getElementById('merchForm');
    if (!form) return;
    // Prevent any native submit — the button is type=button but
    // keyboard Enter on an input can still fire submit.
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        window.saveMerchItem();
    });
}

// ─────────────────────────────────────────────────────────────
// PHOTO HANDLING
// ─────────────────────────────────────────────────────────────
window.handleMerchPhoto = function(input, slot) {
    const file = input.files[0];
    if (!file) return;
    _photoFiles[slot] = file;
    const reader = new FileReader();
    reader.onload = (e) => previewPhotoUrl(e.target.result, slot);
    reader.readAsDataURL(file);
};

function previewPhotoUrl(url, slot) {
    const slotEl = document.getElementById(`photoSlot${slot}`);
    if (!slotEl) return;
    slotEl.style.backgroundImage    = `url('${url}')`;
    slotEl.style.backgroundSize     = 'cover';
    slotEl.style.backgroundPosition = 'center';
    slotEl.querySelector('.photo-slot-placeholder')?.style.setProperty('display', 'none');
}

function clearPhotoSlots() {
    for (let i = 0; i < 4; i++) {
        const slot = document.getElementById(`photoSlot${i}`);
        if (!slot) continue;
        slot.style.backgroundImage = '';
        const ph = slot.querySelector('.photo-slot-placeholder');
        if (ph) ph.style.display = 'flex';
        const inp = document.getElementById(`photoInput${i}`);
        if (inp) inp.value = '';
    }
}

async function uploadPendingPhotos() {
    const urls = [null, null, null, null];
    for (let i = 0; i < 4; i++) {
        const file = _photoFiles[i];
        if (!file) continue;
        const fd = new FormData();
        fd.append('photo',    file);
        fd.append('artistId', _artistId);
        fd.append('slot',     i);
        const res = await fetch('/artist/api/merch/upload-photo', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${_authToken}` },
            body:    fd
        });
        if (!res.ok) continue;
        const data = await res.json();
        urls[i] = data.url;
    }
    return urls;
}

// ─────────────────────────────────────────────────────────────
// CATEGORY / FULFILLMENT CONDITIONAL UI
// ─────────────────────────────────────────────────────────────
function bindCategoryRadios() {
    document.querySelectorAll('input[name="merchCategory"]').forEach(radio => {
        radio.addEventListener('change', () => showSubSections(radio.value));
    });
}

function showSubSections(category) {
    const isDigital = category === 'digital';

    document.getElementById('clothingOptions').style.display   = category === 'clothing' ? 'block' : 'none';
    document.getElementById('vinylOptions').style.display      = category === 'vinyl'    ? 'block' : 'none';
    document.getElementById('digitalOptions').style.display    = isDigital               ? 'block' : 'none';
    document.getElementById('shippingRatesSection').style.display = isDigital ? 'none' : 'block';
    document.getElementById('digitalDeliveryNote').style.display  = isDigital ? 'flex'  : 'none';
}

function bindFulfillmentRadios() {
    const freeShippingCb = document.getElementById('freeShippingEnabled');
    if (!freeShippingCb) return;
    freeShippingCb.addEventListener('change', () => {
        const show = freeShippingCb.checked;
        document.querySelector('.free-shipping-threshold').style.display = show ? 'flex'   : 'none';
        document.getElementById('freeShippingHint').style.display        = show ? 'inline' : 'none';
    });
}

// ─────────────────────────────────────────────────────────────
// SAMPLE TRACK: MODE SWITCH
// ─────────────────────────────────────────────────────────────
window.switchSampleMode = function(mode) {
    _sampleMode = mode;

    document.querySelectorAll('.sample-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.sample-tab[data-mode="${mode}"]`)?.classList.add('active');

    document.getElementById('sampleLinkMode').style.display   = mode === 'link'   ? 'block' : 'none';
    document.getElementById('sampleUploadMode').style.display = mode === 'upload' ? 'block' : 'none';
};

// ─────────────────────────────────────────────────────────────
// SAMPLE TRACK: CATALOG SEARCH
// ─────────────────────────────────────────────────────────────
window.debounceSongSearch = function(q) {
    clearTimeout(_sampleSearchTimer);
    const results = document.getElementById('sampleSearchResults');

    if (!q.trim()) {
        results.innerHTML = '';
        return;
    }

    results.innerHTML = '<div class="sample-searching"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';

    _sampleSearchTimer = setTimeout(async () => {
        try {
            const res  = await apiFetch(`/artist/api/merch/my-songs?artistId=${_artistId}&q=${encodeURIComponent(q)}`);
            const data = await res.json();
            renderSongResults(data.songs || []);
        } catch (e) {
            results.innerHTML = '<div class="sample-no-results">Search failed — please try again.</div>';
        }
    }, 350);
};

function renderSongResults(songs) {
    const results = document.getElementById('sampleSearchResults');

    if (songs.length === 0) {
        results.innerHTML = '<div class="sample-no-results">No songs found. Try a different search or upload a new sample.</div>';
        return;
    }

    results.innerHTML = '';
    songs.forEach(song => {
        const row = document.createElement('div');
        row.className = 'sample-song-row';

        const art      = song.artUrl || '/images/default-art.jpg';
        const duration = song.duration ? formatDuration(song.duration) : '';

        row.innerHTML = `
            <img class="sample-song-art" src="${art}" alt="">
            <div class="sample-song-info">
                <span class="sample-song-title">${esc(song.title)}</span>
                ${song.album ? `<span class="sample-song-album">${esc(song.album)}</span>` : ''}
            </div>
            ${duration ? `<span class="sample-song-duration">${duration}</span>` : ''}
            <button type="button" class="sample-song-select" onclick='selectCatalogSong(${JSON.stringify(song)})'>
                <i class="fas fa-link"></i> Link
            </button>`;

        results.appendChild(row);
    });
}

window.selectCatalogSong = function(song) {
    _sampleTrack = {
        songId:    song.id,
        streamUrl: song.streamUrl,
        title:     song.title,
        artUrl:    song.artUrl,
        duration:  song.duration
    };
    showSamplePreview(_sampleTrack);
    // Clear the search UI
    document.getElementById('sampleSearchInput').value     = '';
    document.getElementById('sampleSearchResults').innerHTML = '';
};

// ─────────────────────────────────────────────────────────────
// SAMPLE TRACK: UPLOAD NEW AUDIO FILE
// ─────────────────────────────────────────────────────────────
function bindSampleAudioDrop() {
    const dropzone = document.getElementById('sampleAudioDrop');
    const input    = document.getElementById('sampleAudioInput');
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', () => input.click());

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragging');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragging');
        const file = e.dataTransfer.files[0];
        if (file) handleSampleFileSelected(file);
    });

    input.addEventListener('change', () => {
        if (input.files[0]) handleSampleFileSelected(input.files[0]);
    });
}

async function handleSampleFileSelected(file) {
    if (!file.type.startsWith('audio/')) {
        showMerchToast('Please select an audio file (mp3, wav, flac, aac).', 'error');
        return;
    }

    const dropContent = document.getElementById('sampleAudioDrop').querySelector('.sample-drop-content');
    const progress    = document.getElementById('sampleUploadProgress');
    const fill        = document.getElementById('sampleUploadFill');
    const statusText  = document.getElementById('sampleUploadStatus');
    const titleInput  = document.getElementById('sampleTrackTitleInput');
    const title       = titleInput?.value.trim() || file.name.replace(/\.[^/.]+$/, '');

    // Measure duration client-side via Web Audio API before we upload,
    // so the server doesn't need ffprobe and the value is always accurate.
    let duration = null;
    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
        const decoded     = await audioCtx.decodeAudioData(arrayBuffer);
        duration          = Math.round(decoded.duration);
        audioCtx.close();
    } catch {
        // Non-fatal — upload still proceeds, duration will be null
    }

    // Show progress bar
    if (dropContent) dropContent.style.display = 'none';
    if (progress)    progress.style.display     = 'flex';
    if (fill)        fill.style.width           = '10%';
    if (statusText)  statusText.textContent      = 'Uploading...';

    // Animate progress bar (fetch doesn't expose real upload progress)
    let pct = 10;
    const ticker = setInterval(() => {
        pct = Math.min(pct + 7, 88);
        if (fill) fill.style.width = pct + '%';
    }, 350);

    try {
        const fd = new FormData();
        fd.append('audioFile', file);
        fd.append('artistId',  _artistId);
        fd.append('title',     title);
        if (duration !== null) fd.append('duration', duration);

        const res = await fetch('/artist/api/upload-merch-sample', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${_authToken}` },
            body:    fd
        });

        clearInterval(ticker);

        // Always parse errors as text first — server may return HTML on 404/500
        if (!res.ok) {
            let errMsg = `Upload failed (${res.status})`;
            try {
                const errData = await res.json();
                errMsg = errData.error || errMsg;
            } catch {
                errMsg = (await res.text().catch(() => errMsg)).slice(0, 120);
            }
            throw new Error(errMsg);
        }

        const data = await res.json();

        if (fill)       fill.style.width       = '100%';
        if (statusText) statusText.textContent  = 'Done!';

        _sampleTrack = {
            songId:    null,
            streamUrl: data.streamUrl,
            title:     data.title || title,
            artUrl:    null,
            duration:  data.duration ?? duration
        };

        setTimeout(() => {
            if (progress)    progress.style.display   = 'none';
            if (dropContent) dropContent.style.display = 'flex';
            if (fill)        fill.style.width          = '0';
            showSamplePreview(_sampleTrack);
        }, 600);

    } catch (e) {
        clearInterval(ticker);
        if (progress)    progress.style.display   = 'none';
        if (dropContent) dropContent.style.display = 'flex';
        if (fill)        fill.style.width          = '0';
        showMerchToast('Sample upload failed: ' + e.message, 'error');
    }
}

// ─────────────────────────────────────────────────────────────
// SAMPLE TRACK: PREVIEW CARD + MINI PLAYER
// ─────────────────────────────────────────────────────────────
function showSamplePreview(track) {
    const card  = document.getElementById('sampleTrackPreview');
    const art   = document.getElementById('samplePreviewArt');
    const title = document.getElementById('samplePreviewTitle');

    if (!card) return;

    if (art) {
        if (track.artUrl) {
            art.style.backgroundImage = `url('${track.artUrl}')`;
            art.classList.add('has-art');
        } else {
            art.style.backgroundImage = '';
            art.classList.remove('has-art');
        }
    }
    if (title) title.textContent = track.title || 'Untitled';

    card.style.display = 'flex';

    // Set up the mini HTML5 audio player
    stopSamplePreview();
    _sampleAudio = new Audio(track.streamUrl);
    _sampleAudio.addEventListener('ended', () => {
        const btn = document.getElementById('samplePreviewPlay');
        if (btn) btn.innerHTML = '<i class="fas fa-play"></i>';
    });
}

function clearSampleTrack() {
    _sampleTrack = null;
    stopSamplePreview();
    const card = document.getElementById('sampleTrackPreview');
    if (card) card.style.display = 'none';
    const titleInput = document.getElementById('sampleTrackTitleInput');
    if (titleInput) titleInput.value = '';
    const input = document.getElementById('sampleAudioInput');
    if (input) input.value = '';
    const dropContent = document.getElementById('sampleAudioDrop')?.querySelector('.sample-drop-content');
    if (dropContent) dropContent.style.display = 'flex';
    const progress = document.getElementById('sampleUploadProgress');
    if (progress) progress.style.display = 'none';
}

function stopSamplePreview() {
    if (_sampleAudio) {
        _sampleAudio.pause();
        _sampleAudio = null;
    }
    const btn = document.getElementById('samplePreviewPlay');
    if (btn) btn.innerHTML = '<i class="fas fa-play"></i>';
}

window.toggleSamplePreview = function() {
    if (!_sampleAudio || !_sampleTrack?.streamUrl) return;

    const btn = document.getElementById('samplePreviewPlay');
    if (_sampleAudio.paused) {
        _sampleAudio.play();
        if (btn) btn.innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        _sampleAudio.pause();
        if (btn) btn.innerHTML = '<i class="fas fa-play"></i>';
    }
};

window.removeSampleTrack = function() {
    clearSampleTrack();
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * showMerchToast — delegates to artistStudio.js's showToast if present,
 * otherwise creates a minimal fallback so merch notifications always work.
 */
function showMerchToast(message, type = 'success') {
    // artistStudio.js exposes showToast globally via its createToastContainer setup
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
        return;
    }
    // Fallback: build our own if showToast isn't ready yet
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3500);
}

async function apiFetch(url, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Authorization': `Bearer ${_authToken}` }
    };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    return fetch(url, opts);
}

function categoryLabel(cat) {
    const map = { clothing: 'Clothing', vinyl: 'Vinyl / CD / Tape', digital: 'Digital', artwork: 'Artwork / Print', bundle: 'Bundle', other: 'Other' };
    return map[cat] || cat;
}

function formatDuration(secs) {
    if (!secs) return '';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function esc(str) {
    return (str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}