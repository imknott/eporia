/**
 * public/javascripts/store.js
 *
 * Powers the public /store page.
 * - Browse / filter / search merch grid
 * - Item detail modal with image gallery + size selector
 * - Cart drawer (localStorage persisted, guest + logged-in)
 * - Shipping region selector with per-item rate calculation
 * - Stripe Checkout redirect via /store/api/checkout
 * - Firebase Auth integration — shows login state in cart
 */

(function () {
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
    let _currentUid     = null;
    let _currentEmail   = null;

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
    // FIREBASE AUTH (optional — graceful if not loaded)
    // ─────────────────────────────────────────────────────────
    function tryGetAuthState() {
        if (typeof firebase === 'undefined' || !firebase.auth) return;
        firebase.auth().onAuthStateChanged(user => {
            _currentUid   = user ? user.uid   : null;
            _currentEmail = user ? user.email : null;
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

        const thumb = item.photos?.[0] || '/images/merch-placeholder.jpg';
        const fulfillIcon = item.fulfillment === 'digital_auto'
            ? '<i class="fas fa-download"></i> Digital'
            : '<i class="fas fa-truck"></i> Ships';

        card.innerHTML = `
            <div class="store-card-img" style="background-image:url('${esc(thumb)}')">
                <span class="store-card-category">${categoryLabel(item.category)}</span>
            </div>
            <div class="store-card-body">
                <p class="store-card-artist">${esc(item.artistName || '')}</p>
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
        const photos  = item.photos?.filter(Boolean) || [];

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
        document.getElementById('modalArtistLink').href      = item.artistId
            ? `/player/artist/${item.artistId}` : '#';
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
                photo:        item.photos?.[0] || null,
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
            const thumb = ci.photo || '/images/merch-placeholder.jpg';
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
                <div class="cart-total-row grand-total-row">
                    <span>Total</span>
                    <span>$${grandTotal.toFixed(2)}</span>
                </div>
            </div>`;
    }

    function updateCartAuthSection() {
        const el = document.getElementById('cartAuthSection');
        if (!el) return;

        if (_currentUid) {
            el.innerHTML = `
                <div class="cart-auth-logged-in">
                    <i class="fas fa-user-check"></i>
                    <span>Buying as <strong>${esc(_currentEmail || 'artist account')}</strong></span>
                    <span class="cart-auth-note">Your purchase history will be tracked.</span>
                </div>`;
        } else {
            el.innerHTML = `
                <div class="cart-auth-guest">
                    <div class="cart-auth-guest-msg">
                        <i class="fas fa-user"></i>
                        <span>Checking out as guest</span>
                    </div>
                    <a class="cart-signin-link" href="/members/signup">
                        Sign in to track how much you've supported artists
                        <i class="fas fa-arrow-right"></i>
                    </a>
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
    window.proceedToCheckout = async function () {
        if (_cart.length === 0) return;

        const btn = document.getElementById('cartCheckoutBtn');
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Processing...</span>';

        try {
            // Optionally get a fresh auth token for purchase tracking
            let idToken = null;
            if (typeof firebase !== 'undefined' && firebase.auth) {
                const user = firebase.auth().currentUser;
                if (user) idToken = await user.getIdToken();
            }

            const headers = {
                'Content-Type': 'application/json'
            };
            if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

            const res = await fetch('/store/api/checkout', {
                method:  'POST',
                headers,
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
                    userEmail: _currentEmail || null,
                    userId:    _currentUid   || null
                })
            });

            const data = await res.json();

            if (data.url) {
                // Clear cart before redirect — Stripe success page is our confirmation
                _cart = [];
                saveCart();
                updateCartBadge();
                window.location.href = data.url;
            } else {
                throw new Error(data.error || 'Checkout failed');
            }
        } catch (e) {
            console.error('[store] checkout error:', e);
            btn.disabled  = false;
            btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <span>Error — try again</span>';
            setTimeout(() => {
                btn.innerHTML = '<i class="fas fa-lock"></i> <span>Secure Checkout</span>';
            }, 3000);
        }
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
})();