/**
 * profileTheme.js
 *
 * Handles all visual customisation in the "Public Profile" studio section:
 *   • Avatar upload → Cropper.js 1:1 → upload to /artist/api/studio/upload-avatar
 *   • Banner upload → Cropper.js free → upload to /artist/api/studio/upload-banner
 *   • Focal-point picker for the banner (drag a dot → background-position X%/Y%)
 *   • Colour pickers for accent, bg, card, text, buttons
 *   • Button-style radio buttons
 *   • Optional page-background image
 *   • Live mini-preview that reflects all changes in real time
 *   • Saves theme JSON to POST /artist/api/studio/page-theme
 *
 * Prerequisite (already in your <head> or loaded before this script):
 *   Cropper.js  — https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js
 *                 + its CSS:  cropper.min.css
 *
 * Mount in your artist studio layout:
 *   <script type="module" src="/javascripts/profileTheme.js"></script>
 *
 * Exposes window.profileTheme so Pug onclick="" handlers can call it.
 */

import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { app } from './firebase-config.js';

const auth = getAuth(app);

// =============================================================================
// AUTH HELPERS
//
// The critical fix: auth.currentUser is always null at script load time
// because Firebase restores its session asynchronously. Reading it directly
// (the old code) always throws "Not authenticated", which cascades into
// _setupBgImageUpload() never being wired and all API calls failing.
//
// waitForUser() wraps onAuthStateChanged so every caller properly awaits the
// SDK's first definitive emission (authenticated user or null).
// =============================================================================
function waitForUser() {
    return new Promise((resolve, reject) => {
        // onAuthStateChanged fires once with the current state the moment the
        // SDK is ready. We unsubscribe immediately — we only need the first value.
        const unsub = onAuthStateChanged(auth, user => {
            unsub();
            if (user) resolve(user);
            else reject(new Error('Not authenticated — please reload and sign in'));
        });
    });
}

async function idToken() {
    const user = await waitForUser();
    return user.getIdToken();   // always fresh (auto-refreshed by SDK)
}

async function apiFetch(url, opts = {}) {
    const token = await idToken();
    const res   = await fetch(url, {
        ...opts,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(opts.headers || {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Request failed');
    }
    return res.json();
}

function showStatus(id, msg, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--error, #ff4d4d)' : 'var(--success, #88C9A1)';
    setTimeout(() => { el.textContent = ''; }, 4000);
}

// ── Module state ──────────────────────────────────────────────────────────────
let _croppers     = {};   // keyed 'avatar' | 'banner'
let _pendingBlobs = {};   // cropped blobs awaiting upload
let _currentTheme = {};   // live local copy of the artist's theme

// ── Focal-point state ─────────────────────────────────────────────────────────
let _focal      = { x: 50, y: 50 };
let _fpDragging = false;

// =============================================================================
// INIT — waits for Firebase Auth to settle, THEN loads data and wires UI.
//        This is the only correct pattern — do not call init() from
//        DOMContentLoaded directly because auth.currentUser is null there.
// =============================================================================
async function init() {
    try {
        // Block here until the SDK confirms who is signed in.
        // On a studio page the user is always authenticated; if somehow they're
        // not, waitForUser() will reject and we fall into the catch below.
        await waitForUser();

        const data = await apiFetch('/artist/api/studio/page-theme');
        _currentTheme = { ...data.theme };

        // Populate colour pickers with saved values
        applyThemeToInputs(_currentTheme);

        // Avatar / banner previews
        if (data.avatarUrl) {
            _setImg('profileAvatarPreview', data.avatarUrl);
            _setImg('ppPrevAvatar', data.avatarUrl, 'background-image');
        }
        if (data.bannerUrl) {
            _loadBannerPreview(data.bannerUrl);
        }

        // Focal point from saved theme
        _focal.x = _currentTheme.bannerFocalX ?? 50;
        _focal.y = _currentTheme.bannerFocalY ?? 50;
        _refreshFpLabel();

        // Background image preview
        if (_currentTheme.bgImageUrl && _isSafeUrl(_currentTheme.bgImageUrl)) {
            _showBgPreview(_currentTheme.bgImageUrl);
        }

        // Button style radio
        const bsRadio = document.querySelector(`input[name="ppButtonStyle"][value="${_currentTheme.buttonStyle || 'neon'}"]`);
        if (bsRadio) bsRadio.checked = true;

        // Background style radio
        const bgRadio = document.querySelector(`input[name="ppBgStyle"][value="${_currentTheme.bgImageStyle || 'cover'}"]`);
        if (bgRadio) bgRadio.checked = true;

        // Wire up all interactive controls
        _setupColourPickers();
        _setupButtonStyleRadios();
        _setupAvatarCropper();
        _setupBannerCropper();
        _setupFocalPointPicker();
        _setupBgImageUpload();   // ← only reaches here when auth is confirmed

        // Initial live preview render
        _refreshPreview();

        console.log('[profileTheme] initialised');
    } catch (e) {
        console.error('[profileTheme] init error:', e);
        // Surface auth errors visibly in the design section rather than
        // silently leaving all controls dead.
        const section = document.getElementById('pageDesignSection');
        if (section && e.message.includes('authenticated')) {
            const banner = document.createElement('p');
            banner.style.cssText = 'color:var(--error,#ff4d4d);font-family:Rajdhani,sans-serif;font-size:0.85rem;padding:12px 0';
            banner.textContent = 'Session expired — please reload the page to re-authenticate.';
            section.prepend(banner);
        }
    }
}

// =============================================================================
// COLOUR PICKERS
// =============================================================================
const COLOUR_FIELDS = [
    { colour: 'colourAccent',  hex: 'hexAccent',   key: 'accentColor'    },
    { colour: 'colourBg',      hex: 'hexBg',        key: 'bgColor'        },
    { colour: 'colourCard',    hex: 'hexCard',       key: 'cardColor'      },
    { colour: 'colourText',    hex: 'hexText',       key: 'textColor'      },
    { colour: 'colourMuted',   hex: 'hexMuted',      key: 'textMutedColor' },
    { colour: 'colourBtnBg',   hex: 'hexBtnBg',      key: 'btnBgColor'     },
    { colour: 'colourBtnText', hex: 'hexBtnText',    key: 'btnTextColor'   },
];

function applyThemeToInputs(theme) {
    COLOUR_FIELDS.forEach(({ colour, hex, key }) => {
        const colEl = document.getElementById(colour);
        const hexEl = document.getElementById(hex);
        const val   = theme[key] || '';
        if (colEl) { colEl.value = val; _updateSwatchBg(colEl); }
        if (hexEl)   hexEl.value = val.toUpperCase();
    });
}

function _updateSwatchBg(colourInput) {
    const swatch = colourInput.closest('.pp-swatch');
    if (swatch) swatch.style.setProperty('--swatch-col', colourInput.value);
}

function _setupColourPickers() {
    COLOUR_FIELDS.forEach(({ colour, hex, key }) => {
        const colEl = document.getElementById(colour);
        const hexEl = document.getElementById(hex);
        if (!colEl || !hexEl) return;

        colEl.addEventListener('input', () => {
            hexEl.value = colEl.value.toUpperCase();
            _updateSwatchBg(colEl);
            _currentTheme[key] = colEl.value;
            _refreshPreview();
        });

        hexEl.addEventListener('input', () => {
            const raw = hexEl.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
                colEl.value = raw.toLowerCase();
                _updateSwatchBg(colEl);
                _currentTheme[key] = raw.toLowerCase();
                _refreshPreview();
            }
        });

        const swatchDiv = colEl.closest('.pp-swatch');
        if (swatchDiv) swatchDiv.addEventListener('click', () => colEl.click());
    });
}

// =============================================================================
// BUTTON STYLE RADIOS
// =============================================================================
function _setupButtonStyleRadios() {
    document.querySelectorAll('input[name="ppButtonStyle"]').forEach(radio => {
        radio.addEventListener('change', () => {
            _currentTheme.buttonStyle = radio.value;
            _refreshPreview();
        });
    });
    document.querySelectorAll('input[name="ppBgStyle"]').forEach(radio => {
        radio.addEventListener('change', () => {
            _currentTheme.bgImageStyle = radio.value;
        });
    });
}

// =============================================================================
// LIVE PREVIEW
// =============================================================================
function _refreshPreview() {
    const preview = document.getElementById('ppLivePreview');
    if (!preview) return;

    const t = _currentTheme;
    preview.style.setProperty('--pp-accent',    t.accentColor    || '#00ffd1');
    preview.style.setProperty('--pp-bg',         t.bgColor        || '#050505');
    preview.style.setProperty('--pp-card',       t.cardColor      || '#111111');
    preview.style.setProperty('--pp-text',       t.textColor      || '#ffffff');
    preview.style.setProperty('--pp-muted',      t.textMutedColor || '#888888');
    preview.style.setProperty('--pp-btn-bg',     t.btnBgColor     || '#00ffd1');
    preview.style.setProperty('--pp-btn-text',   t.btnTextColor   || '#000000');

    const prevBtn = document.getElementById('ppPrevBtn');
    if (prevBtn) prevBtn.dataset.btnStyle = t.buttonStyle || 'neon';
}

// =============================================================================
// AVATAR CROPPER
// =============================================================================
function _setupAvatarCropper() {
    const input = document.getElementById('profileAvatarInput');
    if (!input) return;

    input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            document.getElementById('avatarImageToCrop').src = ev.target.result;
            _openCropModal('avatar');
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });
}

// =============================================================================
// BANNER CROPPER
// =============================================================================
function _setupBannerCropper() {
    const input = document.getElementById('profileBannerInput');
    if (!input) return;

    input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            document.getElementById('bannerImageToCrop').src = ev.target.result;
            _openCropModal('banner');
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });
}

// =============================================================================
// CROP MODAL — open / close / save
// =============================================================================
function _openCropModal(type) {
    const modalId = type === 'avatar' ? 'avatarCropModal' : 'bannerCropModal';
    const imgId   = type === 'avatar' ? 'avatarImageToCrop' : 'bannerImageToCrop';
    const modal   = document.getElementById(modalId);
    const imgEl   = document.getElementById(imgId);
    if (!modal || !imgEl) return;

    if (_croppers[type]) { _croppers[type].destroy(); _croppers[type] = null; }

    modal.style.display = 'flex';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    const options = type === 'avatar'
        ? { aspectRatio: 1, viewMode: 1, dragMode: 'move', autoCropArea: 0.85, background: false }
        : { aspectRatio: NaN, viewMode: 1, dragMode: 'move', autoCropArea: 0.9, background: false, guides: true };

    _croppers[type] = new Cropper(imgEl, options);
}

function cancelCrop(type) {
    const modalId = type === 'avatar' ? 'avatarCropModal' : 'bannerCropModal';
    const modal   = document.getElementById(modalId);
    if (modal) { modal.style.display = 'none'; modal.classList.remove('active'); }
    if (_croppers[type]) { _croppers[type].destroy(); _croppers[type] = null; }
    document.body.style.overflow = '';
}

function saveCrop(type) {
    const cropper = _croppers[type];
    if (!cropper) return;

    const isAvatar = type === 'avatar';
    const canvas   = cropper.getCroppedCanvas({
        width:                 isAvatar ? 400 : 1400,
        height:                isAvatar ? 400 : undefined,
        fillColor:             '#000',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });

    canvas.toBlob(blob => {
        if (!blob) return;
        _pendingBlobs[type] = new File([blob], `${type}.jpg`, { type: 'image/jpeg' });

        if (isAvatar) {
            const url = URL.createObjectURL(blob);
            _setImg('profileAvatarPreview', url);
            _setImg('ppPrevAvatar', url, 'background-image');
        } else {
            const url = URL.createObjectURL(blob);
            _loadBannerPreview(url);
            _focal = { x: 50, y: 50 };
            _refreshFpLabel();
        }

        cancelCrop(type);
        _uploadImage(type);
    }, 'image/jpeg', 0.92);
}

// =============================================================================
// IMAGE UPLOAD
// =============================================================================
async function _uploadImage(type) {
    const file = _pendingBlobs[type];
    if (!file) return;

    const endpoint  = `/artist/api/studio/upload-${type}`;  // upload-avatar | upload-banner
    const formData  = new FormData();
    formData.append(type, file);

    if (type === 'banner') {
        formData.append('bannerFocalX', String(_focal.x));
        formData.append('bannerFocalY', String(_focal.y));
    }

    try {
        const token = await idToken();
        const res   = await fetch(endpoint, {
            method:  'POST',
            headers: { Authorization: `Bearer ${token}` },
            body:    formData,
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json();
        console.log(`[profileTheme] ${type} uploaded →`, data.url);
        delete _pendingBlobs[type];
    } catch (e) {
        console.error(`[profileTheme] ${type} upload error:`, e);
    }
}

// =============================================================================
// BANNER PREVIEW helper
// =============================================================================
function _loadBannerPreview(src) {
    const img    = document.getElementById('profileBannerPreview');
    const picker = document.getElementById('bannerFocalPicker');
    const stage  = document.getElementById('fpStage');

    if (img)    img.src = src;
    if (picker) picker.style.display = 'block';
    if (stage)  stage.style.backgroundImage = `url('${src}')`;

    _positionFpDot();
}

// =============================================================================
// FOCAL POINT PICKER
// =============================================================================
function _setupFocalPointPicker() {
    const stage = document.getElementById('fpStage');
    const dot   = document.getElementById('fpDot');
    if (!stage || !dot) return;

    const updateFromEvent = e => {
        const rect    = stage.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        _focal.x = Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width)  * 100)));
        _focal.y = Math.round(Math.max(0, Math.min(100, ((clientY - rect.top)  / rect.height) * 100)));
        _positionFpDot();
        _refreshFpLabel();
        _currentTheme.bannerFocalX = _focal.x;
        _currentTheme.bannerFocalY = _focal.y;
        const banner = document.getElementById('profileBannerPreview');
        if (banner) banner.style.objectPosition = `${_focal.x}% ${_focal.y}%`;
    };

    stage.addEventListener('mousedown',  e => { _fpDragging = true; updateFromEvent(e); });
    stage.addEventListener('touchstart', e => { _fpDragging = true; updateFromEvent(e); }, { passive: true });
    document.addEventListener('mousemove',  e => { if (_fpDragging) updateFromEvent(e); });
    document.addEventListener('touchmove',  e => { if (_fpDragging) updateFromEvent(e); }, { passive: true });
    document.addEventListener('mouseup',   () => { if (_fpDragging) { _fpDragging = false; _sendFocalPoint(); } });
    document.addEventListener('touchend',  () => { if (_fpDragging) { _fpDragging = false; _sendFocalPoint(); } });
    stage.addEventListener('click', e => { updateFromEvent(e); _sendFocalPoint(); });
}

function _positionFpDot() {
    const dot   = document.getElementById('fpDot');
    const stage = document.getElementById('fpStage');
    if (!dot || !stage) return;
    dot.style.left = `${_focal.x}%`;
    dot.style.top  = `${_focal.y}%`;
}

function _refreshFpLabel() {
    const label = document.getElementById('fpCoordsLabel');
    if (label) label.textContent = `X: ${_focal.x}% · Y: ${_focal.y}%`;
}

let _fpDebounce = null;
function _sendFocalPoint() {
    clearTimeout(_fpDebounce);
    _fpDebounce = setTimeout(async () => {
        try {
            await apiFetch('/artist/api/studio/page-theme', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ theme: { ..._currentTheme, bannerFocalX: _focal.x, bannerFocalY: _focal.y } }),
            });
        } catch (e) { /* non-critical — also saved on Save Design */ }
    }, 600);
}

function resetFocalPoint() {
    _focal = { x: 50, y: 50 };
    _currentTheme.bannerFocalX = 50;
    _currentTheme.bannerFocalY = 50;
    _positionFpDot();
    _refreshFpLabel();
    const banner = document.getElementById('profileBannerPreview');
    if (banner) banner.style.objectPosition = '50% 50%';
    _sendFocalPoint();
}

// =============================================================================
// PAGE BACKGROUND IMAGE
// =============================================================================

// Guard: only accept strings that start with https:// to prevent
// url('null') or url('undefined') from leaking into CSS and causing
// ERR_NAME_NOT_RESOLVED when the browser tries to fetch them as URLs.
function _isSafeUrl(v) {
    return typeof v === 'string' && v.startsWith('https://');
}

// =============================================================================
// COLOR EXTRACTION — auto-match theme to uploaded background image
//
// When the artist uploads a background image we analyse it with a canvas to
// extract dominant colors, then compute a tasteful palette and pre-fill all
// colour pickers.  The artist can still tweak anything — this is a starting
// point, not a lock-in.
//
// Algorithm:
//   1. Draw the image to a small 80×80 canvas (fast, enough detail)
//   2. Bucket all pixels into a coarse 32-step colour histogram
//   3. Sorted by frequency: find the darkest dominant color (bg),
//      the most vibrant/saturated bright color (accent),
//      and derive card, text, and muted shades from those two.
//   4. Apply to _currentTheme, sync to picker inputs, refresh preview.
// =============================================================================
function _rgbToHex(r, g, b) {
    return '#' + [r, g, b]
        .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
        .join('');
}

function _luminance(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

async function _extractPalette(imageSrc) {
    return new Promise(resolve => {
        const img = new Image();
        // crossOrigin intentionally omitted — we only pass same-origin blob: URLs here

        img.onload = () => {
            try {
                const SIZE = 80;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = SIZE;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, SIZE, SIZE);

                const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

                const buckets = new Map();
                for (let i = 0; i < data.length; i += 4) {
                    const a = data[i + 3];
                    if (a < 128) continue;
                    const r = Math.round(data[i]     / 32) * 32;
                    const g = Math.round(data[i + 1] / 32) * 32;
                    const b = Math.round(data[i + 2] / 32) * 32;
                    const key = (r << 16) | (g << 8) | b;
                    buckets.set(key, (buckets.get(key) || 0) + 1);
                }

                const sorted = [...buckets.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([key]) => [
                        (key >> 16) & 0xff,
                        (key >> 8)  & 0xff,
                         key        & 0xff,
                    ]);

                // Background: darkest among top-20 most frequent, clamped dark
                let bgRgb = sorted.slice(0, 20).find(([r, g, b]) => r + g + b < 180)
                         || sorted.reduce((a, b) => (a[0]+a[1]+a[2]) < (b[0]+b[1]+b[2]) ? a : b);
                bgRgb = bgRgb.map(v => Math.min(v, 60));

                // Accent: highest vibrance (saturation × relative brightness)
                let accentRgb = null;
                let maxVibrance = 0;
                for (const [r, g, b] of sorted.slice(0, 40)) {
                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    const saturation = max === 0 ? 0 : (max - min) / max;
                    const brightness = (r + g + b) / 3;
                    const vibrance = saturation * (brightness / 255);
                    if (vibrance > maxVibrance && brightness > 60 && saturation > 0.25) {
                        maxVibrance = vibrance;
                        accentRgb = [r, g, b];
                    }
                }
                if (!accentRgb) accentRgb = [0, 255, 209];

                // Card: bg + brightness boost
                const cardRgb = bgRgb.map(v => Math.min(v + 22, 55));

                // Muted text: 30% accent + 70% grey
                const mutedRgb = accentRgb.map((v, i) =>
                    Math.round(v * 0.3 + [140, 140, 140][i] * 0.7)
                );

                // Button text contrast
                const btnTextColor = _luminance(...accentRgb) > 0.45 ? '#000000' : '#ffffff';

                // Boost accent saturation to at least 70% so it pops
                const [ar, ag, ab] = accentRgb;
                const aMax = Math.max(ar, ag, ab);
                const aMin = Math.min(ar, ag, ab);
                let finalAccent = accentRgb;
                if (aMax > 0 && (aMax - aMin) / aMax < 0.7) {
                    const scale = 255 / aMax;
                    finalAccent = [
                        Math.round(ar * scale * 0.6 + ar * 0.4),
                        Math.round(ag * scale * 0.6 + ag * 0.4),
                        Math.round(ab * scale * 0.6 + ab * 0.4),
                    ].map(v => Math.min(255, v));
                }

                resolve({
                    bgColor:        _rgbToHex(...bgRgb),
                    cardColor:      _rgbToHex(...cardRgb),
                    accentColor:    _rgbToHex(...finalAccent),
                    textColor:      '#ffffff',
                    textMutedColor: _rgbToHex(...mutedRgb),
                    btnBgColor:     _rgbToHex(...finalAccent),
                    btnTextColor,
                });
            } catch (err) {
                console.warn('[profileTheme] palette extraction failed:', err);
                resolve(null);
            }
        };

        img.onerror = () => resolve(null);
        img.src = imageSrc;
    });
}

async function _applyExtractedPalette(imageSrc) {
    const palette = await _extractPalette(imageSrc);
    if (!palette) return;
    Object.assign(_currentTheme, palette);
    applyThemeToInputs(_currentTheme);
    _refreshPreview();
    _showPaletteBanner();
}

function _showPaletteBanner() {
    const existing = document.getElementById('ppPaletteBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'ppPaletteBanner';
    banner.style.cssText = [
        'display:flex', 'align-items:center', 'gap:12px',
        'background:color-mix(in srgb,var(--primary,#00ffd1) 10%,transparent)',
        'border:1px solid color-mix(in srgb,var(--primary,#00ffd1) 35%,transparent)',
        'border-radius:4px', 'padding:10px 16px', 'margin-bottom:20px',
        'font-family:Rajdhani,sans-serif', 'font-size:0.85rem',
        'color:var(--text-secondary,#aaa)',
    ].join(';');

    const strong = document.createElement('strong');
    strong.style.cssText = 'color:var(--primary,#00ffd1);cursor:pointer';
    strong.textContent = 'reset to defaults';
    strong.onclick = () => window.profileTheme.revertDefaultColors();

    const icon = document.createElement('i');
    icon.className = 'fas fa-magic';
    icon.style.cssText = 'color:var(--primary,#00ffd1);flex-shrink:0';

    const text = document.createElement('span');
    text.append('Colors auto-matched from your background image. Tweak below or \u00a0', strong, '.');

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'margin-left:auto;background:none;border:none;color:var(--text-muted,#666);cursor:pointer;font-size:1.1rem;padding:0 4px;line-height:1';
    closeBtn.textContent = '\u00d7';
    closeBtn.onclick = () => banner.remove();

    banner.append(icon, text, closeBtn);

    const grid = document.querySelector('.pp-colour-grid');
    if (grid) grid.parentElement.insertBefore(banner, grid);
}

function revertDefaultColors() {
    const defaults = {
        accentColor: '#00ffd1', bgColor: '#050505', cardColor: '#111111',
        textColor: '#ffffff', textMutedColor: '#888888',
        btnBgColor: '#00ffd1', btnTextColor: '#000000',
    };
    Object.assign(_currentTheme, defaults);
    applyThemeToInputs(_currentTheme);
    _refreshPreview();
    const banner = document.getElementById('ppPaletteBanner');
    if (banner) banner.remove();
}

function _setupBgImageUpload() {
    const input = document.getElementById('ppBgImageInput');
    if (!input) return;

    input.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;

        // Show a local blob preview immediately — no need to wait for R2
        const localUrl = URL.createObjectURL(file);
        _showBgPreview(localUrl);

        // Extract the colour palette NOW from the local blob URL.
        // Blob URLs are same-origin — no CORS headers needed, canvas reads
        // them freely.  We do this before the R2 upload so the pickers update
        // instantly and we never hit the CDN's missing CORS headers.
        _applyExtractedPalette(localUrl);

        try {
            const token    = await idToken();
            const formData = new FormData();
            formData.append('bgImage', file);

            const res = await fetch('/artist/api/studio/upload-bg-image', {
                method:  'POST',
                headers: { Authorization: `Bearer ${token}` },
                body:    formData,
            });
            if (!res.ok) throw new Error((await res.json()).error);

            const data = await res.json();
            // Replace blob URL in preview with the permanent CDN URL
            if (_isSafeUrl(data.url)) {
                _currentTheme.bgImageUrl = data.url;
                _showBgPreview(data.url);
                console.log('[profileTheme] bg image uploaded →', data.url);
            }
        } catch (err) {
            console.error('[profileTheme] bg upload error:', err);
            // Revert the preview on failure
            _currentTheme.bgImageUrl = null;
            _hideBgPreview();
        }

        // Clear input so the same file can be re-selected if needed
        e.target.value = '';
    });
}

function _showBgPreview(src) {
    const img       = document.getElementById('ppBgPreview');
    const empty     = document.getElementById('ppBgEmpty');
    const removeBtn = document.getElementById('ppBgRemoveBtn');
    if (img)       { img.src = src; img.style.display = 'block'; }
    if (empty)     empty.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'inline-flex';
}

function _hideBgPreview() {
    const img       = document.getElementById('ppBgPreview');
    const empty     = document.getElementById('ppBgEmpty');
    const removeBtn = document.getElementById('ppBgRemoveBtn');
    if (img)       { img.style.display = 'none'; img.src = ''; }
    if (empty)     empty.style.display = 'flex';
    if (removeBtn) removeBtn.style.display = 'none';
}

async function removeBgImage() {
    try {
        await apiFetch('/artist/api/studio/bg-image', { method: 'DELETE' });
        _currentTheme.bgImageUrl = null;
        _hideBgPreview();
    } catch (e) {
        console.error('[profileTheme] remove bg error:', e);
    }
}

// =============================================================================
// SAVE THEME
// =============================================================================
async function saveTheme() {
    const btn    = document.getElementById('saveDesignBtn');
    const status = 'designSaveStatus';

    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

        const checkedStyle   = document.querySelector('input[name="ppButtonStyle"]:checked');
        const checkedBgStyle = document.querySelector('input[name="ppBgStyle"]:checked');
        if (checkedStyle)   _currentTheme.buttonStyle  = checkedStyle.value;
        if (checkedBgStyle) _currentTheme.bgImageStyle = checkedBgStyle.value;

        _currentTheme.bannerFocalX = _focal.x;
        _currentTheme.bannerFocalY = _focal.y;

        await apiFetch('/artist/api/studio/page-theme', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ theme: _currentTheme }),
        });

        showStatus(status, '✓ Design saved');
    } catch (e) {
        console.error('[profileTheme] save error:', e);
        showStatus(status, `Error: ${e.message}`, true);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paint-brush"></i> Save Design'; }
    }
}

// =============================================================================
// Utility: set <img> src or a div's CSS background-image
// =============================================================================
function _setImg(id, src, mode = 'src') {
    const el = document.getElementById(id);
    if (!el) return;
    if (mode === 'src') el.src = src;
    else el.style.backgroundImage = `url('${src}')`;
}

// =============================================================================
// BOOT
// Register the public API first (so Pug onclick="" handlers don't throw if
// they fire before init() resolves), then kick off init once the DOM is ready.
// =============================================================================
window.profileTheme = { cancelCrop, saveCrop, resetFocalPoint, saveTheme, removeBgImage, revertDefaultColors };

document.addEventListener('DOMContentLoaded', init);