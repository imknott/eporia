/* public/javascripts/artistSignup.js */
import { GENRES } from '/javascripts/taxonomy.js';
import { auth } from './firebase-config.js';

let currentStep = 1;
const totalSteps = 4;

// [CRITICAL] Stores files locally until final submit
let pendingUploads = {
    avatar: null,
    banner: null
};

// Tracks if files were already uploaded (for edit mode)
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
    // Hide current
    document.getElementById(`step${currentStep}`).classList.add('hidden');
    document.querySelector(`.step[data-step="${currentStep}"]`).classList.remove('active');
    
    // Show new
    currentStep = newStep;
    document.getElementById(`step${currentStep}`).classList.remove('hidden');
    document.querySelector(`.step[data-step="${currentStep}"]`).classList.add('active');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateButtons();
}

function updateButtons() {
    // We target the buttons inside the CURRENT active step
    // This assumes you have .btn-back and .btn-next inside each step's PUG block
    // If buttons are global (outside the steps), this logic works for them too.
}

function validateStep(step) {
    if (step === 1) {
        const name = document.querySelector('input[name="artistName"]').value;
        const handle = document.querySelector('input[name="handle"]').value;
        const wrapper = document.querySelector('.handle-wrapper');
        
        if (!name.trim()) {
            setInputError('artistName', 'Artist Name is required');
            return false;
        }
        if (!handle.trim()) {
            showToast('error', 'Handle is required.');
            return false;
        }
        if (wrapper.classList.contains('error')) {
            showToast('error', 'Please choose an available handle.');
            return false;
        }
    }
    if (step === 2) {
        // [FIX] Check if we have a pending file OR a previously uploaded URL
        if (!pendingUploads.avatar && !uploadedAssets.avatar) {
            showToast('error', 'Please upload a profile picture.');
            return false;
        }
    }
    if (step === 3) {
        const genre = document.getElementById('primaryGenre').value;
        if (!genre) {
            showToast('error', 'Please select a primary genre.');
            return false;
        }
    }
    return true;
}

function captureStepData(step) {
    if (step === 1) {
        const locInput = document.querySelector('input[name="location"]');
        profilePayload.identity = {
            artistName: document.querySelector('input[name="artistName"]').value,
            handle: document.querySelector('input[name="handle"]').value,
            bio: document.querySelector('textarea[name="bio"]').value,
            location: locInput.value,
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
        profilePayload.music.primaryGenre = document.getElementById('primaryGenre').value;
        
        // Chips
        const selectedChips = Array.from(document.querySelectorAll('.chip.selected'))
                                   .map(el => el.innerText.replace('#', '').trim().toLowerCase());
        profilePayload.music.subgenres = selectedChips;

        // Moods
        const selectedMoods = Array.from(document.querySelectorAll('input[name="moodIds"]:checked'))
                                   .map(el => el.value);
        profilePayload.music.moods = selectedMoods;
    }
}

// ==========================================
// 2. IMAGE CROPPER (Offline-First)
// ==========================================

// A. Trigger the hidden file input
window.triggerUpload = function(type) {
    currentCropType = type; // 'avatar' or 'banner'
    document.getElementById('artistFileInput').click();
};

// B. Listen for file selection
function setupCropListeners() {
    const fileInput = document.getElementById('artistFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    if (imageElement) {
                        imageElement.src = ev.target.result;
                        openCropModal();
                    }
                };
                reader.readAsDataURL(file);
            }
            e.target.value = ''; // Reset
        });
    }
}

// C. Open Modal
function openCropModal() {
    modal.classList.add('active');
    modal.style.display = 'flex';

    if (cropper) cropper.destroy();

    // 1:1 for Avatar, 3:1 for Banner
    const aspectRatio = (currentCropType === 'avatar') ? 1 : 3;

    cropper = new Cropper(imageElement, {
        aspectRatio: aspectRatio,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.8,
        background: false
    });
}

// D. Save Locally & Preview
window.saveCrop = function() {
    if (!cropper) return;

    const width = currentCropType === 'avatar' ? 400 : 1500;
    const height = currentCropType === 'avatar' ? 400 : 500;

    const canvas = cropper.getCroppedCanvas({
        width: width, height: height,
        fillColor: '#fff',
        imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    });

    canvas.toBlob((blob) => {
        // 1. Store File for later
        const fileName = `${currentCropType}.jpg`;
        const file = new File([blob], fileName, { type: 'image/jpeg' });
        pendingUploads[currentCropType] = file;

        // 2. Update UI Preview
        const previewId = currentCropType === 'avatar' ? 'avatarPreview' : 'bannerPreview';
        const imgEl = document.getElementById(previewId);
        if (imgEl) imgEl.src = URL.createObjectURL(blob);

        // 3. Update Text Hint
        const blockClass = currentCropType === 'avatar' ? '.avatar-upload-block' : '.banner-upload-block';
        const statusText = document.querySelector(`${blockClass} .upload-hint`);
        if(statusText) {
            statusText.innerHTML = `<i class="fas fa-check"></i> Ready to upload`;
            statusText.style.color = '#88C9A1';
        }

        cancelCrop();
        showToast('success', 'Image saved!');
        
    }, 'image/jpeg', 0.9);
};

window.cancelCrop = function() {
    modal.classList.remove('active');
    modal.style.display = 'none';
    if (cropper) cropper.destroy();
    cropper = null;
};

// ==========================================
// 3. TAXONOMY LOGIC
// ==========================================
window.renderSubgenres = function() {
    const select = document.getElementById('primaryGenre');
    const genreKey = select.value.toUpperCase(); 
    
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

// ==========================================
// 4. FINAL SUBMISSION
// ==========================================
async function submitFinalProfile() {
    // 1. Legal Check
    const legalCheck = document.getElementById('legalCheck');
    const legalBox = document.querySelector('.legal-box');
    if (legalCheck && !legalCheck.checked) {
        if(legalBox) legalBox.classList.add('shake-error');
        showToast('error', 'You must agree to the Terms.');
        setTimeout(() => legalBox?.classList.remove('shake-error'), 400);
        return; 
    }

    // 2. Goals
    const selectedGoals = Array.from(document.querySelectorAll('input[name="goals"]:checked')).map(el => el.value);
    profilePayload.goals = selectedGoals;
    profilePayload.legalAgreedAt = new Date().toISOString();

    const btn = document.querySelector('.btn-submit-final');
    if(btn) {
        btn.innerText = "Creating Profile...";
        btn.disabled = true;
    }

    // 3. Build FormData
    const formData = new FormData();
    formData.append('data', JSON.stringify(profilePayload)); // All text data
    
    if (pendingUploads.avatar) formData.append('avatar', pendingUploads.avatar);
    if (pendingUploads.banner) formData.append('banner', pendingUploads.banner);

    try {
        const response = await fetch('/artist/api/register', {
            method: 'POST',
            body: formData // Browser sets Content-Type to multipart/form-data
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.error || "Registration failed");

        if (result.success) {
            showToast('success', 'Profile Created! Redirecting...');
            setTimeout(() => {
                window.location.href = `/artist/studio?id=${result.artistId}`;
            }, 1500);
        }

    } catch (e) {
        console.error("Submission Error:", e);
        showToast('error', e.message);
        if(btn) {
            btn.disabled = false;
            btn.innerText = "Finish & Launch";
        }
    }
}

// ==========================================
// 5. UTILITIES & INITIALIZERS
// ==========================================

function setupHandleValidation() {
    const handleInput = document.querySelector('input[name="handle"]');
    if (!handleInput) return;
    
    const wrapper = handleInput.closest('.handle-wrapper');
    const icon = wrapper.querySelector('.validation-icon');
    let debounceTimer;

    handleInput.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        wrapper.classList.remove('success', 'error');
        if(icon) icon.innerHTML = ''; 
        clearTimeout(debounceTimer);

        if (value.length < 3) return;

        wrapper.classList.add('loading');
        if(icon) icon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        debounceTimer = setTimeout(async () => {
            try {
                const cleanHandle = value.replace('@', '');
                const res = await fetch(`/artist/api/check-handle/${cleanHandle}`);
                const data = await res.json();

                wrapper.classList.remove('loading');

                if (data.available) {
                    wrapper.classList.add('success');
                    if(icon) icon.innerHTML = '<i class="fas fa-check-circle"></i>';
                } else {
                    wrapper.classList.add('error');
                    if(icon) icon.innerHTML = '<i class="fas fa-times-circle"></i>';
                    showToast('error', `Sorry, @${cleanHandle} is taken.`);
                }
            } catch (err) {
                console.error(err);
                wrapper.classList.remove('loading');
            }
        }, 500);
    });
}

function setupLocationAutocomplete() {
    // (Same logic as provided in your snippet - Photon API)
    // ... [Include your existing setupLocationAutocomplete function here] ...
    // For brevity, I'm assuming you have this block. If you need it again, let me know.
    const input = document.querySelector('input[name="location"]');
    if(!input) return;
    
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
            } catch (err) { console.error(err); }
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
        const city = props.city || props.town || props.name;
        const state = props.state || props.county;
        const country = props.country;
        if (!city || !country) return;
        
        const str = [city, state, country].filter(Boolean).join(', ');
        if(uniqueLocs.has(str)) return;
        uniqueLocs.add(str);

        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `<i class="fas fa-map-marker-alt"></i> <span>${str}</span>`;
        item.onclick = () => {
            input.value = str;
            input.dataset.lat = f.geometry.coordinates[1];
            input.dataset.lng = f.geometry.coordinates[0];
            input.dataset.city = city;
            input.dataset.state = state || "";
            input.dataset.country = country;
            dropdown.classList.remove('active');
        };
        dropdown.appendChild(item);
    });
    if(dropdown.children.length > 0) dropdown.classList.add('active');
}

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