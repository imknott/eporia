/* public/javascripts/userSignup.js */
import {
    getAuth,
    onAuthStateChanged,
    signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';
import { GENRES } from './taxonomy.js';
import { US_STATE_CITIES, INTERNATIONAL_CITIES, searchAllCities } from './states.js';

const auth = getAuth(app);
let authCheckComplete = false;

// ── STATE ──────────────────────────────────────────────────────────────────────
let currentStep = 1;
let selectedPrimaryGenre = null;
let selectedSubgenres = [];
let selectedAnthem = null;
let profileImageFile = null;
let bannerImageFile = null;

// Wallet / credits state
let selectedCreditPackage = null;   // '500' | '1000' | 'custom' | null
let customCreditAmount = 0;          // dollar value entered for custom package

// Stripe state (initialised lazily after account creation)
let stripeInstance = null;
let stripeElements = null;

// Cropper
let cropper = null;
const cropModal = document.getElementById('cropModal');
const imageToCrop = document.getElementById('imageToCrop');

const DEFAULT_ANTHEM = {
    title: "Stardust Drive",
    artist: "Neon Echoes",
    img: "https://images.unsplash.com/photo-1619983081563-430f63602796?w=50"
};

const MOCK_SONGS = [
    DEFAULT_ANTHEM,
    { title: "Midnight City", artist: "M83", img: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=50" },
    { title: "Intro", artist: "The xx", img: "https://images.unsplash.com/photo-1493225255756-d9584f8606e9?w=50" }
];

// ── UI HELPERS ─────────────────────────────────────────────────────────────────
const showAuthSpinner = () => {
    const el = document.getElementById('authCheckSpinner');
    if (el) el.style.display = 'flex';
};

const hideAuthSpinner = () => {
    const el = document.getElementById('authCheckSpinner');
    if (el) el.style.display = 'none';
};

const showSignupForm = () => {
    const wrapper = document.querySelector('.signup-wrapper');
    if (wrapper) {
        wrapper.style.display = 'block';
        wrapper.style.opacity = '1';
    }
};

// ── BACKGROUND ANIMATION ───────────────────────────────────────────────────────
function initBackgroundAnimation() {
    const container = document.getElementById('animBg');
    if (!container) return;

    const tags = [];

    if (typeof GENRES !== 'undefined') {
        Object.values(GENRES).forEach(c => {
            tags.push(`#${c.name.split('/')[0].replace(/\s+/g, '')}`);
            if (c.subgenres) {
                c.subgenres.forEach(s => {
                    const name = typeof s === 'string' ? s : s.name;
                    tags.push(`#${name.replace(/[^a-zA-Z]/g, '')}`);
                });
            }
        });
    } else {
        tags.push('#Music', '#Live', '#Vibes', '#Indie', '#Eporia', '#Electronic', '#Beats', '#Sound', '#Underground');
    }

    const columns = Math.floor(window.innerWidth / 80);
    const activeColumns = new Set();

    function createFallingText() {
        let column;
        let attempts = 0;
        do {
            column = Math.floor(Math.random() * columns);
            attempts++;
        } while (activeColumns.has(column) && attempts < 10);

        if (activeColumns.has(column)) return;
        activeColumns.add(column);

        const el = document.createElement('div');
        el.className = 'matrix-text';
        el.innerText = tags[Math.floor(Math.random() * tags.length)];

        const leftPos = (column * 80) + Math.random() * 60;
        el.style.left = leftPos + 'px';

        const fontSize = Math.random() * 1.2 + 0.8;
        el.style.fontSize = fontSize + 'rem';

        const duration = Math.random() * 8 + 6;
        el.style.animationDuration = duration + 's';

        const colors = [
            'rgba(0, 255, 209, 0.8)',
            'rgba(0, 255, 209, 0.6)',
            'rgba(255, 0, 255, 0.7)',
            'rgba(0, 200, 255, 0.7)',
            'rgba(0, 255, 150, 0.6)'
        ];
        el.style.color = colors[Math.floor(Math.random() * colors.length)];
        container.appendChild(el);

        setTimeout(() => {
            el.remove();
            activeColumns.delete(column);
        }, duration * 1000);
    }

    for (let i = 0; i < Math.min(columns, 15); i++) {
        setTimeout(() => createFallingText(), Math.random() * 2000);
    }

    setInterval(() => {
        if (Math.random() > 0.3) createFallingText();
    }, 600);
}

// ── AUTH GUARD ─────────────────────────────────────────────────────────────────
showAuthSpinner();

onAuthStateChanged(auth, (user) => {
    if (authCheckComplete) return;
    authCheckComplete = true;

    if (user) {
        const signupWrapper = document.querySelector('.signup-wrapper');
        if (signupWrapper) {
            signupWrapper.style.display = 'block';
            signupWrapper.innerHTML = `
                <div class="signin-container" style="text-align:center;padding:60px 20px;margin:0 auto;">
                    <i class="fas fa-check-circle" style="font-size:4rem;color:#88C9A1;margin-bottom:20px;"></i>
                    <h2 style="color:var(--text-main);margin-bottom:10px;font-size:1.8rem;font-weight:900;">Already a Member!</h2>
                    <p style="color:#888;">Taking you to your dashboard...</p>
                </div>
            `;
        }
        hideAuthSpinner();
        setTimeout(() => { window.location.href = '/player/dashboard'; }, 800);
    } else {
        hideAuthSpinner();
        showSignupForm();
    }
});

// ── PASSWORD & EMAIL VALIDATION ────────────────────────────────────────────────
window.togglePassword = (inputId, icon) => {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
};

function setupAuthValidation() {
    const emailInput = document.getElementById('emailInput');
    const passInput = document.getElementById('passwordInput');
    const confirmInput = document.getElementById('confirmPasswordInput');
    const reqList = document.getElementById('passReqs');

    let emailTimer;
    emailInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const wrapper = emailInput.parentElement;
        const status = document.getElementById('emailStatus');
        const hint = document.getElementById('emailHint');

        clearTimeout(emailTimer);
        wrapper.classList.remove('success', 'error');
        status.innerHTML = '';
        hint.style.display = 'none';

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
            if (val.length > 0) wrapper.classList.add('error');
            return;
        }

        status.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        emailTimer = setTimeout(async () => {
            try {
                const res = await fetch(`/members/api/check-email/${encodeURIComponent(val)}`);
                const data = await res.json();
                status.innerHTML = '';
                if (data.available) {
                    wrapper.classList.add('success');
                    status.innerHTML = '<i class="fas fa-check-circle"></i>';
                } else {
                    wrapper.classList.add('error');
                    status.innerHTML = '<i class="fas fa-times-circle"></i>';
                    hint.innerText = 'This email is already registered.';
                    hint.style.display = 'block';
                }
            } catch (err) { console.error(err); }
        }, 600);
    });

    passInput.addEventListener('input', (e) => {
        const val = e.target.value;
        const wrapper = passInput.parentElement;
        reqList.classList.add('visible');

        const hasLen = val.length >= 8;
        const hasNum = /\d/.test(val);
        const hasSym = /[!@#$%^&*(),.?":{}|<>]/.test(val);

        updateReqItem('req-len', hasLen);
        updateReqItem('req-num', hasNum);
        updateReqItem('req-sym', hasSym);

        if (hasLen && hasNum && hasSym) {
            wrapper.classList.add('success');
            confirmInput.disabled = false;
        } else {
            wrapper.classList.remove('success');
            confirmInput.disabled = true;
            confirmInput.value = '';
            confirmInput.parentElement.classList.remove('success', 'error');
        }
    });

    confirmInput.addEventListener('input', (e) => {
        const val = e.target.value;
        const original = passInput.value;
        const wrapper = confirmInput.parentElement;
        const status = document.getElementById('matchStatus');

        if (val === original && val.length > 0) {
            wrapper.classList.remove('error');
            wrapper.classList.add('success');
            status.innerHTML = '<i class="fas fa-check-circle"></i>';
        } else {
            wrapper.classList.remove('success');
            wrapper.classList.add('error');
            status.innerHTML = '<i class="fas fa-times-circle"></i>';
        }
    });
}

function updateReqItem(id, met) {
    const el = document.getElementById(id);
    if (met) {
        el.classList.add('met');
        el.querySelector('i').className = 'fas fa-check-circle';
    } else {
        el.classList.remove('met');
        el.querySelector('i').className = 'far fa-circle';
    }
}

// ── MODALS ────────────────────────────────────────────────────────────────────
window.openModal = (id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('active');
    const iframe = modal.querySelector('iframe');
    if (iframe && !iframe.getAttribute('src')) iframe.src = iframe.dataset.src;
};

window.closeModal = (id) => {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
};

// ── TOAST ──────────────────────────────────────────────────────────────────────
function createToastContainer() {
    if (!document.querySelector('.toast-container')) {
        const c = document.createElement('div');
        c.className = 'toast-container';
        document.body.appendChild(c);
    }
}

function showToast(type, message) {
    const container = document.querySelector('.toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
}

// ── HANDLE VALIDATION ─────────────────────────────────────────────────────────
function setupHandleValidation() {
    const handleInput = document.getElementById('handleInput');
    const wrapper = handleInput.closest('.handle-wrapper');
    const statusIcon = document.getElementById('handleStatus');
    let debounceTimer;

    handleInput.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        wrapper.classList.remove('success', 'error', 'loading');
        statusIcon.innerHTML = '';
        clearTimeout(debounceTimer);
        if (value.length < 3) return;

        wrapper.classList.add('loading');
        statusIcon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        debounceTimer = setTimeout(async () => {
            try {
                const cleanHandle = value.replace('@', '');
                const res = await fetch(`/members/api/check-handle/${cleanHandle}`);
                const data = await res.json();
                wrapper.classList.remove('loading');
                if (data.available) {
                    wrapper.classList.add('success');
                    statusIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
                } else {
                    wrapper.classList.add('error');
                    statusIcon.innerHTML = '<i class="fas fa-times-circle"></i>';
                    showToast('error', `Sorry, @${cleanHandle} is taken.`);
                }
            } catch (err) {
                wrapper.classList.remove('loading');
                console.error(err);
            }
        }, 500);
    });
}

// ── LEGAL ACCEPTANCE ───────────────────────────────────────────────────────────
const legalState = { terms: false, privacy: false, cookie: false };

window.acceptLegal = (type) => {
    legalState[type] = true;
    const row = document.getElementById(`item-${type}`);
    if (!row) return;
    const icon = row.querySelector('.status-icon');
    if (!icon) return;

    row.style.background = 'rgba(0, 255, 209, 0.15)';
    row.style.borderColor = '#00FFD1';
    row.classList.add('accepted');
    icon.classList.remove('far', 'fa-circle');
    icon.classList.add('fas', 'fa-check-circle');
    icon.style.color = '#00FFD1';
    closeModal(`${type}Modal`);
    checkAllLegal();
};

function checkAllLegal() {
    const mainCheck = document.getElementById('legalCheck');
    const mainLabel = document.getElementById('mainLegalLabel');
    const nextBtn = document.getElementById('step1NextBtn');

    if (legalState.terms && legalState.privacy && legalState.cookie) {
        mainCheck.checked = true;
        mainCheck.disabled = false;
        mainLabel.style.opacity = '1';
        mainLabel.style.pointerEvents = 'auto';
        mainLabel.classList.add('enabled');
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
        nextBtn.style.cursor = 'pointer';
    }
}

function setupLegalCheck() {
    console.log('Legal check system initialized');
}

// ── PHOTO CROPPER ──────────────────────────────────────────────────────────────
function setupCropper() {
    const trigger = document.getElementById('triggerProfileUpload');
    const input = document.getElementById('profileFileInput');

    trigger.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                imageToCrop.src = ev.target.result;
                openCropModal();
            };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    });
}

function openCropModal() {
    cropModal.classList.add('active');
    cropModal.style.display = 'flex';
    if (cropper) cropper.destroy();
    cropper = new Cropper(imageToCrop, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.8,
        background: false
    });
}

window.cancelCrop = () => {
    cropModal.classList.remove('active');
    cropModal.style.display = 'none';
    if (cropper) cropper.destroy();
    cropper = null;
};

window.saveCrop = () => {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({
        width: 400, height: 400, fillColor: '#fff',
        imageSmoothingEnabled: true, imageSmoothingQuality: 'high'
    });
    canvas.toBlob((blob) => {
        profileImageFile = new File([blob], 'profile.jpg', { type: 'image/jpeg' });
        document.getElementById('profilePreview').src = URL.createObjectURL(blob);
        showToast('success', 'Photo updated!');
        cancelCrop();
    }, 'image/jpeg', 0.9);
};

// ── BANNER UPLOAD (Step 3) ─────────────────────────────────────────────────────
function setupBannerUpload() {
    const trigger = document.getElementById('triggerBannerUpload');
    const input = document.getElementById('bannerFileInput');
    const preview = document.getElementById('bannerPreview');
    const placeholder = document.getElementById('bannerPlaceholder');

    if (!trigger || !input) return;

    trigger.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        bannerImageFile = file;
        const reader = new FileReader();
        reader.onload = (ev) => {
            preview.src = ev.target.result;
            preview.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
            showToast('success', 'Banner updated!');
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });
}

// ── LOCATION AUTOCOMPLETE ──────────────────────────────────────────────────────
function searchCuratedLocations(query) {
    const matches = [];
    const q = query.toLowerCase();

    Object.entries(US_STATE_CITIES).forEach(([state, cities]) => {
        cities.forEach(city => {
            if (city.name.toLowerCase().includes(q)) {
                matches.push({
                    type: 'curated_us',
                    display: `${city.name}, ${state}`,
                    city: city.name,
                    state,
                    country: 'United States',
                    emoji: city.emoji || '🏙️',
                    color: city.color
                });
            }
        });
        if (state.toLowerCase().includes(q)) {
            matches.push({
                type: 'curated_state',
                display: `${state}, United States`,
                city: null,
                state,
                country: 'United States',
                emoji: '🇺🇸',
                color: 200
            });
        }
    });

    Object.entries(INTERNATIONAL_CITIES).forEach(([country, cities]) => {
        cities.forEach(city => {
            if (city.name.toLowerCase().includes(q) || country.toLowerCase().includes(q)) {
                matches.push({
                    type: 'curated_international',
                    display: `${city.name}, ${country}`,
                    city: city.name,
                    state: null,
                    country,
                    emoji: city.emoji || '🌍',
                    color: city.color
                });
            }
        });
    });

    return matches.slice(0, 8);
}

function setupLocationAutocomplete() {
    const input = document.getElementById('locationInput');
    const wrapper = input.parentElement;
    let dropdown = wrapper.querySelector('.suggestions-dropdown');

    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'suggestions-dropdown';
        wrapper.appendChild(dropdown);
    }

    let debounceTimer;

    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        dropdown.innerHTML = '';
        dropdown.classList.remove('active');
        clearTimeout(debounceTimer);
        if (query.length < 2) return;

        debounceTimer = setTimeout(async () => {
            const localResults = searchCuratedLocations(query);
            let apiResults = [];
            try {
                const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`);
                const data = await res.json();
                apiResults = data.features || [];
            } catch (err) { console.error('Location lookup failed', err); }

            renderHybridSuggestions(localResults, apiResults, dropdown, input);
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) dropdown.classList.remove('active');
    });
}

function renderHybridSuggestions(localMatches, apiFeatures, dropdown, input) {
    dropdown.innerHTML = '';
    const uniqueKeys = new Set();

    localMatches.forEach(item => {
        if (uniqueKeys.has(item.display)) return;
        uniqueKeys.add(item.display);

        const el = document.createElement('div');
        el.className = 'suggestion-item curated';
        const isUS = item.country === 'United States';
        const icon = isUS
            ? '<i class="fas fa-star" style="color:#88C9A1;margin-right:8px;"></i>'
            : `<span style="margin-right:8px;font-size:1.2rem;">${item.emoji}</span>`;

        el.innerHTML = `${icon}<span style="font-weight:700;color:#333;">${item.display}</span><span style="margin-left:auto;font-size:0.7rem;color:#888;">${isUS ? 'US' : 'Intl'}</span>`;

        el.addEventListener('click', () => {
            input.value = item.display;
            input.dataset.city = item.city || '';
            input.dataset.state = item.state || '';
            input.dataset.country = item.country;
            input.dataset.lat = '';
            input.dataset.lng = '';
            input.dataset.verified = 'true';
            dropdown.classList.remove('active');
            trackLocationSelection(item);
        });
        dropdown.appendChild(el);
    });

    apiFeatures.forEach(f => {
        const props = f.properties;
        const city = props.city || props.town || props.village || props.name;
        const state = props.state || props.county;
        const country = props.country;
        if (!city || !country) return;

        const displayString = state ? `${city}, ${state}, ${country}` : `${city}, ${country}`;
        if (uniqueKeys.has(displayString)) return;
        uniqueKeys.add(displayString);

        const el = document.createElement('div');
        el.className = 'suggestion-item photon-result';
        el.innerHTML = `<i class="fas fa-map-marker-alt" style="color:#ccc;margin-right:8px;"></i><span>${displayString}</span><span style="margin-left:auto;font-size:0.7rem;color:#888;">New</span>`;

        el.addEventListener('click', () => {
            input.value = displayString;
            input.dataset.city = city;
            input.dataset.state = state || '';
            input.dataset.country = country;
            input.dataset.lat = f.geometry.coordinates[1];
            input.dataset.lng = f.geometry.coordinates[0];
            input.dataset.verified = 'true';
            dropdown.classList.remove('active');
            trackLocationSelection({ type: 'photon_api', city, state: state || null, country, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], display: displayString });
        });
        dropdown.appendChild(el);
    });

    if (dropdown.children.length > 0) {
        dropdown.classList.add('active');
    } else {
        dropdown.innerHTML = '<div class="suggestion-item" style="color:#888;cursor:default;">No locations found. Try a different search.</div>';
        dropdown.classList.add('active');
    }
}

async function trackLocationSelection(locationData) {
    try {
        await fetch('/members/api/track-location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                city: locationData.city,
                state: locationData.state,
                country: locationData.country,
                source: locationData.type,
                lat: locationData.lat || null,
                lng: locationData.lng || null
            })
        });
    } catch (err) { /* silent */ }
}

// ── GENRE PICKER ───────────────────────────────────────────────────────────────
function setupGenrePicker() {
    const select = document.getElementById('primaryGenreSelect');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Select a Genre...</option>';
    Object.values(GENRES).forEach(genre => {
        const option = document.createElement('option');
        option.value = genre.id;
        option.innerText = genre.name;
        select.appendChild(option);
    });

    window.handlePrimaryGenreChange = () => {
        const primaryId = select.value;
        const subSection = document.getElementById('subgenreSection');
        const subGrid = document.getElementById('subgenreGrid');
        selectedPrimaryGenre = primaryId;
        selectedSubgenres = [];

        const genreObj = Object.values(GENRES).find(g => g.id === primaryId);
        if (genreObj && genreObj.subgenres && genreObj.subgenres.length > 0) {
            subGrid.innerHTML = '';
            subSection.classList.add('active');
            genreObj.subgenres.forEach(sub => {
                const chip = document.createElement('div');
                chip.className = 'chip';
                chip.innerText = sub.name;
                chip.dataset.id = sub.id;
                chip.onclick = () => toggleSubgenre(sub.id, chip);
                subGrid.appendChild(chip);
            });
        } else {
            subSection.classList.remove('active');
            subGrid.innerHTML = '';
        }
    };

    select.addEventListener('change', window.handlePrimaryGenreChange);
}

function toggleSubgenre(subId, el) {
    if (selectedSubgenres.includes(subId)) {
        selectedSubgenres = selectedSubgenres.filter(s => s !== subId);
        el.classList.remove('selected');
    } else {
        if (selectedSubgenres.length >= 3) {
            showToast('error', 'Max 3 subgenres allowed.');
            return;
        }
        selectedSubgenres.push(subId);
        el.classList.add('selected');
    }
}

// ── ANTHEM SEARCH ──────────────────────────────────────────────────────────────
function setupAnthemSearch() {
    const input = document.getElementById('anthemSearch');
    const results = document.getElementById('searchResults');
    if (!input) return;

    let debounceTimer;
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(debounceTimer);

        if (query.length < 2) {
            results.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            results.style.display = 'block';
            results.innerHTML = '<div style="padding:12px 15px;text-align:center;color:var(--text-muted);font-size:0.9rem;"><i class="fas fa-spinner fa-spin" style="color:var(--primary);margin-right:8px;"></i> Searching...</div>';

            try {
                const res = await fetch(`/members/api/public/search-songs?q=${encodeURIComponent(query)}`);
                const data = await res.json();

                if (data.results && data.results.length > 0) {
                    renderAnthemResults(data.results);
                } else {
                    results.innerHTML = '<div style="padding:12px 15px;text-align:center;color:var(--text-muted);font-size:0.9rem;">No tracks found in the Eporia library.</div>';
                }
            } catch (err) {
                console.error(err);
                results.innerHTML = '<div style="padding:12px 15px;text-align:center;color:#FF4444;font-size:0.9rem;">Search failed. Please try again.</div>';
            }
        }, 400);
    });
}

function renderAnthemResults(songs) {
    const box = document.getElementById('searchResults');
    box.innerHTML = '';
    box.style.display = 'block';
    songs.forEach(song => {
        const div = document.createElement('div');
        div.className = 'search-result-row';
        div.innerHTML = `
            <img src="${song.img}" alt="${song.title}">
            <div style="flex:1;min-width:0;">
                <div class="result-title">${song.title}</div>
                <div class="result-artist">${song.artist}</div>
            </div>
        `;
        div.onclick = () => selectAnthem(song);
        box.appendChild(div);
    });
}

function selectAnthem(song) {
    selectedAnthem = {
        songId:   song.id       || song.songId   || null,
        title:    song.title    || '',
        artist:   song.artist   || '',
        artistId: song.artistId || null,
        img:      song.img      || null,
        audioUrl: song.audioUrl || null,
        duration: song.duration || 0,
    };

    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('anthemSearch').value = '';
    document.querySelector('.anthem-search-container').style.display = 'none';

    const card = document.getElementById('selectedAnthem');
    card.style.display = 'flex';
    document.getElementById('anthemCover').src = selectedAnthem.img || '';
    document.getElementById('anthemTitle').innerText = selectedAnthem.title;
    document.getElementById('anthemArtist').innerText = selectedAnthem.artist;
}

// Legacy selectSong alias for MOCK_SONGS fallback
window.selectSong = (song) => selectAnthem(song);

window.clearAnthem = () => {
    selectedAnthem = null;
    document.getElementById('selectedAnthem').style.display = 'none';
    document.querySelector('.anthem-search-container').style.display = 'block';
};

// ── WALLET / CREDIT PACKAGE HANDLERS ─────────────────────────────────────────
window.handlePackageChange = (radio) => {
    selectedCreditPackage = radio.value;

    // Toggle custom amount input visibility
    const customRow = document.getElementById('customInputRow');
    const customPriceBlock = document.getElementById('customPriceBlock');
    const customTotalLine = document.getElementById('customTotalLine');

    if (radio.value === 'custom') {
        if (customRow) customRow.style.display = 'flex';
    } else {
        if (customRow) customRow.style.display = 'none';
        if (customPriceBlock) customPriceBlock.style.display = 'none';
        if (customTotalLine) customTotalLine.style.display = 'none';
        customCreditAmount = 0;
    }

    // Update submit button label
    updateSubmitButtonLabel();
};

window.updateCustomPreview = () => {
    const input = document.getElementById('customAmountInput');
    const val = parseFloat(input.value);
    const priceBlock = document.getElementById('customPriceBlock');
    const baseDisplay = document.getElementById('customBaseDisplay');
    const feeDisplay = document.getElementById('customFeeDisplay');
    const totalLine = document.getElementById('customTotalLine');

    if (!isNaN(val) && val >= 5) {
        customCreditAmount = val;
        const fee = (val * 0.12).toFixed(2);
        const total = (val * 1.12).toFixed(2);
        if (baseDisplay) baseDisplay.innerText = `$${val.toFixed(2)} to artists`;
        if (feeDisplay) feeDisplay.innerText = `$${fee} service fee`;
        if (priceBlock) priceBlock.style.display = 'block';
        if (totalLine) {
            totalLine.innerText = `You pay $${total}`;
            totalLine.style.display = 'block';
        }
    } else {
        customCreditAmount = 0;
        if (priceBlock) priceBlock.style.display = 'none';
        if (totalLine) totalLine.style.display = 'none';
    }

    updateSubmitButtonLabel();
};

function updateSubmitButtonLabel() {
    const btnText = document.getElementById('submitBtnText');
    if (!btnText) return;

    if (selectedCreditPackage && selectedCreditPackage !== 'skip') {
        btnText.innerText = 'Create Account & Fund Wallet';
    } else {
        btnText.innerText = 'Create My Account';
    }
}

window.skipWallet = () => {
    selectedCreditPackage = null;
    // Deselect all radio buttons
    document.querySelectorAll('input[name="creditPackage"]').forEach(r => r.checked = false);
    updateSubmitButtonLabel();
    // Submit without wallet
    submitSignup();
};

// ── STEP NAVIGATION ────────────────────────────────────────────────────────────
window.attemptNextStep = (current) => {
    if (current === 1) {
        const handle = document.getElementById('handleInput').value.trim();
        const email = document.getElementById('emailInput').value.trim();
        const pass = document.getElementById('passwordInput').value;
        const confirmPass = document.getElementById('confirmPasswordInput').value;
        const wrapper = document.getElementById('handleInput').closest('.handle-wrapper');
        const allLegalAccepted = legalState.terms && legalState.privacy && legalState.cookie;

        if (!allLegalAccepted) {
            const legalContainer = document.querySelector('.legal-consent-container');
            legalContainer.classList.add('shake-error');
            setTimeout(() => legalContainer.classList.remove('shake-error'), 500);
            return showToast('error', 'You must open and accept all 3 policies.');
        }
        if (handle.length < 3) return showToast('error', 'Handle must be 3+ characters.');
        if (wrapper.classList.contains('error')) return showToast('error', 'Please choose an available handle.');
        if (!email.includes('@')) return showToast('error', 'Please enter a valid email.');
        if (pass.length < 8) return showToast('error', 'Password must be 8+ characters.');
        if (pass !== confirmPass) return showToast('error', 'Passwords do not match.');
    }

    if (current === 2) {
        const locationInput = document.getElementById('locationInput');
        const location = locationInput.value.trim();
        if (location.length < 2) return showToast('error', 'Please enter your city.');
        if (!locationInput.dataset.verified || locationInput.dataset.verified !== 'true') {
            return showToast('error', 'Please select a location from the dropdown.');
        }
        if (!selectedPrimaryGenre) return showToast('error', 'Please select a Primary Vibe.');
    }

    // Step 3 — no required fields
    goToStep(current + 1);
};

window.prevStep = (step) => goToStep(step - 1);

function goToStep(step) {
    document.querySelectorAll('.form-step').forEach(el => el.classList.remove('active'));
    document.querySelector(`.form-step[data-step="${step}"]`).classList.add('active');

    const percent = ((step - 1) / 3) * 100;
    const bar = document.getElementById('progressFill');
    if (bar) bar.style.width = `${percent}%`;

    document.querySelectorAll('.step').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.step) <= step);
    });
    currentStep = step;
}

// ── ACCOUNT CREATION + WALLET ──────────────────────────────────────────────────

window.submitSignup = async () => {
    const submitBtn = document.getElementById('btnSubmit');
    const btnText = document.getElementById('submitBtnText');

    if (!submitBtn || submitBtn.disabled) return;

    // Validate wallet custom amount before proceeding
    if (selectedCreditPackage === 'custom' && customCreditAmount < 5) {
        return showToast('error', 'Custom amount must be at least $5.00.');
    }

    submitBtn.disabled = true;
    btnText.innerText = 'Creating Account...';

    // Build FormData
    const formData = new FormData();
    formData.append('handle', document.getElementById('handleInput').value.trim());
    formData.append('email', document.getElementById('emailInput').value.trim());
    formData.append('password', document.getElementById('passwordInput').value);
    if (profileImageFile) formData.append('profileImage', profileImageFile);
    if (bannerImageFile) formData.append('bannerImage', bannerImageFile);

    const locInput = document.getElementById('locationInput');
    formData.append('location', locInput.value);
    const geoData = {
        lat: locInput.dataset.lat || null,
        lng: locInput.dataset.lng || null,
        city: locInput.dataset.city || locInput.value.split(',')[0],
        state: locInput.dataset.state || '',
        country: locInput.dataset.country || ''
    };
    formData.append('geo', JSON.stringify(geoData));

    if (selectedPrimaryGenre) formData.append('primaryGenre', selectedPrimaryGenre);

    const musicProfile = {
        primary: selectedPrimaryGenre,
        subgenres: selectedSubgenres,
        requests: document.getElementById('artistRequestInput').value
    };
    formData.append('musicProfile', JSON.stringify(musicProfile));
    formData.append('subgenres', JSON.stringify(selectedSubgenres));
    formData.append('profileSong', selectedAnthem ? JSON.stringify(selectedAnthem) : 'null');

    const settings = { tasteMatch: document.getElementById('tasteMatchToggle').checked };
    formData.append('settings', JSON.stringify(settings));

    try {
        // ── 1. Create the account (no payment required) ──
        const res = await fetch('/members/api/account/create', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Account creation failed');

        // ── 2. Sign in with the custom token returned by the server ──
        await signInWithCustomToken(auth, data.customToken);

        // ── 3. If user chose a credit package → initiate Stripe payment ──
        if (selectedCreditPackage) {
            await initWalletPayment();
        } else {
            // No wallet selected — go straight to dashboard
            window.location.href = '/player/dashboard';
        }

    } catch (err) {
        console.error('[submitSignup]', err);
        showToast('error', err.message);
        submitBtn.disabled = false;
        btnText.innerText = selectedCreditPackage ? 'Create Account & Fund Wallet' : 'Create My Account';
    }
};

// Called after account is created + user is signed in.
// Fetches a PaymentIntent from the server and mounts the Stripe PaymentElement.
async function initWalletPayment() {
    const walletBtnRow = document.getElementById('walletBtnRow');
    const stripeContainer = document.getElementById('stripeWalletContainer');
    const summaryEl = document.getElementById('stripeSummary');

    // Hide the package selection UI
    document.querySelector('.credit-packages-grid').style.display = 'none';
    document.querySelector('.skip-wallet-row').style.display = 'none';
    if (walletBtnRow) walletBtnRow.style.display = 'none';

    stripeContainer.style.display = 'block';

    // Get a fresh ID token for the authenticated user
    const idToken = await auth.currentUser.getIdToken();

    const body = { package: selectedCreditPackage };
    if (selectedCreditPackage === 'custom') body.customAmount = customCreditAmount;

    const res = await fetch('/members/api/wallet/purchase-intent', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(body)
    });
    const intentData = await res.json();
    if (!intentData.clientSecret) throw new Error(intentData.error || 'Payment setup failed');

    // Update summary
    if (summaryEl) {
        summaryEl.innerHTML = `<i class="fas fa-coins"></i> <strong>${intentData.credits.toLocaleString()} credits</strong> — $${intentData.baseDollars} to artists + $${(intentData.totalCharged - intentData.baseDollars).toFixed(2)} service fee = <strong>$${intentData.totalCharged} total</strong>`;
    }

    // Mount Stripe PaymentElement
    stripeInstance = Stripe(intentData.publishableKey);
    stripeElements = stripeInstance.elements({ clientSecret: intentData.clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#00FFD1' } } });

    const paymentEl = stripeElements.create('payment');
    paymentEl.mount('#stripePaymentElement');
}

// Called when user clicks "Complete Purchase" inside the Stripe UI
window.confirmWalletPayment = async () => {
    const btn = document.getElementById('stripePayBtn');
    const btnText = document.getElementById('stripePayBtnText');

    btn.disabled = true;
    btnText.innerText = 'Processing...';

    try {
        const { error, paymentIntent } = await stripeInstance.confirmPayment({
            elements: stripeElements,
            redirect: 'if_required'
        });

        if (error) {
            showToast('error', error.message);
            btn.disabled = false;
            btnText.innerText = 'Complete Purchase';
            return;
        }

        if (paymentIntent && paymentIntent.status === 'succeeded') {
            // Tell the server to credit the wallet (server verifies with Stripe)
            const idToken = await auth.currentUser.getIdToken();
            await fetch('/members/api/wallet/credit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ paymentIntentId: paymentIntent.id })
            });

            showToast('success', 'Wallet funded! Welcome to Eporia 🎵');
            setTimeout(() => { window.location.href = '/player/dashboard'; }, 1200);
        } else {
            // Redirect-based payment methods (e.g. iDEAL, Bancontact)
            // Stripe will have redirected already — if we're still here, something went wrong
            showToast('error', 'Payment requires a redirect. Please try a card instead.');
            btn.disabled = false;
            btnText.innerText = 'Complete Purchase';
        }

    } catch (err) {
        console.error('[confirmWalletPayment]', err);
        showToast('error', err.message);
        btn.disabled = false;
        btnText.innerText = 'Complete Purchase';
    }
};

// User clicks "Skip — go to dashboard" inside the Stripe container
window.goToDashboard = () => {
    window.location.href = '/player/dashboard';
};

// ── INIT ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    createToastContainer();
    setupAuthValidation();
    setupHandleValidation();
    setupGenrePicker();
    setupAnthemSearch();
    setupLocationAutocomplete();
    setupCropper();
    setupBannerUpload();
    setupLegalCheck();
    initBackgroundAnimation();
    selectSong(DEFAULT_ANTHEM);
});