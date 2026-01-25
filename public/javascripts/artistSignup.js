/* public/javascripts/artistSignup.js */
import { GENRES } from '/javascripts/taxonomy.js';
import { auth } from './firebase-config.js';

let currentStep = 1;
const totalSteps = 4;

// Track upload status
let uploadedAssets = {
    avatar: null,
    banner: null
};

// Data Collection Object
let profilePayload = {
    identity: {},
    visuals: {},
    music: { features: {} }
};

// Cropper State
let cropper = null;
let currentCropType = null; 
const modal = document.getElementById('cropModal');
const imageElement = document.getElementById('imageToCrop');

document.addEventListener('DOMContentLoaded', () => {
    setupHandleValidation();
    setupLocationAutocomplete();
    updateButtons();
    setupCropListeners();
    createToastContainer();
    initBackgroundAnimation();
});

// ==========================================
// 1. NAVIGATION & VALIDATION
// ==========================================
window.nextStep = function() {
    if (!validateStep(currentStep)) return;
    
    captureStepData(currentStep);

    if (currentStep < totalSteps) {
        changeStep(currentStep + 1);
    } else {
        submitFinalProfile();
    }
};

window.prevStep = function() {
    if (currentStep > 1) changeStep(currentStep - 1);
};

function changeStep(newStep) {
    document.getElementById(`step${currentStep}`).classList.add('hidden');
    document.querySelector(`.step[data-step="${currentStep}"]`).classList.remove('active');
    
    currentStep = newStep;
    document.getElementById(`step${currentStep}`).classList.remove('hidden');
    document.querySelector(`.step[data-step="${currentStep}"]`).classList.add('active');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateButtons();
}

function updateButtons() {
    const backBtn = document.querySelector('.btn-back');
    const nextBtn = document.querySelector('.btn-next');
    
    backBtn.style.display = (currentStep === 1) ? 'none' : 'block';
    nextBtn.innerText = (currentStep === totalSteps) ? "Launch Studio" : "Continue";
}

function validateStep(step) {
    if (step === 1) {
        const name = document.querySelector('input[name="artistName"]').value;
        if (!name.trim()) {
            setInputError('artistName', 'Artist Name is required');
            return false;
        }
    }
    if (step === 2) {
        if (!uploadedAssets.avatar) {
            showToast('error', 'Please upload a profile picture.');
            return false;
        }
    }
    return true;
}

// [FIXED] Full Data Capture Logic
function captureStepData(step) {
    if (step === 1) {
        const locInput = document.querySelector('input[name="location"]');
        
        profilePayload.identity = {
            artistName: document.querySelector('input[name="artistName"]').value,
            handle: document.querySelector('input[name="handle"]').value,
            bio: document.querySelector('textarea[name="bio"]').value,
            
            // The Display String ("San Diego, CA, US")
            location: locInput.value, 
            
            // [NEW] The Query Data (For your "Local" Sidebar)
            geo: {
                lat: parseFloat(locInput.dataset.lat) || null,
                lng: parseFloat(locInput.dataset.lng) || null,
                city: locInput.dataset.city || "",
                state: locInput.dataset.state || "",
                country: locInput.dataset.country || ""
            }
        };
    }
    else if (step === 3) {
        // Taxonomy Capture
        const select = document.getElementById('primaryGenre');
        profilePayload.music.primaryGenre = select.value;
        
        // Get Selected Subgenres (Chips)
        const selectedChips = Array.from(document.querySelectorAll('.chip.selected'))
                                   .map(el => el.innerText.replace('#', '').trim().toLowerCase());
        profilePayload.music.subgenres = selectedChips;

        // Get Selected Moods
        const selectedMoods = Array.from(document.querySelectorAll('input[name="moodIds"]:checked'))
                                   .map(el => el.value);
        profilePayload.music.moods = selectedMoods;
    }
}

// ==========================================
// 2. TAXONOMY LOGIC (The Missing Piece)
// ==========================================
window.renderSubgenres = function() {
    const select = document.getElementById('primaryGenre');
    const genreKey = select.value.toUpperCase(); // Matches taxonomy.js keys
    
    const genreData = GENRES[genreKey];
    const container = document.getElementById('subgenreGrid');
    
    if (container && genreData) {
        container.innerHTML = genreData.subgenres.map(sub => {
            const name = sub.name || sub; 
            const id = sub.id || sub;
            return `<div class="chip" onclick="this.classList.toggle('selected')" data-id="${id}">#${name}</div>`;
        }).join('');
    }
};

function initBackgroundAnimation() {
    const container = document.createElement('div');
    container.className = 'animated-background';
    document.body.prepend(container);

    const genres = [
        '#IndiePop', '#Techno', '#JazzFusion', '#Trap', 
        '#LoFi', '#Soul', '#DeepHouse', '#AltRock', 
        '#NeoClassical', '#AfroBeats', '#Synthwave'
    ];

    // 1. Spawn Hashtags (Constant flow)
    setInterval(() => {
        const tag = document.createElement('div');
        tag.className = 'floating-tag';
        tag.innerText = genres[Math.floor(Math.random() * genres.length)];
        
        // Random Positioning
        tag.style.left = Math.random() * 90 + '%';
        tag.style.fontSize = (Math.random() * 2 + 1) + 'rem';
        tag.style.animationDuration = (Math.random() * 10 + 15) + 's'; // Slow float (15-25s)
        
        container.appendChild(tag);
        
        // Cleanup
        setTimeout(() => tag.remove(), 25000);
    }, 2000); // New tag every 2 seconds

    // 2. Spawn Tips (Sporadic excitement)
    // Realistic amounts: $1, $2, $3, $5
    const amounts = [1, 1, 2, 1, 5, 2, 1, 3]; 

    function spawnTip() {
        const tip = document.createElement('div');
        tip.className = 'floating-tip';
        
        const amount = amounts[Math.floor(Math.random() * amounts.length)];
        
        tip.innerHTML = `
            <i class="fas fa-coins"></i>
            <span>Fan tipped you <span class="tip-amount">$${amount}.00</span></span>
        `;
        
        // Random Position (Avoid center where form is)
        // Either left side (10-20%) or right side (80-90%)
        const side = Math.random() > 0.5 ? 10 : 75;
        const randomOffset = Math.random() * 15; // Variance
        tip.style.left = (side + randomOffset) + '%';
        tip.style.top = (Math.random() * 60 + 20) + '%'; // Vertical spread
        
        container.appendChild(tip);
        
        setTimeout(() => tip.remove(), 6000);

        // Randomize next tip (3 to 8 seconds)
        setTimeout(spawnTip, Math.random() * 5000 + 3000);
    }

    // Start tips after a slight delay
    setTimeout(spawnTip, 1000);
}



// --- LOCATION AUTOCOMPLETE (Using Photon OSM API) ---
function setupLocationAutocomplete() {
    const input = document.querySelector('input[name="location"]');
    
    // Create Dropdown dynamically
    const wrapper = document.createElement('div');
    wrapper.className = 'location-wrapper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const dropdown = document.createElement('div');
    dropdown.className = 'suggestions-dropdown';
    wrapper.appendChild(dropdown);

    let debounceTimer;

    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Clear previous
        dropdown.innerHTML = '';
        dropdown.classList.remove('active');
        clearTimeout(debounceTimer);

        if (query.length < 3) return;

        // Debounce API call (300ms)
        debounceTimer = setTimeout(async () => {
            try {
                // Fetch from Photon (OSM) - Limit 5, English
                const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`);
                const data = await res.json();

                if (data.features && data.features.length > 0) {
                    renderSuggestions(data.features);
                }
            } catch (err) {
                console.error("Location lookup failed", err);
            }
        }, 300);
    });

    // Render Logic
    function renderSuggestions(features) {
        dropdown.innerHTML = '';
        const uniqueLocs = new Set(); // Prevent duplicates

        features.forEach(f => {
            const props = f.properties;
            
            // Build string: "San Diego, California, United States"
            const city = props.city || props.town || props.village || props.name;
            const state = props.state || props.county;
            const country = props.country;

            if (!city || !country) return; // Skip if data incomplete

            const locationStr = [city, state, country].filter(Boolean).join(', ');

            // Deduplicate
            if (uniqueLocs.has(locationStr)) return;
            uniqueLocs.add(locationStr);

            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = `<i class="fas fa-map-marker-alt"></i> <span>${locationStr}</span>`;
            
            item.addEventListener('click', () => {
                input.value = locationStr;
                dropdown.classList.remove('active');
                
                // [NEW] Store Structured Data for the "Local" Sidebar features
                input.dataset.lat = f.geometry.coordinates[1];
                input.dataset.lng = f.geometry.coordinates[0];
                input.dataset.city = props.city || props.town || props.village || props.name;
                input.dataset.state = props.state || props.county || "";
                input.dataset.country = props.country || "";
            });

            dropdown.appendChild(item);
        });

        if (dropdown.children.length > 0) {
            dropdown.classList.add('active');
        }
    }

    // Close dropdown if clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            dropdown.classList.remove('active');
        }
    });
}

// ==========================================
// 3. IMAGE CROPPER & UPLOAD
// ==========================================
function setupCropListeners() {
    const avatarInput = document.getElementById('avatarInput');
    const bannerInput = document.getElementById('bannerInput');

    // [NEW] Make the Preview Containers Clickable
    document.querySelector('.avatar-preview-container').addEventListener('click', () => {
        avatarInput.click();
    });
    
    document.querySelector('.banner-preview-container').addEventListener('click', () => {
        bannerInput.click();
    });

    // Trigger Crop Modal on File Select (Existing Logic)
    avatarInput.addEventListener('change', (e) => initCropper(e, 'avatar'));
    bannerInput.addEventListener('change', (e) => initCropper(e, 'banner'));
}

function initCropper(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    currentCropType = type;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        imageElement.src = e.target.result;
        modal.classList.add('active');

        if (cropper) cropper.destroy();

        // 1:1 for Avatar, 3.5:1 for Banner
        const ratio = type === 'avatar' ? 1 : 3.5;

        cropper = new Cropper(imageElement, {
            aspectRatio: ratio,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 0.8,
            background: false
        });
    };
    reader.readAsDataURL(file);
    event.target.value = ''; // Reset input
}

window.saveCrop = async function() {
    if (!cropper) return;

    // Resize logic (400px avatar, 1200px banner)
    const width = currentCropType === 'avatar' ? 400 : 1200;
    const height = currentCropType === 'avatar' ? 400 : Math.round(1200 / 3.5);

    const canvas = cropper.getCroppedCanvas({
        width: width,
        height: height,
        fillColor: '#fff',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });

    canvas.toBlob(async (blob) => {
        const fileName = `${currentCropType}.jpg`;
        const file = new File([blob], fileName, { type: 'image/jpeg' });
        
        modal.classList.remove('active');
        await uploadAssetToFirebase(file, currentCropType);
        
    }, 'image/jpeg', 0.9);
};

window.cancelCrop = function() {
    modal.classList.remove('active');
    if (cropper) cropper.destroy();
    cropper = null;
};

async function uploadAssetToFirebase(file, type) {
    const labelId = type === 'avatar' ? 'avatarInput' : 'bannerInput';
    const label = document.querySelector(`label[for="${labelId}"]`);
    const originalHTML = label.innerHTML;
    
    label.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Uploading...`;
    label.classList.add('loading');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
        const user = auth.currentUser;
        if (!user) throw new Error("Sign in required");
        const token = await user.getIdToken();

        const response = await fetch('/artist/api/upload-asset', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const result = await response.json();
        
        if (result.success) {
            uploadedAssets[type] = result.url;
            
            // --- UPDATE PREVIEW & SHOW IMAGE ---
            const previewId = type === 'avatar' ? 'avatarPreview' : 'bannerPreview';
            const imgEl = document.getElementById(previewId);
            
            imgEl.src = result.url;
            imgEl.classList.add('active');
            
            label.classList.remove('loading');
            label.classList.add('success');
            label.innerHTML = `<i class="fas fa-check"></i> Updated`;
            
            showToast('success', 'Image uploaded!');
        } else {
            throw new Error(result.error);
        }
    } catch (e) {
        console.error(e);
        label.classList.remove('loading');
        label.innerHTML = originalHTML;
        showToast('error', 'Upload failed.');
    }
}

// ==========================================
// 4. FINAL SUBMISSION
// ==========================================
async function submitFinalProfile() {
    const legalCheck = document.getElementById('legalCheck');
    const legalBox = document.querySelector('.legal-box');
    
    if (!legalCheck.checked) {
        legalBox.classList.add('shake-error');
        showToast('error', 'You must agree to the Terms.');
        setTimeout(() => legalBox.classList.remove('shake-error'), 400);
        return; 
    }

    const btn = document.querySelector('.btn-next');
    btn.innerText = "Creating Profile...";
    btn.disabled = true;
    
    profilePayload.visuals.avatarUrl = uploadedAssets.avatar;
    profilePayload.visuals.bannerUrl = uploadedAssets.banner;
    
    const selectedGoals = Array.from(document.querySelectorAll('input[name="goals"]:checked')).map(el => el.value);
    profilePayload.goals = selectedGoals;
    profilePayload.legalAgreedAt = new Date().toISOString();

    try {
        const user = auth.currentUser;
        const token = await user.getIdToken();

        const response = await fetch('/artist/api/create-profile', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(profilePayload)
        });

        const result = await response.json();

        if (result.success) {
            showToast('success', 'Profile Submitted!');
            setTimeout(() => {
                window.location.href = '/artist/status';
            }, 1500);
        } else {
            throw new Error(result.error);
        }

    } catch (e) {
        console.error("Submission Error:", e);
        showToast('error', 'Submission failed. Please try again.');
        btn.disabled = false;
        btn.innerText = "Launch Studio";
    }
}



// --- NEW FUNCTION: LIVE VALIDATION ---
function setupHandleValidation() {
    const handleInput = document.querySelector('input[name="handle"]');
    const wrapper = handleInput.closest('.handle-wrapper');
    const icon = wrapper.querySelector('.validation-icon');
    let debounceTimer;

    handleInput.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        
        // 1. Reset State on typing
        wrapper.classList.remove('success', 'error');
        icon.className = 'validation-icon'; // Reset icon classes
        icon.innerHTML = ''; 

        // Clear previous timer (Debounce)
        clearTimeout(debounceTimer);

        // If empty, do nothing
        if (value.length < 3) return;

        // Visual: Show Loading Spinner immediately
        wrapper.classList.add('loading');
        icon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        // 2. Wait 500ms then check API
        debounceTimer = setTimeout(async () => {
            try {
                // Strip @ if user typed it, we re-add it in the backend query
                const cleanHandle = value.replace('@', '');
                
                const res = await fetch(`/artist/api/check-handle/${cleanHandle}`);
                const data = await res.json();

                wrapper.classList.remove('loading');

                if (data.available) {
                    // SUCCESS: Green
                    wrapper.classList.add('success');
                    icon.innerHTML = '<i class="fas fa-check-circle"></i>';
                } else {
                    // ERROR: Red
                    wrapper.classList.add('error');
                    icon.innerHTML = '<i class="fas fa-times-circle"></i>';
                    showToast('error', `Sorry, @${cleanHandle} is already claimed.`);
                }
            } catch (err) {
                console.error(err);
                wrapper.classList.remove('loading');
            }
        }, 500); // 500ms delay
    });
}

// ==========================================
// 5. UTILITIES (Toasts & Errors)
// ==========================================
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

function setInputError(inputName, message) {
    const input = document.querySelector(`[name="${inputName}"]`);
    if (!input) return;
    
    const group = input.closest('.input-group');
    group.classList.add('error');
    
    let errorMsg = group.querySelector('.error-message');
    if (!errorMsg) {
        errorMsg = document.createElement('div');
        errorMsg.className = 'error-message';
        group.appendChild(errorMsg);
    }
    errorMsg.innerText = message;
    
    input.addEventListener('input', () => group.classList.remove('error'), { once: true });
}

// Inject shake animation
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  @keyframes shake { 0% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } 100% { transform: translateX(0); } }
  .shake-error { animation: shake 0.4s ease-in-out; border-color: #e74c3c !important; }
`;
document.head.appendChild(styleSheet);