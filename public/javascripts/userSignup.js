/* public/javascripts/userSignup.js */
import { 
    getAuth, 
    signInWithCustomToken, 
    signInWithPopup, 
    GoogleAuthProvider 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js'; 
import { GENRES } from './taxonomy.js'; 

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// --- STATE ---
let currentStep = 1;
let selectedGenres = []; 
let selectedAnthem = null;  
let profileImageFile = null; 
let googleUser = null; 

// Cropper State
let cropper = null;
const cropModal = document.getElementById('cropModal');
const imageToCrop = document.getElementById('imageToCrop');

// [UPDATE] Default Anthem Configuration
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

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    createToastContainer(); // [NEW]
    setupHandleValidation(); // [NEW]
    renderGenresFromTaxonomy();
    setupAnthemSearch();
    setupLocationAutocomplete();
    setupCropper();
    // [NEW] Auto-Select the Beta Anthem
    selectSong(DEFAULT_ANTHEM);
});

// =========================================
// 1. TOAST NOTIFICATIONS (NEW)
// =========================================
function createToastContainer() {
    if (!document.querySelector('.toast-container')) {
        const container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
}

function showToast(type, message) {
    const container = document.querySelector('.toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);

    // Auto remove after 3s
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
}

// =========================================
// 2. LIVE HANDLE VALIDATION (NEW)
// =========================================
function setupHandleValidation() {
    const handleInput = document.getElementById('handleInput');
    const wrapper = handleInput.closest('.handle-wrapper');
    const statusIcon = document.getElementById('handleStatus');
    let debounceTimer;

    handleInput.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        
        // Reset State
        wrapper.classList.remove('success', 'error', 'loading');
        statusIcon.innerHTML = ''; 
        clearTimeout(debounceTimer);

        if (value.length < 3) return;

        // Show Loading
        wrapper.classList.add('loading');
        statusIcon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        // Debounce API Call
        debounceTimer = setTimeout(async () => {
            try {
                // Remove @ if user typed it
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
                console.error(err);
                wrapper.classList.remove('loading');
            }
        }, 500);
    });
}

// =========================================
// 3. CROPPER LOGIC
// =========================================
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
    if (cropper) cropper.destroy();
    cropper = null;
};

window.saveCrop = () => {
    if (!cropper) return;

    const canvas = cropper.getCroppedCanvas({
        width: 400,
        height: 400,
        fillColor: '#fff',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });

    canvas.toBlob((blob) => {
        profileImageFile = new File([blob], "profile.jpg", { type: "image/jpeg" });
        document.getElementById('profilePreview').src = URL.createObjectURL(blob);
        showToast('success', 'Photo updated!'); // [NEW]
        cancelCrop();
    }, 'image/jpeg', 0.9);
};

// =========================================
// 4. LOCATION AUTOCOMPLETE
// =========================================
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

        if (query.length < 3) return;

        debounceTimer = setTimeout(async () => {
            try {
                const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`);
                const data = await res.json();
                if (data.features && data.features.length > 0) {
                    renderSuggestions(data.features, dropdown, input);
                }
            } catch (err) {
                console.error("Location lookup failed", err);
            }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) dropdown.classList.remove('active');
    });
}

function renderSuggestions(features, dropdown, input) {
    dropdown.innerHTML = '';
    const uniqueLocs = new Set();

    features.forEach(f => {
        const props = f.properties;
        const city = props.city || props.town || props.village || props.name;
        const state = props.state || props.county;
        const country = props.country;

        if (!city || !country) return;

        const locationStr = [city, state, country].filter(Boolean).join(', ');
        if (uniqueLocs.has(locationStr)) return;
        uniqueLocs.add(locationStr);

        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `<i class="fas fa-map-marker-alt"></i> <span>${locationStr}</span>`;
        
        item.addEventListener('click', () => {
            input.value = locationStr;
            dropdown.classList.remove('active');
            input.dataset.lat = f.geometry.coordinates[1];
            input.dataset.lng = f.geometry.coordinates[0];
            input.dataset.city = city;
            input.dataset.country = country;
        });

        dropdown.appendChild(item);
    });

    if (dropdown.children.length > 0) dropdown.classList.add('active');
}

// =========================================
// 5. GENRE TAXONOMY
// =========================================
function renderGenresFromTaxonomy() {
    const grid = document.getElementById('genreGrid');
    if (!grid) return;
    
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.gap = '10px';
    
    const genreKeys = Object.keys(GENRES);
    
    grid.innerHTML = genreKeys.map(key => {
        const genreName = GENRES[key].label || key.replace('_', ' ');
        return `
        <div class="genre-pill" onclick="toggleGenre('${key}', this)" 
             style="border:2px solid #eee; padding:8px 16px; border-radius:20px; cursor:pointer; font-weight:700; color:#888; user-select:none; transition:all 0.2s">
            ${genreName}
        </div>
    `;
    }).join('');
}

window.toggleGenre = (genreKey, el) => {
    if (selectedGenres.includes(genreKey)) {
        selectedGenres = selectedGenres.filter(x => x !== genreKey);
        el.style.background = 'transparent';
        el.style.color = '#888';
        el.style.borderColor = '#eee';
    } else {
        selectedGenres.push(genreKey);
        el.style.background = '#88C9A1';
        el.style.color = 'white';
        el.style.borderColor = '#88C9A1';
    }
};

// =========================================
// 6. AUTH & NAVIGATION (Updated with Toasts)
// =========================================
window.handleGoogleAuth = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        googleUser = result.user;
        document.getElementById('authOptions').style.display = 'none'; 
        document.getElementById('authSuccess').style.display = 'flex'; 
        document.getElementById('authUserName').innerText = googleUser.displayName || googleUser.email;
        if (!profileImageFile) {
            document.getElementById('profilePreview').src = googleUser.photoURL || "https://via.placeholder.com/50";
        }
        document.getElementById('emailInput').value = googleUser.email;
        showToast('success', 'Google Sign-In Successful'); // [NEW]
    } catch (error) {
        console.error(error);
        showToast('error', "Google Sign-In failed.");
    }
};

window.resetAuth = () => {
    auth.signOut();
    googleUser = null;
    document.getElementById('authOptions').style.display = 'block';
    document.getElementById('authSuccess').style.display = 'none';
    document.getElementById('emailInput').value = '';
    document.getElementById('passwordInput').value = '';
};


// --- VALIDATION & NAV (Updated for No-Google Flow) ---
window.attemptNextStep = (current) => {
    // STEP 1 VALIDATION
    if (current === 1) {
        const handle = document.getElementById('handleInput').value.trim();
        const email = document.getElementById('emailInput').value.trim();
        const pass = document.getElementById('passwordInput').value;
        const confirmPass = document.getElementById('confirmPasswordInput').value;
        const wrapper = document.getElementById('handleInput').closest('.handle-wrapper');
        
        if (handle.length < 3) {
            showToast('error', "Handle must be 3+ characters.");
            return;
        }
        if (wrapper.classList.contains('error')) {
            showToast('error', "Please choose an available handle.");
            return;
        }

        if (!email.includes('@')) {
            showToast('error', "Please enter a valid email.");
            return;
        }
        if (pass.length < 6) {
            showToast('error', "Password must be 6+ characters.");
            return;
        }
        if (pass !== confirmPass) {
            showToast('error', "Passwords do not match.");
            return;
        }
    }
    
    // STEP 2 VALIDATION
    if (current === 2) {
        const location = document.getElementById('locationInput').value.trim();
        if (location.length < 2 || selectedGenres.length === 0) {
            showToast('error', "Enter a city and select at least 1 genre.");
            return;
        }
    }
    
    goToStep(current + 1);
};

window.prevStep = (step) => goToStep(step - 1);

function goToStep(step) {
    document.querySelectorAll('.form-step').forEach(el => el.classList.remove('active'));
    document.querySelector(`.form-step[data-step="${step}"]`).classList.add('active');
    
    const percent = ((step - 1) / 2) * 100; 
    const bar = document.getElementById('progressFill');
    if(bar) bar.style.width = `${percent}%`;
    
    document.querySelectorAll('.step').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.step) <= step);
    });
    currentStep = step;
}

// =========================================
// ANTHEM SEARCH (Updated)
// =========================================
function setupAnthemSearch() {
    const input = document.getElementById('anthemSearch');
    const results = document.getElementById('searchResults');
    if(!input) return;

    input.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        if (q.length < 2) { results.style.display='none'; return; }
        
        const matches = MOCK_SONGS.filter(s => s.title.toLowerCase().includes(q));
        results.innerHTML = matches.map(s => `
            <div class="result-item" onclick='selectSong(${JSON.stringify(s)})'>
                <img src="${s.img}" class="result-img">
                <div><b>${s.title}</b><br><small>${s.artist}</small></div>
            </div>
        `).join('');
        results.style.display = matches.length ? 'block' : 'none';
    });
}

window.selectSong = (song) => {
    selectedAnthem = song;
    // Populate the UI Card
    const card = document.getElementById('selectedAnthem');
    const cover = document.getElementById('anthemCover');
    const title = document.getElementById('anthemTitle');
    const artist = document.getElementById('anthemArtist');
    
    if(card && cover && title && artist) {
        card.style.display = 'flex';
        cover.src = song.img;
        title.innerText = song.title;
        artist.innerText = song.artist;
        
        // Hide Search Results
        document.getElementById('searchResults').style.display = 'none';
        
        // Clear input if exists
        const input = document.getElementById('anthemSearch');
        if(input) input.value = '';
    }
};

window.clearAnthem = () => {
    selectedAnthem = null;
    document.getElementById('selectedAnthem').style.display = 'none';
};

// --- FINAL SUBMIT ---
window.submitBetaSignup = async () => {
    const submitBtn = document.querySelector('.btn-submit');
    const originalText = document.getElementById('finishBtnText').innerText;
    
    if(submitBtn) {
        submitBtn.disabled = true;
        document.getElementById('finishBtnText').innerText = "Joining...";
    }

    const formData = new FormData();
    formData.append('handle', document.getElementById('handleInput').value);
    
    const locInput = document.getElementById('locationInput');
    formData.append('location', locInput.value);
    
    const geoData = {
        lat: locInput.dataset.lat || null,
        lng: locInput.dataset.lng || null,
        city: locInput.dataset.city || "",
        country: locInput.dataset.country || ""
    };
    formData.append('geo', JSON.stringify(geoData));

    formData.append('genres', JSON.stringify(selectedGenres));
    formData.append('profileSong', JSON.stringify(selectedAnthem));

    if (profileImageFile) {
        formData.append('profileImage', profileImageFile);
    }

    // STRICT EMAIL/PASSWORD PAYLOAD
    formData.append('email', document.getElementById('emailInput').value);
    formData.append('password', document.getElementById('passwordInput').value);

    try {
        const response = await fetch('/members/api/create-account', {
            method: 'POST',
            body: formData 
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.error || "Signup Failed");

        if(submitBtn) document.getElementById('finishBtnText').innerText = "Logging in...";
        
        // Sign in with the custom token returned by backend
        await signInWithCustomToken(auth, result.token);

        window.location.href = '/player/dashboard';

    } catch (error) {
        console.error(error);
        showToast('error', error.message);
        if(submitBtn) {
            submitBtn.disabled = false;
            document.getElementById('finishBtnText').innerText = originalText;
        }
    }
};