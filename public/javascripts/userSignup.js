/* public/javascripts/userSignup.js */
import { 
    getAuth, 
    signInWithCustomToken, 
    onAuthStateChanged // [ADDED]
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js'; 
import { GENRES } from './taxonomy.js'; 

const auth = getAuth(app);
let authCheckComplete = false;


// --- STATE ---
let currentStep = 1;
let selectedPrimaryGenre = null;
let selectedSubgenres = [];
let selectedAnthem = null;  
let profileImageFile = null; 

// Cropper State
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



// --- UI HELPERS ---
const showAuthSpinner = () => {
    const spinner = document.getElementById('authCheckSpinner');
    if (spinner) spinner.style.display = 'flex';
};

const hideAuthSpinner = () => {
    const spinner = document.getElementById('authCheckSpinner');
    if (spinner) spinner.style.display = 'none';
};

const showSignupForm = () => {
    const wrapper = document.querySelector('.signup-wrapper');
    if (wrapper) {
        wrapper.style.display = 'block';
        wrapper.style.opacity = '1';
    }
};

// Start by showing the spinner while checking auth state
showAuthSpinner();

// --- AUTH GUARD ---
onAuthStateChanged(auth, (user) => {
    if (authCheckComplete) return; 
    authCheckComplete = true;
    
    if (user) {
        // CASE: User is already signed in
        console.log('✅ User already signed in, redirecting to dashboard...');
        
        // Update UI to show redirecting state
        const signupWrapper = document.querySelector('.signup-wrapper');
        if (signupWrapper) {
            signupWrapper.style.display = 'block';
            signupWrapper.innerHTML = `
                <div class="signin-container" style="text-align: center; padding: 60px 20px; margin: 0 auto;">
                    <i class="fas fa-check-circle" style="font-size: 4rem; color: #88C9A1; margin-bottom: 20px;"></i>
                    <h2 style="color: var(--text-main); margin-bottom: 10px; font-size: 1.8rem; font-weight: 900;">Already a Member!</h2>
                    <p style="color: #888;">Taking you to your dashboard...</p>
                </div>
            `;
        }
        hideAuthSpinner();
        
        setTimeout(() => {
            window.location.href = '/player/dashboard';
        }, 800);

    } else {
        // CASE: No user, show the signup form
        console.log('👤 No user detected, showing signup form');
        hideAuthSpinner();
        showSignupForm();
    }
});

// --- PASSWORD & EMAIL VALIDATION ---

// 1. Toggle Visibility
window.togglePassword = (inputId, icon) => {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = "password";
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
};

// 2. Setup Real-Time Validation Listeners
function setupAuthValidation() {
    const emailInput = document.getElementById('emailInput');
    const passInput = document.getElementById('passwordInput');
    const confirmInput = document.getElementById('confirmPasswordInput');
    const reqList = document.getElementById('passReqs');

    // --- EMAIL CHECKER ---
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

        // Basic Regex for format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!emailRegex.test(val)) {
            if(val.length > 0) {
                 wrapper.classList.add('error'); // Soft error for format
            }
            return;
        }

        // Live DB Check
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
                    hint.innerText = "This email is already registered.";
                    hint.style.display = 'block';
                }
            } catch (err) { console.error(err); }
        }, 600);
    });

    // --- PASSWORD STRENGTH ---
    passInput.addEventListener('input', (e) => {
        const val = e.target.value;
        const wrapper = passInput.parentElement;
        
        // Show requirements box
        reqList.classList.add('visible');

        // Check Rules
        const hasLen = val.length >= 8;
        const hasNum = /\d/.test(val);
        const hasSym = /[!@#$%^&*(),.?":{}|<>]/.test(val);

        // Update UI List
        updateReqItem('req-len', hasLen);
        updateReqItem('req-num', hasNum);
        updateReqItem('req-sym', hasSym);

        // Enable/Disable Confirm Input
        if (hasLen && hasNum && hasSym) {
            wrapper.classList.add('success');
            confirmInput.disabled = false;
        } else {
            wrapper.classList.remove('success');
            confirmInput.disabled = true;
            confirmInput.value = ''; // Reset confirm if main changes
            confirmInput.parentElement.classList.remove('success', 'error');
        }
    });

    // --- PASSWORD MATCH ---
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
        el.querySelector('i').className = "fas fa-check-circle";
    } else {
        el.classList.remove('met');
        el.querySelector('i').className = "far fa-circle";
    }
}

// =========================================
// [NEW] MODAL HELPERS
// =========================================
window.openModal = (id) => {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'flex'; // Uses flex to center
        modal.classList.add('active');
    }
};

window.closeModal = (id) => {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
};


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

    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
}


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
                console.error(err);
                wrapper.classList.remove('loading');
            }
        }, 500);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    createToastContainer();
    setupAuthValidation(); // <--- Moved here
    setupHandleValidation();
    setupGenrePicker(); 
    setupAnthemSearch();
    setupLocationAutocomplete();
    setupCropper();
    setupLegalCheck();
    selectSong(DEFAULT_ANTHEM);
});


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
    cropModal.style.display = 'flex'; // Ensure visible
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
        imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    });
    canvas.toBlob((blob) => {
        profileImageFile = new File([blob], "profile.jpg", { type: "image/jpeg" });
        document.getElementById('profilePreview').src = URL.createObjectURL(blob);
        showToast('success', 'Photo updated!');
        cancelCrop();
    }, 'image/jpeg', 0.9);
};

// --- [NEW] LOCAL SEARCH FUNCTION ---
function searchCuratedLocations(query) {
    const matches = [];
    const q = query.toLowerCase();

    // Iterate over States
    Object.entries(STATE_CITIES).forEach(([state, cities]) => {
        // 1. Check Cities
        cities.forEach(city => {
            if (city.name.toLowerCase().includes(q)) {
                matches.push({
                    type: 'curated_city',
                    display: `${city.name}, ${state}`,
                    city: city.name,
                    state: state,
                    country: "United States",
                    emoji: city.emoji || '🏙️',
                    color: city.color
                });
            }
        });

        // 2. Check State (Fallback Discovery)
        if (state.toLowerCase().includes(q)) {
            matches.push({
                type: 'curated_state',
                display: `${state}, United States`,
                city: null, // State-level
                state: state,
                country: "United States",
                emoji: '🇺🇸',
                color: 200
            });
        }
    });

    return matches.slice(0, 3); // Limit local matches
}

// --- [UPDATED] LOCATION AUTOCOMPLETE (HYBRID) ---
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
            // 1. Search Local Curated List (Strict US)
            const localResults = searchCuratedLocations(query);

            // 2. Search Photon API (Global Fallback)
            let apiResults = [];
            try {
                const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`);
                const data = await res.json();
                apiResults = data.features || [];
            } catch (err) { console.error("Location lookup failed", err); }

            // 3. Render Hybrid List
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

    // A. Render Local Matches (Priority)
    localMatches.forEach(item => {
        if (uniqueKeys.has(item.display)) return;
        uniqueKeys.add(item.display);

        const el = document.createElement('div');
        el.className = 'suggestion-item curated'; // Add CSS style for curated
        // Use styled badge
        el.innerHTML = `
            <i class="fas fa-star" style="color: #88C9A1;"></i> 
            <span style="font-weight:700; color:#333;">${item.display}</span>
        `;
        
        el.addEventListener('click', () => {
            input.value = item.display;
            input.dataset.city = item.city || "";
            input.dataset.state = item.state;
            input.dataset.country = item.country;
            input.dataset.lat = ""; // Local data might not have coords yet, optional
            input.dataset.lng = "";
            dropdown.classList.remove('active');
        });
        dropdown.appendChild(el);
    });

    // B. Render API Matches (International / Fallback)
    apiFeatures.forEach(f => {
        const props = f.properties;
        const city = props.city || props.town || props.village || props.name;
        const state = props.state || props.county; 
        const country = props.country;
        
        if (!city || !country) return;

        // Skip US results from API if we want to enforce Curated List
        // (Optional: Remove this line if you want to allow non-curated US cities)
        if (country === "United States") return; 

        let displayString = state ? `${city}, ${state}, ${country}` : `${city}, ${country}`;
        
        if (uniqueKeys.has(displayString)) return;
        uniqueKeys.add(displayString);

        const el = document.createElement('div');
        el.className = 'suggestion-item';
        el.innerHTML = `<i class="fas fa-globe-americas" style="color:#ccc"></i> <span>${displayString}</span>`;
        
        el.addEventListener('click', () => {
            input.value = displayString;
            input.dataset.city = city;
            input.dataset.state = state || "";
            input.dataset.country = country;
            input.dataset.lat = f.geometry.coordinates[1];
            input.dataset.lng = f.geometry.coordinates[0];
            dropdown.classList.remove('active');
        });
        dropdown.appendChild(el);
    });

    if (dropdown.children.length > 0) dropdown.classList.add('active');
}

function setupGenrePicker() {
    const select = document.getElementById('primaryGenreSelect');
    if(!select) return;
    
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
        if (genreObj && genreObj.subgenres) {
            subGrid.innerHTML = '';
            subSection.style.display = 'block';
            genreObj.subgenres.forEach(sub => {
                const chip = document.createElement('div');
                chip.className = 'genre-chip';
                chip.innerText = sub.name;
                chip.dataset.id = sub.id;
                chip.onclick = () => toggleSubgenre(sub.id, chip);
                subGrid.appendChild(chip);
            });
        }
    };
}

function toggleSubgenre(subId, el) {
    if (selectedSubgenres.includes(subId)) {
        selectedSubgenres = selectedSubgenres.filter(s => s !== subId);
        el.classList.remove('active');
    } else {
        if (selectedSubgenres.length >= 3) {
            showToast('error', "Max 3 subgenres allowed.");
            return;
        }
        selectedSubgenres.push(subId);
        el.classList.add('active');
    }
}


function setupLegalCheck() {
    const checkbox = document.getElementById('legalCheck');
    const nextBtn = document.getElementById('step1NextBtn');
    if(checkbox && nextBtn) {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                nextBtn.disabled = false;
                nextBtn.style.opacity = '1';
                nextBtn.style.cursor = 'pointer';
            } else {
                nextBtn.disabled = true;
                nextBtn.style.opacity = '0.5';
                nextBtn.style.cursor = 'not-allowed';
            }
        });
    }
}


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
    const card = document.getElementById('selectedAnthem');
    const cover = document.getElementById('anthemCover');
    const title = document.getElementById('anthemTitle');
    const artist = document.getElementById('anthemArtist');
    if(card && cover && title && artist) {
        card.style.display = 'flex';
        cover.src = song.img;
        title.innerText = song.title;
        artist.innerText = song.artist;
        document.getElementById('searchResults').style.display = 'none';
        const input = document.getElementById('anthemSearch');
        if(input) input.value = '';
    }
};

window.clearAnthem = () => {
    selectedAnthem = null;
    document.getElementById('selectedAnthem').style.display = 'none';
};

// ... [Keep Final Submit] ...
window.attemptNextStep = (current) => {
    if (current === 1) {
        const handle = document.getElementById('handleInput').value.trim();
        const email = document.getElementById('emailInput').value.trim();
        const pass = document.getElementById('passwordInput').value;
        const confirmPass = document.getElementById('confirmPasswordInput').value;
        const wrapper = document.getElementById('handleInput').closest('.handle-wrapper');
        const legalChecked = document.getElementById('legalCheck').checked;
        
        if (!legalChecked) return showToast('error', "You must agree to the Terms & Policies.");
        if (handle.length < 3) return showToast('error', "Handle must be 3+ characters.");
        if (wrapper.classList.contains('error')) return showToast('error', "Please choose an available handle.");
        if (!email.includes('@')) return showToast('error', "Please enter a valid email.");
        if (pass.length < 6) return showToast('error', "Password must be 6+ characters.");
        if (pass !== confirmPass) return showToast('error', "Passwords do not match.");
    }
    
    if (current === 2) {
        const location = document.getElementById('locationInput').value.trim();
        if (location.length < 2) return showToast('error', "Please enter your city.");
        if (!selectedPrimaryGenre) return showToast('error', "Please select a Primary Vibe.");
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

// --- [UPDATED] SUBMIT FUNCTION ---
window.submitBetaSignup = async () => {
    const submitBtn = document.querySelector('.btn-submit');
    const originalText = document.getElementById('finishBtnText').innerText;
    
    if(submitBtn) {
        submitBtn.disabled = true;
        document.getElementById('finishBtnText').innerText = "Joining...";
    }

    const formData = new FormData();
    formData.append('handle', document.getElementById('handleInput').value);
    formData.append('email', document.getElementById('emailInput').value);
    formData.append('password', document.getElementById('passwordInput').value);
    if (profileImageFile) formData.append('profileImage', profileImageFile);

    // [UPDATED] Geo Data Construction
    const locInput = document.getElementById('locationInput');
    formData.append('location', locInput.value); 
    
    const geoData = {
        lat: locInput.dataset.lat || null,
        lng: locInput.dataset.lng || null,
        city: locInput.dataset.city || locInput.value.split(',')[0], // Fallback if manually typed
        state: locInput.dataset.state || "",
        country: locInput.dataset.country || ""
    };
    formData.append('geo', JSON.stringify(geoData));
    
    // ... [Rest of payload construction] ...
    const musicProfile = {
        primary: selectedPrimaryGenre,
        subgenres: selectedSubgenres,
        requests: document.getElementById('artistRequestInput').value
    };
    formData.append('musicProfile', JSON.stringify(musicProfile));
    formData.append('profileSong', JSON.stringify(selectedAnthem));
    
    const settings = {
        tasteMatch: document.getElementById('tasteMatchToggle').checked,
        quickTips: [
            document.getElementById('tip1').value || 1,
            document.getElementById('tip2').value || 3,
            document.getElementById('tip3').value || 5
        ]
    };
    formData.append('settings', JSON.stringify(settings));

    try {
        const response = await fetch('/members/api/create-account', {
            method: 'POST',
            body: formData 
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Signup Failed");

        if(submitBtn) document.getElementById('finishBtnText').innerText = "Logging in...";
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