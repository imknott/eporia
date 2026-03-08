/**
 * public/javascripts/public_store.js
 *
 * Cart module for public artist / user profile pages.
 * Shares the same localStorage cart key as store.js so the cart is
 * fully persistent across the store page, artist profiles, and user pages.
 *
 * Exposes globals:
 *   window.openCart()
 *   window.closeCart()
 *   window.addToCartPub(item, selectedSize)   — merch item from store API
 *   window.addDigitalToCart(track, artist)    — digital song purchase
 *   window.cartQty(key, delta)
 *   window.cartRemove(key)
 *   window.proceedToCheckout()
 *
 * Loaded as type="module" — Firebase SDK imported directly.
 */

import {
    getAuth,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';

(function () {

    // ─────────────────────────────────────────────────────────
    // CONSTANTS — must match store.js exactly
    // ─────────────────────────────────────────────────────────
    const CART_KEY         = 'eporia_cart_v1';
    const SUPPORTER_FEE    = 0.10;
    const REGION_LABELS    = {
        usDomestic:  'United States',
        canada:      'Canada',
        europe:      'Europe',
        restOfWorld: 'Rest of World'
    };

    // ─────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────
    const _auth   = getAuth(app);
    let _cart     = loadCart();
    let _region   = localStorage.getItem('eporia_region') || 'usDomestic';
    let _uid      = null;
    let _email    = null;
    let _handle   = null;
    let _avatar   = null;

    // ─────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        injectCartDrawer();
        updateCartBadge();
        bindCartIcon();
        watchAuth();
        loadPageMerch();
    });

    // ─────────────────────────────────────────────────────────
    // AUTH
    // ─────────────────────────────────────────────────────────
    function watchAuth() {
        onAuthStateChanged(_auth, async user => {
            _uid    = user ? user.uid   : null;
            _email  = user ? user.email : null;
            _handle = null;
            _avatar = null;

            if (user) {
                try {
                    const token = await user.getIdToken();
                    const res   = await fetch('/members/api/me', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const profile = await res.json();
                        _handle = profile.handle || null;
                        _avatar = profile.avatar  || null;
                    }
                } catch { /* non-fatal */ }
            }
            updateCartAuthSection();
        });
    }

    // ─────────────────────────────────────────────────────────
    // LOAD ARTIST MERCH ON PROFILE PAGE
    // Looks for #artistMerchGrid — only present on artist profile pages.
    // ─────────────────────────────────────────────────────────
    async function loadPageMerch() {
        const grid      = document.getElementById('artistMerchGrid');
        const loading   = document.getElementById('artistMerchLoading');
        const empty     = document.getElementById('artistMerchEmpty');
        const artistId  = document.querySelector('[data-artist-id]')?.dataset.artistId;

        if (!grid || !artistId) return;

        try {
            const res  = await fetch(`/store/api/items?artistId=${encodeURIComponent(artistId)}&limit=8`);
            const data = await res.json();
            const items = data.items || [];

            if (loading) loading.style.display = 'none';

            if (items.length === 0) {
                if (empty) empty.style.display = 'flex';
                return;
            }

            items.forEach(item => {
                const card = buildMerchCard(item);
                grid.appendChild(card);
            });

            const section = document.getElementById('artistMerchSection');
            if (section) section.style.display = '';

        } catch (e) {
            if (loading) loading.style.display = 'none';
            console.warn('[public_store] merch load failed:', e);
        }
    }

    // ─────────────────────────────────────────────────────────
    // MERCH CARD (styled to match the store page's store-card)
    // ─────────────────────────────────────────────────────────
    function buildMerchCard(item) {
        const card = document.createElement('div');
        card.className = 'store-card pub-merch-card';

        const thumb = item.photos?.[0] || '/images/merch-placeholder.jpg';
        const label = item.fulfillment === 'digital_auto'
            ? '<i class="fas fa-download"></i> Digital'
            : '<i class="fas fa-truck"></i> Ships';

        card.innerHTML = `
            <div class="store-card-img" style="background-image:url('${esc(thumb)}')">
                <span class="store-card-category">${esc(catLabel(item.category))}</span>
            </div>
            <div class="store-card-body">
                <h3 class="store-card-name">${esc(item.name)}</h3>
                <div class="store-card-footer">
                    <span class="store-card-price">$${Number(item.price).toFixed(2)}</span>
                    <span class="store-card-ship">${label}</span>
                </div>
            </div>`;

        card.addEventListener('click', () => openMerchModal(item));
        return card;
    }

    // ─────────────────────────────────────────────────────────
    // MERCH QUICK-ADD MODAL
    // Minimal size-picker + add to cart, using the same HTML
    // structure as the store's full modal so store.css styles it.
    // ─────────────────────────────────────────────────────────
    function openMerchModal(item) {
        let modal = document.getElementById('pubMerchModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pubMerchModal';
            modal.className = 'modal-overlay';
            modal.onclick = e => { if (e.target === modal) closeMerchModal(); };
            modal.innerHTML = `
                <div class="store-item-modal" style="max-width:500px">
                    <button class="modal-close-btn" onclick="closeMerchModal()">&times;</button>
                    <div class="item-modal-inner" style="flex-direction:column">
                        <div id="pmMainImg" class="item-modal-main-img" style="height:260px;border-radius:8px;flex:none;margin-bottom:18px"></div>
                        <div class="item-modal-info">
                            <p class="item-modal-category" id="pmCategory"></p>
                            <h2 class="item-modal-name"  id="pmName"></h2>
                            <div class="item-modal-price" id="pmPrice"></div>
                            <p class="item-modal-desc"   id="pmDesc"></p>
                            <div id="pmSizeRow" class="item-modal-sizes" style="display:none">
                                <label>Select Size</label>
                                <div class="size-selector" id="pmSizes"></div>
                            </div>
                            <div class="item-modal-fulfillment" id="pmFulfill"></div>
                            <button class="btn-primary btn-buy" id="pmAddBtn" type="button">
                                <i class="fas fa-shopping-cart"></i><span> Add to Cart</span>
                            </button>
                            <p class="item-modal-fee-note">
                                <i class="fas fa-info-circle"></i>
                                A small 10% supporter fee is added at checkout. Artists keep 100%.
                            </p>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        const photos = item.photos?.filter(Boolean) || [];
        document.getElementById('pmMainImg').style.backgroundImage =
            `url('${photos[0] || '/images/merch-placeholder.jpg'}')`;
        document.getElementById('pmCategory').textContent = catLabel(item.category);
        document.getElementById('pmName').textContent     = item.name || '';
        document.getElementById('pmPrice').textContent    = `$${Number(item.price).toFixed(2)}`;
        document.getElementById('pmDesc').textContent     = item.description || '';

        // Sizes
        const sizeRow = document.getElementById('pmSizeRow');
        const sizes   = document.getElementById('pmSizes');
        sizes.innerHTML = '';
        if (item.category === 'clothing' && item.sizes?.length) {
            sizeRow.style.display = 'block';
            item.sizes.forEach(s => {
                const btn = document.createElement('button');
                btn.className = 'size-btn';
                btn.textContent = s;
                btn.addEventListener('click', () => {
                    sizes.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
                sizes.appendChild(btn);
            });
        } else {
            sizeRow.style.display = 'none';
        }

        const fulfillEl = document.getElementById('pmFulfill');
        fulfillEl.innerHTML = item.fulfillment === 'digital_auto'
            ? '<i class="fas fa-bolt"></i> Digital delivery — download link sent instantly after purchase.'
            : '<i class="fas fa-truck"></i> Shipped by the artist.';

        const addBtn = document.getElementById('pmAddBtn');
        addBtn.disabled = false;
        addBtn.innerHTML = '<i class="fas fa-shopping-cart"></i><span> Add to Cart</span>';
        addBtn.onclick = () => {
            const needsSize = item.category === 'clothing' && item.sizes?.length;
            const activeSize = sizes.querySelector('.size-btn.active');
            if (needsSize && !activeSize) {
                sizeRow.classList.add('shake');
                setTimeout(() => sizeRow.classList.remove('shake'), 600);
                return;
            }
            addToCartPub(item, activeSize?.textContent || null);
            addBtn.innerHTML = '<i class="fas fa-check"></i><span> Added!</span>';
            addBtn.disabled  = true;
            setTimeout(() => {
                closeMerchModal();
                window.openCart();
            }, 600);
        };

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    window.closeMerchModal = function () {
        const m = document.getElementById('pubMerchModal');
        if (m) { m.classList.remove('active'); document.body.style.overflow = ''; }
    };

    // ─────────────────────────────────────────────────────────
    // ADD TO CART — PUBLIC (merch from store API)
    // ─────────────────────────────────────────────────────────
    function addToCartPub(item, selectedSize) {
        const key = `${item.id}_${selectedSize || 'nosize'}`;
        const ex  = _cart.find(c => c.key === key);
        if (ex) {
            ex.qty = Math.min(ex.qty + 1, 99);
        } else {
            _cart.push({
                key,
                itemId:       item.id,
                artistId:     item.artistId,
                artistName:   item.artistName || '',
                name:         item.name,
                price:        item.price,
                photo:        item.photos?.[0] || null,
                category:     item.category,
                fulfillment:  item.fulfillment,
                shippingRates: item.shippingRates || null,
                selectedSize: selectedSize || null,
                qty: 1
            });
        }
        saveCart(); updateCartBadge(); renderCartItems();
    }
    window.addToCartPub = addToCartPub;

    // ─────────────────────────────────────────────────────────
    // ADD TO CART — DIGITAL TRACK
    // ─────────────────────────────────────────────────────────
    window.addDigitalToCart = function (trackId, trackTitle, artistId, artistName, artUrl, price, btn) {
        if (!price || price <= 0) return;

        const key = `digital_${trackId}`;
        const ex  = _cart.find(c => c.key === key);
        if (!ex) {
            _cart.push({
                key,
                itemId:       trackId,
                artistId:     artistId,
                artistName:   artistName,
                name:         trackTitle + ' (Digital)',
                price:        parseFloat(price),
                photo:        artUrl || null,
                category:     'digital',
                fulfillment:  'digital_auto',
                shippingRates: null,
                selectedSize: null,
                qty: 1
            });
        }
        saveCart(); updateCartBadge(); renderCartItems();

        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Added!';
            btn.disabled  = true;
            setTimeout(() => { btn.disabled = false; btn.innerHTML = orig; }, 1800);
        }
        window.openCart();
    };

    // ─────────────────────────────────────────────────────────
    // CART STATE HELPERS
    // ─────────────────────────────────────────────────────────
    function loadCart() {
        try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
    }

    function saveCart() {
        try { localStorage.setItem(CART_KEY, JSON.stringify(_cart)); } catch {}
    }

    function updateCartBadge() {
        const badge = document.getElementById('cartBadge');
        if (!badge) return;
        const total = _cart.reduce((s, c) => s + c.qty, 0);
        badge.textContent = total || '';
        badge.style.display = total > 0 ? 'flex' : 'none';
    }

    window.cartQty = function (key, delta) {
        const item = _cart.find(c => c.key === key);
        if (!item) return;
        item.qty = Math.max(0, item.qty + delta);
        if (item.qty === 0) _cart = _cart.filter(c => c.key !== key);
        saveCart(); updateCartBadge(); renderCartItems();
    };

    window.cartRemove = function (key) {
        _cart = _cart.filter(c => c.key !== key);
        saveCart(); updateCartBadge(); renderCartItems();
    };

    // ─────────────────────────────────────────────────────────
    // SHIPPING
    // ─────────────────────────────────────────────────────────
    function calcItemShipping(item, region, qty) {
        if (!item.shippingRates || item.fulfillment === 'digital_auto') return 0;
        const rates  = item.shippingRates;
        const r      = rates[region] || rates.usDomestic || { first: 0, additional: 0 };
        if (rates.freeShippingEnabled && item.price * qty >= (rates.freeShippingThreshold || Infinity)) return 0;
        return r.first + r.additional * Math.max(0, qty - 1);
    }

    function calcTotals() {
        let items = 0, ship = 0;
        _cart.forEach(ci => {
            items += ci.price * ci.qty;
            ship  += calcItemShipping(ci, _region, ci.qty);
        });
        const fee   = Math.round(items * SUPPORTER_FEE * 100) / 100;
        return { items, ship, fee, total: items + ship + fee };
    }

    // ─────────────────────────────────────────────────────────
    // CART DRAWER INJECTION
    // Same HTML structure as store.js so store.css styles it.
    // ─────────────────────────────────────────────────────────
    function injectCartDrawer() {
        // Don't double-inject if store.js already added it
        if (document.getElementById('cartDrawer')) return;

        const regionOpts = Object.entries(REGION_LABELS)
            .map(([v, l]) => `<option value="${v}" ${v === _region ? 'selected' : ''}>${l}</option>`)
            .join('');

        document.body.insertAdjacentHTML('beforeend', `
        <div id="cartBackdrop" class="cart-backdrop" onclick="window.closeCart()"></div>
        <aside id="cartDrawer" class="cart-drawer" role="dialog" aria-label="Shopping cart">
            <div class="cart-drawer-header">
                <h2 class="cart-title">
                    <i class="fas fa-shopping-cart"></i>
                    Your Cart
                    <span id="cartHeaderCount" class="cart-header-count"></span>
                </h2>
                <button class="cart-close-btn" onclick="window.closeCart()" aria-label="Close cart">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="cart-region-row">
                <label for="cartRegionSelect">
                    <i class="fas fa-globe"></i> Shipping to:
                </label>
                <select id="cartRegionSelect">${regionOpts}</select>
            </div>
            <div id="cartAuthSection" class="cart-auth-section"></div>
            <div id="cartItemList"    class="cart-item-list"></div>
            <div id="cartTotals"      class="cart-totals"></div>
            <div class="cart-checkout-footer">
                <button id="cartCheckoutBtn" class="btn-primary btn-buy" onclick="window.proceedToCheckout()">
                    <i class="fas fa-lock"></i>
                    <span>Secure Checkout</span>
                </button>
                <p class="cart-fee-note">
                    <i class="fas fa-info-circle"></i>
                    A small 10% supporter fee is added to keep Eporia running.
                    100% of item prices go directly to the artists.
                </p>
                <button class="cart-continue-btn" onclick="window.closeCart()">
                    <i class="fas fa-arrow-left"></i> Continue Shopping
                </button>
            </div>
        </aside>`);

        document.getElementById('cartRegionSelect').addEventListener('change', e => {
            _region = e.target.value;
            localStorage.setItem('eporia_region', _region);
            renderCartItems();
        });
    }

    function bindCartIcon() {
        document.getElementById('cartIcon')?.addEventListener('click', e => {
            e.preventDefault();
            window.openCart();
        });
    }

    window.openCart = function () {
        renderCartItems();
        updateCartAuthSection();
        document.getElementById('cartDrawer')?.classList.add('open');
        document.getElementById('cartBackdrop')?.classList.add('visible');
        document.body.style.overflow = 'hidden';
    };

    window.closeCart = function () {
        document.getElementById('cartDrawer')?.classList.remove('open');
        document.getElementById('cartBackdrop')?.classList.remove('visible');
        document.body.style.overflow = '';
    };

    // ─────────────────────────────────────────────────────────
    // RENDER CART
    // ─────────────────────────────────────────────────────────
    function renderCartItems() {
        const list      = document.getElementById('cartItemList');
        const totalsEl  = document.getElementById('cartTotals');
        const checkBtn  = document.getElementById('cartCheckoutBtn');
        const headerCnt = document.getElementById('cartHeaderCount');

        if (!list) return;

        const totalItems = _cart.reduce((s, c) => s + c.qty, 0);
        if (headerCnt) headerCnt.textContent = totalItems ? `(${totalItems})` : '';

        if (_cart.length === 0) {
            list.innerHTML = `
                <div class="cart-empty">
                    <i class="fas fa-store-slash"></i>
                    <p>Your cart is empty</p>
                    <p class="cart-empty-sub">Browse artists' merch and digital tracks.</p>
                </div>`;
            if (totalsEl) totalsEl.innerHTML = '';
            if (checkBtn) checkBtn.disabled = true;
            return;
        }

        if (checkBtn) checkBtn.disabled = false;

        list.innerHTML = _cart.map(ci => {
            const shipping = calcItemShipping(ci, _region, ci.qty);
            const lineTotal = ci.price * ci.qty;
            const thumb = ci.photo || '/images/merch-placeholder.jpg';
            const shipLabel = ci.fulfillment === 'digital_auto'
                ? `<span class="cart-item-ship digital"><i class="fas fa-download"></i> Digital</span>`
                : shipping === 0
                    ? `<span class="cart-item-ship free"><i class="fas fa-truck"></i> Free shipping</span>`
                    : `<span class="cart-item-ship"><i class="fas fa-truck"></i> +$${shipping.toFixed(2)} shipping</span>`;

            return `
            <div class="cart-item" data-key="${esc(ci.key)}">
                <div class="cart-item-img" style="background-image:url('${esc(thumb)}')"></div>
                <div class="cart-item-details">
                    <p class="cart-item-artist">${esc(ci.artistName)}</p>
                    <p class="cart-item-name">${esc(ci.name)}${ci.selectedSize ? ` <span class="cart-item-size">${ci.selectedSize}</span>` : ''}</p>
                    ${shipLabel}
                    <div class="cart-item-controls">
                        <button class="cart-qty-btn" onclick="window.cartQty('${esc(ci.key)}',-1)">−</button>
                        <span class="cart-qty">${ci.qty}</span>
                        <button class="cart-qty-btn" onclick="window.cartQty('${esc(ci.key)}',1)">+</button>
                        <span class="cart-item-line-total">$${lineTotal.toFixed(2)}</span>
                        <button class="cart-remove-btn" onclick="window.cartRemove('${esc(ci.key)}')" aria-label="Remove">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');

        const { items, ship, fee, total } = calcTotals();
        if (totalsEl) totalsEl.innerHTML = `
            <div class="cart-totals-inner">
                <div class="cart-total-row"><span>Items</span><span>$${items.toFixed(2)}</span></div>
                <div class="cart-total-row"><span>Shipping</span><span>${ship === 0 ? 'Free' : '$' + ship.toFixed(2)}</span></div>
                <div class="cart-total-row fee-row">
                    <span>Eporia Supporter Fee <span class="fee-pct">(10%)</span></span>
                    <span>$${fee.toFixed(2)}</span>
                </div>
                <div class="cart-total-row grand-total-row">
                    <span>Total</span><span>$${total.toFixed(2)}</span>
                </div>
            </div>`;
    }

    function updateCartAuthSection() {
        const el = document.getElementById('cartAuthSection');
        if (!el) return;
        if (_uid) {
            const name = _handle || _email || 'your account';
            const avatar = _avatar
                ? `<img src="${esc(_avatar)}" class="cart-auth-avatar" alt="${esc(name)}">`
                : `<div class="cart-auth-avatar-fallback"><i class="fas fa-user"></i></div>`;
            el.innerHTML = `
                <div class="cart-auth-logged-in">
                    <div class="cart-auth-logged-in-row">
                        ${avatar}
                        <div class="cart-auth-logged-in-info">
                            <span class="cart-auth-name">${esc(name)}</span>
                            <span class="cart-auth-note">Purchases saved to your account</span>
                        </div>
                        <i class="fas fa-check-circle cart-auth-check"></i>
                    </div>
                    <button class="cart-signout-btn" onclick="window.pubSignOut()">
                        <i class="fas fa-sign-out-alt"></i> Sign out
                    </button>
                </div>`;
        } else {
            el.innerHTML = `
                <div class="cart-auth-guest">
                    <div class="cart-auth-guest-msg">
                        <i class="fas fa-user"></i>
                        <span>Checking out as guest</span>
                    </div>
                    <a class="cart-signin-link" href="/members/signin">
                        Sign in to track your artist support
                        <i class="fas fa-arrow-right"></i>
                    </a>
                </div>`;
        }
    }

    window.pubSignOut = async function () {
        try { await signOut(_auth); await fetch('/members/logout', { method: 'GET' }); } catch {}
    };

    // ─────────────────────────────────────────────────────────
    // CHECKOUT — same endpoint as store.js
    // ─────────────────────────────────────────────────────────
    window.proceedToCheckout = async function () {
        if (_cart.length === 0) return;
        const btn = document.getElementById('cartCheckoutBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Processing...</span>'; }

        try {
            let idToken = null;
            if (_auth.currentUser) idToken = await _auth.currentUser.getIdToken();

            const headers = { 'Content-Type': 'application/json' };
            if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

            const res = await fetch('/store/api/checkout', {
                method: 'POST', headers,
                body: JSON.stringify({
                    cartItems: _cart.map(ci => ({
                        itemId:       ci.itemId,
                        artistId:     ci.artistId,
                        artistName:   ci.artistName,
                        name:         ci.name,
                        price:        ci.price,
                        qty:          ci.qty,
                        selectedSize: ci.selectedSize,
                        shippingCost: calcItemShipping(ci, _region, ci.qty),
                        photo:        ci.photo
                    })),
                    region:    _region,
                    userEmail: _email || null,
                    userId:    _uid   || null
                })
            });

            const data = await res.json();
            if (data.url) {
                _cart = []; saveCart(); updateCartBadge();
                window.location.href = data.url;
            } else {
                throw new Error(data.error || 'Checkout failed');
            }
        } catch (e) {
            console.error('[public_store] checkout error:', e);
            if (btn) {
                btn.disabled  = false;
                btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <span>Error — try again</span>';
                setTimeout(() => { btn.innerHTML = '<i class="fas fa-lock"></i> <span>Secure Checkout</span>'; }, 3000);
            }
        }
    };

    // ─────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────
    function catLabel(cat) {
        return { clothing:'Clothing', vinyl:'Vinyl / CD / Tape', digital:'Digital',
                 artwork:'Artwork', bundle:'Bundle', other:'Other' }[cat] || cat;
    }

    function esc(str) {
        return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

})();
