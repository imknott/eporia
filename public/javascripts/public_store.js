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
    let _sampleAudio = null;  // HTMLAudioElement for modal sample preview
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
        const grid     = document.getElementById('artistMerchGrid');
        const loading  = document.getElementById('artistMerchLoading');
        const empty    = document.getElementById('artistMerchEmpty');
        const section  = document.getElementById('artistMerchSection');
        const artistId = document.querySelector('[data-artist-id]')?.dataset.artistId;

        if (!grid) return;
        if (!artistId) {
            // No artist ID on the page — hide spinner, show empty state.
            if (loading) loading.style.display = 'none';
            if (empty)   empty.style.display   = 'flex';
            return;
        }

        try {
            // /store/api/items supports artistId filtering and returns artistName + normalised CDN URLs
            const res   = await fetch(`/store/api/items?artistId=${encodeURIComponent(artistId)}&limit=24`);
            const data  = await res.json();
            const items = data.items || [];

            if (loading) loading.style.display = 'none';

            if (items.length === 0) {
                if (empty) empty.style.display = 'flex';
                return;
            }

            items.forEach(item => grid.appendChild(buildMerchCard(item)));

            // CSS sets #artistMerchSection { display:none } by default so the header
            // doesn't flash before items load.  Must set 'block' explicitly — setting ''
            // would just re-apply the CSS rule and keep it hidden.
            if (section) section.style.display = 'block';

        } catch (e) {
            if (loading) loading.style.display = 'none';
            if (empty)   empty.style.display   = 'flex';   // show empty state on error too
            console.warn('[public_store] merch load failed:', e);
        }
    }

    // ─────────────────────────────────────────────────────────
    // MERCH CARD (styled to match the store page's store-card)
    // ─────────────────────────────────────────────────────────
    function buildMerchCard(item) {
        const card = document.createElement('div');
        card.className = 'store-card pub-merch-card';

        const thumb = fixUrl(item.photos?.[0]) || '/images/merch-placeholder.jpg';
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

        // ── Sample player ────────────────────────────────────────────────
        // Stop any previous audio from a prior modal open
        if (_sampleAudio) {
            _sampleAudio.pause();
            _sampleAudio.src = '';
            _sampleAudio = null;
        }

        // Remove any existing sample player from a previous open
        modal.querySelector('.modal-sample-player')?.remove();

        const sample = item.sampleTrack;
        if (sample?.streamUrl) {
            const streamUrl = fixUrl(sample.streamUrl);
            const artSrc    = fixUrl(sample.artUrl) || fixUrl(item.photos?.[0]) || '/images/merch-placeholder.jpg';

            const playerEl = document.createElement('div');
            playerEl.className = 'modal-sample-player';
            playerEl.innerHTML = `
                <div class="sample-player-art" style="background-image:url('${artSrc}')"></div>
                <div class="sample-player-body">
                    <div class="sample-player-header">
                        <i class="fas fa-headphones"></i>
                        <span class="sample-player-label">Sample Track</span>
                    </div>
                    <p class="sample-player-title">${esc(sample.title || item.name || 'Sample Track')}</p>
                    <div class="sample-player-controls">
                        <button class="sample-player-btn pub-sample-btn" type="button" aria-label="Play sample">
                            <i class="fas fa-play"></i>
                        </button>
                        <div class="sample-player-progress">
                            <div class="sample-player-bar pub-sample-bar">
                                <div class="sample-player-fill pub-sample-fill"></div>
                            </div>
                            <span class="sample-player-time pub-sample-time">0:00</span>
                        </div>
                    </div>
                </div>`;

            // Insert before the Add to Cart button
            const infoPanel = modal.querySelector('.item-modal-info');
            const pmAddBtn  = modal.querySelector('#pmAddBtn');
            if (infoPanel && pmAddBtn) infoPanel.insertBefore(playerEl, pmAddBtn);

            const btn  = playerEl.querySelector('.pub-sample-btn');
            const fill = playerEl.querySelector('.pub-sample-fill');
            const time = playerEl.querySelector('.pub-sample-time');
            const bar  = playerEl.querySelector('.pub-sample-bar');

            btn.addEventListener('click', () => {
                if (!_sampleAudio) {
                    _sampleAudio = new Audio(streamUrl);
                    _sampleAudio.addEventListener('timeupdate', () => {
                        if (!_sampleAudio?.duration) return;
                        fill.style.width = (_sampleAudio.currentTime / _sampleAudio.duration * 100) + '%';
                        time.textContent = fmtTime(_sampleAudio.currentTime);
                    });
                    _sampleAudio.addEventListener('ended', () => {
                        btn.innerHTML = '<i class="fas fa-play"></i>';
                        btn.classList.remove('playing');
                        fill.style.width = '0%';
                        time.textContent = '0:00';
                        _sampleAudio = null;
                    });
                    _sampleAudio.addEventListener('error', () => {
                        btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                        btn.classList.remove('playing');
                        _sampleAudio = null;
                    });
                }
                if (_sampleAudio.paused) {
                    _sampleAudio.play().then(() => {
                        btn.innerHTML = '<i class="fas fa-pause"></i>';
                        btn.classList.add('playing');
                    }).catch(() => {
                        btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                    });
                } else {
                    _sampleAudio.pause();
                    btn.innerHTML = '<i class="fas fa-play"></i>';
                    btn.classList.remove('playing');
                }
            });

            bar.addEventListener('click', (e) => {
                if (!_sampleAudio?.duration) return;
                const rect = bar.getBoundingClientRect();
                _sampleAudio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * _sampleAudio.duration;
            });
        }

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
        if (_sampleAudio) {
            _sampleAudio.pause();
            _sampleAudio.src = '';
            _sampleAudio = null;
        }
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
                photo:        fixUrl(item.photos?.[0]) || null,
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
            const thumb = fixUrl(ci.photo) || '/images/merch-placeholder.jpg';
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
    // 30-SECOND TRACK PREVIEW
    // Used by the Featured section on public artist profiles.
    // Enforces a hard 30-second cutoff — auto-stops and resets.
    // Only one track plays at a time across the whole page.
    //
    // AbortError prevention
    // ─────────────────────
    // Browsers reject the Promise returned by audio.play() with
    // AbortError when pause() is called before the promise has
    // resolved (i.e. the user clicks a second track very quickly,
    // or the 30-second timer fires while loading is still pending).
    //
    // The correct pattern (per MDN) is:
    //   1. Store the play() promise in a module-level variable.
    //   2. In stopCurrentPreview(), wait for that promise to settle
    //      before calling pause() — otherwise the browser throws.
    //   3. Clear all state refs BEFORE the async wait so that any
    //      reentrant call to stopCurrentPreview() is a no-op.
    //   4. In the play() .catch(), bail silently on AbortError
    //      and do NOT call stopCurrentPreview() — that would kill
    //      the newly started track whose refs are already live.
    // ─────────────────────────────────────────────────────────
    const PREVIEW_LIMIT = 30;
    let _previewAudio   = null;
    let _previewBtn     = null;
    let _previewBar     = null;
    let _previewTime    = null;
    let _previewWrap    = null;
    let _previewPromise = null;   // the pending play() Promise, if any

    function stopCurrentPreview() {
        // Snapshot and clear ALL state refs first.
        // This makes the function idempotent — any reentrant call
        // (e.g. from inside a .catch() handler) becomes a no-op.
        const audio   = _previewAudio;
        const promise = _previewPromise;
        _previewAudio   = null;
        _previewPromise = null;

        if (audio) {
            if (promise) {
                // A play() is in-flight. We MUST wait for it to settle
                // before pausing — calling pause() on a pending play()
                // causes the AbortError that breaks the next track.
                promise.then(() => {
                    audio.pause();
                    audio.src = '';
                }).catch(() => {
                    // play() was already rejected (e.g. AbortError from a
                    // previous stop) — just clear the src to release memory.
                    audio.src = '';
                });
            } else {
                // No pending promise — safe to pause immediately.
                try { audio.pause(); } catch (_) {}
                audio.src = '';
            }
        }

        // Reset UI refs
        if (_previewBtn) {
            _previewBtn.innerHTML = '<i class="fas fa-play"></i>';
            _previewBtn.classList.remove('playing');
            _previewBtn = null;
        }
        if (_previewBar)  { _previewBar.style.width   = '0%';    _previewBar  = null; }
        if (_previewTime) { _previewTime.textContent   = '0:00';  _previewTime = null; }
        if (_previewWrap) { _previewWrap.style.display = 'none';  _previewWrap = null; }
    }

    window.pubTogglePreview = function (btn) {
        const url = btn.dataset.url;
        if (!url) return;

        // Clicking the currently-playing track → pause/resume
        if (_previewAudio && _previewBtn === btn) {
            if (_previewAudio.paused) {
                // Resume — track the new promise
                _previewPromise = _previewAudio.play();
                _previewPromise.then(() => {
                    _previewPromise = null;
                    btn.innerHTML = '<i class="fas fa-pause"></i>';
                    btn.classList.add('playing');
                }).catch(err => {
                    _previewPromise = null;
                    if (err.name === 'AbortError') return;
                    btn.innerHTML = '<i class="fas fa-play"></i>';
                    btn.classList.remove('playing');
                });
            } else {
                // Pause — safe because we're not in a pending play() here
                _previewAudio.pause();
                btn.innerHTML = '<i class="fas fa-play"></i>';
                btn.classList.remove('playing');
            }
            return;
        }

        // Clicking a different track → stop previous (handles pending play() safely)
        stopCurrentPreview();

        // Find the progress row belonging to this button
        const trackRow = btn.closest('.pub-track-row');
        const progRow  = trackRow?.nextElementSibling;
        const fill     = progRow?.querySelector('.pub-preview-fill');
        const timeEl   = progRow?.querySelector('.pub-preview-time');

        if (progRow) progRow.style.display = 'flex';

        const audio = new Audio(url);

        // Set refs before play() so stopCurrentPreview() called from
        // any async callback always operates on the right element.
        _previewAudio = audio;
        _previewBtn   = btn;
        _previewBar   = fill;
        _previewTime  = timeEl;
        _previewWrap  = progRow || null;

        audio.addEventListener('timeupdate', () => {
            // Guard: audio may have been stopped between tick and handler
            if (audio !== _previewAudio) return;
            const ct = audio.currentTime;
            if (ct >= PREVIEW_LIMIT) { stopCurrentPreview(); return; }
            if (fill)   fill.style.width   = (ct / PREVIEW_LIMIT * 100) + '%';
            if (timeEl) timeEl.textContent  = fmtTime(ct);
        });

        audio.addEventListener('ended', () => {
            if (audio === _previewAudio) stopCurrentPreview();
        });

        audio.addEventListener('error', () => {
            // MEDIA_ERR_ABORTED (code 1) fires when we blank src to stop —
            // that is expected and should not show an error state.
            if (audio.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
            // Only update UI if this audio is still the active one
            if (audio === _previewAudio) {
                btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                btn.classList.remove('playing');
                setTimeout(() => {
                    if (btn.innerHTML.includes('exclamation')) {
                        btn.innerHTML = '<i class="fas fa-play"></i>';
                    }
                }, 2500);
                stopCurrentPreview();
            }
        });

        // Store the promise so stopCurrentPreview() can wait on it
        _previewPromise = audio.play();
        _previewPromise.then(() => {
            _previewPromise = null;
            // Guard: track may have been stopped while loading
            if (audio !== _previewAudio) return;
            btn.innerHTML = '<i class="fas fa-pause"></i>';
            btn.classList.add('playing');
        }).catch(err => {
            _previewPromise = null;
            // AbortError = stopCurrentPreview() was called before the browser
            // started playing (fast click to next track, 30s timer, etc.).
            // This is NOT an error — the new track is already being set up.
            // Do NOT call stopCurrentPreview() here: that would kill the next track.
            if (err.name === 'AbortError') return;
            // Any other error (network, codec, CORS) — show briefly then reset
            if (audio === _previewAudio) {
                btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                btn.classList.remove('playing');
                setTimeout(() => {
                    if (btn.innerHTML.includes('exclamation')) {
                        btn.innerHTML = '<i class="fas fa-play"></i>';
                    }
                }, 2500);
                stopCurrentPreview();
            }
        });
    };

    // Stop preview when merch modal opens (clean audio state)
    const _origOpenMerchModal = window.openMerchModal;
    document.addEventListener('click', e => {
        if (e.target.closest('#pubMerchModal') || e.target.closest('.pub-merch-card')) {
            stopCurrentPreview();
        }
    });
    function catLabel(cat) {
        return { clothing:'Clothing', vinyl:'Vinyl / CD / Tape', digital:'Digital',
                 artwork:'Artwork', bundle:'Bundle', other:'Other' }[cat] || cat;
    }

    function esc(str) {
        return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function fixUrl(url) {
        if (!url) return null;
        if (url.startsWith('https://') || url.startsWith('http://')) return url;
        if (url.startsWith('cdn.eporiamusic.com')) return `https://${url}`;
        return `https://cdn.eporiamusic.com/${url.replace(/^\//, '')}`;
    }

    function fmtTime(s) {
        if (!s || isNaN(s)) return '0:00';
        const m = Math.floor(s / 60), sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
    }

})();