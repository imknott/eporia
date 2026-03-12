/**
 * paymentModal.js
 * public/javascripts/paymentModal.js
 *
 * Handles the in-app Stripe Embedded Checkout modal for new signups.
 *
 * Flow:
 *  1. submitBetaSignup() (userSignup.js) calls window.openPaymentModal(formData, plan, interval, mode)
 *  2. We POST /members/api/subscription/create-intent
 *     → { clientSecret, uid, publishableKey }
 *  3. stripe.initEmbeddedCheckout({ clientSecret }) mounts Stripe's hosted
 *     checkout form inside our modal — includes card, Apple/Google Pay,
 *     iDEAL, and all managed-payment methods automatically.
 *  4. User pays inside the modal. Stripe redirects to:
 *     /members/signup/finish?session_id={CHECKOUT_SESSION_ID}&uid=...
 *  5. /signup/finish retrieves the session, verifies completion, calls
 *     provisionNewMember() (60/20/20 or 80/20 split), signs the user in.
 *
 * Note: Embedded Checkout renders in a Stripe-hosted iframe.
 * The left-column summary (plan, pricing, allocation bars) is fully custom;
 * the right-column payment form is Stripe's secure UI.
 */

import { getAuth } from
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';

const auth = getAuth(app);

// ─── Module state ────────────────────────────────────────────
let stripeInstance    = null;
let embeddedCheckout  = null;   // stripe.initEmbeddedCheckout() instance

// Prices come from the server response (stripe.prices.retrieve) — never hardcoded here.

// ─── Open the modal ──────────────────────────────────────────

/**
 * openPaymentModal
 * Called by submitBetaSignup() after it has built formData.
 *
 * @param {FormData} formData  — the full signup form payload
 * @param {string}   plan      — 'discovery' | 'supporter' | 'champion'
 * @param {string}   interval  — 'month' | 'year'
 * @param {string}   mode      — 'hybrid' | 'manual'
 */
window.openPaymentModal = async function(formData, plan, interval, mode) {
    const overlay   = document.getElementById('paymentModal');
    const loadingEl = document.getElementById('pmodLoading');
    const errorEl   = document.getElementById('pmodError');
    const elemWrap  = document.getElementById('stripe-payment-element');
    const submitRow = document.getElementById('pmodSubmitRow');
    const localHint = document.getElementById('pmodLocalHint');

    // Reset UI state
    loadingEl.style.display  = 'flex';
    errorEl.style.display    = 'none';
    elemWrap.style.display   = 'none';
    // Embedded Checkout has its own Pay button — hide ours
    if (submitRow) submitRow.style.display = 'none';
    if (localHint) localHint.style.display = 'none';
    overlay.style.display    = 'flex';
    document.body.style.overflow = 'hidden';

    // Destroy any previous checkout instance cleanly
    if (embeddedCheckout) {
        embeddedCheckout.destroy();
        embeddedCheckout = null;
    }

    try {
        // 1. Create Firebase user + Firestore record + Stripe checkout session
        const res  = await fetch('/members/api/subscription/create-intent', {
            method: 'POST',
            body:   formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to initialize payment');

        const { clientSecret, publishableKey, priceAmount } = data;

        // 2. Load Stripe SDK lazily (only on this page)
        if (!stripeInstance) {
            await loadStripeSDK();
            // eslint-disable-next-line no-undef
            stripeInstance = Stripe(publishableKey);
        }

        // 3. Mount Embedded Checkout — Stripe renders its full payment UI
        //    (card, Apple/Google Pay, iDEAL, local methods) inside the iframe.
        //    No custom appearance API here; styling is controlled in the
        //    Stripe Dashboard → Branding.
        populateSummary(plan, interval, mode, priceAmount);

        loadingEl.style.display = 'none';
        elemWrap.style.display  = 'block';

        // NOTE: initEmbeddedCheckout does NOT accept an appearance parameter.
        // Embedded Checkout is a fully Stripe-hosted UI — branding (colors, fonts,
        // logo, button style) is controlled exclusively via:
        //   Stripe Dashboard → Settings → Branding
        // Set your brand color to #00FFD1, background to #0D0D0D, and upload
        // the Eporia logo there. Stripe applies it to the iframe automatically.
        embeddedCheckout = await stripeInstance.initEmbeddedCheckout({ clientSecret });
        embeddedCheckout.mount('#stripe-payment-element');

    } catch (err) {
        console.error('[paymentModal]', err);
        loadingEl.style.display = 'none';
        showModalError(err.message);
    }
};

// ─── Close modal ─────────────────────────────────────────────

window.closePaymentModal = function() {
    // Destroy the Stripe embedded checkout before hiding the modal.
    // Not doing this leaks the iframe and can cause re-mount issues.
    if (embeddedCheckout) {
        embeddedCheckout.destroy();
        embeddedCheckout = null;
    }

    const overlay = document.getElementById('paymentModal');
    if (overlay) {
        overlay.style.display        = 'none';
        document.body.style.overflow = '';
    }

    // Re-enable the parent form's submit button
    const btnPayment = document.getElementById('btnPayment');
    if (btnPayment) {
        btnPayment.disabled = false;
        const btnText = document.getElementById('finishBtnText');
        if (btnText) btnText.innerText = 'Proceed to Payment';
    }
};

// ─── Populate left-column summary ────────────────────────────

function populateSummary(plan, interval, mode, price) {
    // price is a string like "7.99" returned by the server from stripe.prices.retrieve()
    price = parseFloat(price);

    document.getElementById('pmodPlanName').textContent     =
        plan.charAt(0).toUpperCase() + plan.slice(1);
    document.getElementById('pmodPlanInterval').textContent =
        '· ' + (interval === 'year' ? 'Annual' : 'Monthly');
    document.getElementById('pmodPriceAmount').textContent  = '$' + price.toFixed(2);
    document.getElementById('pmodTotalDue').textContent     = '$' + price.toFixed(2);

    // Update pay button text in case submitRow is ever shown
    const payBtnText = document.getElementById('pmodPayBtnText');
    if (payBtnText) payBtnText.innerHTML =
        `<i class="fas fa-lock"></i> Pay $${price.toFixed(2)} & Activate`;

    // Allocation breakdown
    const modeLabel  = document.getElementById('pmodAllocMode');
    const barsWrap   = document.getElementById('pmodAllocBars');
    const platform   = (price * 0.20).toFixed(2);

    if (mode === 'hybrid') {
        const pool   = (price * 0.60).toFixed(2);
        const wallet = (price * 0.20).toFixed(2);
        modeLabel.innerHTML =
            '<span class="pmod-mode-tag hybrid"><i class="fas fa-random"></i> Hybrid Mode</span>';
        barsWrap.innerHTML  = allocBar('#00FFD1', 'Artist Pool (auto)',     '$' + pool,   60)
                            + allocBar('#FF00FF', 'Your Tip Wallet',        '$' + wallet, 20)
                            + allocBar('#4A7A7A', 'Platform',               '$' + platform, 20);
    } else {
        const wallet = (price * 0.80).toFixed(2);
        modeLabel.innerHTML =
            '<span class="pmod-mode-tag manual"><i class="fas fa-hand-holding-usd"></i> Manual Mode</span>';
        barsWrap.innerHTML  = allocBar('#FF00FF', 'Your Tip Wallet (full)', '$' + wallet, 80)
                            + allocBar('#4A7A7A', 'Platform',               '$' + platform, 20);
    }

    // Renewal disclaimer — shown below the allocation breakdown, above the payment form
    const renewalEl = document.getElementById('pmodRenewalNotice');
    if (renewalEl) {
        const periodLabel = interval === 'year' ? 'annual' : 'monthly';
        renewalEl.innerHTML = `
            <i class="fas fa-sync-alt" style="color:#5F9EA0;margin-right:6px;font-size:0.75rem"></i>
            Your membership renews ${periodLabel} at $${price.toFixed(2)}. Cancel anytime in settings.
            To avoid being charged for the next period, cancel at least 24 hours before your renewal date.
        `;
    }
}

function allocBar(color, label, amount, pct) {
    return `
    <div class="pmod-alloc-row">
      <div class="pmod-alloc-bar-track">
        <div class="pmod-alloc-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="pmod-alloc-row-labels">
        <span style="color:#C8E6E6;font-size:0.85rem">${label}</span>
        <span style="color:${color};font-weight:700">${amount}</span>
      </div>
    </div>`;
}

// ─── Helpers ─────────────────────────────────────────────────

function showModalError(msg) {
    const el      = document.getElementById('pmodError');
    const textEl  = document.getElementById('pmodErrorText');
    if (textEl) textEl.textContent = msg;
    if (el)     el.style.display   = 'flex';
}

async function loadStripeSDK() {
    if (window.Stripe) return;
    return new Promise((resolve, reject) => {
        const script   = document.createElement('script');
        script.src     = 'https://js.stripe.com/v3/';
        script.onload  = resolve;
        script.onerror = () => reject(new Error('Stripe.js failed to load'));
        document.head.appendChild(script);
    });
}

// openPaymentModal and closePaymentModal are attached to window above.
// No ES module export needed — userSignup.js calls them as window.openPaymentModal().