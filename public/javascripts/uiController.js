/* public/javascripts/uiController.js */
import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { CitySoundscapeMap } from './citySoundscapeMap.js';

const auth = getAuth();
window.globalUserCache = null;

// ==========================================
// 2. UI CONTROLLER (The Pulse)
// ==========================================
export class PlayerUIController {
    constructor(engine) {
        window.ui = this;
        this.engine = engine;
        this.isMinimized = true; 
        this.togglePlayerSize = this.togglePlayerSize.bind(this);
        // State for tipping
        this.currentTipArtistId = null;
        this.currentWalletBalance = 0.00;
        // Expose new functions globally
        window.ui.openTipModal = this.openTipModal.bind(this);
        window.ui.closeTipModal = this.closeTipModal.bind(this);
        window.ui.selectTipAmount = this.selectTipAmount.bind(this);
        window.ui.validateTipInput = this.validateTipInput.bind(this);
        window.ui.submitTip = this.submitTip.bind(this);
        window.ui.updateAllocationRemaining = this.updateAllocationRemaining.bind(this);
        window.ui.commitAllocation = this.commitAllocation.bind(this);
        window.ui.tipCurrentArtist = this.tipCurrentArtist.bind(this);

        // Enhanced Event Listeners
        this.setupEnhancedAudioListeners();
        
        this.init();
    }

    init() {
        this.initAuthListener();
        
        this.exposeGlobalFunctions();
        this.setupOmniSearch();
        this.setupViewObserver();
        this.updateSidebarState();
        this.setupSeekbar(); 
        this.setupKeyboardShortcuts(); // NEW: Audio shortcuts
        
        // Initialize City Soundscape Map
        this.initCityMap();

        document.addEventListener('input', (e) => {
            if (e.target.matches('.eq-slider')) window.updateEQ();
        });

        document.addEventListener('click', (e) => {
            const menu = document.getElementById('profileDropdown');
            const trigger = document.querySelector('.profile-trigger'); 
            if (menu && menu.classList.contains('active')) {
                if (!menu.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
                    menu.classList.remove('active');
                }
            }
        });
    }

    // ==========================================
    // ENHANCED AUDIO EVENT LISTENERS
    // ==========================================
    setupEnhancedAudioListeners() {
        // Core playback events
        this.engine.on('stateChange', (data) => {
            this.updatePlayPauseIcons(data.isPlaying);
            this.updatePlayerUI(data.track);
            if (data.isPlaying && this.isMinimized) this.togglePlayerSize();
        });

        this.engine.on('progress', (data) => this.updateProgressBar(data));

        // NEW: Buffering indicators
        this.engine.on('bufferStart', (data) => {
            this.showBuffering(true);
            // console.log(`⏳ Loading: ${data.track?.title || 'track'}`);
        });

        this.engine.on('bufferEnd', (data) => {
            this.showBuffering(false);
            // console.log(`✅ Ready: ${data.track?.title || 'track'}`);
        });

        // NEW: Preload feedback
        this.engine.on('preloadComplete', (data) => {
            this.markTrackAsPreloaded(data.track.id);
            // console.log(`📦 Preloaded: ${data.track.title}`);
        });

        // NEW: Track endings
        this.engine.on('trackEnd', (data) => {
            this.onTrackEnd(data.track);
        });

        // NEW: Error handling
        this.engine.on('error', (data) => {
            this.showToast(`Error playing ${data.track?.title || 'track'}`, 'error');
            console.error('Playback error:', data.error);
        });

        // NEW: Queue updates with enhanced UI
        this.engine.on('queueUpdate', (queue) => {
            this.updateQueueUI(queue);
            this.updateQueueCount(queue.length);
        });
    }

    fixImageUrl(url) {
    if (!url) return 'https://via.placeholder.com/150';
    
    // Use environment variable for R2 URL (set by server-side rendering)
    const R2_PUBLIC_URL = window.R2_PUBLIC_URL || "https://pub-8159c20ed1b2482da0517a72d585b498.r2.dev";
    
    // If we see the bad domain, swap it
    if (url.includes('cdn.eporiamusic.com')) {
        return url.replace('https://cdn.eporiamusic.com', R2_PUBLIC_URL);
    }
    return url;
}
    // ==========================================
    // A. SETTINGS & SAVE LOGIC (Rebuilt)
    // ==========================================
    
    // 1. UPDATE LOCAL (Live Audio / UI changes)
    updateGlobalSetting(key, value) {
        if (!window.globalUserCache) window.globalUserCache = {};
        if (!window.globalUserCache.settings) window.globalUserCache.settings = {};
        
        // Update Cache
        window.globalUserCache.settings[key] = value;

        // Update Audio Engine Immediately (The "Live" feel)
        this.engine.updateSettings(window.globalUserCache.settings);
        
        // ADDED: Special handling for theme changes
        if (key === 'theme') {
            this.applyGenreTheme(value);
            this.showToast(`Theme changed to ${value}`, 'success');
        }
        
        // Visual feedback for unsaved changes
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
            saveBtn.style.opacity = "1";
        }
        
        // ADDED: Debounced autosave - save 1 second after last change
        clearTimeout(this.settingsSaveTimeout);
        this.settingsSaveTimeout = setTimeout(() => {
            this.saveSettings();
        }, 1000);
    }

    // 2. SAVE TO DB (Manual Trigger)
    async saveSettings() {
        const btn = document.getElementById('saveSettingsBtn');
        if (btn) {
            btn.innerText = "Saving...";
            btn.disabled = true;
        }

        try {
            const token = await auth.currentUser.getIdToken();
            await fetch('/player/api/settings/save', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(window.globalUserCache.settings)
            });
            
            if (btn) {
                btn.innerText = "Saved!";
                setTimeout(() => {
                    btn.innerText = "Save Changes";
                    // Optionally disable again until next change
                }, 2000);
            }
            this.showToast("Settings saved.");
        } catch (e) {
            console.error("Save Error:", e);
            this.showToast("Failed to save settings.");
            if (btn) btn.disabled = false;
        }
    }

    // 3. SAVE PROFILE DATA (Manual Trigger)
    async saveProfileChanges() {
        const btn = document.getElementById('saveProfileBtn');
        if(btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        const handle = document.getElementById('editHandle')?.value;
        const bio = document.getElementById('editBio')?.value;
        const location = document.getElementById('editLocation')?.value;

        try {
            const token = await auth.currentUser.getIdToken();
            await fetch('/player/api/profile/update', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ handle, bio, location })
            });
            
            this.showToast("Profile updated.");
            
            if(window.globalUserCache && handle) {
                window.globalUserCache.handle = handle;
                window.globalUserCache.bio = bio; // Add this
                window.globalUserCache.location = location; // Add this
                
                // Refresh the UI without a reload
                this.updateProfileUI(window.globalUserCache); 

                const sidebarName = document.getElementById('profileName');
                if(sidebarName) sidebarName.innerText = handle;
            }

        } catch (e) {
            console.error(e);
            this.showToast("Update failed.");
        } finally {
            if(btn) btn.innerText = "Save Profile";
        }
    }

    async loadSettingsPage(container) {
        container.dataset.hydrated = "true";
        const emailEl = document.getElementById('settingsEmail');
        if (emailEl && auth.currentUser.email) emailEl.innerText = auth.currentUser.email;

        // Attach Save Listener
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveSettings();
        }

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/settings', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            
            // Merge Cache
            if (!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache = {
                ...window.globalUserCache,
                ...data,
                settings: {
                    ...window.globalUserCache.settings,
                    ...data.settings
                }
            };
            
            const settings = window.globalUserCache.settings || {};
            
            // --- POPULATE INPUTS ---
            // This helper looks for [name="X"]
            const setVal = (name, val) => {
                const el = document.querySelector(`[name="${name}"]`);
                if (!el) {
                     console.warn(`Setting element not found: ${name}`); 
                    return;
                }
                
                if (el.type === 'checkbox') {
                    el.checked = val === true; // Ensure boolean
                } else {
                    el.value = val;
                }
            };

            // 1. Audio
            setVal('audioQuality', settings.audioQuality || 'auto');
            setVal('normalizeVolume', settings.normalizeVolume !== false); // Default true
            setVal('crossfade', settings.crossfade || 3);
            if(document.getElementById('fadeVal')) document.getElementById('fadeVal').innerText = (settings.crossfade || 3) + 's';
            
            // EQ
            if(settings.eqHigh !== undefined) setVal('eqHigh', settings.eqHigh);
            if(settings.eqMid !== undefined) setVal('eqMid', settings.eqMid);
            if(settings.eqLow !== undefined) setVal('eqLow', settings.eqLow);

            // 2. Finance (UPDATED)
            setVal('allocationMode', settings.allocationMode || 'manual'); // Default to Manual
            setVal('publicReceipts', settings.publicReceipts !== false);

            // 3. Social & Privacy
            setVal('ghostMode', settings.ghostMode === true);
            setVal('localVisibility', settings.localVisibility !== false);
            setVal('tasteMatch', settings.tasteMatch !== false);

            // 4. Account
            setVal('theme', settings.theme || 'electronic');
            
            // Trigger EQ update visually
            if (window.updateEQ) window.updateEQ();
            this.showSupportedFormats();

        } catch (e) { 
            console.error("Settings Hydration Failed", e); 
            this.showToast("Failed to load settings.");
        }
    }

   // ==========================================
// B. WALLET & FINANCE (UPDATED - NO MOCK DATA)
// ==========================================

async openTipModal(artistId, artistName) {
    if (!artistId) {
        this.showToast("Cannot tip: Artist information missing", "error");
        return;
    }

    this.currentTipArtistId = artistId;
    
    // Update UI Text
    const artistNameEl = document.getElementById('tipArtistName');
    const modal = document.getElementById('tipModal');
    const balanceEl = document.getElementById('tipWalletBalance');
    
    if (!modal || !balanceEl || !artistNameEl) {
        console.error("Tip modal elements not found");
        return;
    }
    
    artistNameEl.innerText = artistName || 'Artist';
    
    // Show loading state
    balanceEl.innerText = "...";
    modal.style.display = 'flex';
    
    // Fetch fresh balance from backend
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/player/api/wallet', { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        
        if (!res.ok) throw new Error('Failed to fetch wallet balance');
        
        const data = await res.json();
        
        this.currentWalletBalance = parseFloat(data.balance) || 0;
        balanceEl.innerText = this.currentWalletBalance.toFixed(2);
    } catch (e) {
        console.error("Wallet fetch error:", e);
        this.showToast("Error fetching balance", "error");
        balanceEl.innerText = "0.00";
        this.currentWalletBalance = 0;
    }
}

closeTipModal() {
    const modal = document.getElementById('tipModal');
    const input = document.getElementById('customTipInput');
    
    if (modal) modal.style.display = 'none';
    if (input) input.value = '';
    
    this.currentTipArtistId = null;
    
    // Reset selections
    document.querySelectorAll('.btn-tip-option').forEach(b => b.classList.remove('selected'));
}

// SELECT PRESET TIP AMOUNT
selectTipAmount(amount) {
    const input = document.getElementById('customTipInput');
    if (!input) return;
    
    // Remove active class from others
    document.querySelectorAll('.btn-tip-option').forEach(b => b.classList.remove('selected'));
    if (event && event.target) event.target.classList.add('selected');

    if (amount === 'max') {
        input.value = this.currentWalletBalance.toFixed(2);
    } else {
        input.value = amount.toFixed(2);
    }
    
    this.validateTipInput();
}

// VALIDATE TIP INPUT
validateTipInput() {
    const input = document.getElementById('customTipInput');
    const btn = document.getElementById('confirmTipBtn');
    
    if (!input || !btn) return;
    
    const val = parseFloat(input.value);

    if (isNaN(val) || val <= 0 || val > this.currentWalletBalance) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
    } else {
        btn.disabled = false;
        btn.style.opacity = "1";
    }
}

// SUBMIT TIP
async submitTip() {
    const input = document.getElementById('customTipInput');
    const btn = document.getElementById('confirmTipBtn');
    
    if (!input || !btn) return;
    
    const amount = parseFloat(input.value);

    if (!this.currentTipArtistId || isNaN(amount) || amount <= 0) {
        this.showToast("Invalid tip amount", "error");
        return;
    }

    const originalBtnText = btn.innerText;
    btn.innerText = "Sending...";
    btn.disabled = true;

    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/player/api/tip-artist', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                artistId: this.currentTipArtistId,
                amount: amount
            })
        });

        const data = await res.json();

        if (data.success) {
            this.showToast(`Successfully tipped $${amount.toFixed(2)}!`, "success");
            this.closeTipModal();
            
            // Update global cache
            if (window.globalUserCache) {
                window.globalUserCache.walletBalance = data.newBalance;
            }
            
            // Update wallet display in sidebar if present
            const walletBalanceEl = document.getElementById('userWalletBalance');
            if (walletBalanceEl && data.newBalance !== undefined) {
                walletBalanceEl.innerText = parseFloat(data.newBalance).toFixed(2);
            }
        } else {
            throw new Error(data.error || 'Failed to send tip');
        }
    } catch (e) {
        console.error("Tip submission error:", e);
        this.showToast(e.message || "Failed to send tip", "error");
    } finally {
        btn.innerText = originalBtnText;
        btn.disabled = false;
    }
}

// ==========================================
// TIP CURRENT ARTIST (Helper for Full Player Button)
// ==========================================
tipCurrentArtist() {
    // Get current track from the audio engine
    if (!this.engine || !this.engine.currentTrack) {
        this.showToast("Please play a track first", "warning");
        console.warn('[TIP] No current track in engine');
        return;
    }
    
    const track = this.engine.currentTrack;
    // console.log('[TIP] Current track:', track);
    
    // Check if artistId exists
    if (!track.artistId) {
        this.showToast("Artist information unavailable", "warning");
        console.warn('[TIP] No artistId in current track:', track);
        return;
    }
    
    // Open the tip modal with artist info
    this.openTipModal(track.artistId, track.artist);
}

// ==========================================
// WALLET PAGE INITIALIZATION (NO MOCK DATA)
// ==========================================

async initWalletPage() {
    const balanceDisplay = document.getElementById('walletBalanceDisplay');
    const allocContainer = document.getElementById('allocationContainer');
    const list = document.getElementById('transactionList');
    
    // 1. Get Real Wallet Data from Backend
    let walletData = { balance: 0, monthlyAllocation: 0, plan: 'standard' };
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/player/api/wallet', { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        
        if (!res.ok) throw new Error('Failed to fetch wallet data');
        
        walletData = await res.json();
        
        // CRITICAL: Store balance for allocation calculations
        this.currentWalletBalance = Number(walletData.balance || 0);
        
        // Update Card UI
        if (balanceDisplay) {
            balanceDisplay.innerText = this.currentWalletBalance.toFixed(2);
        }
        
        const allocDisplay = document.getElementById('walletAllocation');
        if (allocDisplay) {
            allocDisplay.innerText = `$${Number(walletData.monthlyAllocation || 0).toFixed(2)}`;
        }
        
        // Update Plan Badge
        const planBadge = document.getElementById('walletPlanBadge');
        if (planBadge) {
            const planName = walletData.plan 
                ? walletData.plan.charAt(0).toUpperCase() + walletData.plan.slice(1) 
                : 'Standard';
            planBadge.innerHTML = `<i class="fas fa-crown"></i> <span>${planName}</span>`;
        }

    } catch (e) { 
        console.error("Wallet Data Error:", e); 
        this.showToast("Error loading wallet data", "error");
    }

    // 2. Get Real Followed Artists for Allocation
    if (allocContainer) {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/profile/following/${auth.currentUser.uid}`, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            
            if (!res.ok) throw new Error('Failed to fetch following artists');
            
            const followData = await res.json();
            
            // Render the Allocation Table with real data
            this.renderAllocationUI(
                allocContainer, 
                followData.artists || [], 
                this.currentWalletBalance  // Use stored balance
            );

        } catch (e) {
            console.error("Allocation UI Error:", e);
            if (allocContainer) {
                allocContainer.innerHTML = `
                    <div style="text-align:center; padding:20px; color:var(--danger)">
                        Failed to load artists. Please try again later.
                    </div>`;
            }
        }
    }

    // 3. Fetch Real Transaction History
    if (list) {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet/transactions', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (res.ok) {
                const data = await res.json();
                this.renderTransactions(list, data.transactions || []);
            } else {
                // If endpoint doesn't exist yet, show empty state
                this.renderTransactions(list, []);
            }
        } catch (e) {
            console.error("Transaction History Error:", e);
            // Show empty state if fetch fails
            this.renderTransactions(list, []);
        }
    }
}

renderAllocationUI(container, artists, balance) {
    if (!container) return;
    
    if (artists.length === 0) {
        container.innerHTML = `
            <div class="allocation-container" style="text-align:center">
                <h3>Follow Artists to Allocate</h3>
                <p style="color:var(--text-secondary); margin-bottom:15px">
                    You need to follow artists before you can support them directly.
                </p>
                <button class="btn-alloc primary" onclick="navigateTo('/player/explore')">
                    Explore Scene
                </button>
            </div>`;
        return;
    }

    let html = `
        <div class="allocation-container">
            <div class="alloc-header">
                <div class="alloc-title-group">
                    <h3>Fair Trade Distribution</h3>
                    <div class="alloc-subtitle">Decide where 100% of your funds go.</div>
                </div>
                <div class="alloc-balance-pill" id="allocRemaining">
                    <span>Remaining:</span>
                    <span id="remainVal">$${balance.toFixed(2)}</span>
                </div>
            </div>
            
            <div class="artist-alloc-list">`;

    artists.forEach(artist => {
        html += `
            <div class="artist-alloc-row">
                <img src="${artist.img || artist.profileImage || 'https://via.placeholder.com/50'}" 
                     class="alloc-avatar" 
                     alt="${artist.name}">
                <div class="alloc-info">
                    <span class="alloc-name">${artist.name}</span>
                    <span class="alloc-role">Artist</span>
                </div>
                <div class="alloc-input-wrapper">
                    <span class="alloc-currency">$</span>
                    <input type="number" 
                           class="alloc-input" 
                           data-id="${artist.id}" 
                           placeholder="0.00" 
                           min="0" 
                           step="0.01"
                           oninput="window.ui.updateAllocationRemaining()"
                           onchange="window.ui.updateAllocationRemaining()">
                </div>
            </div>`;
    });

    html += `
            </div>
            <button id="commitAllocBtn" 
                    class="btn-alloc" 
                    disabled
                    onclick="window.ui.commitAllocation()">
                <i class="fas fa-lock"></i> Commit Allocation
            </button>
        </div>`;

    container.innerHTML = html;
    
    // CRITICAL: Store the balance for calculations
    this.currentWalletBalance = balance;
    
    // console.log('[ALLOCATION] Rendered UI with balance:', balance);
    // console.log('[ALLOCATION] Artists:', artists.length);
}

// Update remaining balance as user allocates
updateAllocationRemaining() {
    const inputs = document.querySelectorAll('.alloc-input');
    const remainingEl = document.getElementById('remainVal');
    const commitBtn = document.getElementById('commitAllocBtn');
    
    /* console.log('[ALLOCATION] Updating remaining...', {
        inputs: inputs.length,
        hasRemainingEl: !!remainingEl,
        hasButton: !!commitBtn
    });*/
    
    if (!remainingEl) return;
    
    let total = 0;
    inputs.forEach(input => {
        const val = parseFloat(input.value) || 0;
        total += val;
    });
    
    const balance = this.currentWalletBalance || 0;
    const remaining = balance - total;
    
    /* console.log('[ALLOCATION] Calculation:', {
        total,
        balance,
        remaining
    });*/
    
    remainingEl.innerText = `$${remaining.toFixed(2)}`;
    
    // Enable/disable commit button
    if (commitBtn) {
        if (total > 0 && remaining >= 0) {
            commitBtn.disabled = false;
            commitBtn.style.opacity = '1';
            // console.log('[ALLOCATION] Button ENABLED');
        } else {
            commitBtn.disabled = true;
            commitBtn.style.opacity = '0.5';
            // console.log('[ALLOCATION] Button disabled', { total, remaining });
        }
    }
    
    // Visual feedback if over budget
    if (remaining < 0) {
        remainingEl.style.color = 'var(--danger)';
    } else {
        remainingEl.style.color = 'var(--text-main)';
    }
}

// Commit allocation
async commitAllocation() {
    const inputs = document.querySelectorAll('.alloc-input');
    const allocations = [];
    
    inputs.forEach(input => {
        const amount = parseFloat(input.value) || 0;
        if (amount > 0) {
            allocations.push({
                artistId: input.dataset.id,
                amount: amount
            });
        }
    });
    
    if (allocations.length === 0) {
        this.showToast("Please allocate funds to at least one artist", "warning");
        return;
    }
    
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/player/api/wallet/allocate', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ allocations })
        });
        
        const data = await res.json();
        
        if (data.success) {
            this.showToast("Allocation committed successfully!", "success");
            // Refresh wallet page
            this.initWalletPage();
        } else {
            throw new Error(data.error || 'Failed to commit allocation');
        }
    } catch (e) {
        console.error("Allocation Error:", e);
        this.showToast(e.message || "Failed to commit allocation", "error");
    }
}

renderTransactions(container, transactions) {
    if (!container) return;
    
    if (!transactions || transactions.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px; color:var(--text-secondary)">
                <i class="fas fa-receipt" style="font-size:2rem; margin-bottom:10px; opacity:0.5"></i>
                <p>No transactions yet</p>
            </div>`;
        return;
    }
    
    let html = '';
    transactions.forEach(tx => {
        const isIncoming = tx.type === 'in' || tx.type === 'credit';
        const icon = isIncoming ? 'fa-arrow-down' : 'fa-arrow-up';
        const iconColor = isIncoming ? 'var(--success)' : 'var(--text-secondary)';
        
        html += `
            <div class="transaction-row">
                <div class="tx-icon" style="color: ${iconColor}">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="tx-info">
                    <div class="tx-title">${tx.title || tx.description || 'Transaction'}</div>
                    <div class="tx-date">${tx.date || new Date(tx.timestamp).toLocaleDateString()}</div>
                </div>
                <div class="tx-amount ${isIncoming ? 'positive' : 'negative'}">
                    ${isIncoming ? '+' : '-'}$${Math.abs(tx.amount).toFixed(2)}
                </div>
            </div>`;
    });
    
    container.innerHTML = html;
}

    // ==========================================
// PROFILE PAGE LOADER
// ==========================================

toggleProfileEditMode() {
        // Get elements
        const editBtn = document.getElementById('editBtn');
        const saveControls = document.getElementById('saveControls');
        
        // Check if we are currently editing (Edit button is hidden)
        const isCurrentlyEditing = editBtn && editBtn.style.display === 'none';
        
        // Toggle Buttons
        if (editBtn) editBtn.style.display = isCurrentlyEditing ? 'inline-flex' : 'none';
        if (saveControls) saveControls.style.display = isCurrentlyEditing ? 'none' : 'flex';
        
        // Toggle Bio (Text vs Input)
        const bioText = document.getElementById('profileBio');
        const bioInput = document.getElementById('bioInput');
        
        if (bioText && bioInput) {
            if (isCurrentlyEditing) {
                // EXIT Edit Mode
                bioText.style.display = 'block';
                bioInput.style.display = 'none';
            } else {
                // ENTER Edit Mode
                const currentText = bioText.textContent.trim();
                bioInput.value = currentText === 'No bio yet.' ? '' : currentText;
                
                bioText.style.display = 'none';
                bioInput.style.display = 'block';
                bioInput.disabled = false;
                setTimeout(() => bioInput.focus(), 50);
            }
        }
        
        // Toggle Camera Icons
        const cams = ['coverEditBtn', 'avatarEditBtn', 'anthemEditBtn'];
        cams.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.style.display = isCurrentlyEditing ? 'none' : 'inline-flex';
        });
    }

    async saveProfileChanges() {
        const saveBtn = document.getElementById('saveProfileBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        try {
            const bioInput = document.getElementById('bioInput');
            const payload = { bio: bioInput ? bioInput.value.trim() : '' };

            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/profile/update', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error("Update failed");

            // Optimistic Update
            const bioText = document.getElementById('profileBio');
            if (bioText) bioText.textContent = payload.bio || "No bio yet.";
            
            if (window.globalUserCache) window.globalUserCache.bio = payload.bio;

            this.showToast("Profile saved!", "success");
            this.toggleProfileEditMode();

        } catch (e) {
            console.error("Save Error:", e);
            this.showToast("Could not save profile.", "error");
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-check"></i> <span>Save Changes</span>';
            }
        }
    }


async loadProfilePage() {
    const contentScroll = document.querySelector('.content-scroll');
    if (!contentScroll) return;

    const viewMode = contentScroll.dataset.viewMode;
    const targetHandle = contentScroll.dataset.targetHandle;
    
    let targetUserUid = null;
    let isOwnProfile = false;
    let profileData = null;

    // 1. Determine Context
    if (viewMode === 'private') {
        targetUserUid = auth.currentUser.uid;
        isOwnProfile = true;
        
        // INSTANT CACHE LOAD: Render immediately if we have local data
        if (window.globalUserCache) {
            this.updateProfileUI(window.globalUserCache);
        }
    } else {
        targetUserUid = await this.getUserIdByHandle(targetHandle);
        isOwnProfile = (targetUserUid === auth.currentUser.uid);
    }

    if (!targetUserUid) return;

    // 2. FETCH FRESH DATA
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/${targetUserUid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            profileData = await res.json();
            
            // Update local cache if it's the current user
            if (isOwnProfile) {
                window.globalUserCache = { ...window.globalUserCache, ...profileData };
            }
            
            this.updateProfileUI(profileData);
        }
        
        // 3. Load Connections
        await this.loadProfileFollowingData(targetUserUid);
        await this.loadTopArtists(targetUserUid);
        
        // 3.5. Load Signature Stack (Crates)
        await this.loadUserCrates(targetUserUid);
        
        // 4. BIND SPA EVENT LISTENERS (CRITICAL FOR SPA)
        if (isOwnProfile) {
            this.setupProfileEditControls();
        } else {
            await this.checkUserFollowStatus(targetUserUid, profileData);
        }
        
    } catch (e) {
        console.error("Profile Load Error:", e);
    }
}

async loadProfileData(uid) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Failed to load profile');
        
        const data = await res.json();
        return data;
        
    } catch (e) {
        console.error("Load Profile Data Error:", e);
        return null;
    }
}

updateProfileUI(profileData) {
    if (!profileData) return;
    
    // Use environment variable for R2 URL
    const R2_PUBLIC_URL = window.R2_PUBLIC_URL || "https://pub-8159c20ed1b2482da0517a72d585b498.r2.dev";
    
    const fixUrl = (url) => {
        if (!url) return '';
        if (url.includes('cdn.eporiamusic.com')) {
            return url.replace('https://cdn.eporiamusic.com', R2_PUBLIC_URL);
        }
        return url;
    };
    
    // Get clean URLs
    const cleanAvatar = fixUrl(profileData.photoURL || profileData.avatar);
    const cleanCover = fixUrl(profileData.coverURL);

    // Match DB Keys: photoURL, profileSong, joinDate, coverURL
    const handleEl = document.getElementById('profileHandle');
    const bioEl = document.getElementById('profileBio');
    const joinDateEl = document.getElementById('profileJoinDate');
    const avatarImg = document.getElementById('profileAvatar');
    const heroBackground = document.getElementById('heroBackground');
    
    if (handleEl) handleEl.textContent = profileData.handle || '@user';
    if (bioEl) bioEl.textContent = profileData.bio || 'No bio yet.';
    
    // Correctly parse Firestore Timestamp for joinDate
    if (joinDateEl && profileData.joinDate) {
        const seconds = profileData.joinDate._seconds || profileData.joinDate.seconds;
        const dateObj = seconds ? new Date(seconds * 1000) : new Date(profileData.joinDate);
        joinDateEl.textContent = `Joined ${dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
    }

    // Use CLEAN photoURL
    if (avatarImg && cleanAvatar) {
        avatarImg.src = cleanAvatar;
    }

    // Use CLEAN coverURL
    if (heroBackground && cleanCover) {
        heroBackground.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${cleanCover}')`;
    }
    
    // Use profileSong for anthem card
    if (this.loadAnthemCard) {
        this.loadAnthemCard(profileData.profileSong);
    }
}

setupProfileEditControls() {
        // console.log('🔧 Setting up profile edit controls');
        
        // Wait for DOM to be ready
        requestAnimationFrame(() => {
            // 1. Show and bind the main Edit Profile button
            const editBtn = document.getElementById('editBtn');
            if (editBtn) {
                editBtn.onclick = () => this.toggleProfileEditMode();
                
                // [CRITICAL FIX] Reveal the button now that we confirmed ownership
                editBtn.style.display = 'inline-flex'; 
                
                // console.log('✅ Edit button found, bound, and revealed');
            } else {
                console.warn('⚠️ Edit button not found in DOM');
            }
            
            // 2. Bind Save button
            const saveBtn = document.getElementById('saveProfileBtn');
            if (saveBtn) saveBtn.onclick = () => this.saveProfileChanges();
            
            // 3. Bind Cancel button
            const cancelBtn = document.getElementById('cancelEditBtn');
            if (cancelBtn) cancelBtn.onclick = () => this.toggleProfileEditMode();
            
            // 4. Bind Image Uploads
            const avatarInput = document.getElementById('avatarInput');
            if (avatarInput) avatarInput.onchange = (e) => this.initCrop(e, 'avatar');
            
            const coverInput = document.getElementById('coverInput');
            if (coverInput) coverInput.onchange = (e) => this.initCrop(e, 'cover');

            // 5. Anthem Search
            const anthemSearchInput = document.getElementById('anthemSearchInput');
            if (anthemSearchInput) {
                let searchTimeout;
                anthemSearchInput.oninput = (e) => {
                    clearTimeout(searchTimeout);
                    const query = e.target.value.trim();
                    if (query.length < 2) {
                        const results = document.getElementById('anthemSearchResults');
                        if (results) results.innerHTML = '';
                        return;
                    }
                    searchTimeout = setTimeout(() => this.searchAnthemSongs(query), 300);
                };
            }
        });
    }

// ==========================================
// CROPPER.JS IMAGE HANDLING
// ==========================================




initCrop(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    this.currentCropType = type;
    const imageToCrop = document.getElementById('imageToCrop');
    const cropModal = document.getElementById('cropModal');

    const reader = new FileReader();
    reader.onload = (ev) => {
        if (imageToCrop) imageToCrop.src = ev.target.result;
        
        // Use flex to trigger the centering defined in CSS
        if (cropModal) {
            cropModal.style.display = 'flex'; 
        }
        
        if (this.cropper) this.cropper.destroy();
        
        const aspectRatio = type === 'avatar' ? 1 : (16 / 9);
        this.cropper = new Cropper(imageToCrop, {
            aspectRatio: aspectRatio,
            viewMode: 1,
            autoCropArea: 0.8,
            background: false
        });
    };
    reader.readAsDataURL(file);
    event.target.value = ''; 
}

cancelCrop() {
    const cropModal = document.getElementById('cropModal');
    if (cropModal) {
        cropModal.style.display = 'none';
    }
    if (this.cropper) {
        this.cropper.destroy();
        this.cropper = null;
    }
}

async saveCrop() {
    if (!this.cropper) return;
    
    const cropBtn = document.querySelector('#cropModal .btn-next');
    const originalText = cropBtn.innerText;
    cropBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    cropBtn.disabled = true;

    // Get cropped canvas
    const canvas = this.cropper.getCroppedCanvas({
        width: this.currentCropType === 'avatar' ? 400 : 1200,
        imageSmoothingEnabled: true, 
        imageSmoothingQuality: 'high',
    });

    canvas.toBlob(async (blob) => {
        const formData = new FormData();
        // 'avatar' or 'cover' matches the multer field name in backend
        formData.append(this.currentCropType, blob, `${this.currentCropType}.jpg`);

        try {
            const token = await auth.currentUser.getIdToken();
            // Call the new, smarter backend routes
            const endpoint = `/player/api/profile/upload-${this.currentCropType}`;
            
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                // 1. Strict DB Key mapping to match your Firestore schema
                const dbKey = this.currentCropType === 'avatar' ? 'photoURL' : 'coverURL';
                
                // 2. Update local SPA cache
                if (window.globalUserCache) {
                    window.globalUserCache[dbKey] = data.url;
                }
                
                // 3. [FIX] Force immediate UI repaint for Cover Photo
                if (this.currentCropType === 'cover') {
                    const heroBackground = document.getElementById('heroBackground');
                    if (heroBackground) {
                        heroBackground.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.2)), url('${data.url}')`;
                    }
                }

                // 4. Update the rest of the profile and sidebar
                this.updateProfileUI(window.globalUserCache);

                if (this.currentCropType === 'avatar') {
                    const sidebarPic = document.getElementById('profilePic');
                    if (sidebarPic) sidebarPic.src = data.url;
                }

                this.showToast('Photo updated successfully!');

            } else {
                throw new Error(data.error || 'Upload failed');
            }
        } catch (e) {
            console.error("Crop Upload Error:", e);
            this.showToast(e.message);
        } finally {
            this.cancelCrop();
            cropBtn.innerHTML = originalText;
            cropBtn.disabled = false;
        }
    }, 'image/jpeg', 0.9);
}

// ==========================================
// ANTHEM / SONG SEARCH LOGIC
// ==========================================

async searchAnthemSongs(query) {
        const resultsContainer = document.getElementById('anthemSearchResults');
        if (!resultsContainer) return;
        resultsContainer.innerHTML = '<div style="text-align:center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Searching database...</div>';

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/search?q=${encodeURIComponent(query)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            const songs = (data.results || []).filter(r => r.type === 'song');
            
            if (songs.length === 0) {
                resultsContainer.innerHTML = '<div style="text-align:center; padding: 20px;">No tracks found.</div>';
                return;
            }

            resultsContainer.innerHTML = songs.map(song => `
                <div class="search-result-item" style="cursor:pointer; display:flex; align-items:center; padding:10px; border-bottom:1px solid var(--border-color);" 
                     onclick='window.ui.selectAnthem(${JSON.stringify(song)})'>
                    <img src="${song.img}" class="result-img" style="width:40px; height:40px; border-radius:5px; margin-right:15px; object-fit:cover;">
                    <div class="result-info">
                        <div class="result-title" style="font-weight:bold;">${song.title}</div>
                        <div class="result-sub" style="font-size:0.8rem; color:var(--text-secondary);">${song.subtitle}</div>
                    </div>
                </div>
            `).join('');
        } catch (err) { resultsContainer.innerHTML = 'Search failed.'; }
    }

    async selectAnthem(song) {
        const newAnthem = { 
            songId: song.id, 
            title: song.title, 
            artist: song.subtitle, 
            img: song.img, 
            audioUrl: song.audioUrl, 
            duration: song.duration 
        };
        if (!window.globalUserCache) window.globalUserCache = {};
        window.globalUserCache.profileSong = newAnthem;
        this.loadAnthemCard(newAnthem);
        this.closeAnthemModal();
        this.showToast("Anthem updated!");

        try {
            const token = await auth.currentUser.getIdToken();
            await fetch('/player/api/profile/update', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ anthem: newAnthem })
            });
        } catch (e) { console.error("Anthem Save Error:", e); }
    }

    loadAnthemCard(anthem) {
        const anthemCard = document.getElementById('anthemPlayer');
        if (!anthemCard) return;
        
        if (anthem && anthem.title) {
            document.getElementById('anthemTitle').textContent = anthem.title;
            document.getElementById('anthemArtist').textContent = anthem.artist;
            if (anthem.img) document.getElementById('anthemArt').src = anthem.img;
            Object.assign(anthemCard.dataset, { 
                artistId:anthem.artistId,
                songId: anthem.songId, 
                songTitle: anthem.title, 
                songArtist: anthem.artist, 
                songImg: anthem.img, 
                audioUrl: anthem.audioUrl, 
                duration: anthem.duration 
            });
            anthemCard.classList.remove('empty');
        } else {
            anthemCard.classList.add('empty');
        }
    }

async loadProfileFollowingData(uid) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/following/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        
        // Populate artists grid
        const artistsGrid = document.getElementById('fullArtistsGrid');
        if (artistsGrid) {
            this.populateArtistsGrid(artistsGrid, data.artists || []);
        }
        
        // Populate users grid
        const usersGrid = document.getElementById('fullUsersGrid');
        if (usersGrid) {
            this.populateUsersGrid(usersGrid, data.users || []);
        }
        
    } catch (e) {
        console.error("Load Following Data Error:", e);
    }
}

populateArtistsGrid(grid, artists) {
    if (!grid) return;
    
    if (!artists || artists.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="text-align:center; padding:40px; color:#888">
                <i class="fas fa-music" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block;"></i>
                <p>No artists followed yet</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = '';
    
    artists.forEach(artist => {
        const card = document.createElement('div');
        card.className = 'artist-square';
        card.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
        
        card.innerHTML = `
            <img src="${artist.img || 'https://via.placeholder.com/150'}" alt="${artist.name}">
            <div class="artist-overlay">${artist.name}</div>
        `;
        
        grid.appendChild(card);
    });
}

populateUsersGrid(grid, users) {
    if (!grid) return;
    
    if (!users || users.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="text-align:center; padding:40px; color:#888">
                <i class="fas fa-user-friends" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block;"></i>
                <p>No users followed yet</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = '';
    
    users.forEach(user => {
        const card = document.createElement('div');
        card.className = 'user-card';
        card.onclick = (e) => {
            if (e.target.closest('.unfollow-btn')) return;
            const handle = user.handle.replace('@', '');
            window.navigateTo(`/player/u/${handle}`);
        };
        
        card.innerHTML = `
            <img src="${user.img || 'https://via.placeholder.com/50'}" alt="${user.name}">
            <div class="user-info">
                <div class="user-name">${user.name}</div>
                <div class="user-handle">${user.handle}</div>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

async loadTopArtists(uid) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/profile/following/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        const artists = data.artists || [];
        
        const grid = document.getElementById('topArtistsGrid');
        if (!grid) return;
        
        const topArtists = artists.slice(0, 6);
        
        if (topArtists.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1; text-align:center; padding:40px; color:#888">
                    <i class="fas fa-music" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block;"></i>
                    <p>No artists followed yet</p>
                </div>
            `;
            return;
        }
        
        grid.innerHTML = '';
        
        topArtists.forEach(artist => {
            const card = document.createElement('div');
            card.className = 'artist-square';
            card.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
            
            card.innerHTML = `
                <img src="${artist.img || 'https://via.placeholder.com/150'}" alt="${artist.name}">
                <div class="artist-overlay">${artist.name}</div>
            `;
            
            grid.appendChild(card);
        });
        
    } catch (e) {
        console.error("Load Top Artists Error:", e);
    }
}

// Add these Modal Functions inside PlayerUIController (e.g., below setupProfileEditControls)

openAnthemModal() { document.getElementById('anthemModal').style.display = 'flex'; }
closeAnthemModal() { document.getElementById('anthemModal').style.display = 'none'; }
openQuestionModal() { document.getElementById('questionModal').style.display = 'flex'; }
closeQuestionModal() { document.getElementById('questionModal').style.display = 'none'; }
submitQuestion() { alert("Question sent!"); this.closeQuestionModal(); }

closeUnfollowModal() { 
    document.getElementById('unfollowModal').style.display = 'none'; 
    window.pendingUnfollow = null; 
}
confirmUnfollow() { 
    if (window.pendingUnfollow) window.pendingUnfollow(); 
    this.closeUnfollowModal(); 
}

async checkUserFollowStatus(uid, profileData) {
    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/user/follow/check?userId=${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        const followBtn = document.getElementById('userFollowBtn');
        
        if (followBtn) {
            followBtn.style.display = 'flex';
            this.updateUserFollowButton(followBtn, data.following, uid, profileData);
        }
    } catch (e) {
        console.error("Check User Follow Error:", e);
    }
}

updateUserFollowButton(btn, isFollowing, uid, profileData) {
    if (isFollowing) {
        btn.innerHTML = '<i class="fas fa-user-check"></i><span>Following</span>';
        btn.style.background = '#666';
    } else {
        btn.innerHTML = '<i class="fas fa-user-plus"></i><span>Follow</span>';
        btn.style.background = '#88C9A1';
    }
    
    btn.onclick = () => this.toggleUserFollow(uid, profileData, btn);
}

async toggleUserFollow(uid, profileData, btn) {
    const isCurrentlyFollowing = btn.textContent.includes('Following');
    
    try {
        const token = await auth.currentUser.getIdToken();
        const endpoint = isCurrentlyFollowing ? '/player/api/user/unfollow' : '/player/api/user/follow';
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: uid,
                handle: profileData.handle,
                name: profileData.displayName || profileData.handle,
                avatar: profileData.avatar
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            this.updateUserFollowButton(btn, data.following, uid, profileData);
            this.showToast(data.following ? 'Now following!' : 'Unfollowed');
        }
    } catch (e) {
        console.error("Toggle User Follow Error:", e);
        this.showToast('Action failed');
    }
}

async getUserIdByHandle(handle) {
    try {
        const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
        
        // Call backend API to get user by handle
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/player/api/user/by-handle?handle=${encodeURIComponent(cleanHandle)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) return null;
        
        const data = await res.json();
        return data.uid || null;
        
    } catch (e) {
        console.error("Get User ID Error:", e);
        return null;
    }
}

// ==========================================
// SIGNATURE STACK (CRATES)
// ==========================================

async loadUserCrates(uid) {
    try {
        const token = await auth.currentUser.getIdToken();
        
        // Load created crates
        const createdRes = await fetch(`/player/api/crates/user/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const createdData = await createdRes.json();
        
        this.renderCratesGrid(createdData.crates || [], 'createdCratesGrid');
        
        // Load liked crates
        const likedRes = await fetch(`/player/api/crates/liked/${uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const likedData = await likedRes.json();
        
        this.renderCratesGrid(likedData.crates || [], 'likedCratesGrid');
        
    } catch (e) {
        console.error("Load User Crates Error:", e);
        const grids = ['createdCratesGrid', 'likedCratesGrid'];
        grids.forEach(gridId => {
            const grid = document.getElementById(gridId);
            if (grid) grid.innerHTML = '<div class="empty-state">Failed to load crates</div>';
        });
    }
}

renderCratesGrid(crates, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // 1. Handle Empty State
        if (!crates || crates.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="text-align:center; padding:60px 20px; color:var(--text-secondary); width:100%;">
                    <i class="fas fa-box-open" style="font-size:3rem; opacity:0.3; margin-bottom:15px; display:block"></i>
                    <p style="margin:0; font-size:1rem">No crates found</p>
                </div>`;
            
            // Ensure container behaves like a grid even when empty so message centers
            container.style.display = 'flex';
            container.style.justifyContent = 'center';
            return;
        }
        
        // 2. Reset Container
        container.innerHTML = '';
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';
        container.style.gap = '20px';
        
        // 3. Use the Unified Card Helper
        crates.forEach(crate => {
            // Use the shared helper to ensure identical design
            const card = this.createCrateCard(crate);
            
            // Optional: Remove fixed width if you want them to be responsive in the grid
            card.style.minWidth = 'auto'; 
            card.style.width = '100%';
            
            container.appendChild(card);
        });
    }

    // ==========================================
    // 3. CRATE VIEW LOADER (The Missing Piece)
    // ==========================================
    async loadCrateView(crateId) {
        const container = document.querySelector('.content-scroll');
        if (!container) return;

        // Loading UI
        container.innerHTML = `
            <div style="display:flex; justify-content:center; align-items:center; height:60vh; flex-direction:column; color:#888;">
                <i class="fas fa-spinner fa-spin" style="font-size:2rem; margin-bottom:15px; color:var(--primary)"></i>
                <span>Loading Crate...</span>
            </div>`;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/crate/${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) throw new Error("Crate not found");

            const crateData = await res.json();
            
            // Store for playback
            this.activeCrateData = crateData;
            this.currentCrateId = crateId;

            // Render
            this.renderCrateView(crateData, container);

        } catch (e) {
            console.error("Load Crate Error:", e);
            container.innerHTML = `
                <div style="text-align:center; padding:50px;">
                    <h2><i class="fas fa-exclamation-triangle"></i> Crate Not Found</h2>
                    <p style="color:#888; margin-top:10px">${e.message}</p>
                    <button class="btn-pill outline" onclick="window.history.back()" style="margin-top:20px">Go Back</button>
                </div>`;
        }
    }

    renderCrateView(crate, container) {
        const coverImg = crate.coverImage || (crate.tracks && crate.tracks.length ? (crate.tracks[0].artUrl || crate.tracks[0].img) : '') || 'https://via.placeholder.com/300';
        const creatorName = crate.creatorHandle || 'Unknown';
        const creatorAvatar = crate.creatorAvatar || '';
        const trackCount = crate.tracks ? crate.tracks.length : 0;

        const headerHtml = `
        <div class="crate-hero" style="background: linear-gradient(to bottom, rgba(0,0,0,0.6), var(--bg-main)), url('${coverImg}') no-repeat center center; background-size: cover;">
            <div class="crate-hero-inner" style="backdrop-filter: blur(20px); background: rgba(0,0,0,0.5); padding: 40px; border-radius: 20px; display: flex; gap: 30px; align-items: flex-end;">
                <div class="crate-cover" style="width: 220px; height: 220px; flex-shrink: 0; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border-radius: 12px; overflow: hidden;">
                    <img src="${coverImg}" style="width: 100%; height: 100%; object-fit: cover;">
                </div>
                <div class="crate-info" style="flex: 1;">
                    <div class="crate-badge" style="font-size: 0.75rem; font-weight: 800; letter-spacing: 1px; color: var(--accent-orange); margin-bottom: 5px;">CRATE</div>
                    <h1 class="crate-title" style="font-size: 3.5rem; font-weight: 900; margin-bottom: 10px; line-height: 1.1;">${crate.title}</h1>
                    ${crate.description ? `<p style="color: #ccc; margin-bottom: 20px;">${crate.description}</p>` : ''}
                    
                    <div class="crate-meta" style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
                        ${creatorAvatar ? `<img src="${creatorAvatar}" style="width:30px; height:30px; border-radius:50%">` : '<i class="fas fa-user"></i>'}
                        <span style="color:#ccc">Created by <strong>${creatorName}</strong></span>
                        <span style="color:#666">•</span>
                        <span style="color:#ccc">${trackCount} Songs</span>
                    </div>

                    <div class="crate-actions" style="display: flex; gap: 15px;">
                        <button class="btn-play-all" onclick="window.ui.playCrate('${crate.id}')" style="padding: 12px 30px; border-radius: 50px; border: none; background: var(--primary); color: #000; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-play"></i> Play All
                        </button>
                        <button class="btn-shuffle" 
                                onclick="window.ui.playCrate(true)" 
                                title="Shuffle"
                                style="width: 48px; height: 48px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; transition: all 0.2s;">
                            <i class="fas fa-random"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        let tracksHtml = '<div class="crate-tracks" style="margin-top:30px; padding:0 20px">';
        
        if (crate.tracks && crate.tracks.length > 0) {
            tracksHtml += '<div class="track-list-body">';
            crate.tracks.forEach((track, index) => {
                const aId = track.artistId || track.ownerId || track.uid || '';
                const img = this.fixImageUrl(track.artUrl || track.img);
                
                tracksHtml += `
                <div class="track-row" 
                     onclick="window.ui.playCrateTrack(${index})"
                     data-song-id="${track.id}"
                     data-artist-id="${aId}"
                     style="display: flex; align-items: center; padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;">
                    
                    <div style="width:40px; text-align:center; color:#666">${index + 1}</div>
                    
                    <div style="flex:1; display:flex; align-items:center; gap:15px">
                        <img src="${img}" style="width:40px; height:40px; border-radius:4px; object-fit:cover">
                        <div>
                            <div style="font-weight:700; color:var(--text-main)">${track.title}</div>
                            <div style="font-size:0.8rem; color:#888">${track.artist}</div>
                        </div>
                    </div>
                    
                    <div style="width:80px; text-align:right">
                         <button class="track-like-btn" 
                            onclick="event.stopPropagation(); window.toggleSongLike(this, '${track.id}', '${track.title.replace(/'/g, "\\'")}', '${track.artist.replace(/'/g, "\\'")}', '${img}', '${track.audioUrl}', '${track.duration}', '${aId}')"
                            style="background:none; border:none; color:#666; cursor:pointer">
                            <i class="far fa-heart"></i>
                        </button>
                    </div>
                </div>`;
            });
            tracksHtml += '</div>';
        } else {
            tracksHtml += '<div style="text-align:center; padding:50px; color:#666">Crate is empty</div>';
        }
        tracksHtml += '</div><div style="height:120px"></div>'; // Spacer

        container.innerHTML = headerHtml + tracksHtml;
    }

    // ==========================================
    // C. DASHBOARD & WALLET
    // ==========================================
    async loadSceneDashboard(city = null, state = null, country = null) {
        const CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes
        const now = Date.now();

        // Create cache key based on city (for multi-city caching)
        const cacheKey = city ? `dashboard_${city}` : 'dashboard';

        // 1. CHECK CACHE (only if no specific city requested or if cached)
        if (!city && window.globalUserCache?.dashboard && 
           (now - window.globalUserCache.dashboardTimestamp < CACHE_DURATION)) {
            // console.log("⚡ Using Cached Dashboard Data");
            this.renderSceneDashboard(window.globalUserCache.dashboard);
            return;
        }

        // 2. FETCH FRESH DATA
        try {
            const token = await auth.currentUser.getIdToken();
            
            // Build query parameters for city navigation
            let queryParams = '';
            if (city) {
                queryParams = `?city=${encodeURIComponent(city)}`;
                if (state) queryParams += `&state=${encodeURIComponent(state)}`;
                if (country) queryParams += `&country=${encodeURIComponent(country)}`;
            }
            
            const res = await fetch(`/player/api/dashboard${queryParams}`, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            const data = await res.json();

            // 3. UPDATE CACHE
            if (!window.globalUserCache) window.globalUserCache = {};
            if (!city) {
                // Only cache default city
                window.globalUserCache.dashboard = data;
                window.globalUserCache.dashboardTimestamp = now;
            }

            // 4. RENDER
            this.renderSceneDashboard(data);
            
            // 5. LOAD CITY PILLS
            this.loadCityPills();

        } catch (e) { 
            console.error("Scene Load Error:", e); 
        }
    }

    renderSceneDashboard(data) {
        // Define Containers (Exact match to your dashboard.pug)
        const dropsContainer = document.getElementById('localDropsContainer');
        const cratesContainer = document.getElementById('localCratesContainer');
        const artistsContainer = document.getElementById('localArtistsContainer');
        const forYouContainer = document.getElementById('forYouArtistsContainer');
        const forYouSection = document.getElementById('forYouSection');
        
        // Safety check - if user navigated away quickly
        if (!dropsContainer) return;

        // console.log('[DASHBOARD] Rendering:', data);

        // --- A. UPDATE TEXT HEADERS (From your original code) ---
        const sceneTitle = document.querySelector('.scene-title');
        const sceneSubtitle = document.querySelector('.scene-subtitle');
        
        if (sceneTitle && data.city) {
            sceneTitle.textContent = `${data.city} Underground`;
        }
        
        if (sceneSubtitle && data.state) {
            sceneSubtitle.textContent = `Pulse of ${data.state}`;
        }

        // Update "Top Local" section header
        const artistSection = document.querySelector('.feed-section:has(#localArtistsContainer)');
        if (artistSection && data.city) {
            const header = artistSection.querySelector('h3');
            if (header) {
                header.innerHTML = `
                    Artists in ${data.city}
                    <button class="btn-see-more" onclick="window.loadMoreArtists()" 
                            style="margin-left: 15px; background: var(--primary); color: #000; 
                            padding: 6px 15px; border-radius: 20px; font-size: 0.8rem; 
                            border: none; cursor: pointer; font-weight: 700; transition: 0.2s;">
                        See All
                    </button>
                `;
            }
        }

        // Update Community Crates description
        const cratesDesc = document.querySelector('.feed-section:has(#localCratesContainer) .section-desc');
        if (cratesDesc && data.city) {
            cratesDesc.textContent = `Hand-picked collections from ${data.city} locals.`;
        }

        // --- B. RENDER GRIDS (Preserving your Empty States) ---

        // 1. Fresh Drops
        dropsContainer.innerHTML = '';
        if (!data.freshDrops || data.freshDrops.length === 0) {
            dropsContainer.innerHTML = this.createEmptyState("Quiet in the city tonight.");
        } else {
            data.freshDrops.forEach(song => dropsContainer.appendChild(this.createSongCard(song)));
        }

        // 2. For You Section (Genre-Matched Artists)
        if (forYouContainer && forYouSection) {
            if (data.forYou && data.forYou.length > 0) {
                forYouSection.style.display = 'block';
                forYouContainer.innerHTML = '';
                data.forYou.forEach(artist => forYouContainer.appendChild(this.createArtistCircle(artist, data.city)));
            } else {
                forYouSection.style.display = 'none';
            }
        }

        // 3. Community Crates
        if (cratesContainer) {
            cratesContainer.innerHTML = '';
            if (!data.localCrates || data.localCrates.length === 0) {
                 cratesContainer.innerHTML = this.createEmptyState("No local crates created yet.");
            } else {
                data.localCrates.forEach(crate => cratesContainer.appendChild(this.createCrateCard(crate)));
            }
        }

        // 4. Artists
        if (artistsContainer) {
            artistsContainer.innerHTML = '';
            if (data.topLocal) {
                data.topLocal.forEach(artist => artistsContainer.appendChild(this.createArtistCircle(artist, data.city)));
            }
        }
        
        // --- C. UPDATE GLOBALS (For Load More) ---
        window.currentCity = data.city;
        window.currentState = data.state;
        window.currentCountry = data.country;
    }

    // NEW: Load city pills for quick navigation
    async loadCityPills() {
        const container = document.getElementById('cityPillsContainer');
        if (!container) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/cities/active', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            this.renderCityPills(data.cities);
        } catch (e) {
            console.error("City Pills Load Error:", e);
        }
    }

    // NEW: Render city pills
    renderCityPills(cities) {
        const container = document.getElementById('cityPillsContainer');
        if (!container) return;

        container.innerHTML = '';
        
        if (!cities || cities.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';

        cities.forEach(cityData => {
            const pill = document.createElement('button');
            pill.className = 'city-pill';
            
            // Highlight current city
            if (cityData.city === window.currentCity) {
                pill.classList.add('active');
            }
            
            pill.innerHTML = `
                <span class="city-pill-name">${cityData.city}</span>
                <span class="city-pill-state">${cityData.state || cityData.country}</span>
            `;
            
            pill.onclick = () => this.navigateToCity(cityData.city, cityData.state, cityData.country);
            container.appendChild(pill);
        });
    }

    // NEW: Navigate to a different city without interrupting playback
    async navigateToCity(city, state, country) {
        // console.log(`🌆 Navigating to ${city}, ${state || country}`);
        
        // Update URL without page reload
        const url = new URL(window.location);
        url.searchParams.set('city', city);
        if (state) url.searchParams.set('state', state);
        if (country) url.searchParams.set('country', country);
        window.history.pushState({}, '', url);
        
        // Reload dashboard with new city (this preserves music playback)
        await this.loadSceneDashboard(city, state, country);
        
        // Show toast notification
        this.showToast(`Exploring ${city} Underground`, 'success');
    }

    // NEW: Initialize City Soundscape Map
    initCityMap() {
        try {
            this.cityMap = new CitySoundscapeMap();
            window.cityMap = this.cityMap;
            // console.log('🗺️ City Soundscape Map initialized');
        } catch (error) {
            console.error('Failed to initialize city map:', error);
        }
    }

    // NEW: Open City Soundscape Map
    async openCitySearch() {
        try {
            // Show loading state
            this.showToast('Loading map...', 'info');
            
            if (!this.cityMap) {
                console.warn('City map not initialized, creating now...');
                this.initCityMap();
            }
            
            const userLocation = {
                city: window.currentCity || 'San Diego',
                coordinates: window.currentCityCoords || [-117.1611, 32.7157]
            };
            
            const userGenres = window.globalUserCache?.userGenres || 
                              window.globalUserCache?.genres || [];
            
            await this.cityMap.init(userLocation, userGenres);
        } catch (error) {
            console.error('Failed to open city map:', error);
            this.showToast('Unable to load city map. Please try again.', 'error');
        }
    }

    async loadUserWallet() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            const balance = Number(data.balance).toFixed(2);

            const sidebarBal = document.getElementById('userWalletBalance');
            if (sidebarBal) sidebarBal.innerText = balance;

            document.querySelectorAll('.menu-balance, #dropdownWalletBalance').forEach(el => {
                el.innerText = `$${balance}`;
            });
        } catch (e) { console.error("Wallet Sync Error", e); }
    }

    renderTransactions(container, items) {
        if(!container) return;
        container.innerHTML = '';
        items.forEach(item => {
            const isPos = item.type === 'in';
            const iconClass = isPos ? 'fa-arrow-down' : 'fa-arrow-up';
            const iconStyle = isPos ? '' : 'out';
            const sign = isPos ? '+' : '-';
            const amountClass = isPos ? 'positive' : 'negative';

            container.innerHTML += `
                <div class="trans-item">
                    <div class="trans-icon ${iconStyle}"><i class="fas ${iconClass}"></i></div>
                    <div class="trans-info">
                        <div class="trans-title">${item.title}</div>
                        <div class="trans-date">${item.date}</div>
                    </div>
                    <div class="trans-amount ${amountClass}">${sign}$${Number(Math.abs(item.amount)).toFixed(2)}</div>
                </div>`;
        });
    }

    // ==========================================
    // D. FAVORITES & LIBRARY
    // ==========================================

    async loadFavorites() {
        const container = document.getElementById('favoritesList');
        if (!container) return;

        // 1. CHECK CACHE (5 Minute TTL)
        const CACHE_DURATION = 5 * 60 * 1000; 
        const now = Date.now();

        if (window.globalUserCache?.favorites && 
           (now - window.globalUserCache.favoritesTimestamp < CACHE_DURATION)) {
            // console.log("⚡ Using Cached Favorites");
            this.renderFavoritesList(window.globalUserCache.favorites);
            return;
        }

        // 2. FETCH FRESH DATA
        container.innerHTML = '<div class="track-row skeleton-box"></div><div class="track-row skeleton-box"></div>';
        
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/favorites', { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            const data = await res.json();

            // 3. UPDATE CACHE
            if (!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache.favorites = data.songs;
            window.globalUserCache.favoritesTimestamp = now;

            // 4. RENDER
            this.renderFavoritesList(data.songs);

        } catch (e) { 
            console.error("Load Favs Error:", e);
            container.innerHTML = this.createEmptyState("Failed to load favorites.");
        }
    }

    renderFavoritesList(songs) {
        const container = document.getElementById('favoritesList');
        if (!container) return;
        container.innerHTML = '';
        
        if (!songs || songs.length === 0) {
            container.innerHTML = this.createEmptyState("Go explore the scene and heart some tracks!");
            return;
        }

        songs.forEach((track, index) => {
            const row = document.createElement('div');
            row.className = 'track-row';
            row.onclick = (e) => {
                if(e.target.closest('button')) return;
                window.playSong(track.id, track.title, track.artist, track.img, track.audioUrl, track.duration);
            };

            row.innerHTML = `
                <span class="track-num">${index + 1}</span>
                <img class="track-img" src="${track.img}" loading="lazy">
                <div class="track-info-row">
                    <span class="t-title">${track.title}</span>
                    <span class="t-plays">${track.artist}</span>
                </div>
                <div class="row-controls" style="display:flex; gap:10px; align-items:center; margin-right:15px">
                    <button class="row-btn" onclick="addToQueue('${track.id}', '${track.title.replace(/'/g, "\\'")}', '${track.artist.replace(/'/g, "\\'")}', '${track.img}', '${track.audioUrl}', '${track.duration}')">
                        <i class="fas fa-list"></i>
                    </button>
                    <button class="row-btn" data-song-id="${track.id}" onclick="toggleSongLike(this, '${track.id}', '${track.title.replace(/'/g, "\\'")}', '${track.artist.replace(/'/g, "\\'")}', '${track.img}', '${track.audioUrl}', '${track.duration}')">
                        <i class="fas fa-heart" style="color:#F4A261"></i>
                    </button>
                </div>
                <span class="t-time">${this.formatTime(track.duration)}</span>
            `;
            container.appendChild(row);
        });
    }

    // ==========================================
    // E. VIEW ROUTER (Hydration Logic)
    // ==========================================
   checkAndReloadViews() {
        if (!auth.currentUser) return; 

        const currentPage = document.querySelector('.content-scroll');
        const pageType = currentPage ? currentPage.dataset.page : null;

        if (!pageType) return;
        if (currentPage.dataset.hydrated === "true") return;

        // console.log(`💧 Hydrating View: ${pageType}`);

        switch(pageType) {
            case 'dashboard':
                this.loadSceneDashboard();
                // ADDED: Reload likes when returning to dashboard
                if (!window.globalUserCache?.likedSongs) {
                    this.loadUserLikes();
                }
                break;
            case 'favorites':
                this.loadFavorites();
                // ADDED: Ensure likes are loaded for favorites page
                if (!window.globalUserCache?.likedSongs) {
                    this.loadUserLikes();
                }
                break;
            case 'wallet':
                this.initWalletPage();
                break;
            case 'profile':
                this.loadProfilePage();
                
                // Bind Save Button for Profile
                const saveBtn = document.getElementById('saveProfileBtn');
                if (saveBtn) saveBtn.onclick = () => this.saveProfileChanges();
                
                // Bind Cancel button
                const cancelBtn = document.getElementById('cancelEditBtn');
                if (cancelBtn) cancelBtn.onclick = () => this.toggleProfileEditMode();
                break;
            case 'settings':
                this.loadSettingsPage(currentPage);
                break;
            case 'crate-view':
                const crateId = currentPage.dataset.crateId;
                if(crateId) this.loadCrateView(crateId);
                break;
            case 'artist-profile':
                // [NEW] Initialize Artist Wall Comments
                const artistId = window.location.pathname.split('/').pop();
                if (artistId && artistId !== 'artist') {
                    // Clean up old instance if exists
                    if (window.artistComments) window.artistComments = null;
                    
                    // Initialize new manager
                    window.artistComments = new ArtistCommentsManager(artistId, auth.currentUser.uid);
                    window.artistComments.init();
                }
                break;
        }

        // Check for Tab Parameter
        const urlParams = new URLSearchParams(window.location.search);
        const targetTab = urlParams.get('tab');
        if (targetTab) {
            setTimeout(() => window.switchProfileTab(targetTab), 100);
        }

        currentPage.dataset.hydrated = "true";
        this.updateSidebarState();
        this.hydrateGlobalButtons(); // Now correctly defined in the class
        this.loadUserWallet(); 
    }

    // [FIX] Moved inside the class so 'this.hydrateGlobalButtons' works
    hydrateGlobalButtons() {
        // console.log('[HYDRATE] Starting button hydration...');
        
        const followBtns = document.querySelectorAll('#followBtn');
        followBtns.forEach(btn => {
            if (btn.dataset.artistId && !btn.dataset.checked) {
                this.checkFollowStatus(btn.dataset.artistId);
                btn.dataset.checked = "true";
            }
        });
        
        const likeBtns = document.querySelectorAll('.card-like-btn i, .row-btn i.fa-heart, .player-full .fa-heart, .mp-controls .fa-heart');
        likeBtns.forEach(icon => {
            const btn = icon.closest('button') || icon.parentElement;
            let songId = btn.dataset.songId;
            if(!songId && this.engine.currentTrack) songId = this.engine.currentTrack.id;
            if(songId) this.checkSongLikeStatus(songId, icon);
        });
    }

    
    // ==========================================
    // F. PLAYBACK & ACTIONS
    // ==========================================
    addToQueue(id, title, artist, artUrl, audioUrl, duration) {
        this.engine.addToQueue({ id, title, artist, artUrl, audioUrl, duration });
        this.showToast(`Added to Queue: ${title}`);
    }


    async toggleSongLike(btn, songId, title, artist, artUrl, audioUrl, duration) {
        if (!auth.currentUser) return window.location.href = '/members/login';
        
        const icon = btn.tagName === 'I' ? btn : btn.querySelector('i');
        const isLiked = icon.classList.contains('fas');
        
        // Ensure cache structures exist
        if (!window.globalUserCache) window.globalUserCache = {};
        if (!window.globalUserCache.likedSongs) window.globalUserCache.likedSongs = new Set();
        if (!window.globalUserCache.favorites) window.globalUserCache.favorites = [];

        if (isLiked) { 
            // --- UNLIKE ACTION ---
            // 1. UI: Toggle Icon immediately
            icon.classList.remove('fas'); 
            icon.classList.add('far'); 
            icon.style.color = '';
            
            // 2. CACHE: Remove ID from the Set (for heart checks)
            window.globalUserCache.likedSongs.delete(songId);
            
            // 3. CACHE: Remove Object from Favorites Array (for list rendering)
            window.globalUserCache.favorites = window.globalUserCache.favorites.filter(s => s.id !== songId);
            
            // 4. LIVE UI: If we are strictly on the Favorites page, remove the row locally
            const row = btn.closest('.track-row');
            if (row && document.getElementById('favoritesList')) {
                row.remove();
                // If that was the last song, show empty state
                if (window.globalUserCache.favorites.length === 0) {
                    document.getElementById('favoritesList').innerHTML = this.createEmptyState("Go explore the scene and heart some tracks!");
                }
            }

        } else { 
            // --- LIKE ACTION ---
            // 1. UI: Toggle Icon
            icon.classList.remove('far'); 
            icon.classList.add('fas'); 
            icon.style.color = '#F4A261';
            
            // 2. CACHE: Add ID to Set
            window.globalUserCache.likedSongs.add(songId);
            
            // 3. CACHE: Add Object to Favorites Array (Prepend to top)
            // We verify it doesn't already exist to prevent duplicates
            if (!window.globalUserCache.favorites.some(s => s.id === songId)) {
                window.globalUserCache.favorites.unshift({
                    id: songId,
                    title: title,
                    artist: artist,
                    img: artUrl,
                    audioUrl: audioUrl,
                    duration: parseFloat(duration) || 0
                });
            }
        }

        // 5. NETWORK: Send request in background
        try {
            const token = await auth.currentUser.getIdToken();
            const method = isLiked ? 'DELETE' : 'POST';
            const url = isLiked ? `/player/api/user/like/${songId}` : '/player/api/user/like';
            
            await fetch(url, { 
                method: method, 
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, 
                body: method === 'POST' ? JSON.stringify({ songId, title, artist, artUrl, audioUrl, duration }) : undefined
            });
        } catch (e) { 
            console.error("Like failed", e); 
            // Revert UI if network fails (optional safety net)
            this.checkSongLikeStatus(songId, icon); 
        }
    }
    async loadUserLikes() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/user/likes/ids', { headers: { 'Authorization': `Bearer ${token}` }});
            const data = await res.json();
            
            if(!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache.likedSongs = new Set(data.likedSongIds || []);
            
            // console.log('[LIKES LOADED]', data.likedSongIds?.length || 0, 'liked songs:', Array.from(window.globalUserCache.likedSongs));
            
            this.hydrateGlobalButtons();
            
        } catch(e) { 
            console.error("Like Cache Error", e); 
        }
    }

    checkSongLikeStatus(songId, iconElement) {
        if (!auth.currentUser || !iconElement) return;
        
        let isLiked = false;
        if (window.globalUserCache && window.globalUserCache.likedSongs) {
            isLiked = window.globalUserCache.likedSongs.has(songId);
        }
        
        // console.log(`[LIKE CHECK] Song ${songId}: ${isLiked ? 'LIKED' : 'NOT LIKED'}`, window.globalUserCache?.likedSongs);
        
        if (isLiked) {
            iconElement.classList.remove('far'); 
            iconElement.classList.add('fas'); 
            iconElement.style.color = '#F4A261';
        } else {
            iconElement.classList.remove('fas'); 
            iconElement.classList.add('far'); 
            iconElement.style.color = '';
        }
    }

    async toggleFollow(btn) {
        if (!auth.currentUser) return window.location.href = '/members/login';
        const isFollowing = btn.classList.contains('following');
        this.updateFollowButtonUI(!isFollowing); 

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/artist/follow', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    artistId: btn.dataset.artistId,
                    artistName: btn.dataset.artistName,
                    artistImg: btn.dataset.artistImg
                })
            });
            
            const data = await res.json();
            this.updateFollowButtonUI(data.following);
            
            if (window.globalUserCache) {
                window.globalUserCache.sidebarArtists = data.sidebar;
                this.renderSidebarArtists(data.sidebar);
            }
        } catch (e) {
            console.error("Follow error", e);
            this.updateFollowButtonUI(isFollowing); 
        }
    }

    updateFollowButtonUI(isFollowing) {
        const btn = document.getElementById('followBtn');
        if (!btn) return;
        if (isFollowing) {
            btn.classList.add('following');
            btn.innerHTML = 'Following';
            btn.style.background = 'transparent';
            btn.style.border = '1px solid #FFF';
            btn.style.color = '#FFF';
        } else {
            btn.classList.remove('following');
            btn.innerHTML = 'Follow';
            btn.style.background = '#88C9A1';
            btn.style.border = 'none';
            btn.style.color = '#FFF';
        }
    }

    // ==========================================
    // G. HELPERS & RENDERERS
    // ==========================================
    createSongCard(song) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.style.minWidth = '160px'; 
        
        // CRITICAL FIX: Extract artistId from song data
        const artistId = song.artistId || song.artist_id || null;
        
        // CRITICAL FIX: Include artistId in card click
        card.onclick = () => window.playSong(
            song.id, 
            song.title, 
            song.artist, 
            song.img, 
            song.audioUrl, 
            song.duration,
            artistId  // NOW INCLUDED
        );
        
        card.innerHTML = `
            <div class="img-container">
                <img src="${song.img}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">
                <div class="play-overlay" style="display:flex; gap:10px; justify-content:center; align-items:center; background:rgba(0,0,0,0.6)">
                    <button onclick="event.stopPropagation(); playSong('${song.id}', '${song.title.replace(/'/g, "\\'")}', '${song.artist.replace(/'/g, "\\'")}', '${song.img}', '${song.audioUrl}', '${song.duration}', '${artistId || ''}')" style="background:white; color:black; border:none; border-radius:50%; width:40px; height:40px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="fas fa-play"></i></button>
                    <button class="card-like-btn" data-song-id="${song.id}" onclick="event.stopPropagation(); toggleSongLike(this, '${song.id}', '${song.title.replace(/'/g, "\\'")}', '${song.artist.replace(/'/g, "\\'")}', '${song.img}', '${song.audioUrl}', '${song.duration}')" style="background:rgba(255,255,255,0.2); color:white; border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; display:flex; align-items:center; justify-content:center;"><i class="far fa-heart"></i></button>
                </div>
            </div>
            <div class="card-info"><div class="card-title">${song.title}</div><div class="card-subtitle">${song.artist}</div></div>`;
        this.checkSongLikeStatus(song.id, card.querySelector('.card-like-btn i'));
        return card;
    }

    createCrateCard(crate) {
        const card = document.createElement('div');
        // Use 'media-card' class to inherit the horizontal scroll layout styles
        card.className = 'media-card crate-card-dashboard';
        card.style.minWidth = '160px'; 
        
        // Handle click - Navigate to crate view
        card.onclick = () => window.navigateTo(`/player/crate/${crate.id}`);
        
        // Image logic with fallback to coverImage or placeholder - FIXED: Use fixImageUrl
        const rawImage = crate.img || crate.coverImage || 'https://via.placeholder.com/150';
        const image = this.fixImageUrl(rawImage);
        
        // Build genre tag (limit to 1 for dashboard compactness)
        let genreTag = '';
        if (crate.genres && crate.genres.length > 0) {
            genreTag = `<span style="font-size:0.65rem; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; color:#aaa;">${crate.genres[0]}</span>`;
        }

        // Use songCount alias or trackCount
        const count = crate.songCount || crate.trackCount || 0;

        card.innerHTML = `
            <div class="img-container" style="position:relative; border-radius:12px; overflow:hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
                <img src="${image}" loading="lazy" style="width:100%; height:100%; object-fit:cover; transition:transform 0.3s;">
                
                <div class="play-overlay" style="display:flex; justify-content:center; align-items:center; background:rgba(0,0,0,0.4); position:absolute; inset:0; opacity:0; transition:opacity 0.2s;">
                    <i class="fas fa-box-open" style="color:white; font-size:2rem; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))"></i>
                </div>
                
                <div style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.7); color:white; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:700; backdrop-filter:blur(4px);">
                    ${count} tracks
                </div>
            </div>
            
            <div class="card-info" style="padding-top:8px;">
                <div class="card-title" style="margin-bottom:2px; font-size:0.95rem;">${crate.title}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="card-subtitle" style="opacity:0.7; font-size:0.8rem;">by ${crate.creatorHandle || 'Anonymous'}</div>
                    ${genreTag}
                </div>
            </div>`;
            
        // Add JS-based hover effects
        card.onmouseenter = () => {
            const img = card.querySelector('img');
            const overlay = card.querySelector('.play-overlay');
            if(img) img.style.transform = 'scale(1.05)';
            if(overlay) overlay.style.opacity = '1';
        };
        card.onmouseleave = () => {
            const img = card.querySelector('img');
            const overlay = card.querySelector('.play-overlay');
            if(img) img.style.transform = 'scale(1)';
            if(overlay) overlay.style.opacity = '0';
        };

        return card;
    }

    createArtistCircle(artist, locationName) {
        const circle = document.createElement('div');
        circle.className = 'artist-circle-item';
        circle.style.cssText = "display:flex; flex-direction:column; align-items:center; min-width:120px; cursor:pointer;";
        circle.onclick = () => window.navigateTo(`/player/artist/${artist.id}`);
        circle.innerHTML = `<img src="${artist.img || 'https://via.placeholder.com/100'}" style="width:120px; height:120px; border-radius:50%; object-fit:cover; border:2px solid #fff; box-shadow:0 4px 10px rgba(0,0,0,0.1);"><span style="margin-top:10px; font-weight:700; font-size:0.9rem; text-align:center;">${artist.name || artist.handle}</span><span style="font-size:0.8rem; color:#888;">${artist.location || locationName}</span>`;
        return circle;
    }

    createEmptyState(msg) {
        return `<div style="padding:20px; color:var(--text-muted); font-size:0.9rem; width:100%; text-align:center;">${msg}</div>`;
    }

    showToast(msg) {
        const toast = document.createElement('div');
        toast.innerText = msg;
        toast.style.cssText = `position:fixed; bottom:80px; right:20px; background:#333; color:#fff; padding:10px 20px; border-radius:5px; z-index:1000; animation: fadeIn 0.3s;`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    formatTime(seconds) {
        if (!seconds) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    updatePlayerUI(track) {
        if(!track) return;

        // 1. Update Text Info
        document.querySelectorAll('#d-title-full, #d-title-mini').forEach(el => el.innerText = track.title);
        document.querySelectorAll('#d-artist-full, #d-artist-mini').forEach(el => el.innerText = track.artist);
        
        // 2. [RESTORED] Update Total Duration Time
        if (track.duration) {
            const m = Math.floor(track.duration / 60);
            const s = Math.floor(track.duration % 60);
            const timeString = `${m}:${s < 10 ? '0' : ''}${s}`;
            
            // Update both full player and any mini player time displays
            const totalEl = document.getElementById('totalTime');
            if (totalEl) totalEl.innerText = timeString;
        }

        // 3. Update Artwork
        const artElements = document.querySelectorAll('#d-art-full, #d-art-mini');
        if (track.artUrl && track.artUrl !== 'null') {
            artElements.forEach(el => {
                el.style.backgroundImage = `url('${track.artUrl}')`;
                if(el.id === 'd-art-full') el.style.backgroundSize = 'cover';
                el.classList.remove('art-placeholder');
            });
        }

        // 4. Update Heart Status
        const heartIcon = document.querySelector('.player-full .fa-heart') || document.querySelector('.mp-controls .fa-heart');
        if (heartIcon) this.checkSongLikeStatus(track.id, heartIcon);
        
        // NEW: Update quality badge
        this.updateQualityBadge(track);
    }

    setupSeekbar() {
        // We look for the container wrapper, not just the colored fill bar
        const progressContainer = document.querySelector('.progress-track') || document.getElementById('progressBar')?.parentElement;
        
        if (progressContainer) {
            progressContainer.style.cursor = 'pointer';
            
            // Handle Click / Scrub
            progressContainer.addEventListener('click', (e) => {
                if (!this.engine.currentTrack) return;
                
                const rect = progressContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                const pct = Math.max(0, Math.min(1, clickX / width)); // Clamp between 0-1
                
                // Calculate new time
                const seekTime = pct * this.engine.trackDuration;
                
                // Tell engine to jump
                this.engine.seek(seekTime);
                
                // Optimistic UI update (move bar instantly)
                this.updateProgressBar({ 
                    progress: pct, 
                    currentTime: seekTime 
                });
            });
        }
    }

    updateProgressBar({ progress, currentTime, duration, buffering }) {
        // 1. Move the colored bar
        const bar = document.getElementById('progressBar'); // The colored fill
        if (bar) {
            bar.style.width = `${progress * 100}%`;
            
            // NEW: Visual buffering indicator
            if (buffering) {
                bar.classList.add('buffering');
            } else {
                bar.classList.remove('buffering');
            }
        }
        
        // 2. [RESTORED] Update the "Current Time" text
        const timeEl = document.getElementById('currentTime');
        if (timeEl) {
            timeEl.innerText = this.formatTime(currentTime);
        }
        
        // NEW: Update duration if provided
        if (duration) {
            const durationEl = document.getElementById('totalTime');
            if (durationEl) {
                durationEl.innerText = this.formatTime(duration);
            }
        }
    }
    
    updatePlayPauseIcons(isPlaying) {
        document.querySelectorAll('.fa-play, .fa-pause').forEach(icon => {
            if (icon.parentElement.matches('.btn-play-hero, .btn-play-mini, .mp-play')) {
                icon.classList.toggle('fa-pause', isPlaying);
                icon.classList.toggle('fa-play', !isPlaying);
            }
        });
    }

    setupViewObserver() {
        const observer = new MutationObserver(() => {
            this.checkAndReloadViews();
            this.updateSidebarState();
        });
        const target = document.querySelector('.main-wrapper') || document.body;
        observer.observe(target, { childList: true, subtree: true });
    }

    updateSidebarState() {
        const currentPath = window.location.pathname;
        document.querySelectorAll('.sidebar .nav-item').forEach(item => {
            item.classList.remove('active');
            const onClickAttr = item.getAttribute('onclick');
            if (onClickAttr && onClickAttr.includes(currentPath)) item.classList.add('active');
        });
    }

    renderSidebarArtists(artists) {
        const container = document.getElementById('sidebarArtistList');
        if (!container) return;
        if (!artists || artists.length === 0) {
            container.innerHTML = '<div style="padding:10px; font-size:0.8rem; color:#888">No artists followed yet.</div>';
            return;
        }
        container.innerHTML = artists.map(artist => `
            <div class="artist-item" onclick="navigateTo('/player/artist/${artist.id}')">
                <img src="${artist.img || 'https://via.placeholder.com/50'}" style="background:#333; width:32px; height:32px; border-radius:50%; object-fit:cover;">
                <span>${artist.name}</span>
            </div>`).join('');
    }



    checkUserTheme(userData) {
        let targetTheme = null;

        // [FIX] Priority 1: Check inside 'settings' object (where we save it)
        if (userData.settings && userData.settings.theme) {
            targetTheme = userData.settings.theme;
        }
        // Priority 2: Check root level (Backward compatibility)
        else if (userData.theme) {
            targetTheme = userData.theme;
        } 
        // Priority 3: Check primaryGenre
        else if (userData.primaryGenre) {
            targetTheme = userData.primaryGenre;
        } 
        // Priority 4: Fallback to genres array
        else if (userData.genres && userData.genres.length > 0) {
            targetTheme = userData.genres[0];
        }

        if (targetTheme) {
            this.applyGenreTheme(targetTheme);
        }
    }

    applyGenreTheme(genreKey) {
        // 1. Clean the key to match CSS (e.g. "hip_hop" -> "hip-hop")
        const themeSlug = genreKey.toLowerCase().replace(/_/g, '-');
        const themeClass = `theme-${themeSlug}`;

        // 2. Remove any existing genre themes
        document.body.classList.forEach(cls => {
            if (cls.startsWith('theme-')) document.body.classList.remove(cls);
        });

        // 3. Add new theme
        document.body.classList.add(themeClass);
        // console.log(`🎨 Theme Applied: ${themeSlug}`);

        // 4. Load Fonts Dynamically
        this.injectGenreFonts(themeSlug);
    }

    injectGenreFonts(themeSlug) {
        // Map of fonts needed for each theme to keep initial load light
        const fontMap = {
            'pop':        'Montserrat:wght@800&family=Quicksand:wght@500;700',
            'electronic': 'Orbitron:wght@900&family=Rajdhani:wght@500;700',
            'hip-hop':    'Archivo+Black&family=Inter:wght@400;800',
            'rock':       'Teko:wght@600&family=Open+Sans:wght@400;800',
            'rnb':        'Playfair+Display:ital,wght@0,700;1,700&family=Lato:wght@400;700',
            'jazz':       'Abril+Fatface&family=Lora:ital,wght@0,500;1,500',
            'country':    'Rye&family=Merriweather:wght@400;900',
            'reggae':     'Chelsea+Market&family=Rubik:wght@400;700',
            'classical':  'Cinzel:wght@700&family=EB+Garamond:wght@400;600'
        };

        if (!fontMap[themeSlug]) return;

        // Check if already injected
        const linkId = `font-${themeSlug}`;
        if (document.getElementById(linkId)) return;

        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${fontMap[themeSlug]}&display=swap`;
        document.head.appendChild(link);
    }

    initAuthListener() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    // Load likes FIRST before hydrating any buttons
                    await this.loadUserLikes();
                    
                    // [FIX] Force dashboard load if we're on that page
                    const currentPath = window.location.pathname;
                    if (currentPath.includes('/dashboard')) {
                        // console.log('[INIT] Dashboard page detected, forcing data load...');
                        await this.loadSceneDashboard();
                    }
                    
                    // Now safe to check and hydrate views
                    this.checkAndReloadViews();
                    this.loadUserWallet(); // Ensure sidebar updates
                    this.setupNotifications();
                    
                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    if(userDoc.exists()) {
                        const data = userDoc.data();
                        window.globalUserCache = { ...window.globalUserCache, ...data };
                        this.engine.updateSettings(data.settings || {});
                        this.checkUserTheme(data);
                        
                        const nameEl = document.getElementById('profileName');
                        const picEl = document.getElementById('profilePic');
                        if (nameEl) nameEl.innerText = data.handle || "Member";

                        // [FIX] Use the helper to clean the URL for the sidebar
                        if (picEl && data.photoURL) {
                            picEl.src = this.fixImageUrl(data.photoURL);
                        }

                        this.renderSidebarArtists(data.sidebarArtists || []);
                    }
                } catch (err) { console.error("Profile Error:", err); }
            }
        });
    }

    
    // --- GLOBAL FUNCTIONS ---
    exposeGlobalFunctions() {
        window.playSong = (id, title, artist, artUrl, audioUrl, duration, artistId = null) => {
            // console.log("▶️ Global PlaySong:", { title, artistId });

            this.engine.play(id, { 
                id: id,
                title: title, 
                artist: artist, 
                artUrl: this.fixImageUrl(artUrl), // Use helper to fix R2 links
                audioUrl: audioUrl, 
                duration: duration ? parseFloat(duration) : 0,
                artistId: artistId // <--- PASS THIS TO ENGINE
            }); 
        };

        window.togglePlay = () => this.engine.togglePlay();
        window.togglePlayerSize = this.togglePlayerSize;
        window.addToQueue = (id, title, artist, artUrl, audioUrl, duration) => {
            if(event) event.stopPropagation(); 
            this.addToQueue(id, title, artist, artUrl, audioUrl, duration);
        };
        window.playAllFavorites = () => this.playAllFavorites();
        window.toggleProfileMenu = () => document.getElementById('profileDropdown')?.classList.toggle('active');
        
        // NEW: City navigation functions
        window.navigateToCity = (city, state, country) => this.navigateToCity(city, state, country);
        
        // NEW: Open city soundscape map
        window.openCitySearch = () => this.openCitySearch();

        // [NEW] Artist Tab Switcher
        window.switchArtistTab = (tabName) => {
            // 1. Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            
            // 2. Show target content
            const target = document.getElementById(`tab-${tabName}`);
            if (target) target.style.display = 'block';
            
            // 3. Update Active Button State
            document.querySelectorAll('.profile-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
            if (event && event.target) event.target.classList.add('active');
        };

        // [RESTORED] Anthem Playback logic
       window.playAnthem = () => {
        const card = document.getElementById('anthemPlayer');
        if (!card || !card.dataset.songId) {
            this.showToast('No anthem set yet.');
            return;
        }
        
        // [FIX] Changed 'img' to 'artUrl' so the Player UI can render the background
        this.engine.play(card.dataset.songId, {
            title: card.dataset.songTitle,
            artist: card.dataset.songArtist,
            artUrl: card.dataset.songImg, 
            audioUrl: card.dataset.audioUrl,
            duration: parseFloat(card.dataset.duration) || 0
            });
        };

        // [RESTORED] Missing Profile Tab Switcher
        window.switchProfileTab = (tab) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById(`tab-${tab}`);
            if(target) target.style.display = 'block';
            
            // Update active button state
            document.querySelectorAll('.tab-btn').forEach(btn => 
                btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(tab))
            );
        };

        // [FIX] Exposed switchSubTab to window
        window.switchSubTab = (subTab) => {
            const artistView = document.getElementById('followingArtistsView');
            const userView = document.getElementById('followingUsersView');
            const artistBtn = document.getElementById('subBtnArtists');
            const userBtn = document.getElementById('subBtnUsers');
            
            if (subTab === 'artists') {
                if(artistView) artistView.style.display = 'block';
                if(userView) userView.style.display = 'none';
                if(artistBtn) { artistBtn.classList.add('active'); artistBtn.style.opacity = '1'; artistBtn.style.color = 'var(--text-main)'; }
                if(userBtn) { userBtn.classList.remove('active'); userBtn.style.opacity = '0.6'; userBtn.style.color = 'var(--text-secondary)'; }
            } else {
                if(artistView) artistView.style.display = 'none';
                if(userView) userView.style.display = 'block';
                if(artistBtn) { artistBtn.classList.remove('active'); artistBtn.style.opacity = '0.6'; artistBtn.style.color = 'var(--text-secondary)'; }
                if(userBtn) { userBtn.classList.add('active'); userBtn.style.opacity = '1'; userBtn.style.color = 'var(--text-main)'; }
            }
        };

        // Switch between Created and Liked crates in Signature Stack
        window.switchStackTab = (stackTab) => {
            const createdView = document.getElementById('createdCratesView');
            const likedView = document.getElementById('likedCratesView');
            const createdBtn = document.getElementById('subBtnCreated');
            const likedBtn = document.getElementById('subBtnLiked');
            
            if (stackTab === 'created') {
                if(createdView) createdView.style.display = 'block';
                if(likedView) likedView.style.display = 'none';
                if(createdBtn) { createdBtn.classList.add('active'); createdBtn.style.opacity = '1'; createdBtn.style.color = 'var(--text-main)'; }
                if(likedBtn) { likedBtn.classList.remove('active'); likedBtn.style.opacity = '0.6'; likedBtn.style.color = 'var(--text-secondary)'; }
            } else {
                if(createdView) createdView.style.display = 'none';
                if(likedView) likedView.style.display = 'block';
                if(createdBtn) { createdBtn.classList.remove('active'); createdBtn.style.opacity = '0.6'; createdBtn.style.color = 'var(--text-secondary)'; }
                if(likedBtn) { likedBtn.classList.add('active'); likedBtn.style.opacity = '1'; likedBtn.style.color = 'var(--text-main)'; }
            }
        };

        window.togglePlayerLike = () => this.togglePlayerLike();
        window.toggleFollow = (btn) => this.toggleFollow(btn); // Re-expose Follow
        window.toggleSongLike = (btn, songId, title, artist, artUrl, audioUrl, duration) => {
            this.toggleSongLike(btn, songId, title, artist, artUrl, audioUrl, duration);
        };
        
        // Expose helper functions for debugging/manual refresh
        window.refreshLikeStates = () => this.hydrateGlobalButtons();
        window.checkSongLikeStatus = (songId, iconElement) => this.checkSongLikeStatus(songId, iconElement);
        
        // Load More Artists
        window.loadMoreArtists = () => this.loadMoreArtists();
        window.loadMoreArtistsBatch = () => this.loadArtistsBatch();

        // REMOVED: Old city search (now uses map modal)
        // window.openCitySearch = () => window.setSearchMode('city');
        
        window.switchSettingsTab = (tabName) => {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById('tab-' + tabName);
            if(target) target.style.display = 'block';
            document.querySelectorAll('.settings-tabs .tab-btn').forEach(el => el.classList.remove('active'));
            if(event && event.currentTarget) event.currentTarget.classList.add('active');
        };
        
        // ADDED: Expose updateSetting for settings page (was missing!)
        window.updateSetting = (key, value) => {
            // console.log(`[SETTINGS] updateSetting called: ${key} = ${value}`);
            this.updateGlobalSetting(key, value);
        };

        window.updateEQ = () => {
            const high = document.querySelector('input[name="eqHigh"]')?.value;
            const mid = document.querySelector('input[name="eqMid"]')?.value;
            const low = document.querySelector('input[name="eqLow"]')?.value;
            
            // NEW: Update value displays
            const highValEl = document.getElementById('eqHighVal');
            const midValEl = document.getElementById('eqMidVal');
            const lowValEl = document.getElementById('eqLowVal');
            
            if (highValEl && high !== undefined) highValEl.textContent = high + ' dB';
            if (midValEl && mid !== undefined) midValEl.textContent = mid + ' dB';
            if (lowValEl && low !== undefined) lowValEl.textContent = low + ' dB';
            
            if (high) this.updateGlobalSetting('eqHigh', parseFloat(high));
            if (mid) this.updateGlobalSetting('eqMid', parseFloat(mid));
            if (low) this.updateGlobalSetting('eqLow', parseFloat(low));
        };
        
        // NEW: Reset EQ function
        window.resetEQ = () => {
            const eqHigh = document.getElementById('eqHigh');
            const eqMid = document.getElementById('eqMid');
            const eqLow = document.getElementById('eqLow');
            
            if (eqHigh) eqHigh.value = 0;
            if (eqMid) eqMid.value = 0;
            if (eqLow) eqLow.value = 0;
            
            window.updateEQ();
            this.showToast('EQ reset to flat');
        };
        
        window.sendCmd = (cmd) => {
            if (cmd === 'next') {
                this.engine.playNext();
                // Optional: Update UI to show we skipped
                this.showToast('Skipping to next track... ⏭️');
            } else if (cmd === 'prev') {
                // Since we don't track history yet, 'prev' usually restarts the song
                this.engine.seek(0);
                this.showToast('Replaying track ⏮️');
            }
        };
        
        // NEW: Enhanced playback controls
        window.skipForward = (seconds = 10) => {
            this.engine.skipForward(seconds);
            this.showToast(`⏩ +${seconds}s`);
        };
        
        window.skipBackward = (seconds = 10) => {
            this.engine.skipBackward(seconds);
            this.showToast(`⏪ -${seconds}s`);
        };
        
        window.shuffleQueue = () => {
            if (this.engine.queue.length < 2) {
                this.showToast('Need at least 2 tracks to shuffle');
                return;
            }
            this.engine.shuffleQueue();
            this.showToast('🔀 Queue shuffled');
        };
        
        window.clearQueue = () => {
            if (this.engine.queue.length === 0) {
                this.showToast('Queue is already empty');
                return;
            }
            if (confirm(`Clear all ${this.engine.queue.length} tracks from queue?`)) {
                this.engine.clearQueue();
                this.showToast('Queue cleared');
            }
        };
        
        window.showStats = () => this.showPlaybackStats();
        
        window.triggerProfileUpload = () => this.triggerProfileUpload();
        window.saveProfileChanges = () => this.saveProfileChanges();
        window.saveSettings = () => this.saveSettings();
        window.playCrate = (shuffle) => this.playCrate(shuffle);
        window.playCrateTrack = (index) => this.playCrateTrack(index);
        window.toggleCrateLike = () => this.toggleCrateLike();
     
    }
    
    togglePlayerSize() {
        this.isMinimized = !this.isMinimized;
        const rightSidebar = document.getElementById('rightSidebar');
        if (rightSidebar) rightSidebar.classList.toggle('minimized', this.isMinimized);
    }
    
    async togglePlayerLike() {
        if (!this.engine.currentTrack) return;
        const heartBtn = document.querySelector('.mp-controls .fa-heart')?.parentElement || document.querySelector('.player-full .fa-heart')?.parentElement;
        if (heartBtn) {
            const t = this.engine.currentTrack;
            await this.toggleSongLike(heartBtn, t.id, t.title, t.artist, t.artUrl, t.audioUrl, t.duration);
        }
    }
    
    async playAllFavorites() {
        if (!auth.currentUser) return;
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/favorites', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (data.songs && data.songs.length > 0) {
                const first = data.songs[0];
                window.playSong(first.id, first.title, first.artist, first.img, first.audioUrl, first.duration);
                for (let i = 1; i < data.songs.length; i++) {
                    const s = data.songs[i];
                    this.engine.addToQueue({ 
                        id: s.id, title: s.title, artist: s.artist, 
                        artUrl: s.img, audioUrl: s.audioUrl, duration: s.duration 
                    });
                }
                this.showToast(`Playing ${data.songs.length} Liked Songs`);
            }
        } catch (e) { console.error(e); }
    }

    // ==========================================
    // H. SEARCH SYSTEM (Missing Functions)
    // ==========================================
    setupOmniSearch() {
        // 1. Expose Global Helper for Filter Menu
        window.toggleSearchFilter = () => {
            const menu = document.getElementById('searchFilterMenu');
            if (menu) menu.classList.toggle('active');
        };
        
        // 2. Expose Search Mode Switcher
        window.setSearchMode = (mode) => {
            const input = document.getElementById('mainSearchInput');
            const icon = document.getElementById('currentSearchIcon');
            const menu = document.getElementById('searchFilterMenu');
            let prefix = '', placeholder = 'Search...', iconClass = 'fa-search';

            switch(mode) {
                case 'artist': prefix = '@'; placeholder = 'Search artists...'; iconClass = 'fa-microphone-alt'; break;
                case 'song': prefix = 's:'; placeholder = 'Search songs...'; iconClass = 'fa-music'; break;
                case 'city': prefix = 'C:'; placeholder = 'Search cities...'; iconClass = 'fa-city'; break;
                default: prefix = ''; placeholder = 'Search...'; iconClass = 'fa-search';
            }

            if(icon) icon.className = `fas ${iconClass}`;
            if(menu) menu.classList.remove('active');
            
            if(input) {
                input.value = prefix; 
                input.placeholder = placeholder; 
                input.focus();
            }
        };
        
        // 3. DELEGATED Input Listener (SPA Safe)
        // We attach to document so it works even if the search bar is re-rendered
        let debounceTimer;
        document.addEventListener('input', (e) => {
            // Only trigger if the event came from the main search input
            if (e.target && e.target.id === 'mainSearchInput') {
                const query = e.target.value;
                const resultsBox = document.getElementById('searchResults');
                
                clearTimeout(debounceTimer);
                
                // Hide box if query is too short
                if (query.length < 2) { 
                    if(resultsBox) resultsBox.classList.remove('active'); 
                    return; 
                }

                debounceTimer = setTimeout(async () => {
                    if(resultsBox) {
                        resultsBox.innerHTML = '<div class="search-placeholder"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
                        resultsBox.classList.add('active');
                    }
                    
                    try {
                        const token = await auth.currentUser.getIdToken();
                        const res = await fetch(`/player/api/search?q=${encodeURIComponent(query)}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        const data = await res.json();
                        this.renderSearchResults(data.results);
                    } catch (err) { 
                        console.error("Search Error:", err); 
                    }
                }, 300);
            }
        });
        
        // 4. Click Outside to Close (Delegated)
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                document.getElementById('searchFilterMenu')?.classList.remove('active');
                document.getElementById('searchResults')?.classList.remove('active');
            }
        });
    }

    renderSearchResults(results) {
        const box = document.getElementById('searchResults');
        if (!box) return;
        
        box.innerHTML = '';
        if (!results || results.length === 0) {
            box.innerHTML = '<div class="search-placeholder">No results found.</div>';
            return;
        }
        
        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            
            // Handle Image logic
            let imgHtml = '';
            if (item.img) {
                imgHtml = `<img src="${item.img}" class="result-img">`;
            } else {
                imgHtml = '<div class="result-img square"></div>';
            }
            
            // Handle Click
            div.onclick = () => {
                if (item.type === 'song') {
                    window.playSong(item.id, item.title, item.subtitle, item.img, item.audioUrl, item.duration);
                } else if (item.url) {
                    window.navigateTo(item.url);
                }
                box.classList.remove('active');
            };
            
            div.innerHTML = `
                ${imgHtml}
                <div class="result-info">
                    <div class="result-title">${item.title}</div>
                    <div class="result-sub">${item.subtitle}</div>
                </div>`;
            box.appendChild(div);
        });
    }

    async checkFollowStatus(artistId) {
        if (!auth.currentUser) return;
        try {
            const token = await auth.currentUser.getIdToken();
            // WAS: /status?artistId... -> NOW: /check?artistId... (Matches player.js)
            const res = await fetch(`/player/api/artist/follow/check?artistId=${artistId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            this.updateFollowButtonUI(data.following);
        } catch (e) { console.error("Status check failed", e); }
    }


    async loadMoreArtists() {
        try {
            const modal = document.createElement('div');
            modal.className = 'artists-modal';
            modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1000;';
            modal.innerHTML = `
                <div class="modal-overlay" onclick="this.parentElement.remove()" 
                     style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                     background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);"></div>
                <div class="modal-content" style="position: relative; background: var(--card-bg); 
                     max-width: 900px; max-height: 85vh; margin: 5vh auto; border-radius: 20px; 
                     overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div class="modal-header" style="display: flex; justify-content: space-between; 
                         align-items: center; padding: 25px 30px; border-bottom: 1px solid var(--border-color);">
                        <h2 style="margin: 0; color: var(--text-main); font-size: 1.5rem; font-weight: 900;">
                            Artists in ${window.currentCity || 'Your City'}
                        </h2>
                        <button onclick="this.closest('.artists-modal').remove()" 
                                style="background: none; border: none; font-size: 1.5rem; cursor: pointer; 
                                color: var(--text-secondary); transition: 0.2s;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div id="allArtistsList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); 
                         gap: 20px; padding: 30px; max-height: calc(85vh - 150px); overflow-y: auto;">
                        <div style="grid-column: 1/-1; text-align: center; padding: 60px;">
                            <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: var(--primary);"></i>
                            <p style="margin-top: 15px; color: var(--text-secondary);">Loading artists...</p>
                        </div>
                    </div>
                    <div style="text-align: center; padding: 20px; border-top: 1px solid var(--border-color);">
                        <button id="loadMoreBtn" onclick="window.loadMoreArtistsBatch()" 
                                style="background: var(--primary); color: #000; padding: 12px 35px; 
                                border-radius: 25px; border: none; font-weight: 800; cursor: pointer; 
                                font-size: 0.95rem; transition: 0.2s;">
                            Load More
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Initialize and load first batch
            window.artistsOffset = 0;
            window.artistsLimit = 24;
            await this.loadArtistsBatch();

        } catch (e) {
            console.error("Load More Artists Error:", e);
        }
    }

    async loadArtistsBatch() {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(
                `/player/api/artists/local?city=${encodeURIComponent(window.currentCity)}&offset=${window.artistsOffset}&limit=${window.artistsLimit}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            const data = await res.json();

            const container = document.getElementById('allArtistsList');
            
            if (window.artistsOffset === 0) {
                container.innerHTML = '';
            }

            if (data.artists && data.artists.length > 0) {
                data.artists.forEach(artist => {
                    const card = document.createElement('div');
                    card.className = 'artist-card-modal';
                    card.style.cssText = 'cursor: pointer; text-align: center; transition: 0.2s;';
                    card.onmouseenter = () => card.style.transform = 'translateY(-5px)';
                    card.onmouseleave = () => card.style.transform = 'translateY(0)';
                    card.onclick = () => {
                        window.navigateTo(`/player/artist/${artist.id}`);
                        document.querySelector('.artists-modal').remove();
                    };
                    card.innerHTML = `
                        <img src="${artist.img}" 
                             style="width: 100%; aspect-ratio: 1; border-radius: 50%; object-fit: cover; 
                             margin-bottom: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
                        <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main); 
                             margin-bottom: 4px;">${artist.name}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">
                            ${artist.followers || 0} followers
                        </div>
                    `;
                    container.appendChild(card);
                });

                window.artistsOffset += data.artists.length;

                // Hide "Load More" if no more artists
                const loadMoreBtn = document.getElementById('loadMoreBtn');
                if (data.artists.length < window.artistsLimit) {
                    loadMoreBtn.style.display = 'none';
                } else {
                    loadMoreBtn.style.display = 'inline-block';
                }
            } else {
                if (window.artistsOffset === 0) {
                    container.innerHTML = `
                        <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                            <i class="fas fa-music" style="font-size: 3rem; color: var(--text-secondary); 
                               opacity: 0.3; margin-bottom: 15px;"></i>
                            <p style="color: var(--text-secondary); font-size: 1rem;">
                                No artists found in ${window.currentCity} yet.
                            </p>
                            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 10px;">
                                Be the first to represent!
                            </p>
                        </div>
                    `;
                }
                document.getElementById('loadMoreBtn').style.display = 'none';
            }

        } catch (e) {
            console.error("Load Artists Batch Error:", e);
            const container = document.getElementById('allArtistsList');
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <p>Failed to load artists. Please try again.</p>
                </div>
            `;
        }
    }

    // ==========================================
    // I. CRATE VIEW LOGIC (New)
    // ==========================================

    async loadCrateView(crateId) {
        this.currentCrateId = crateId;
        
        // 1. Fetch Full Crate Data (Tracks are needed for playback)
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/crate/${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            // Store locally for playback functions
            this.activeCrateData = data;
            
            // 2. Check Like Status
            this.checkCrateLikeStatus(crateId);
            
        } catch (e) {
            console.error("Load Crate Error:", e);
            this.showToast("Failed to load crate data");
        }
    }


    async playCrate(crateIdOrShuffle = false) {
        let tracks = [];
        let shuffle = false;
        let targetCrateId = null;

        // SCENARIO A: Called with an ID
        if (typeof crateIdOrShuffle === 'string') {
            targetCrateId = crateIdOrShuffle;
            this.showToast('Loading crate...');
            try {
                const token = await auth.currentUser.getIdToken();
                const res = await fetch(`/player/api/crate/${targetCrateId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                
                if(!data.tracks || data.tracks.length === 0) {
                    this.showToast("Crate is empty");
                    return;
                }
                tracks = data.tracks;
            } catch(e) {
                console.error(e);
                this.showToast('Could not play crate');
                return;
            }
        } 
        // SCENARIO B: Called from View
        else {
            shuffle = crateIdOrShuffle;
            if (!this.activeCrateData || !this.activeCrateData.tracks) {
                this.showToast("No active crate to play");
                return;
            }
            tracks = [...this.activeCrateData.tracks];
            targetCrateId = this.currentCrateId;
        }

        if (tracks.length === 0) return;

        // 2. Handle Shuffle
        if (shuffle) {
            for (let i = tracks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
            }
            this.showToast('🔀 Shuffling crate...');
        } else if (typeof crateIdOrShuffle !== 'string') {
            this.showToast('Playing crate...');
        }

        // 3. Play First Track
        const first = tracks[0];
        
        // [CRITICAL FIX] Ensure artistId is passed
        const firstArtistId = first.artistId || first.ownerId || first.uid || null;

        await this.engine.play(first.id, {
            id: first.id, // Good practice to include ID in the object too
            artistId: firstArtistId, // <--- FIX ADDED HERE
            title: first.title,
            artist: first.artist,
            artUrl: first.artUrl || first.img,
            audioUrl: first.audioUrl,
            audioUrls: first.audioUrls,
            duration: parseFloat(first.duration) || 0,
            quality: first.quality
        });

        // 4. Queue the rest
        this.engine.queue = []; 
        for (let i = 1; i < tracks.length; i++) {
            const t = tracks[i];
            const tArtistId = t.artistId || t.ownerId || t.uid || null; // <--- FIX ADDED HERE
            
            this.engine.addToQueue({
                id: t.id,
                artistId: tArtistId, // <--- FIX ADDED HERE
                title: t.title,
                artist: t.artist,
                artUrl: t.artUrl || t.img,
                audioUrl: t.audioUrl,
                audioUrls: t.audioUrls,
                duration: parseFloat(t.duration) || 0,
                quality: t.quality
            });
        }
        
        // 5. Log the play
        if (targetCrateId && window.logCratePlay) window.logCratePlay(targetCrateId);
    }

    async playCrateTrack(index) {
        if (!this.activeCrateData || !this.activeCrateData.tracks) return;

        const tracks = this.activeCrateData.tracks;
        const track = tracks[index];

        // [CRITICAL FIX] Ensure artistId is passed
        const trackArtistId = track.artistId || track.ownerId || track.uid || null;

        // Play selected
        await this.engine.play(track.id, {
            id: track.id,
            artistId: trackArtistId, // <--- FIX ADDED HERE
            title: track.title,
            artist: track.artist,
            artUrl: track.artUrl || track.img,
            audioUrl: track.audioUrl,
            audioUrls: track.audioUrls,
            duration: parseFloat(track.duration) || 0,
            quality: track.quality
        });

        // Queue remaining tracks (from index + 1 to end)
        this.engine.queue = [];
        for (let i = index + 1; i < tracks.length; i++) {
            const t = tracks[i];
            const tArtistId = t.artistId || t.ownerId || t.uid || null; // <--- FIX ADDED HERE
            
            this.engine.addToQueue({
                id: t.id,
                artistId: tArtistId, // <--- FIX ADDED HERE
                title: t.title,
                artist: t.artist,
                artUrl: t.artUrl || t.img,
                audioUrl: t.audioUrl,
                audioUrls: t.audioUrls,
                duration: parseFloat(t.duration) || 0,
                quality: t.quality
            });
        }
    }

    async toggleCrateLike() {
        if (!this.currentCrateId) return;
        const btn = document.querySelector('.btn-like-crate');
        const icon = btn.querySelector('i');

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/crate/like/toggle', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ crateId: this.currentCrateId })
            });
            const data = await res.json();

            if (data.liked) {
                icon.classList.remove('far'); icon.classList.add('fas');
                btn.classList.add('liked');
                this.showToast('Added to collection');
            } else {
                icon.classList.remove('fas'); icon.classList.add('far');
                btn.classList.remove('liked');
                this.showToast('Removed from collection');
            }
        } catch (e) {
            console.error("Crate Like Error:", e);
        }
    }

    async checkCrateLikeStatus(crateId) {
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/crate/like/check?crateId=${crateId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.liked) {
                const btn = document.querySelector('.btn-like-crate');
                if (btn) {
                    btn.classList.add('liked');
                    const icon = btn.querySelector('i');
                    icon.classList.remove('far');
                    icon.classList.add('fas');
                }
            }
        } catch (e) { console.error(e); }
    }

  setupNotifications() {
        if (!auth.currentUser) return;

        // 1. Initial Load
        this.checkNotifications();

        // 2. Poll every 60s (Background sync)
        if (this.notifInterval) clearInterval(this.notifInterval);
        this.notifInterval = setInterval(() => this.checkNotifications(), 60000);
    }

    async checkNotifications() {
        // CACHE STRATEGY: Use cache if < 60 seconds old
        const CACHE_TTL = 60 * 1000; 
        const now = Date.now();
        
        if (window.globalUserCache?.notifications && 
           (now - window.globalUserCache.notifTimestamp < CACHE_TTL)) {
            // console.log('⚡ Using cached notifications');
            this.renderNotificationDropdown(window.globalUserCache.notifications);
            return;
        }

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch('/player/api/notifications', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            // Update Cache
            if (!window.globalUserCache) window.globalUserCache = {};
            window.globalUserCache.notifications = data.notifications || [];
            window.globalUserCache.notifTimestamp = now;

            this.renderNotificationDropdown(data.notifications);

        } catch (e) {
            console.error("Notification Check Error:", e);
        }
    }

    renderNotificationDropdown(notifications) {
        const list = document.getElementById('dropdownNotifList');
        const badge = document.getElementById('profileNotifBadge');
        if (!list) return;

        // 1. Update Badge
        const unreadCount = notifications.filter(n => !n.read).length;
        if (badge) {
            badge.innerText = unreadCount;
            badge.style.display = unreadCount > 0 ? 'flex' : 'none';
        }

        // 2. Render List
        if (!notifications || notifications.length === 0) {
            list.innerHTML = '<div class="empty-notif" style="padding:15px; text-align:center; color:var(--text-secondary); font-size:0.8rem">All caught up!</div>';
            return;
        }

        list.innerHTML = notifications.map(n => `
            <div class="dropdown-item ${n.read ? '' : 'unread'}" 
                 style="padding: 10px 15px; border-left: 3px solid ${n.read ? 'transparent' : 'var(--primary)'}; background: ${n.read ? 'transparent' : 'var(--bg-main)'}"
                 onclick="window.ui.handleNotificationClick('${n.id}', '${n.link || ''}')">
                <img src="${n.avatar || 'https://via.placeholder.com/30'}" style="width:30px; height:30px; border-radius:50%; margin-right:10px; object-fit:cover">
                <div style="flex:1">
                    <div style="font-size:0.85rem; font-weight:${n.read ? '600' : '800'}; color:var(--text-main)">${n.fromName}</div>
                    <div style="font-size:0.75rem; color:var(--text-secondary)">${n.message}</div>
                </div>
            </div>
        `).join('');
    }

    async handleNotificationClick(notifId, link) {
        // 1. Optimistic UI Update (Mark read locally)
        if (window.globalUserCache?.notifications) {
            const notif = window.globalUserCache.notifications.find(n => n.id === notifId);
            if (notif) notif.read = true;
            this.renderNotificationDropdown(window.globalUserCache.notifications);
        }

        // 2. Navigate (if link exists)
        if (link) window.navigateTo(link);

        // 3. Sync with Backend (Mark as read in DB)
        try {
            const token = await auth.currentUser.getIdToken();
            await fetch('/player/api/notifications/mark-read', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ notificationId: notifId })
            });
        } catch (e) { console.error("Mark read failed", e); }
    }

    // ==========================================
    // NEW: ENHANCED AUDIO UI METHODS
    // ==========================================
    
    showBuffering(isBuffering) {
        const spinner = document.getElementById('bufferingSpinner');
        const playBtn = document.getElementById('playPauseBtn');
        
        if (spinner) {
            spinner.style.display = isBuffering ? 'block' : 'none';
        }
        
        if (playBtn && isBuffering) {
            playBtn.classList.add('loading');
        } else if (playBtn) {
            playBtn.classList.remove('loading');
        }
    }

    updateQualityBadge(track) {
        const badge = document.getElementById('qualityBadge');
        if (!badge) return;
        
        // Determine quality from URL or metadata
        let quality = 'MP3';
        
        if (track.quality) {
            quality = track.quality;
        } else if (track.audioUrl) {
            if (track.audioUrl.includes('.flac')) quality = 'FLAC';
            else if (track.audioUrl.includes('.m4a')) quality = 'ALAC';
            else if (track.audioUrl.includes('320')) quality = '320';
            else if (track.audioUrl.includes('192')) quality = '192';
        }
        
        badge.textContent = quality;
        badge.className = 'quality-badge quality-' + quality.toLowerCase();
        badge.style.display = 'block';
    }

    updateQueueUI(queue) {
        const queueContainer = document.getElementById('queueList');
        if (!queueContainer) return;
        
        if (queue.length === 0) {
            queueContainer.innerHTML = '<div class="empty-queue" style="padding:20px; text-align:center; color:var(--text-secondary)">Queue is empty</div>';
            return;
        }
        
        queueContainer.innerHTML = queue.map((track, index) => `
            <div class="queue-item" 
                 data-track-id="${track.id}"
                 onclick="window.ui.playQueueIndex(${index})">
                
                <div class="queue-item-drag-handle">
                    <i class="fas fa-grip-vertical"></i>
                </div>
                
                <img src="${this.fixImageUrl(track.artUrl)}" 
                     class="queue-item-art" 
                     alt="${track.title}">
                
                <div class="queue-item-info">
                    <div class="queue-item-title">${track.title}</div>
                    <div class="queue-item-artist">${track.artist}</div>
                </div>
                
                <div class="queue-item-actions">
                    <span class="preload-status" id="preload-${track.id}">
                        <i class="fas fa-circle-notch fa-spin" style="display:none"></i>
                        <i class="fas fa-check-circle" style="display:none; color:var(--success)"></i>
                    </span>
                    
                    <button onclick="event.stopPropagation(); window.ui.removeFromQueue(${index})"
                            class="btn-icon">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="queue-item-duration">${this.formatTime(track.duration)}</div>
            </div>
        `).join('');
    }

    markTrackAsPreloaded(trackId) {
        const statusEl = document.getElementById(`preload-${trackId}`);
        if (!statusEl) return;
        
        const spinner = statusEl.querySelector('.fa-spin');
        const check = statusEl.querySelector('.fa-check-circle');
        
        if (spinner) spinner.style.display = 'none';
        if (check) check.style.display = 'inline';
    }

    updateQueueCount(count) {
        const badge = document.getElementById('queueCountBadge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
    }

    playQueueIndex(index) {
        if (index < 0 || index >= this.engine.queue.length) return;
        
        const track = this.engine.queue[index];
        
        // Remove this track and everything before it from queue
        this.engine.queue.splice(0, index + 1);
        
        // Play the track
        this.engine.play(track.id, track);
    }

    removeFromQueue(index) {
        const removed = this.engine.removeFromQueue(index);
        if (removed) {
            this.showToast(`Removed ${removed.title} from queue`);
        }
    }

    onTrackEnd(track) {
        // Log the completion for analytics
        if (window.logTrackCompletion) {
            window.logTrackCompletion(track.id);
        }
        
        // If queue is empty, could suggest actions
        if (this.engine.queue.length === 0) {
            // console.log('Queue empty - track ended');
        }
    }

    showSupportedFormats() {
        const formatList = document.getElementById('supportedFormatsList');
        if (!formatList) return;
        
        const formats = this.engine.supportedFormats;
        const supported = Object.entries(formats)
            .filter(([_, isSupported]) => isSupported)
            .map(([format]) => format.toUpperCase());
        
        formatList.innerHTML = `
            <div class="settings-info">
                <i class="fas fa-info-circle"></i>
                <span>Your browser supports: ${supported.join(', ')}</span>
            </div>
        `;
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger if typing in input
            if (e.target.matches('input, textarea')) return;
            
            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    this.engine.togglePlay();
                    break;
                    
                case 'ArrowRight':
                    if (e.shiftKey) {
                        this.engine.playNext();
                        this.showToast('⏭️ Next track');
                    } else {
                        this.engine.skipForward(10);
                    }
                    break;
                    
                case 'ArrowLeft':
                    if (e.shiftKey) {
                        this.engine.replay();
                        this.showToast('⏮️ Restart');
                    } else {
                        this.engine.skipBackward(10);
                    }
                    break;
                    
                case 'ArrowUp':
                    e.preventDefault();
                    const currentVol = this.engine.masterBus.gain.value;
                    this.engine.setVolume(Math.min(currentVol + 0.1, 1));
                    this.showToast(`🔊 Volume: ${Math.round((currentVol + 0.1) * 100)}%`);
                    break;
                    
                case 'ArrowDown':
                    e.preventDefault();
                    const vol = this.engine.masterBus.gain.value;
                    this.engine.setVolume(Math.max(vol - 0.1, 0));
                    this.showToast(`🔉 Volume: ${Math.round((vol - 0.1) * 100)}%`);
                    break;
            }
        });
    }

    showPlaybackStats() {
        const stats = this.engine.getStats();
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content stats-modal">
                <h2>📊 Playback Statistics</h2>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-label">Total Plays</span>
                        <span class="stat-value">${stats.totalPlays}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Listen Time</span>
                        <span class="stat-value">${this.formatTime(stats.totalListenTime)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Cached Tracks</span>
                        <span class="stat-value">${stats.cacheSize} / ${this.engine.maxCacheSize}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Queue Length</span>
                        <span class="stat-value">${stats.queueLength}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Currently Playing</span>
                        <span class="stat-value">${stats.currentTrack ? stats.currentTrack.title : 'None'}</span>
                    </div>
                </div>
                <button class="btn-primary" onclick="this.closest('.modal-overlay').remove()">
                    Close
                </button>
            </div>
        `;
        
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        
        document.body.appendChild(modal);
    }
}



export class ArtistCommentsManager {
    constructor(artistId, currentUserId) {
        this.artistId = artistId;
        this.currentUserId = currentUserId;
        this.comments = [];
        this.canComment = false;
        this.isLoading = false;
        this.hasMore = true;
        this.lastTimestamp = null;
        
        // Bind submit to keep context
        this.submitComment = this.submitComment.bind(this);
    }

    async init() {
        await this.checkCommentPermission();
        await this.loadComments();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const form = document.getElementById('artistCommentForm');
        const input = document.getElementById('commentInput');
        const actions = document.getElementById('commentActions');
        const cancelBtn = document.getElementById('cancelCommentBtn');
        const submitBtn = document.getElementById('submitCommentBtn');
        const avatar = document.getElementById('currentUserAvatar');

        // 1. Set User Avatar using the Global Fixer
        if (avatar && window.globalUserCache?.photoURL && window.ui) {
            avatar.src = window.ui.fixImageUrl(window.globalUserCache.photoURL);
            avatar.style.display = 'block';
        }

        // 2. Input Focus Logic (Show Buttons)
        if (input) {
            input.onfocus = () => {
                if (actions) actions.style.display = 'flex'; // Use flex to match your CSS
                if (actions) actions.classList.add('active');
            };

            // Auto-grow & Enable Button
            input.oninput = function() {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
                
                if (submitBtn) {
                    if (this.value.trim().length > 0) {
                        submitBtn.disabled = false;
                        submitBtn.classList.add('ready');
                    } else {
                        submitBtn.disabled = true;
                        submitBtn.classList.remove('ready');
                    }
                }
            };
        }

        // 3. Cancel Button Logic
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                if (input) {
                    input.value = '';
                    input.style.height = 'auto';
                    input.rows = 1;
                    input.blur();
                }
                if (actions) actions.style.display = 'none'; // Hide buttons
            };
        }

        // 4. Submit Logic
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                await this.submitComment();
            };
        }
    }

    async submitComment() {
        const input = document.getElementById('commentInput');
        const submitBtn = document.getElementById('submitCommentBtn');
        const actions = document.getElementById('commentActions');
        
        const text = input ? input.value.trim() : '';
        if (!text) return;

        try {
            if (submitBtn) {
                submitBtn.innerText = 'Posting...';
                submitBtn.disabled = true;
            }

            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/${this.artistId}/comment`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ comment: text })
            });

            const data = await res.json();

            if (data.success) {
                // Reset UI
                if (input) {
                    input.value = '';
                    input.style.height = 'auto';
                    input.blur();
                }
                if (actions) actions.style.display = 'none';
                
                // Add new comment
                this.comments.unshift(data.comment);
                this.renderComments();
                
                // Update count
                const countEl = document.getElementById('commentCount');
                if (countEl) countEl.innerText = `${this.comments.length} Comments`;
                
                if (window.ui) window.ui.showToast('Comment posted');
            } else {
                throw new Error(data.error);
            }

        } catch (e) {
            console.error(e);
            if (window.ui) window.ui.showToast(e.message || 'Failed to post comment');
        } finally {
            if (submitBtn) submitBtn.innerText = 'Comment';
        }
    }

    renderComments() {
        const container = document.getElementById('commentsList');
        if (!container) return;

        if (this.comments.length === 0) {
            container.innerHTML = '<div style="padding:40px; text-align:center; color:#888">No comments yet.</div>';
            return;
        }

        container.innerHTML = this.comments.map(c => {
            const isOwn = c.userId === this.currentUserId;
            const timeAgo = this.getTimeAgo(new Date(c.timestamp));
            
            // [FIX] Use the helper to fix broken images in the list
            const avatarUrl = window.ui ? window.ui.fixImageUrl(c.userAvatar) : (c.userAvatar || 'https://via.placeholder.com/40');

            return `
            <div class="comment-item" style="margin-bottom:20px; display:flex; gap:15px; background:transparent;">
                <img src="${avatarUrl}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-top:5px;">
                <div style="flex:1;">
                    <div style="margin-bottom:4px;">
                        <span style="font-weight:700; color:var(--text-main); font-size:0.9rem; margin-right:8px;">
                            ${c.userName}
                        </span>
                        <span style="color:var(--text-secondary); font-size:0.8rem;">
                            ${timeAgo}
                        </span>
                    </div>
                    <div style="color:var(--text-main); font-size:0.95rem; line-height:1.4; margin-bottom:8px; white-space: pre-wrap;">${this.sanitize(c.comment)}</div>
                    
                    <div style="display:flex; gap:15px; align-items:center;">
                        <button style="background:none; border:none; color:var(--text-secondary); cursor:pointer; display:flex; align-items:center; gap:5px; font-size:0.85rem;" title="Like">
                            <i class="far fa-thumbs-up"></i> ${c.likes || ''}
                        </button>
                        
                        ${isOwn ? `
                            <button onclick="window.artistComments.deleteComment('${c.id}')" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:0.8rem; margin-left:auto;">
                                Delete
                            </button>
                        ` : `
                            <button onclick="window.artistComments.reportComment('${c.id}')" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:0.8rem; margin-left:auto;" title="Report">
                                <i class="fas fa-flag"></i>
                            </button>
                        `}
                    </div>
                </div>
            </div>
        `}).join('');
    }

    async reportComment(commentId) {
        const reason = prompt("Why are you reporting this comment? (e.g. Spam, Harassment)");
        if (!reason) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/${this.artistId}/comment/${commentId}/report`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
            
            const data = await res.json();
            if (data.success && window.ui) {
                window.ui.showToast('Report submitted. Thanks for helping!');
            }
        } catch (e) {
            console.error(e);
            if (window.ui) window.ui.showToast('Error submitting report');
        }
    }

    async deleteComment(commentId) {
        if (!confirm("Delete this comment?")) return;
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/${this.artistId}/comment/${commentId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                this.comments = this.comments.filter(c => c.id !== commentId);
                this.renderComments();
                const countEl = document.getElementById('commentCount');
                if (countEl) countEl.innerText = `${this.comments.length} Comments`;
                if (window.ui) window.ui.showToast('Comment deleted');
            }
        } catch (e) {
            console.error(e);
        }
    }

    async checkCommentPermission() {
        try {
            if (!auth.currentUser) {
                this.canComment = false;
                this.updateCommentUI();
                return;
            }
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`/player/api/artist/${this.artistId}/can-comment`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            this.canComment = data.canComment;
            this.updateCommentUI();
        } catch (e) { console.error(e); }
    }

    updateCommentUI() {
        const formContainer = document.getElementById('commentFormContainer');
        const prompt = document.getElementById('followToCommentPrompt');
        if (this.canComment) {
            if (formContainer) formContainer.style.display = 'block';
            if (prompt) prompt.style.display = 'none';
        } else {
            if (formContainer) formContainer.style.display = 'none';
            if (prompt) prompt.style.display = 'block';
        }
    }

    async loadComments(append = false) {
        if (this.isLoading) return;
        this.isLoading = true;
        const loader = document.getElementById('commentsLoading');
        if (loader) loader.style.display = 'block';

        try {
            const token = await auth.currentUser.getIdToken();
            let url = `/player/api/artist/${this.artistId}/comments?limit=20`;
            if (append && this.lastTimestamp) url += `&lastTimestamp=${this.lastTimestamp}`;

            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();

            if (append) this.comments.push(...data.comments);
            else this.comments = data.comments || [];

            this.hasMore = data.hasMore;
            if (data.comments.length > 0) this.lastTimestamp = data.comments[data.comments.length - 1].timestamp;

            this.renderComments();
            const countEl = document.getElementById('commentCount');
            if (countEl) countEl.innerText = `${this.comments.length} Comments`;

        } catch (e) { console.error(e); } 
        finally {
            this.isLoading = false;
            if (loader) loader.style.display = 'none';
        }
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        if (seconds < 60) return 'just now';
        const m = Math.floor(seconds / 60);
        if (m < 60) return `${m} minutes ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h} hours ago`;
        const d = Math.floor(h / 24);
        return `${d} days ago`;
    }

    sanitize(str) {
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }
}