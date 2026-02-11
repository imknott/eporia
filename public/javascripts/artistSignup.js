/* public/javascripts/artistSignup.js */
import { GENRES } from '/javascripts/taxonomy.js';

// --- STATE ---
let currentStep = 1;
const totalSteps = 4; // Identity -> Verification -> Sound -> Review

const legalState = {
    terms: false,
    privacy: false,
    cookie: false,
    agreement: false
};

// Data Collection
let profilePayload = {
    identity: {},
    verification: {},
    music: { features: {} },
    goals: [],
    status: 'pending_review', // Key flag for review system
    reviewApproved: false
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupHandleValidation();
    setupLocationAutocomplete();
    setupGenreSystem();
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
    }
};

window.prevStep = function() {
    if (currentStep > 1) changeStep(currentStep - 1);
};

function changeStep(newStep) {
    // Hide current
    const currentEl = document.getElementById(`step${currentStep}`);
    if (currentEl) currentEl.classList.add('hidden');
    
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    
    // Show new
    currentStep = newStep;
    const newEl = document.getElementById(`step${currentStep}`);
    if (newEl) newEl.classList.remove('hidden');
    
    // Update Indicators
    for (let i = 1; i <= newStep; i++) {
        const ind = document.querySelector(`.step[data-step="${i}"]`);
        if (ind) ind.classList.add('active');
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateStep(step) {
    // STEP 1: IDENTITY
    if (step === 1) {
        const name = document.querySelector('input[name="artistName"]').value;
        const handle = document.querySelector('input[name="handle"]').value;
        const bio = document.querySelector('textarea[name="bio"]').value;
        const wrapper = document.querySelector('.handle-wrapper');
        
        if (!name.trim()) { showToast('error', 'Artist Name is required'); return false; }
        if (!handle.trim()) { showToast('error', 'Handle is required'); return false; }
        if (!bio.trim()) { showToast('error', 'Bio is required'); return false; }
        if (wrapper.classList.contains('error')) { showToast('error', 'Handle is taken'); return false; }
    }
    
    // STEP 2: VERIFICATION
    if (step === 2) {
        const email = document.querySelector('input[name="contactEmail"]').value;
        const contactMethod = document.querySelector('select[name="contactMethod"]').value;
        const isGroup = document.querySelector('input[name="artistType"]:checked')?.value === 'group';
        
        if (!email.trim() || !email.includes('@')) {
            showToast('error', 'Valid contact email is required');
            return false;
        }
        
        if (!contactMethod) {
            showToast('error', 'Please select a preferred verification method');
            return false;
        }
        
        // Check if at least ONE music platform link is provided
        const spotifyLink = document.querySelector('input[name="link_spotify"]')?.value;
        const youtubeLink = document.querySelector('input[name="link_youtube"]')?.value;
        const appleLink = document.querySelector('input[name="link_apple"]')?.value;
        const otherLink = document.querySelector('input[name="link_other"]')?.value;
        
        if (!spotifyLink && !youtubeLink && !appleLink && !otherLink) {
            showToast('error', 'Please provide at least ONE music platform link for verification');
            return false;
        }
        
        // If group, validate that members are filled
        if (isGroup) {
            const memberInputs = Array.from(document.querySelectorAll('input[name="members[]"]'));
            const validMembers = memberInputs.filter(inp => inp.value.trim()).length;
            if (validMembers < 2) {
                showToast('error', 'Groups must list at least 2 band members');
                return false;
            }
        }
    }

    // STEP 3: SOUND
    if (step === 3) {
        const genre = document.getElementById('primaryGenre').value;
        if (!genre) { showToast('error', 'Please select a primary genre'); return false; }
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
    else if (step === 2) {
        // Verification Data
        const isGroup = document.querySelector('input[name="artistType"]:checked')?.value === 'group';
        let members = [];
        if (isGroup) {
            document.querySelectorAll('input[name="members[]"]').forEach(inp => {
                if(inp.value.trim()) members.push(inp.value.trim());
            });
        }

        const links = {
            spotify: document.querySelector('input[name="link_spotify"]')?.value || null,
            youtube: document.querySelector('input[name="link_youtube"]')?.value || null,
            apple: document.querySelector('input[name="link_apple"]')?.value || null,
            other: document.querySelector('input[name="link_other"]')?.value || null,
            instagram: document.querySelector('input[name="link_instagram"]')?.value || null,
            tiktok: document.querySelector('input[name="link_tiktok"]')?.value || null
        };

        profilePayload.verification = {
            contactEmail: document.querySelector('input[name="contactEmail"]').value,
            contactMethod: document.querySelector('select[name="contactMethod"]').value,
            artistType: isGroup ? 'group' : 'solo',
            members: members,
            links: links,
            isrc: document.querySelector('input[name="verification_isrc"]')?.value || null
        };
        
        // Also merge into identity for compatibility
        Object.assign(profilePayload.identity, {
            artistType: isGroup ? 'group' : 'solo',
            members: members,
            links: links,
            isrc: document.querySelector('input[name="verification_isrc"]')?.value || null
        });
    }
    else if (step === 3) {
        profilePayload.music.primaryGenre = document.getElementById('primaryGenre').value;
        profilePayload.music.subgenres = Array.from(document.querySelectorAll('.chip.selected'))
                                   .map(el => el.innerText.replace('#', '').trim().toLowerCase());
        profilePayload.music.moods = Array.from(document.querySelectorAll('input[name="moodIds"]:checked'))
                                   .map(el => el.value);
    }
}

// ==========================================
// 2. APPLICATION SUBMISSION
// ==========================================
window.submitApplication = async function() {
    // 1. Validate Legal Agreements
    if (!legalState.terms || !legalState.privacy || !legalState.cookie || !legalState.agreement) {
        const legalBox = document.querySelector('.legal-consent-container');
        if(legalBox) legalBox.classList.add('shake-error');
        showToast('error', 'You must read and accept all 4 agreements.');
        setTimeout(() => legalBox?.classList.remove('shake-error'), 400);
        return; 
    }

    // 2. Capture Final Step Data
    const selectedGoals = Array.from(document.querySelectorAll('input[name="goals"]:checked')).map(el => el.value);
    profilePayload.goals = selectedGoals;
    profilePayload.legalAgreedAt = new Date().toISOString();

    // 3. Build Final Payload
   const finalPayload = {
        identity: profilePayload.identity,         // Pass as object
        verification: profilePayload.verification, // Pass as object
        music: profilePayload.music,
        goals: profilePayload.goals,
        status: 'pending_review',
        legalAgreedAt: profilePayload.legalAgreedAt
    };

    console.log('📦 Submitting Application:', finalPayload);

    try {
        const res = await fetch('/artist/api/create-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload)
        });

        const result = await res.json();

        if (res.ok && result.success) {
            showToast('success', 'Application submitted successfully!');
            setTimeout(() => {
                document.getElementById('step4').classList.add('hidden');
                document.getElementById('stepSuccess').classList.remove('hidden');
            }, 800);
        } else {
            throw new Error(result.message || 'Submission failed');
        }
    } catch (err) {
        console.error('❌ Submission Error:', err);
        showToast('error', err.message || 'Something went wrong. Please try again.');
    }
};

// ==========================================
// 3. BACKGROUND ANIMATION - MATRIX STYLE
// ==========================================
function initBackgroundAnimation() {
    const container = document.getElementById('animBg'); 
    if (!container) return;
    
    const tags = [];
    
    // Collect all genre tags
    if (GENRES) {
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
        tags.push('#Music', '#Live', '#Vibes', '#Indie', '#Eporia', '#Electronic', '#Beats', '#Sound', '#Artist', '#Creator');
    }

    // Matrix-style falling text
    const columns = Math.floor(window.innerWidth / 80); // Number of columns based on screen width
    const activeColumns = new Set();
    
    function createFallingText() {
        // Randomly select a column that's not currently active
        let column;
        let attempts = 0;
        do {
            column = Math.floor(Math.random() * columns);
            attempts++;
        } while (activeColumns.has(column) && attempts < 10);
        
        if (activeColumns.has(column)) return; // Skip if column is busy
        
        activeColumns.add(column);
        
        const el = document.createElement('div');
        el.className = 'matrix-text';
        el.innerText = tags[Math.floor(Math.random() * tags.length)];
        
        // Position in column
        const leftPos = (column * 80) + Math.random() * 60;
        el.style.left = leftPos + 'px';
        
        // Random font size
        const fontSize = Math.random() * 1.2 + 0.8;
        el.style.fontSize = fontSize + 'rem';
        
        // Random duration (speed)
        const duration = Math.random() * 8 + 6; // 6-14 seconds
        el.style.animationDuration = duration + 's';
        
        // Random color variations
        const colorVariations = [
            'rgba(0, 255, 209, 0.8)',   // Primary cyan
            'rgba(0, 255, 209, 0.6)',   // Dimmer cyan
            'rgba(255, 0, 255, 0.7)',   // Magenta
            'rgba(0, 200, 255, 0.7)',   // Blue
            'rgba(0, 255, 150, 0.6)'    // Green-cyan
        ];
        el.style.color = colorVariations[Math.floor(Math.random() * colorVariations.length)];
        
        container.appendChild(el);
        
        // Remove element and free column after animation
        setTimeout(() => {
            el.remove();
            activeColumns.delete(column);
        }, duration * 1000);
    }
    
    // Create initial wave
    for (let i = 0; i < Math.min(columns, 15); i++) {
        setTimeout(() => createFallingText(), Math.random() * 2000);
    }
    
    // Continuous creation
    setInterval(() => {
        if (Math.random() > 0.3) { // 70% chance each interval
            createFallingText();
        }
    }, 600); // Create new text every 600ms
}

// ==========================================
// 4. GENRE SYSTEM
// ==========================================
function setupGenreSystem() {
    const select = document.getElementById('primaryGenre');
    if (!select || !GENRES) return;
    
    Object.keys(GENRES).forEach(key => {
        const genre = GENRES[key];
        const option = document.createElement('option');
        option.value = key;
        option.innerText = genre.name;
        select.appendChild(option);
    });
    
    select.addEventListener('change', (e) => {
        const selectedKey = e.target.value;
        const genre = GENRES[selectedKey];
        
        const container = document.getElementById('subgenreContainer');
        const chipsDiv = document.getElementById('subgenreChips');
        
        chipsDiv.innerHTML = '';
        
        if (genre.subgenres && genre.subgenres.length > 0) {
            container.style.display = 'flex';
            genre.subgenres.forEach(sub => {
                const chip = document.createElement('div');
                chip.className = 'chip';
                chip.innerText = `#${typeof sub === 'string' ? sub : sub.name}`;
                chip.onclick = () => chip.classList.toggle('selected');
                chipsDiv.appendChild(chip);
            });
        } else {
            container.style.display = 'none';
        }
    });
}

// ==========================================
// 5. LEGAL MODAL SYSTEM
// ==========================================
window.openModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    const iframe = modal.querySelector('iframe.legal-frame');
    if (iframe && !iframe.src) {
        iframe.src = iframe.dataset.src;
    }
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
};

window.acceptLegal = function(type) {
    legalState[type] = true;
    
    const item = document.getElementById(`item-${type}`);
    if (item) {
        const icon = item.querySelector('.status-icon');
        if (icon) {
            icon.classList.remove('far', 'fa-circle');
            icon.classList.add('fas', 'fa-check-circle');
            icon.style.color = 'var(--primary)';
        }
        item.style.background = 'rgba(136, 201, 161, 0.15)';
        item.style.borderColor = 'var(--primary)';
    }
    
    // Close modal
    document.querySelectorAll('.modal-overlay').forEach(m => {
        m.classList.remove('active');
    });
    document.body.style.overflow = '';
    
    // Check if all are accepted
    if (legalState.terms && legalState.privacy && legalState.cookie && legalState.agreement) {
        const mainLabel = document.getElementById('mainLegalLabel');
        const checkbox = document.getElementById('legalCheck');
        const submitBtn = document.getElementById('btnSubmitFinal');
        
        if (mainLabel) {
            mainLabel.style.opacity = '1';
            mainLabel.style.pointerEvents = 'auto';
        }
        if (checkbox) {
            checkbox.disabled = false;
            checkbox.checked = true;
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
        }
    }
};

// Close modals on background click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
        document.body.style.overflow = '';
    }
});

// ==========================================
// 6. BAND MEMBERS TOGGLE
// ==========================================
window.toggleBandMembers = function(show) {
    const section = document.getElementById('bandMembersSection');
    if (section) {
        section.style.display = show ? 'block' : 'none';
    }
};

window.addMemberInput = function() {
    const list = document.getElementById('membersList');
    if (!list) return;
    
    const currentCount = list.querySelectorAll('input').length;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'members[]';
    input.placeholder = `Member ${currentCount + 1} Full Legal Name`;
    list.appendChild(input);
};

// ==========================================
// 7. UTILITIES
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
                    showToast('error', 'Handle taken');
                }
            } catch (err) {
                console.error(err);
                wrapper.classList.remove('loading');
            }
        }, 500);
    });
}

function setupLocationAutocomplete() {
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
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            dropdown.classList.remove('active');
        }
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
            // FIXED: Hide dropdown after selection
            dropdown.classList.remove('active');
            dropdown.innerHTML = '';
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

// Inject shake animation
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  @keyframes shake { 0% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } 100% { transform: translateX(0); } }
  .shake-error { animation: shake 0.4s ease-in-out; border-color: #e74c3c !important; }
`;
document.head.appendChild(styleSheet);