/**
 * public/javascripts/store.js
 *
 * Powers the public /store page.
 * - Browse / filter / search merch grid
 * - Item detail modal with image gallery + size selector
 * - Cart drawer (localStorage persisted, guest + logged-in)
 * - Shipping region selector with per-item rate calculation
 * - Stripe Checkout redirect via /store/api/checkout
 * - Firebase Auth — in-store sign-in modal, no redirect to player
 *
 * Loaded as type="module" — Firebase SDK imported directly.
 */

import {
    getAuth,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';

(function () {
    const _auth = getAuth(app);
    // ─────────────────────────────────────────────────────────
    // CONSTANTS
    // ─────────────────────────────────────────────────────────
    const SUPPORTER_FEE_PCT = 0.10;   // 10% displayed in cart, enforced server-side
    const CART_KEY          = 'eporia_cart_v1';

    const REGION_LABELS = {
        usDomestic:  'United States',
        canada:      'Canada',
        europe:      'Europe',
        restOfWorld: 'Rest of World'
    };

    // ─────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────
    let _allItems       = [];
    let _filtered       = [];
    let _page           = 0;
    const PAGE_SIZE     = 24;
    let _activeCategory = 'all';
    let _searchQuery    = '';
    let _sortOrder      = 'newest';
    let _cart           = loadCart();
    let _region         = localStorage.getItem('eporia_region') || 'usDomestic';
    let _currentItem    = null;   // item open in modal
    let _sampleAudio    = null;   // HTMLAudioElement for sample preview
    let _currentUid     = null;
    let _currentEmail   = null;
    let _currentHandle  = null;
    let _currentAvatar  = null;

    // ─────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        injectCartDrawer();
        loadAllItems();
        bindSearch();
        bindFilters();
        bindSort();
        bindCartIcon();
        updateCartBadge();
        tryGetAuthState();
    });

    // ─────────────────────────────────────────────────────────
    // FIREBASE AUTH
    // Uses the modular SDK imported at the top of this file.
    // Runs immediately on page load — no page redirect on sign-in.
    // ─────────────────────────────────────────────────────────
    function tryGetAuthState() {
        onAuthStateChanged(_auth, async user => {
            _currentUid    = user ? user.uid   : null;
            _currentEmail  = user ? user.email : null;
            _currentHandle = null;
            _currentAvatar = null;

            if (user) {
                // Silently fetch handle + avatar from the server
                try {
                    const token = await user.getIdToken();
                    const res   = await fetch('/members/api/me', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const profile  = await res.json();
                        _currentHandle = profile.handle || null;
                        _currentAvatar = profile.avatar || null;
                    }
                } catch { /* non-fatal — falls back to email */ }
            }

            updateCartAuthSection();
        });
    }

    // ─────────────────────────────────────────────────────────
    // LOAD ITEMS
    // ─────────────────────────────────────────────────────────
    async function loadAllItems() {
        showLoading(true);
        try {
            const res  = await fetch('/store/api/items');
            const data = await res.json();
            _allItems  = data.items || [];
            applyFilters();
        } catch (e) {
            console.error('[store] load failed:', e);
            showEmpty(true);
        } finally {
            showLoading(false);
        }
    }

    // ─────────────────────────────────────────────────────────
    // FILTERING & SEARCH
    // ─────────────────────────────────────────────────────────
    function applyFilters() {
        const q = _searchQuery.toLowerCase();

        _filtered = _allItems.filter(item => {
            const catMatch  = _activeCategory === 'all' || item.category === _activeCategory;
            const textMatch = !q
                || item.name.toLowerCase().includes(q)
                || (item.artistName || '').toLowerCase().includes(q);
            return catMatch && textMatch;
        });

        if (_sortOrder === 'price_asc')  _filtered.sort((a, b) => a.price - b.price);
        if (_sortOrder === 'price_desc') _filtered.sort((a, b) => b.price - a.price);

        _page = 0;
        renderPage(true);
    }

    function renderPage(reset = false) {
        const grid = document.getElementById('storeGrid');
        if (reset) grid.innerHTML = '';

        const start = _page * PAGE_SIZE;
        const slice = _filtered.slice(start, start + PAGE_SIZE);

        if (_filtered.length === 0) {
            showEmpty(true);
            document.getElementById('storeLoadMore').style.display = 'none';
            return;
        }
        showEmpty(false);

        slice.forEach(item => grid.appendChild(buildCard(item)));

        const hasMore = (_page + 1) * PAGE_SIZE < _filtered.length;
        document.getElementById('storeLoadMore').style.display = hasMore ? 'flex' : 'none';
    }

    window.loadMoreItems = function () {
        _page++;
        renderPage(false);
    };

    function bindSearch() {
        const input = document.getElementById('storeSearch');
        let timer;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                _searchQuery = input.value;
                applyFilters();
            }, 280);
        });
    }

    function bindFilters() {
        document.querySelectorAll('.filter-pill[data-cat]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-pill[data-cat]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _activeCategory = btn.dataset.cat;
                applyFilters();
            });
        });
    }

    function bindSort() {
        document.getElementById('storeSort').addEventListener('change', e => {
            _sortOrder = e.target.value;
            applyFilters();
        });
    }

    // ─────────────────────────────────────────────────────────
    // CARD
    // ─────────────────────────────────────────────────────────
    function buildCard(item) {
        const card  = document.createElement('div');
        card.className   = 'store-card';
        card.dataset.id  = item.id;

        const thumb = fixUrl(item.photos?.[0]) || '/images/merch-placeholder.jpg';
        const fulfillIcon = item.fulfillment === 'digital_auto'
            ? '<i class="fas fa-download"></i> Digital'
            : '<i class="fas fa-truck"></i> Ships';

        card.innerHTML = `
            <div class="store-card-img" style="background-image:url('${esc(thumb)}')">
                <span class="store-card-category">${categoryLabel(item.category)}</span>
            </div>
            <div class="store-card-body">
                <p class="store-card-artist"><a class="store-card-artist-link" href="${artistProfileUrl(item)}" onclick="event.stopPropagation()">${esc(item.artistName || '')}</a></p>
                <h3 class="store-card-name">${esc(item.name)}</h3>
                <div class="store-card-footer">
                    <span class="store-card-price">$${Number(item.price).toFixed(2)}</span>
                    <span class="store-card-ship">${fulfillIcon}</span>
                </div>
            </div>`;

        card.addEventListener('click', () => openItemModal(item));
        return card;
    }

    // ─────────────────────────────────────────────────────────
    // ITEM DETAIL MODAL
    // ─────────────────────────────────────────────────────────
    function openItemModal(item) {
        _currentItem = item;

        // Gallery
        const mainImg = document.getElementById('modalMainImg');
        const thumbs  = document.getElementById('modalThumbs');
        const photos  = (item.photos || []).map(fixUrl).filter(Boolean);

        if (photos.length > 0) {
            mainImg.style.backgroundImage = `url('${photos[0]}')`;
        } else {
            mainImg.style.backgroundImage = "url('/images/merch-placeholder.jpg')";
        }

        thumbs.innerHTML = photos.map((url, i) => `
            <div class="thumb ${i === 0 ? 'active' : ''}"
                 style="background-image:url('${esc(url)}')"
                 data-url="${esc(url)}">
            </div>`).join('');

        thumbs.querySelectorAll('.thumb').forEach(t => {
            t.addEventListener('click', () => {
                mainImg.style.backgroundImage = `url('${t.dataset.url}')`;
                thumbs.querySelectorAll('.thumb').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
            });
        });

        // Arrow nav for gallery
        const prev = document.getElementById('modalPrevImg');
        const next = document.getElementById('modalNextImg');
        if (photos.length > 1) {
            prev.style.display = 'flex';
            next.style.display = 'flex';
            let currentIdx = 0;

            const goTo = (idx) => {
                currentIdx = (idx + photos.length) % photos.length;
                mainImg.style.backgroundImage = `url('${photos[currentIdx]}')`;
                thumbs.querySelectorAll('.thumb').forEach((t, i) => {
                    t.classList.toggle('active', i === currentIdx);
                });
            };

            prev.onclick = () => goTo(currentIdx - 1);
            next.onclick = () => goTo(currentIdx + 1);
        } else {
            prev.style.display = 'none';
            next.style.display = 'none';
        }

        // Text fields
        document.getElementById('modalCategory').innerText   = categoryLabel(item.category);
        document.getElementById('modalName').innerText       = item.name || '';
        document.getElementById('modalArtistName').innerText = item.artistName || '';
        const _artistUrl = artistProfileUrl(item);
        document.getElementById('modalArtistLink').href      = _artistUrl;
        const _profileBtn = document.getElementById('modalArtistProfileBtn');
        if (_profileBtn) _profileBtn.href = _artistUrl;
        document.getElementById('modalPrice').innerText      = `$${Number(item.price).toFixed(2)}`;
        document.getElementById('modalDesc').innerText       = item.description || '';

        // Sizes
        const sizeRow      = document.getElementById('modalSizeRow');
        const sizeSelector = document.getElementById('modalSizeSelector');
        sizeSelector.innerHTML = '';

        if (item.category === 'clothing' && item.sizes?.length) {
            sizeRow.style.display = 'block';
            item.sizes.forEach(s => {
                const btn = document.createElement('button');
                btn.className = 'size-btn';
                btn.textContent = s;
                btn.addEventListener('click', () => {
                    sizeSelector.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
                sizeSelector.appendChild(btn);
            });
        } else {
            sizeRow.style.display = 'none';
        }

        // Shipping estimate for selected region
        renderModalShipping(item);

        // Fulfillment note
        const fulfillNote = document.getElementById('modalFulfillment');
        fulfillNote.innerHTML = item.fulfillment === 'digital_auto'
            ? '<i class="fas fa-bolt"></i> Digital delivery — download link sent to your email instantly after purchase.'
            : item.fulfillment === 'self'
            ? `<i class="fas fa-box"></i> Shipped by the artist${item.shipFromAddress ? ' from ' + esc(item.shipFromAddress) : ''}.`
            : '<i class="fas fa-truck"></i> Ships via Printful print-on-demand. Tracking provided after dispatch.';

        // ── Sample track player ──────────────────────────────────────────
        // Show for vinyl/cd/tape/artwork/bundle items with a sampleTrack.
        // Any category can have a sample; we show it whenever one exists.
        const samplePlayer = document.getElementById('modalSamplePlayer');
        const sampleBtn    = document.getElementById('modalSampleBtn');
        const sampleArt    = document.getElementById('modalSampleArt');
        const sampleTitle  = document.getElementById('modalSampleTitle');
        const sampleFill   = document.getElementById('modalSampleFill');
        const sampleTime   = document.getElementById('modalSampleTime');
        const sampleBar    = document.getElementById('modalSampleBar');

        // Stop any previously playing audio from another item
        if (_sampleAudio) {
            _sampleAudio.pause();
            _sampleAudio.src = '';
            _sampleAudio = null;
        }
        if (sampleBtn) {
            sampleBtn.innerHTML = '<i class="fas fa-play"></i>';
            sampleBtn.classList.remove('playing');
        }
        if (sampleFill) sampleFill.style.width = '0%';
        if (sampleTime) sampleTime.textContent = '0:00';

        const sample = item.sampleTrack;
        if (sample?.streamUrl && samplePlayer) {
            const streamUrl = fixUrl(sample.streamUrl);
            samplePlayer.style.display = 'flex';

            // Album art for the sample (falls back to first product photo)
            const artSrc = fixUrl(sample.artUrl) || fixUrl(item.photos?.[0]) || '/images/merch-placeholder.jpg';
            if (sampleArt) sampleArt.style.backgroundImage = `url('${artSrc}')`;
            if (sampleTitle) sampleTitle.textContent = sample.title || item.name || 'Sample Track';

            // Wire up play/pause
            sampleBtn.onclick = () => {
                if (!_sampleAudio) {
                    _sampleAudio = new Audio(streamUrl);
                    _sampleAudio.preload = 'metadata';

                    _sampleAudio.addEventListener('timeupdate', () => {
                        if (!_sampleAudio.duration) return;
                        const pct = (_sampleAudio.currentTime / _sampleAudio.duration) * 100;
                        if (sampleFill) sampleFill.style.width = pct + '%';
                        if (sampleTime) sampleTime.textContent = fmtTime(_sampleAudio.currentTime);
                    });

                    _sampleAudio.addEventListener('ended', () => {
                        sampleBtn.innerHTML = '<i class="fas fa-play"></i>';
                        sampleBtn.classList.remove('playing');
                        if (sampleFill) sampleFill.style.width = '0%';
                        if (sampleTime) sampleTime.textContent = '0:00';
                        _sampleAudio = null;
                    });

                    _sampleAudio.addEventListener('error', () => {
                        sampleBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                        sampleBtn.classList.remove('playing');
                        _sampleAudio = null;
                    });
                }

                if (_sampleAudio.paused) {
                    _sampleAudio.play().then(() => {
                        sampleBtn.innerHTML = '<i class="fas fa-pause"></i>';
                        sampleBtn.classList.add('playing');
                    }).catch(() => {
                        sampleBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                    });
                } else {
                    _sampleAudio.pause();
                    sampleBtn.innerHTML = '<i class="fas fa-play"></i>';
                    sampleBtn.classList.remove('playing');
                }
            };

            // Scrub bar click
            if (sampleBar) {
                sampleBar.addEventListener('click', (e) => {
                    if (!_sampleAudio?.duration) return;
                    const rect = sampleBar.getBoundingClientRect();
                    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    _sampleAudio.currentTime = pct * _sampleAudio.duration;
                });
            }
        } else if (samplePlayer) {
            samplePlayer.style.display = 'none';
        }

        // Reset add-to-cart button
        const addBtn = document.getElementById('modalAddToCart');
        addBtn.disabled   = false;
        addBtn.innerHTML  = '<i class="fas fa-shopping-cart"></i><span> Add to Cart</span>';

        document.getElementById('itemModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function renderModalShipping(item) {
        const shippingEl = document.getElementById('modalShipping');
        if (!shippingEl) return;

        if (item.fulfillment === 'digital_auto') {
            shippingEl.innerHTML = '<i class="fas fa-download"></i> Free — digital delivery';
            return;
        }

        const shipping = calcItemShipping(item, _region, 1);
        const regionLabel = REGION_LABELS[_region] || _region;

        if (shipping === 0) {
            shippingEl.innerHTML = `<i class="fas fa-truck"></i> Free shipping to ${regionLabel}`;
        } else {
            shippingEl.innerHTML = `<i class="fas fa-truck"></i> $${shipping.toFixed(2)} shipping to ${regionLabel}`;
        }
    }

    window.closeItemModal = function (e) {
        if (e && e.target !== document.getElementById('itemModal')) return;
        // Stop sample playback when modal closes
        if (_sampleAudio) {
            _sampleAudio.pause();
            _sampleAudio.src = '';
            _sampleAudio = null;
        }
        document.getElementById('itemModal').classList.remove('active');
        document.body.style.overflow = '';
        _currentItem = null;
    };

    // Add to cart from modal
    document.addEventListener('click', e => {
        if (e.target.id === 'modalAddToCart' || e.target.closest('#modalAddToCart')) {
            if (!_currentItem) return;

            const sizeSelector = document.getElementById('modalSizeSelector');
            const activeSize   = sizeSelector?.querySelector('.size-btn.active');
            const needsSize    = _currentItem.category === 'clothing' && _currentItem.sizes?.length;

            if (needsSize && !activeSize) {
                // Shake the size row to prompt selection
                const sizeRow = document.getElementById('modalSizeRow');
                sizeRow.classList.add('shake');
                setTimeout(() => sizeRow.classList.remove('shake'), 600);
                return;
            }

            addToCart(_currentItem, activeSize?.textContent || null);

            const addBtn = document.getElementById('modalAddToCart');
            addBtn.innerHTML = '<i class="fas fa-check"></i><span> Added!</span>';
            addBtn.disabled  = true;

            setTimeout(() => {
                document.getElementById('itemModal').classList.remove('active');
                document.body.style.overflow = '';
                _currentItem = null;
                openCart();
            }, 600);
        }
    });

    // ─────────────────────────────────────────────────────────
    // CART STATE
    // ─────────────────────────────────────────────────────────
    function loadCart() {
        try {
            return JSON.parse(localStorage.getItem(CART_KEY)) || [];
        } catch {
            return [];
        }
    }

    function saveCart() {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(_cart));
        } catch {}
    }

    function addToCart(item, selectedSize) {
        const key = `${item.id}_${selectedSize || 'nosize'}`;
        const existing = _cart.find(c => c.key === key);

        if (existing) {
            existing.qty = Math.min(existing.qty + 1, 99);
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
                qty:          1
            });
        }

        saveCart();
        updateCartBadge();
        renderCartItems();
    }

    function removeFromCart(key) {
        _cart = _cart.filter(c => c.key !== key);
        saveCart();
        updateCartBadge();
        renderCartItems();
    }

    function updateCartQty(key, delta) {
        const item = _cart.find(c => c.key === key);
        if (!item) return;
        item.qty = Math.max(0, item.qty + delta);
        if (item.qty === 0) {
            removeFromCart(key);
        } else {
            saveCart();
            renderCartItems();
        }
    }

    // ─────────────────────────────────────────────────────────
    // SHIPPING CALCULATION
    // ─────────────────────────────────────────────────────────
    function calcItemShipping(item, region, qty) {
        if (!item.shippingRates || item.fulfillment === 'digital_auto') return 0;

        const rates      = item.shippingRates;
        const regionRate = rates[region] || rates.usDomestic || { first: 0, additional: 0 };

        // Check free shipping threshold
        if (rates.freeShippingEnabled) {
            const threshold = rates.freeShippingThreshold || Infinity;
            if (item.price * qty >= threshold) return 0;
        }

        return regionRate.first + regionRate.additional * Math.max(0, qty - 1);
    }

    function calcCartTotals() {
        let itemsSubtotal = 0;
        let shippingTotal = 0;

        _cart.forEach(ci => {
            itemsSubtotal += ci.price * ci.qty;
            shippingTotal += calcItemShipping(ci, _region, ci.qty);
        });

        const supporterFee = Math.round(itemsSubtotal * SUPPORTER_FEE_PCT * 100) / 100;
        const grandTotal   = itemsSubtotal + shippingTotal + supporterFee;

        return { itemsSubtotal, shippingTotal, supporterFee, grandTotal };
    }

    // ─────────────────────────────────────────────────────────
    // CART DRAWER — INJECT HTML
    // ─────────────────────────────────────────────────────────
    function injectCartDrawer() {
        const regionOptions = Object.entries(REGION_LABELS)
            .map(([val, label]) => `<option value="${val}" ${val === _region ? 'selected' : ''}>${label}</option>`)
            .join('');

        const drawerHTML = `
        <!-- Cart overlay backdrop -->
        <div id="cartBackdrop" class="cart-backdrop" onclick="window.closeCart()"></div>

        <!-- Cart drawer -->
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

            <!-- Region selector -->
            <div class="cart-region-row">
                <label for="cartRegionSelect">
                    <i class="fas fa-globe"></i> Shipping to:
                </label>
                <select id="cartRegionSelect">
                    ${regionOptions}
                </select>
            </div>

            <!-- Auth section -->
            <div id="cartAuthSection" class="cart-auth-section"></div>

            <!-- Item list -->
            <div id="cartItemList" class="cart-item-list"></div>

            <!-- Totals -->
            <div id="cartTotals" class="cart-totals"></div>

            <!-- Checkout button -->
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
        </aside>`;

        document.body.insertAdjacentHTML('beforeend', drawerHTML);

        // Bind region change
        document.getElementById('cartRegionSelect').addEventListener('change', e => {
            _region = e.target.value;
            localStorage.setItem('eporia_region', _region);
            renderCartItems();
            // Also update modal shipping if open
            if (_currentItem) renderModalShipping(_currentItem);
        });
    }

    function bindCartIcon() {
        document.getElementById('cartIcon')?.addEventListener('click', e => {
            e.preventDefault();
            openCart();
        });
    }

    window.openCart = function () {
        renderCartItems();
        updateCartAuthSection();
        document.getElementById('cartDrawer').classList.add('open');
        document.getElementById('cartBackdrop').classList.add('visible');
        document.body.style.overflow = 'hidden';
    };

    window.closeCart = function () {
        document.getElementById('cartDrawer').classList.remove('open');
        document.getElementById('cartBackdrop').classList.remove('visible');
        document.body.style.overflow = '';
    };

    // ─────────────────────────────────────────────────────────
    // RENDER CART
    // ─────────────────────────────────────────────────────────
    function renderCartItems() {
        const list     = document.getElementById('cartItemList');
        const totalsEl = document.getElementById('cartTotals');
        const checkBtn = document.getElementById('cartCheckoutBtn');
        const headerCount = document.getElementById('cartHeaderCount');

        const totalItems = _cart.reduce((s, c) => s + c.qty, 0);
        headerCount.textContent = totalItems ? `(${totalItems})` : '';

        if (_cart.length === 0) {
            list.innerHTML = `
                <div class="cart-empty">
                    <i class="fas fa-store-slash"></i>
                    <p>Your cart is empty</p>
                    <p class="cart-empty-sub">Browse artists' merch and support them directly.</p>
                </div>`;
            totalsEl.innerHTML = '';
            if (checkBtn) checkBtn.disabled = true;
            return;
        }

        if (checkBtn) checkBtn.disabled = false;

        list.innerHTML = _cart.map(ci => {
            const shipping = calcItemShipping(ci, _region, ci.qty);
            const lineTotal = ci.price * ci.qty;
            const thumb = fixUrl(ci.photo) || '/images/merch-placeholder.jpg';
            const shippingLabel = ci.fulfillment === 'digital_auto'
                ? '<span class="cart-item-ship digital"><i class="fas fa-download"></i> Digital</span>'
                : shipping === 0
                    ? '<span class="cart-item-ship free"><i class="fas fa-truck"></i> Free shipping</span>'
                    : `<span class="cart-item-ship"><i class="fas fa-truck"></i> +$${shipping.toFixed(2)} shipping</span>`;

            return `
            <div class="cart-item" data-key="${esc(ci.key)}">
                <div class="cart-item-img" style="background-image:url('${esc(thumb)}')"></div>
                <div class="cart-item-details">
                    <p class="cart-item-artist">${esc(ci.artistName)}</p>
                    <p class="cart-item-name">${esc(ci.name)}${ci.selectedSize ? ` <span class="cart-item-size">${ci.selectedSize}</span>` : ''}</p>
                    ${shippingLabel}
                    <div class="cart-item-controls">
                        <button class="cart-qty-btn" onclick="window.cartQty('${esc(ci.key)}', -1)">−</button>
                        <span class="cart-qty">${ci.qty}</span>
                        <button class="cart-qty-btn" onclick="window.cartQty('${esc(ci.key)}', 1)">+</button>
                        <span class="cart-item-line-total">$${lineTotal.toFixed(2)}</span>
                        <button class="cart-remove-btn" onclick="window.cartRemove('${esc(ci.key)}')" aria-label="Remove">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Totals
        const { itemsSubtotal, shippingTotal, supporterFee, grandTotal } = calcCartTotals();

        totalsEl.innerHTML = `
            <div class="cart-totals-inner">
                <div class="cart-total-row">
                    <span>Items</span>
                    <span>$${itemsSubtotal.toFixed(2)}</span>
                </div>
                <div class="cart-total-row">
                    <span>Shipping</span>
                    <span>${shippingTotal === 0 ? 'Free' : '$' + shippingTotal.toFixed(2)}</span>
                </div>
                <div class="cart-total-row fee-row">
                    <span>Eporia Supporter Fee <span class="fee-pct">(10%)</span></span>
                    <span>$${supporterFee.toFixed(2)}</span>
                </div>
                <div class="cart-total-row tax-note-row">
                    <span><i class="fas fa-map-marker-alt" style="opacity:0.5;margin-right:4px"></i>Tax</span>
                    <span class="cart-tax-pending">Calculated at checkout</span>
                </div>
                <div class="cart-total-row grand-total-row">
                    <span>Subtotal</span>
                    <span>$${grandTotal.toFixed(2)}</span>
                </div>
            </div>`;
    }

    function updateCartAuthSection() {
        const el = document.getElementById('cartAuthSection');
        if (!el) return;

        if (_currentUid) {
            const displayName = _currentHandle || _currentEmail || 'your account';
            const avatarHTML  = _currentAvatar
                ? `<img src="${esc(_currentAvatar)}" class="cart-auth-avatar" alt="${esc(displayName)}">`
                : `<div class="cart-auth-avatar-fallback"><i class="fas fa-user"></i></div>`;

            el.innerHTML = `
                <div class="cart-auth-logged-in">
                    <div class="cart-auth-logged-in-row">
                        ${avatarHTML}
                        <div class="cart-auth-logged-in-info">
                            <span class="cart-auth-name">${esc(displayName)}</span>
                            <span class="cart-auth-note">Purchases saved to your account</span>
                        </div>
                        <i class="fas fa-check-circle cart-auth-check"></i>
                    </div>
                    <button class="cart-signout-btn" onclick="window.storeSignOut()">
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
                    <button class="cart-signin-link" onclick="window.openStoreAuthModal()">
                        Sign in to track your artist support
                        <i class="fas fa-arrow-right"></i>
                    </button>
                </div>`;
        }
    }

    function updateCartBadge() {
        const badge = document.getElementById('cartBadge');
        if (!badge) return;
        const total = _cart.reduce((s, c) => s + c.qty, 0);
        badge.textContent = total || '';
        badge.style.display = total > 0 ? 'flex' : 'none';
    }
    // Expose so storeCheckout.js can reset the badge after successful payment
    window.updateCartBadge = updateCartBadge;

    // ─────────────────────────────────────────────────────────
    // CART WINDOW FUNCTIONS (called from inline onclick)
    // ─────────────────────────────────────────────────────────
    window.cartQty = function (key, delta) {
        updateCartQty(key, delta);
    };

    window.cartRemove = function (key) {
        removeFromCart(key);
    };

    // ─────────────────────────────────────────────────────────
    // CHECKOUT
    // ─────────────────────────────────────────────────────────
    window.proceedToCheckout = function () {
        if (_cart.length === 0) return;

        // Close cart drawer, then open the embedded checkout modal.
        // storeCheckout.js handles address collection, ZipTax lookup,
        // Stripe Elements mounting, and PaymentIntent confirmation.
        window.closeCart();

        // Pass a snapshot of the cart in the shape the backend expects
        const cartForCheckout = _cart.map(ci => ({
            itemId:       ci.itemId,
            artistId:     ci.artistId,
            artistName:   ci.artistName,
            name:         ci.name,
            price:        ci.price,
            qty:          ci.qty,
            selectedSize: ci.selectedSize || null,
            photo:        ci.photo        || null,
            fulfillment:  ci.fulfillment  || null,
            shippingRates: ci.shippingRates || null,
        }));

        if (window.openCheckoutModal) {
            window.openCheckoutModal(cartForCheckout, _region);
        } else {
            console.error('[store] storeCheckout.js not loaded — window.openCheckoutModal missing');
        }
    };

    // Called by storeCheckout.js after a successful payment to clear the cart
    window.clearCart = function () {
        _cart = [];
        saveCart();
        updateCartBadge();
        renderCartItems();
    };

    // ─────────────────────────────────────────────────────────
    // UI HELPERS
    // ─────────────────────────────────────────────────────────
    function showLoading(show) {
        document.getElementById('storeLoading').style.display = show ? 'flex' : 'none';
    }

    function showEmpty(show) {
        document.getElementById('storeEmpty').style.display = show ? 'flex' : 'none';
    }

    function categoryLabel(cat) {
        const map = {
            clothing: 'Clothing',
            vinyl:    'Vinyl / CD / Tape',
            digital:  'Digital',
            artwork:  'Artwork',
            bundle:   'Bundle',
            other:    'Other'
        };
        return map[cat] || cat;
    }

    function esc(str) {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * fixUrl — normalizes CDN URLs that the DB stores without a protocol.
     * Matches the server-side normalizeUrl() in routes/store.js and merch.js.
     *
     *   'cdn.eporiamusic.com/...'  →  'https://cdn.eporiamusic.com/...'
     *   'artists/...'             →  'https://cdn.eporiamusic.com/artists/...'
     *   'https://...'             →  unchanged
     *   null / falsy              →  null
     */
    function fixUrl(url) {
        if (!url) return null;
        if (url.startsWith('https://') || url.startsWith('http://')) return url;
        if (url.startsWith('cdn.eporiamusic.com')) return `https://${url}`;
        return `https://cdn.eporiamusic.com/${url.replace(/^\//, '')}`;
    }

    /** Format seconds as m:ss for the sample player time display. */
    function fmtTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    /**
     * slugify(str) — convert an artist name to a URL-safe slug.
     * Mirrors the slugify() helper in player.js and public_profile.js.
     * Used as a fallback when item.artistSlug is not stored on the item doc.
     */
    function slugify(str) {
        return (str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')   // strip accents
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
    }

    /** Resolve the public profile URL for an artist item. */
    function artistProfileUrl(item) {
        const slug = item.artistSlug || slugify(item.artistName);
        return slug ? `/artist/${slug}` : '#';
    }

    // ─────────────────────────────────────────────────────────
    // STORE SIGN-IN MODAL
    // Allows fans to sign in without leaving the store page.
    // On success, mints a server session cookie (same flow as
    // signin.js) but stays on /store instead of redirecting.
    // ─────────────────────────────────────────────────────────
    window.openStoreAuthModal = function () {
        const modal = document.getElementById('storeAuthModal');
        if (!modal) return;
        clearAuthModalError();
        document.getElementById('storeAuthForm')?.reset();
        modal.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        setTimeout(() => document.getElementById('storeAuthEmail')?.focus(), 80);
    };

    window.closeStoreAuthModal = function (e) {
        // If triggered by overlay click, only close if the click was on the backdrop itself
        if (e && e.target !== document.getElementById('storeAuthModal')) return;
        const modal = document.getElementById('storeAuthModal');
        if (modal) modal.classList.remove('is-open');
        document.body.style.overflow = '';
    };

    window.storeSignOut = async function () {
        try {
            await signOut(_auth);
            // Clear the server-side session cookie
            await fetch('/members/logout', { method: 'GET' });
        } catch (err) {
            console.warn('[store] sign-out error:', err.message);
        }
        // onAuthStateChanged fires and updates the cart section automatically
    };

    function clearAuthModalError() {
        const el = document.getElementById('storeAuthError');
        if (el) { el.style.display = 'none'; el.textContent = ''; }
    }

    function showAuthModalError(msg) {
        const el = document.getElementById('storeAuthError');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    }

    // Password visibility toggle
    document.addEventListener('click', e => {
        if (e.target.closest('.store-auth-pw-toggle')) {
            const wrap  = e.target.closest('.store-auth-pw-wrap');
            const input = wrap?.querySelector('input');
            const icon  = e.target.closest('.store-auth-pw-toggle')?.querySelector('i');
            if (!input) return;
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            if (icon) {
                icon.classList.toggle('fa-eye',        !isHidden);
                icon.classList.toggle('fa-eye-slash',   isHidden);
            }
        }
    });

    // Bind sign-in form
    document.addEventListener('DOMContentLoaded', () => {
        const form = document.getElementById('storeAuthForm');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                clearAuthModalError();

                const email    = document.getElementById('storeAuthEmail').value.trim();
                const password = document.getElementById('storeAuthPassword').value;
                const btn      = document.getElementById('storeAuthSubmit');

                btn.disabled  = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span> Signing in...</span>';

                try {
                    const cred = await signInWithEmailAndPassword(_auth, email, password);

                    // Exchange ID token for a server session cookie — same as signin.js
                    const idToken = await cred.user.getIdToken();
                    await fetch('/members/api/session-login', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ idToken })
                    });

                    // Close modal — onAuthStateChanged fires and fills the cart section
                    const modal = document.getElementById('storeAuthModal');
                    if (modal) modal.classList.remove('is-open');
                    document.body.style.overflow = '';

                    // Re-open cart if it was open before sign-in
                    if (document.getElementById('cartDrawer')?.classList.contains('open')) {
                        updateCartAuthSection();
                    }

                } catch (err) {
                    let msg = 'Sign in failed. Please try again.';
                    if (err.code === 'auth/invalid-credential' ||
                        err.code === 'auth/wrong-password'     ||
                        err.code === 'auth/user-not-found')       msg = 'Incorrect email or password.';
                    else if (err.code === 'auth/too-many-requests') msg = 'Too many attempts. Please try again later.';
                    else if (err.code === 'auth/invalid-email')     msg = 'Invalid email address.';
                    else if (err.code === 'auth/network-request-failed') msg = 'Network error. Check your connection.';
                    showAuthModalError(msg);
                } finally {
                    btn.disabled  = false;
                    btn.innerHTML = '<i class="fas fa-lock"></i><span> Sign In</span>';
                }
            });
        }

        // Forgot password link inside modal
        const forgotLink = document.getElementById('storeAuthForgot');
        if (forgotLink) {
            forgotLink.addEventListener('click', async (e) => {
                e.preventDefault();
                const email = document.getElementById('storeAuthEmail').value.trim();
                if (!email) {
                    showAuthModalError('Enter your email address first, then click "Forgot password".');
                    return;
                }
                try {
                    await sendPasswordResetEmail(_auth, email);
                    clearAuthModalError();
                    const el = document.getElementById('storeAuthError');
                    if (el) {
                        el.textContent   = 'Reset link sent — check your inbox.';
                        el.style.display = 'block';
                        el.className     = 'store-auth-error store-auth-success';
                    }
                } catch (err) {
                    showAuthModalError('Could not send reset email. Check the address and try again.');
                }
            });
        }
    });

})();