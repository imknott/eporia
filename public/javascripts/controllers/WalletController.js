/* public/javascripts/controllers/WalletController.js */
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export class WalletController {
    constructor(mainUI) {
        this.mainUI = mainUI;
        this.auth = getAuth();
        this.currentTipArtistId = null;
        this.currentWalletBalance = 0.00;

        // Bind functions to window so the HTML onclick handlers still work
        window.ui.openTipModal = this.openTipModal.bind(this);
        window.ui.closeTipModal = this.closeTipModal.bind(this);
        window.ui.selectTipAmount = this.selectTipAmount.bind(this);
        window.ui.validateTipInput = this.validateTipInput.bind(this);
        window.ui.submitTip = this.submitTip.bind(this);
        window.ui.updateAllocationRemaining = this.updateAllocationRemaining.bind(this);
        window.ui.commitAllocation = this.commitAllocation.bind(this);
        window.ui.tipCurrentArtist = this.tipCurrentArtist.bind(this);
    }

    async openTipModal(artistId, artistName) {
        if (!artistId) {
            this.mainUI.showToast("Cannot tip: Artist information missing", "error");
            return;
        }

        this.currentTipArtistId = artistId;
        
        const artistNameEl = document.getElementById('tipArtistName');
        const modal = document.getElementById('tipModal');
        const balanceEl = document.getElementById('tipWalletBalance');
        
        if (!modal || !balanceEl || !artistNameEl) return;
        
        artistNameEl.innerText = artistName || 'Artist';
        balanceEl.innerText = "...";
        modal.style.display = 'flex';
        
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet', { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            if (!res.ok) throw new Error('Failed to fetch wallet balance');
            
            const data = await res.json();
            this.currentWalletBalance = parseFloat(data.balance) || 0;
            balanceEl.innerText = this.currentWalletBalance.toFixed(2);
        } catch (e) {
            console.error("Wallet fetch error:", e);
            this.mainUI.showToast("Error fetching balance", "error");
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
        document.querySelectorAll('.btn-tip-option').forEach(b => b.classList.remove('selected'));
    }

    selectTipAmount(amount) {
        const input = document.getElementById('customTipInput');
        if (!input) return;
        
        document.querySelectorAll('.btn-tip-option').forEach(b => b.classList.remove('selected'));
        if (event && event.target) event.target.classList.add('selected');

        input.value = amount === 'max' ? this.currentWalletBalance.toFixed(2) : amount.toFixed(2);
        this.validateTipInput();
    }

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

    async submitTip() {
        const input = document.getElementById('customTipInput');
        const btn = document.getElementById('confirmTipBtn');
        if (!input || !btn) return;
        
        const amount = parseFloat(input.value);
        if (!this.currentTipArtistId || isNaN(amount) || amount <= 0) {
            this.mainUI.showToast("Invalid tip amount", "error");
            return;
        }

        const originalBtnText = btn.innerText;
        btn.innerText = "Sending...";
        btn.disabled = true;

        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/tip-artist', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ artistId: this.currentTipArtistId, amount: amount })
            });

            const data = await res.json();
            if (data.success) {
                this.mainUI.showToast(`Successfully tipped $${amount.toFixed(2)}!`, "success");
                this.closeTipModal();
                
                if (window.globalUserCache) window.globalUserCache.walletBalance = data.newBalance;
                
                const walletBalanceEl = document.getElementById('userWalletBalance');
                if (walletBalanceEl && data.newBalance !== undefined) {
                    walletBalanceEl.innerText = parseFloat(data.newBalance).toFixed(2);
                }
            } else {
                throw new Error(data.error || 'Failed to send tip');
            }
        } catch (e) {
            this.mainUI.showToast(e.message || "Failed to send tip", "error");
        } finally {
            btn.innerText = originalBtnText;
            btn.disabled = false;
        }
    }

    tipCurrentArtist() {
        if (!this.mainUI.engine || !this.mainUI.engine.currentTrack) {
            this.mainUI.showToast("Please play a track first", "warning");
            return;
        }
        
        const track = this.mainUI.engine.currentTrack;
        if (!track.artistId) {
            this.mainUI.showToast("Artist information unavailable", "warning");
            return;
        }
        this.openTipModal(track.artistId, track.artist);
    }

    async initWalletPage() {
        const balanceDisplay = document.getElementById('walletBalanceDisplay');
        const allocContainer = document.getElementById('allocationContainer');
        const list = document.getElementById('transactionList');
        
        let walletData = { balance: 0, monthlyAllocation: 0, plan: 'standard' };
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error('Failed to fetch wallet data');
            
            walletData = await res.json();
            this.currentWalletBalance = Number(walletData.balance || 0);
            
            if (balanceDisplay) balanceDisplay.innerText = this.currentWalletBalance.toFixed(2);
            
            const allocDisplay = document.getElementById('walletAllocation');
            if (allocDisplay) allocDisplay.innerText = `$${Number(walletData.monthlyAllocation || 0).toFixed(2)}`;
            
            const planBadge = document.getElementById('walletPlanBadge');
            if (planBadge) {
                const planName = walletData.plan ? walletData.plan.charAt(0).toUpperCase() + walletData.plan.slice(1) : 'Standard';
                planBadge.innerHTML = `<i class="fas fa-crown"></i> <span>${planName}</span>`;
            }
        } catch (e) { 
            this.mainUI.showToast("Error loading wallet data", "error");
        }

        if (allocContainer) {
            try {
                const token = await this.auth.currentUser.getIdToken();
                const res = await fetch(`/player/api/profile/following/${this.auth.currentUser.uid}`, { 
                    headers: { 'Authorization': `Bearer ${token}` } 
                });
                if (!res.ok) throw new Error('Failed to fetch following artists');
                
                const followData = await res.json();
                this.renderAllocationUI(allocContainer, followData.artists || [], this.currentWalletBalance);
            } catch (e) {
                allocContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--danger)">Failed to load artists. Please try again later.</div>`;
            }
        }

        if (list) {
            try {
                const token = await this.auth.currentUser.getIdToken();
                const res = await fetch('/player/api/wallet/transactions', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = res.ok ? await res.json() : { transactions: [] };
                this.renderTransactions(list, data.transactions || []);
            } catch (e) {
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
                    <p style="color:var(--text-secondary); margin-bottom:15px">You need to follow artists before you can support them directly.</p>
                    <button class="btn-alloc primary" onclick="navigateTo('/player/explore')">Explore Scene</button>
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
                    <img src="${artist.img || artist.profileImage || 'https://via.placeholder.com/50'}" class="alloc-avatar" alt="${artist.name}">
                    <div class="alloc-info">
                        <span class="alloc-name">${artist.name}</span>
                        <span class="alloc-role">Artist</span>
                    </div>
                    <div class="alloc-input-wrapper">
                        <span class="alloc-currency">$</span>
                        <input type="number" class="alloc-input" data-id="${artist.id}" placeholder="0.00" min="0" step="0.01"
                               oninput="window.ui.updateAllocationRemaining()" onchange="window.ui.updateAllocationRemaining()">
                    </div>
                </div>`;
        });

        html += `
                </div>
                <button id="commitAllocBtn" class="btn-alloc" disabled onclick="window.ui.commitAllocation()">
                    <i class="fas fa-lock"></i> Commit Allocation
                </button>
            </div>`;

        container.innerHTML = html;
        this.currentWalletBalance = balance;
    }

    updateAllocationRemaining() {
        const inputs = document.querySelectorAll('.alloc-input');
        const remainingEl = document.getElementById('remainVal');
        const commitBtn = document.getElementById('commitAllocBtn');
        
        if (!remainingEl) return;
        
        let total = 0;
        inputs.forEach(input => total += (parseFloat(input.value) || 0));
        
        const remaining = (this.currentWalletBalance || 0) - total;
        remainingEl.innerText = `$${remaining.toFixed(2)}`;
        
        if (commitBtn) {
            commitBtn.disabled = (total <= 0 || remaining < 0);
            commitBtn.style.opacity = commitBtn.disabled ? '0.5' : '1';
        }
        remainingEl.style.color = remaining < 0 ? 'var(--danger)' : 'var(--text-main)';
    }

    async commitAllocation() {
        const inputs = document.querySelectorAll('.alloc-input');
        const allocations = [];
        
        inputs.forEach(input => {
            const amount = parseFloat(input.value) || 0;
            if (amount > 0) allocations.push({ artistId: input.dataset.id, amount: amount });
        });
        
        if (allocations.length === 0) {
            this.mainUI.showToast("Please allocate funds to at least one artist", "warning");
            return;
        }
        
        try {
            const token = await this.auth.currentUser.getIdToken();
            const res = await fetch('/player/api/wallet/allocate', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ allocations })
            });
            
            const data = await res.json();
            if (data.success) {
                this.mainUI.showToast("Allocation committed successfully!", "success");
                this.initWalletPage();
            } else {
                throw new Error(data.error || 'Failed to commit allocation');
            }
        } catch (e) {
            this.mainUI.showToast(e.message || "Failed to commit allocation", "error");
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
            // Determine if money is coming in or going out
            const isIncoming = tx.type === 'in' || tx.type === 'credit' || parseFloat(tx.amount) > 0;
            
            // Set CSS classes based on transaction type
            const iconClass = isIncoming ? 'fa-arrow-down' : 'fa-arrow-up';
            const bgClass = isIncoming ? '' : 'out'; 
            const amountClass = isIncoming ? 'positive' : 'negative';
            const sign = isIncoming ? '+' : '-';
            
            // Format the date nicely (e.g., "Feb 17, 2026")
            let formattedDate = 'Unknown Date';
            if (tx.date) {
                formattedDate = new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            } else if (tx.timestamp) {
                formattedDate = new Date(tx.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
            
            // Use the exact CSS classes from wallet.css
            html += `
                <div class="trans-item">
                    <div class="trans-icon ${bgClass}">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div class="trans-info">
                        <div class="trans-title">${tx.title || tx.description || 'Transaction'}</div>
                        <div class="trans-date">${formattedDate}</div>
                    </div>
                    <div class="trans-amount ${amountClass}">
                        ${sign}$${Math.abs(parseFloat(tx.amount)).toFixed(2)}
                    </div>
                </div>`;
        });
        
        container.innerHTML = html;
    }
}