/* paymentsStudio.js
 * Handles the Payments & Financials tab in the artist studio.
 *
 * Dependencies (loaded at runtime — no npm bundler required):
 *   @stripe/connect-js  →  loaded dynamically below
 *
 * Backend endpoints consumed (all in routes/artist/studio.js):
 *   GET  /artist/api/studio/earnings        → earnings summary
 *   POST /artist/api/studio/stripe-session  → AccountSession client_secret
 *   POST /artist/api/studio/stripe-onboarding-link → onboarding URL
 */

import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app }     from './firebase-config.js';

const auth = getAuth(app);

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(cents) {
    return '$' + (cents / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

async function authHeaders(json = false) {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    const token = await user.getIdToken();
    const h = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

// ─── earnings cards + threshold bar ─────────────────────────────────────────

async function loadEarnings() {
    try {
        const headers = await authHeaders();
        const res  = await fetch('/artist/api/studio/earnings', { headers });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        // Earnings cards
        document.getElementById('earningsThisMonth').textContent  = fmt(data.thisMonthCents  ?? 0);
        document.getElementById('earningsPending').textContent    = fmt(data.pendingCents     ?? 0);
        document.getElementById('earningsLifetime').textContent   = fmt(data.lifetimeCents    ?? 0);

        // Month range label e.g. "Mar 1 – Mar 31"
        const now   = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const opts  = { month: 'short', day: 'numeric' };
        document.getElementById('earningsMonthRange').textContent =
            `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;

        // Next payout date: 15th of current month, or 15th of next if past the 15th
        const today       = now.getDate();
        const payoutMonth = today < 15 ? now.getMonth() : now.getMonth() + 1;
        const payoutDate  = new Date(now.getFullYear(), payoutMonth, 15);
        document.getElementById('nextPayoutDate').textContent =
            payoutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        // Threshold bar (min $50 = 5000 cents)
        const THRESHOLD = 5000;
        const earned    = data.thisMonthCents ?? 0;
        const pct       = Math.min((earned / THRESHOLD) * 100, 100);
        document.getElementById('thresholdFill').style.width  = `${pct}%`;
        document.getElementById('thresholdAmount').textContent = `${fmt(earned)} earned`;

        const statusEl = document.getElementById('thresholdStatus');
        if (earned >= THRESHOLD) {
            statusEl.innerHTML = '<i class="fas fa-check-circle" style="color:#88C9A1"></i> You qualify for the 15th payout!';
            statusEl.classList.add('qualified');
        } else {
            const remaining = fmt(THRESHOLD - earned);
            statusEl.innerHTML = `<i class="fas fa-info-circle"></i> Earn ${remaining} more this month to qualify for the 15th payout.`;
            statusEl.classList.remove('qualified');
        }

    } catch (err) {
        console.error('[payments] earnings error:', err);
    }
}

// ─── payout status badge ─────────────────────────────────────────────────────

function setPayoutBadge(onboarded) {
    const badge = document.getElementById('payoutStatusBadge');
    if (onboarded) {
        badge.innerHTML = '<i class="fas fa-check-circle"></i> Payouts Active';
        badge.classList.add('active');
        badge.classList.remove('pending');
    } else {
        badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Setup Required';
        badge.classList.add('pending');
        badge.classList.remove('active');
    }
}

// ─── Stripe Connect embedded components ─────────────────────────────────────

let stripeConnectInstance = null;

async function initStripeConnect() {
    const loadingEl          = document.getElementById('stripeLoading');
    const onboardingBanner   = document.getElementById('stripeOnboardingBanner');
    const componentsWrap     = document.getElementById('stripeComponentsWrap');
    const noAccountEl        = document.getElementById('stripeNoAccount');

    loadingEl.style.display = 'flex';

    try {
        const headers = await authHeaders();

        // Ask our backend for the artist's Stripe status + an AccountSession
        const res  = await fetch('/artist/api/studio/stripe-session', {
            method: 'POST',
            headers,
        });

        if (!res.ok) {
            const err = await res.json();
            // Artist has no stripeAccountId yet — show the placeholder
            if (err.code === 'NO_STRIPE_ACCOUNT') {
                loadingEl.style.display = 'none';
                noAccountEl.style.display = 'flex';
                setPayoutBadge(false);
                return;
            }
            throw new Error(err.error || 'Session fetch failed');
        }

        const { clientSecret, onboarded, publishableKey } = await res.json();

        setPayoutBadge(onboarded);
        loadingEl.style.display = 'none';

        if (!onboarded) {
            // Show the "Set Up Payouts" CTA — don't mount components yet
            onboardingBanner.style.display = 'flex';
            return;
        }

        // Artist is onboarded — mount Stripe Connect embedded components
        componentsWrap.style.display = 'block';

        // Lazy-load the Stripe Connect JS SDK
        const { loadConnectAndInitialize } = await import(
            'https://cdn.jsdelivr.net/npm/@stripe/connect-js@latest/dist/connect-js.esm.js'
        );

        stripeConnectInstance = loadConnectAndInitialize({
            publishableKey,
            fetchClientSecret: () => Promise.resolve(clientSecret),
            appearance: {
                overlays: 'dialog',
                variables: {
                    colorPrimary:    '#88C9A1',
                    colorBackground: '#1E1E1E',
                    colorText:       '#E0E0E0',
                    colorDanger:     '#E76F51',
                    fontFamily:      'Nunito, sans-serif',
                    borderRadius:    '8px',
                    spacingUnit:     '4px',
                },
            },
        });

        // Mount the payments component (transaction history)
        const paymentsEl = document.getElementById('stripePaymentsComponent');
        const payments   = stripeConnectInstance.create('payments');
        paymentsEl.appendChild(payments);

        // Mount the notification banner (pending requirements, etc.)
        const notifEl = document.getElementById('stripeNotificationBanner');
        const notif   = stripeConnectInstance.create('notification-banner');
        notifEl.appendChild(notif);

    } catch (err) {
        console.error('[payments] Stripe init error:', err);
        loadingEl.style.display = 'none';
        noAccountEl.style.display = 'flex';
    }
}

// ─── onboarding CTA ──────────────────────────────────────────────────────────

window.startStripeOnboarding = async () => {
    const btn = document.getElementById('startOnboardingBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Redirecting...';

    try {
        const headers = await authHeaders();
        const res  = await fetch('/artist/api/studio/stripe-onboarding-link', {
            method: 'POST',
            headers,
        });
        const data = await res.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error(data.error || 'No URL returned');
        }
    } catch (err) {
        console.error('[payments] onboarding link error:', err);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-external-link-alt"></i> Set Up Payouts';
        if (window.showToast) window.showToast('Could not start onboarding. Try again.', 'error');
    }
};

// ─── lifetime distribution card ──────────────────────────────────────────────

async function loadDistroStatus() {
    try {
        const headers = await authHeaders();
        const res  = await fetch('/artist/api/studio/payment-status', { headers });
        if (!res.ok) return;
        const { lifetimeDistro, lifetimeDistroAt } = await res.json();

        const cta    = document.getElementById('distroCta');
        const active = document.getElementById('distroActive');
        if (!cta || !active) return;

        if (lifetimeDistro) {
            cta.style.display    = 'none';
            active.style.display = 'flex';
            if (lifetimeDistroAt) {
                const d = lifetimeDistroAt._seconds
                    ? new Date(lifetimeDistroAt._seconds * 1000)
                    : new Date(lifetimeDistroAt);
                const sinceEl = document.getElementById('distroActiveSince');
                if (sinceEl) sinceEl.textContent =
                    `Active since ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
            }
        } else {
            cta.style.display    = 'flex';
            active.style.display = 'none';
        }
    } catch (err) {
        console.error('[payments] distro status error:', err);
    }
}

window.startDistroPayment = async () => {
    const btn = document.getElementById('distroUpgradeBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading...'; }

    let stripe = null;
    let elements = null;
    let overlay = null;

    try {
        const headers = await authHeaders(true); // Content-Type: application/json required for POST bodies
        const res = await fetch('/artist/api/studio/create-payment-intent', {
            method: 'POST', headers,
            body: JSON.stringify({ type: 'distro' }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Could not start payment');
        }
        const { clientSecret, publishableKey, amount } = await res.json();
        const fmtUSD = c => `$${(c / 100).toFixed(2)}`;

        // Build modal
        overlay = document.createElement('div');
        overlay.className = 'payment-modal-overlay';
        overlay.innerHTML = `
            <div class="payment-modal">
                <div class="payment-modal__header">
                    <h2><i class="fas fa-globe-americas" style="color:#88C9A1;margin-right:8px;"></i>Lifetime Distribution</h2>
                    <button class="payment-modal__close" id="distroModalClose">&times;</button>
                </div>
                <div class="payment-modal__summary">
                    <div class="payment-modal__summary-row">
                        <span>Lifetime Distribution Access</span><span>One-time</span>
                    </div>
                    <div class="payment-modal__summary-row">
                        <span>Royalty split</span><span>You keep 100%</span>
                    </div>
                    <div class="payment-modal__summary-total">
                        <span>Total</span><span>${fmtUSD(amount)}</span>
                    </div>
                </div>
                <div id="distroPaymentElement"></div>
                <div id="distroPaymentError" style="color:#E76F51;font-size:0.82rem;margin-top:8px;display:none;"></div>
                <div class="payment-modal__actions">
                    <button class="btn-primary" id="distroPayBtn">
                        <i class="fas fa-lock" style="margin-right:6px;"></i>Pay ${fmtUSD(amount)}
                    </button>
                    <button class="btn-secondary" id="distroCancelBtn">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        stripe   = Stripe(publishableKey);
        elements = stripe.elements({ clientSecret, appearance: {
            theme: 'night',
            variables: { colorPrimary: '#88C9A1', colorBackground: '#1a1a1a',
                         colorText: '#e0e0e0', fontFamily: 'Nunito, sans-serif', borderRadius: '8px' },
        }});
        elements.create('payment').mount('#distroPaymentElement');

        const closeOverlay = () => { if (overlay) overlay.remove(); };
        document.getElementById('distroModalClose').onclick = closeOverlay;
        document.getElementById('distroCancelBtn').onclick  = closeOverlay;

        document.getElementById('distroPayBtn').onclick = async () => {
            const payBtn = document.getElementById('distroPayBtn');
            const errEl  = document.getElementById('distroPaymentError');
            payBtn.disabled = true;
            payBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            errEl.style.display = 'none';

            const { error, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: { return_url: window.location.href },
                redirect: 'if_required',
            });

            if (error) {
                errEl.textContent   = error.message;
                errEl.style.display = 'block';
                payBtn.disabled     = false;
                payBtn.innerHTML    = `<i class="fas fa-lock" style="margin-right:6px;"></i>Pay ${fmtUSD(amount)}`;
                return;
            }

            // Verify server-side and activate the flag
            try {
                const confRes = await fetch('/artist/api/studio/confirm-distro-payment', {
                    method: 'POST', headers,
                    body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
                });
                if (!confRes.ok) throw new Error((await confRes.json()).error);
                closeOverlay();
                if (window.showToast) window.showToast('🎉 Lifetime distribution is now active!', 'success');
                await loadDistroStatus(); // refresh the card
            } catch (confErr) {
                errEl.textContent   = `Payment succeeded but activation failed: ${confErr.message}. Please contact support.`;
                errEl.style.display = 'block';
            }
        };

    } catch (err) {
        console.error('[distro] payment error:', err);
        if (window.showToast) window.showToast(err.message || 'Payment failed', 'error');
        if (overlay) overlay.remove();
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rocket"></i>  Get Lifetime Distribution'; }
    }
};

// ─── HITS Act expense tracker ────────────────────────────────────────────────

class HitsTracker {
    constructor() {
        this._expenses = [];
        this._totalCents = 0;
        this._year = new Date().getFullYear();
    }

    // ── Fetch + render ────────────────────────────────────────────────────────
    async loadExpenses() {
        const yearEl = document.getElementById('hitsYearSelect');
        if (yearEl) this._year = parseInt(yearEl.value) || this._year;

        try {
            const headers = await authHeaders();
            const res  = await fetch(`/artist/api/studio/expenses?year=${this._year}`, { headers });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();

            this._expenses   = data.expenses   || [];
            this._totalCents = data.totalCents || 0;

            this._renderProgress(this._totalCents, data.deductionLimitCents);
            this._renderTable(this._expenses);

            // Set today's date as default in the add form
            const dateInput = document.getElementById('hitsDate');
            if (dateInput && !dateInput.value) {
                dateInput.value = new Date().toISOString().split('T')[0];
            }
        } catch (err) {
            console.error('[hits] load error:', err);
            const tbody = document.getElementById('hitsExpenseList');
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--danger);padding:20px;">Failed to load expenses</td></tr>`;
        }
    }

    // ── Progress bar ──────────────────────────────────────────────────────────
    _renderProgress(totalCents, limitCents = 15_000_000) {
        const fill  = document.getElementById('hitsProgressFill');
        const label = document.getElementById('hitsSpentLabel');
        if (!fill || !label) return;

        const pct      = Math.min((totalCents / limitCents) * 100, 100);
        const dollars  = (totalCents / 100).toFixed(2);
        const remaining = ((limitCents - totalCents) / 100).toFixed(2);

        fill.style.width      = `${pct}%`;
        fill.style.background = pct >= 100 ? '#E76F51' : pct >= 80 ? '#F4A261' : 'var(--primary)';
        label.textContent     = `$${dollars} logged · $${Math.max(0, parseFloat(remaining)).toFixed(2)} remaining`;
    }

    // ── Table ─────────────────────────────────────────────────────────────────
    _renderTable(expenses) {
        const tbody = document.getElementById('hitsExpenseList');
        if (!tbody) return;

        if (expenses.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-secondary)">
                No expenses logged for ${this._year}. Add your first production cost above.
            </td></tr>`;
            return;
        }

        tbody.innerHTML = expenses.map(e => {
            const amt     = `$${(e.amountCents / 100).toFixed(2)}`;
            const receipt = e.receiptUrl
                ? `<a href="${e.receiptUrl}" target="_blank" style="color:var(--primary)"><i class="fas fa-file-image"></i></a>`
                : `<label style="cursor:pointer;color:var(--text-secondary)" title="Upload receipt">
                       <i class="fas fa-upload"></i>
                       <input type="file" accept="image/*,application/pdf" style="display:none"
                              onchange="window.hitsTracker._uploadReceipt('${e.id}', this)">
                   </label>`;
            return `<tr>
                <td>${e.date}</td>
                <td><span class="hits-cat-tag">${e.category}</span></td>
                <td>${this._esc(e.description)}</td>
                <td style="color:var(--text-secondary);font-size:0.85rem">${this._esc(e.notes || '—')}</td>
                <td style="text-align:right;font-weight:800;font-family:'Nunito',sans-serif">${amt}</td>
                <td style="text-align:center">${receipt}</td>
                <td style="text-align:center">
                    <button onclick="window.hitsTracker._deleteExpense('${e.id}')"
                            style="background:none;border:none;color:var(--danger);cursor:pointer;opacity:0.7"
                            title="Delete">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Add expense ───────────────────────────────────────────────────────────
    async addExpense() {
        const date        = document.getElementById('hitsDate')?.value;
        const category    = document.getElementById('hitsCategory')?.value;
        const amount      = document.getElementById('hitsAmount')?.value;
        const description = document.getElementById('hitsDescription')?.value?.trim();
        const notes       = document.getElementById('hitsNotes')?.value?.trim();
        const btn         = document.getElementById('hitsAddBtn');

        if (!date || !category || !amount || !description) {
            if (window.showToast) window.showToast('Date, category, amount, and description are required', 'error');
            return;
        }

        const orig = btn.innerHTML;
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

        try {
            const headers = await authHeaders(true);
            const res = await fetch('/artist/api/studio/expenses', {
                method: 'POST', headers,
                body: JSON.stringify({ date, category, amount, description, notes }),
            });
            if (!res.ok) throw new Error((await res.json()).error);

            // Clear form fields
            document.getElementById('hitsAmount').value      = '';
            document.getElementById('hitsDescription').value = '';
            document.getElementById('hitsNotes').value       = '';
            document.getElementById('hitsCategory').value    = '';

            if (window.showToast) window.showToast('Expense logged', 'success');
            await this.loadExpenses();
        } catch (err) {
            console.error('[hits] add error:', err);
            if (window.showToast) window.showToast(err.message || 'Failed to save expense', 'error');
        } finally {
            btn.disabled  = false;
            btn.innerHTML = orig;
        }
    }

    // ── Delete expense ────────────────────────────────────────────────────────
    async _deleteExpense(id) {
        if (!confirm('Delete this expense? This cannot be undone.')) return;
        try {
            const headers = await authHeaders();
            const res = await fetch(`/artist/api/studio/expenses/${id}`, { method: 'DELETE', headers });
            if (!res.ok) throw new Error((await res.json()).error);
            if (window.showToast) window.showToast('Expense deleted', 'success');
            await this.loadExpenses();
        } catch (err) {
            if (window.showToast) window.showToast(err.message || 'Delete failed', 'error');
        }
    }

    // ── Upload receipt ────────────────────────────────────────────────────────
    async _uploadReceipt(expenseId, inputEl) {
        const file = inputEl.files?.[0];
        if (!file) return;

        try {
            const token = await auth.currentUser.getIdToken();
            const form  = new FormData();
            form.append('receipt', file);
            const res = await fetch(`/artist/api/studio/expenses/${expenseId}/receipt`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: form,
            });
            if (!res.ok) throw new Error((await res.json()).error);
            if (window.showToast) window.showToast('Receipt uploaded', 'success');
            await this.loadExpenses();
        } catch (err) {
            if (window.showToast) window.showToast(err.message || 'Upload failed', 'error');
        }
    }

    // ── CSV export ────────────────────────────────────────────────────────────
    async exportCSV() {
        try {
            const headers = await authHeaders();
            const res = await fetch(`/artist/api/studio/expenses/export.csv?year=${this._year}`, { headers });
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = Object.assign(document.createElement('a'), {
                href: url,
                download: `hits-act-expenses-${this._year}.csv`,
            });
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            if (window.showToast) window.showToast(err.message || 'Export failed', 'error');
        }
    }

    // ── Utility ───────────────────────────────────────────────────────────────
    _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
}

// ─── Merch Sales Analytics ───────────────────────────────────────────────────

async function loadMerchAnalytics() {
    const periodEl = document.getElementById('merchPeriodSelect');
    const period   = periodEl?.value || '30';

    try {
        const headers = await authHeaders();
        const res  = await fetch(`/artist/api/studio/merch-analytics?period=${period}`, { headers });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        // ── Summary cards ────────────────────────────────────────────────────
        const totalRevEl = document.getElementById('merchTotalRevenue');
        const totalSalEl = document.getElementById('merchTotalSales');
        const topItemEl  = document.getElementById('merchTopItem');

        if (totalRevEl) totalRevEl.textContent = `$${data.totalRevenueDollars}`;
        if (totalSalEl) totalSalEl.textContent = data.totalSales;
        if (topItemEl)  topItemEl.textContent  = data.items[0]?.name || '—';

        // ── Trend bar chart ───────────────────────────────────────────────────
        const trendWrap = document.getElementById('merchTrendBars');
        if (trendWrap && data.trend.length > 0) {
            const maxRevenue = Math.max(...data.trend.map(t => parseFloat(t.revenueDollars)), 1);
            trendWrap.innerHTML = data.trend.map(t => {
                const pct   = Math.max((parseFloat(t.revenueDollars) / maxRevenue) * 100, 2);
                const label = t.month.slice(5); // "03" from "2026-03"
                const month = new Date(`${t.month}-01`).toLocaleDateString('en-US', { month: 'short' });
                return `<div class="merch-trend-bar-wrap" title="${month}: $${t.revenueDollars} · ${t.saleCount} sold">
                    <div class="merch-trend-bar" style="height:${pct}%"></div>
                    <div class="merch-trend-bar-label">${month}</div>
                </div>`;
            }).join('');
        } else if (trendWrap) {
            trendWrap.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:20px;width:100%">No sales data yet for this period.</div>`;
        }

        // ── Per-item table ────────────────────────────────────────────────────
        const tbody = document.getElementById('merchItemsTableBody');
        if (!tbody) return;

        if (data.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-secondary)">
                No merch sales yet for this period.
            </td></tr>`;
            return;
        }

        tbody.innerHTML = data.items.map((item, i) => {
            const avgSale = item.saleCount > 0
                ? `$${(item.revenueCents / item.saleCount / 100).toFixed(2)}`
                : '—';
            const rankBadge = i === 0
                ? `<span style="background:rgba(255,215,0,0.15);color:#ffd700;border:1px solid rgba(255,215,0,0.3);border-radius:20px;padding:2px 8px;font-size:0.7rem;font-weight:800;margin-left:8px;">BEST SELLER</span>`
                : '';
            const photoHtml = item.photo
                ? `<img src="${item.photo}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;margin-right:10px;flex-shrink:0;">`
                : `<div style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,0.06);margin-right:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;"><i class="fas fa-shopping-bag" style="font-size:0.8rem;color:var(--text-secondary)"></i></div>`;
            return `<tr>
                <td>
                    <div style="display:flex;align-items:center;">
                        ${photoHtml}
                        <div>
                            <div style="font-weight:700;">${item.name}${rankBadge}</div>
                            ${item.price ? `<div style="font-size:0.78rem;color:var(--text-secondary)">Listed at $${item.price}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td><span class="hits-cat-tag">${item.category || '—'}</span></td>
                <td style="font-weight:700;">${item.saleCount}</td>
                <td style="text-align:right;font-weight:800;font-family:'Nunito',sans-serif;color:var(--primary)">$${item.revenueDollars}</td>
                <td style="text-align:right;color:var(--text-secondary)">${avgSale}</td>
            </tr>`;
        }).join('');

    } catch (err) {
        console.error('[merch-analytics] error:', err);
        const tbody = document.getElementById('merchItemsTableBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:20px;">
            <i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>Failed to load analytics: ${err.message}
        </td></tr>`;
    }
}

// Expose on window so the pug onchange handler can call it
window.loadMerchAnalytics = loadMerchAnalytics;

// ─── public init — called by switchView ──────────────────────────────────────

export async function initPaymentsView() {
    await loadEarnings();
    await loadDistroStatus();
    if (!stripeConnectInstance) {
        await initStripeConnect();
    }
    // HITS Act tracker
    if (!window.hitsTracker) {
        window.hitsTracker = new HitsTracker();
    }
    window.hitsTracker.loadExpenses();
}

// Expose so artistStudio.js switchView can call it without a dynamic import
window.initPaymentsView = initPaymentsView;