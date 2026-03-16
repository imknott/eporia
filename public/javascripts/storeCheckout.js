/**
 * public/javascripts/storeCheckout.js
 *
 * Drives the embedded checkout modal on store.pug.
 * Handles: shipping/billing forms, live ZipTax lookup,
 * Stripe Elements card mounting, order summary rendering,
 * PaymentIntent confirmation, and success state.
 *
 * Depends on: Stripe.js (loaded via <script> in store.pug)
 * Exposes globals used by store.js: window.openCheckoutModal()
 */

import {
    getAuth,
    onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { app } from './firebase-config.js';

(function () {

    // ── State ─────────────────────────────────────────────────
    const _auth     = getAuth(app);
    let _stripe     = null;
    let _elements   = null;
    let _cardElement = null;
    let _cart       = [];          // passed in from store.js on open
    let _region     = 'usDomestic';
    let _uid        = null;
    let _email      = null;
    let _orderSummary = null;      // from create-intent response
    let _clientSecret = null;
    let _taxTimer   = null;        // debounce handle for zip lookup

    const TAX_DEBOUNCE_MS = 600;

    // ── Auth ─────────────────────────────────────────────────
    onAuthStateChanged(_auth, user => {
        _uid   = user ? user.uid   : null;
        _email = user ? user.email : null;
        const emailEl = document.getElementById('checkoutEmail');
        if (emailEl && _email && !emailEl.value) emailEl.value = _email;
    });

    window.openCheckoutModal = function (cart, region) {
        _cart   = cart   || [];
        _region = region || 'usDomestic';

        if (_cart.length === 0) return;

        const modal = document.getElementById('checkoutModal');
        if (!modal) return;

        // Reset state
        _orderSummary = null;
        _clientSecret = null;

        // Pre-fill email if logged in
        const emailEl = document.getElementById('checkoutEmail');
        if (emailEl && _email) emailEl.value = _email;

        // Reset billing toggle
        const sameCheck = document.getElementById('billingSameAsShipping');
        if (sameCheck) sameCheck.checked = true;
        const billingWrap = document.getElementById('billingAddressWrap');
        if (billingWrap) billingWrap.style.display = 'none';

        resetPayButton();
        renderPlaceholderSummary();

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Mount Stripe Address Elements once we have a publishableKey.
        // We do a lightweight fetch of the publishable key first, then mount.
        // The address element fires 'change' → createOrRefreshIntent when complete.
        if (!_stripe) {
            // Bootstrap: get the publishable key via a dummy small intent
            // — we use the env-var key injected in the meta tag added to store.pug
            const pk = document.querySelector('meta[name="stripe-pk"]')?.content;
            if (pk && !_shippingElement) mountAddressElements(pk);
        } else if (!_shippingElement) {
            mountAddressElements(_stripe._apiKey || '');
        }
    };

    window.closeCheckoutModal = function () {
        const modal = document.getElementById('checkoutModal');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
        destroyCardElement();
        destroyAddressElements();
    };

    window.toggleBillingFields = function () {
        const same = document.getElementById('billingSameAsShipping')?.checked;
        const wrap = document.getElementById('billingAddressWrap');
        if (wrap) wrap.style.display = same ? 'none' : 'block';
        // Mount billing element if showing for first time
        if (!same && _stripe && !_billingElement) mountBillingElement();
    };

    // ── Address Element state ─────────────────────────────────
    let _shippingElement = null;   // Stripe Address Element — shipping
    let _billingElement  = null;   // Stripe Address Element — billing
    let _shippingValue   = null;   // last complete address from shipping element
    let _billingValue    = null;   // last complete address from billing element

    // ── Mount Address Elements (called once on first open) ───
    function mountAddressElements(publishableKey) {
        if (!window.Stripe) return;
        if (!_stripe) _stripe = window.Stripe(publishableKey);

        const appearance = {
            theme: 'night',
            variables: {
                colorPrimary:    '#00FFD1',
                colorBackground: '#0d0d0d',
                colorText:       '#e0e0e0',
                colorDanger:     '#E76F51',
                fontFamily:      '"Rajdhani", sans-serif',
                borderRadius:    '4px',
                spacingUnit:     '4px',
            },
        };

        // Shipping Address Element
        if (!_shippingElement) {
            const shippingElements = _stripe.elements({ appearance });
            _shippingElement = shippingElements.create('address', {
                mode: 'shipping',
                fields: { phone: 'never' },
            });
            _shippingElement.mount('#stripeShippingElement');
            _shippingElement.on('change', event => {
                if (event.complete) {
                    _shippingValue = event.value;
                    clearTimeout(_taxTimer);
                    _taxTimer = setTimeout(createOrRefreshIntent, TAX_DEBOUNCE_MS);
                } else {
                    _shippingValue = null;
                }
            });
        }
    }

    function mountBillingElement() {
        if (!_stripe || _billingElement) return;
        const appearance = {
            theme: 'night',
            variables: {
                colorPrimary:    '#00FFD1',
                colorBackground: '#0d0d0d',
                colorText:       '#e0e0e0',
                colorDanger:     '#E76F51',
                fontFamily:      '"Rajdhani", sans-serif',
                borderRadius:    '4px',
            },
        };
        const billingElements = _stripe.elements({ appearance });
        _billingElement = billingElements.create('address', {
            mode: 'billing',
            fields: { phone: 'never' },
        });
        _billingElement.mount('#stripeBillingElement');
        _billingElement.on('change', event => {
            _billingValue = event.complete ? event.value : null;
        });
    }

    function destroyAddressElements() {
        if (_shippingElement) {
            try { _shippingElement.unmount(); } catch (_) {}
            _shippingElement = null;
        }
        if (_billingElement) {
            try { _billingElement.unmount(); } catch (_) {}
            _billingElement = null;
        }
        _shippingValue = null;
        _billingValue  = null;
    }

    // ── Build address objects for backend ────────────────────
    function getShippingAddress() {
        if (!_shippingValue) return null;
        const a = _shippingValue.address;
        return {
            name:    _shippingValue.name || '',
            line1:   a.line1       || '',
            line2:   a.line2       || '',
            city:    a.city        || '',
            state:   a.state       || '',
            zip:     a.postal_code || '',
            country: a.country     || 'US',
        };
    }

    function getBillingAddress() {
        const same = document.getElementById('billingSameAsShipping')?.checked !== false;
        if (same || !_billingValue) return getShippingAddress();
        const a = _billingValue.address;
        return {
            name:    _billingValue.name || '',
            line1:   a.line1       || '',
            line2:   a.line2       || '',
            city:    a.city        || '',
            state:   a.state       || '',
            zip:     a.postal_code || '',
            country: a.country     || 'US',
        };
    }

    // ── Create / refresh PaymentIntent ────────────────────────
    // Called when address changes. Creates a new intent each time since
    // the tax amount may have changed. Previous intent is abandoned.
    async function createOrRefreshIntent() {
        const shipping = getShippingAddress();
        if (!shipping?.zip) return;   // address element not yet complete

        const btn = document.getElementById('checkoutPayBtn');
        if (btn) { btn.disabled = true; btn.querySelector('span:first-of-type').textContent = ' Calculating...'; }
        showTaxNotice('Calculating tax...');

        try {
            const token   = _uid ? await _auth.currentUser?.getIdToken() : null;
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch('/store/api/checkout/create-intent', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    cartItems:       _cart,
                    region:          _region,
                    shippingAddress: shipping,
                    billingAddress:  getBillingAddress(),
                    userEmail:       document.getElementById('checkoutEmail')?.value.trim() || _email,
                    userId:          _uid || null,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not calculate order total');

            _clientSecret = data.clientSecret;
            _orderSummary = data.orderSummary;

            renderOrderSummary(_orderSummary);
            updateTaxNotice(_orderSummary);
            mountOrUpdateStripeElements(data.publishableKey, data.clientSecret);

        } catch (err) {
            console.error('[checkout] intent error:', err);
            showCardError(err.message);
        }
    }

    function mountOrUpdateStripeElements(publishableKey, clientSecret) {
        if (!window.Stripe || !_stripe) return;

        // Destroy old payment element if it exists
        destroyCardElement();

        // Reuse the existing Stripe instance, create a new elements group for this intent
        _elements = _stripe.elements({
            clientSecret,
            appearance: {
                theme: 'night',
                variables: {
                    colorPrimary:    '#00FFD1',
                    colorBackground: '#0d0d0d',
                    colorText:       '#e0e0e0',
                    colorDanger:     '#E76F51',
                    fontFamily:      '"Rajdhani", sans-serif',
                    borderRadius:    '4px',
                    spacingUnit:     '4px',
                },
            },
        });

        _cardElement = _elements.create('payment');
        _cardElement.mount('#checkoutCardElement');

        _cardElement.on('ready', () => {
            const btn = document.getElementById('checkoutPayBtn');
            if (btn) {
                btn.disabled = false;
                btn.querySelector('span:first-of-type').textContent = ' Pay Now';
            }
        });

        _cardElement.on('change', event => {
            if (event.error) showCardError(event.error.message);
            else hideCardError();
        });
    }

    function destroyCardElement() {
        if (_cardElement) {
            try { _cardElement.unmount(); } catch (_) {}
            _cardElement = null;
        }
        _elements = null;
    }

    window.submitCheckout = async function () {
        if (!_stripe || !_elements || !_clientSecret) {
            showCardError('Please enter your shipping address first.');
            return;
        }
        if (!_shippingValue) {
            showCardError('Please complete your shipping address.');
            return;
        }

        const btn = document.getElementById('checkoutPayBtn');
        const origHtml = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>  Processing...'; }
        hideCardError();

        try {
            const addr = _shippingValue.address;
            const { error, paymentIntent } = await _stripe.confirmPayment({
                elements: _elements,
                confirmParams: {
                    return_url:    `${window.location.origin}/store/checkout/success`,
                    receipt_email: document.getElementById('checkoutEmail')?.value.trim() || _email || undefined,
                    shipping: {
                        name:    _shippingValue.name || '',
                        address: {
                            line1:       addr.line1       || '',
                            line2:       addr.line2       || '',
                            city:        addr.city        || '',
                            state:       addr.state       || '',
                            postal_code: addr.postal_code || '',
                            country:     addr.country     || 'US',
                        },
                    },
                },
                redirect: 'if_required',
            });

            if (error) {
                showCardError(error.message);
                if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
            } else if (paymentIntent?.status === 'succeeded') {
                showSuccess(paymentIntent.id);
            }

        } catch (err) {
            console.error('[checkout] confirm error:', err);
            showCardError(err.message || 'Payment failed. Please try again.');
            if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
        }
    };

    // ── Success state ─────────────────────────────────────────
    function showSuccess(paymentIntentId) {
        window.closeCheckoutModal();

        // Clear cart via store.js's exposed function so state stays in sync
        if (window.clearCart) {
            window.clearCart();
        } else {
            try { localStorage.removeItem('eporia_cart_v1'); } catch (_) {}
        }

        const overlay = document.getElementById('checkoutSuccessOverlay');
        const ref     = document.getElementById('checkoutSuccessRef');
        if (ref && paymentIntentId) ref.textContent = `Order ref: ${paymentIntentId.slice(-8).toUpperCase()}`;
        if (overlay) overlay.style.display = 'flex';
    }

    window.closeCheckoutSuccess = function () {
        const overlay = document.getElementById('checkoutSuccessOverlay');
        if (overlay) overlay.style.display = 'none';
        window.location.reload();
    };

    // ── Order summary rendering ───────────────────────────────
    function renderPlaceholderSummary() {
        setElText('coSubtotal', '—');
        setElText('coShipping', '—');
        setElText('coTax', '—');
        setElText('coFee', '—');
        setElText('coTotal', '—');
        setElText('coTaxRate', '');
        setElText('checkoutPayAmount', '');

        const itemsEl = document.getElementById('checkoutSummaryItems');
        if (!itemsEl) return;
        const cartItems = _cart;
        itemsEl.innerHTML = cartItems.map(ci => `
            <div class="co-summary-item">
                ${ci.photo ? `<div class="co-item-img" style="background-image:url('${esc(ci.photo)}')"></div>` : ''}
                <div class="co-item-info">
                    <div class="co-item-name">${esc(ci.name)}${ci.selectedSize ? ` <span class="co-item-size">${ci.selectedSize}</span>` : ''}</div>
                    <div class="co-item-artist">${esc(ci.artistName || '')}</div>
                    <div class="co-item-qty">Qty: ${ci.qty}</div>
                </div>
                <div class="co-item-price">$${(ci.price * ci.qty).toFixed(2)}</div>
            </div>`).join('');
    }

    function renderOrderSummary(summary) {
        if (!summary) return;
        setElText('coSubtotal', `$${summary.subtotal}`);
        setElText('coShipping', summary.shipping === '0.00' ? 'Free' : `$${summary.shipping}`);
        setElText('coTax',      summary.tax === '0.00' ? '—' : `$${summary.tax}`);
        setElText('coTaxRate',  '');
        setElText('coFee',      `$${summary.supporterFee}`);
        setElText('coTotal',    `$${summary.total}`);
        setElText('checkoutPayAmount', ` — $${summary.total}`);

        // Render items with server-confirmed prices
        const itemsEl = document.getElementById('checkoutSummaryItems');
        if (itemsEl && summary.items) {
            itemsEl.innerHTML = summary.items.map(i => `
                <div class="co-summary-item">
                    ${i.photo ? `<div class="co-item-img" style="background-image:url('${esc(i.photo)}')"></div>` : ''}
                    <div class="co-item-info">
                        <div class="co-item-name">${esc(i.name)}${i.size ? ` <span class="co-item-size">${i.size}</span>` : ''}</div>
                        <div class="co-item-artist">${esc(i.artist || '')}</div>
                        <div class="co-item-qty">Qty: ${i.qty}</div>
                    </div>
                    <div class="co-item-price">$${i.price}</div>
                </div>`).join('');
        }
    }

    function updateTaxNotice(summary) {
        const notice = document.getElementById('checkoutTaxNotice');
        const text   = document.getElementById('checkoutTaxNoticeText');
        const zip    = document.getElementById('shipZip')?.value.trim();
        if (!notice || !text) return;
        if (summary?.tax !== '0.00' && zip) {
            text.textContent = `$${summary.tax} sales tax applied for ZIP ${zip}`;
            notice.style.display = 'flex';
        } else {
            notice.style.display = 'none';
        }
    }

    function showTaxNotice(msg) {
        const notice = document.getElementById('checkoutTaxNotice');
        const text   = document.getElementById('checkoutTaxNoticeText');
        if (notice && text) { text.textContent = msg; notice.style.display = 'flex'; }
    }

    // ── Error helpers ─────────────────────────────────────────
    function showCardError(msg) {
        const el = document.getElementById('checkoutCardErrors');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    }
    function hideCardError() {
        const el = document.getElementById('checkoutCardErrors');
        if (el) el.style.display = 'none';
    }

    function resetPayButton() {
        const btn = document.getElementById('checkoutPayBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-lock"></i><span> Pay Now</span><span id="checkoutPayAmount"></span>';
        }
    }

    // ── Utilities ─────────────────────────────────────────────
    function setElText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function esc(str) {
        return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Check for success redirect return ────────────────────
    // If Stripe redirected back after 3DS, show success screen
    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        const piSecret = params.get('payment_intent_client_secret');
        if (piSecret && window.Stripe) {
            const pk = document.querySelector('meta[name="stripe-pk"]')?.content;
            if (pk) {
                const s = window.Stripe(pk);
                s.retrievePaymentIntent(piSecret).then(({ paymentIntent }) => {
                    if (paymentIntent?.status === 'succeeded') {
                        showSuccess(paymentIntent.id);
                    }
                }).catch(() => {});
            }
        }
    });

})();