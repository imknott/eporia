/**
 * routes/store.js
 *
 * Public storefront — no auth required for browsing.
 * Stripe checkout + webhook for merch purchases.
 *
 * PATCHES APPLIED:
 *   - normalizeUrl / normalizeItem: fixes bare CDN hostnames in DB URLs
 *   - artistId filter on GET /api/items: supports public artist profile merch grids
 *
 * Mount in app.js:
 *   const storeRouter = require('./routes/store');
 *   app.use('/store', storeRouter);   // BEFORE express.json()
 */

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const Stripe  = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const db     = admin.apps.length ? admin.firestore() : null;

const APP_URL           = process.env.APP_URL || 'https://eporiamusic.com';
const SUPPORTER_FEE_PCT = 0.10;
const WEBHOOK_SECRET    = process.env.STRIPE_WEBHOOK_SECRET;

const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || 'https://cdn.eporiamusic.com';
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();

/**
 * normalizeUrl — converts bare-hostname or relative-path CDN URLs to
 * absolute HTTPS. Matches the pattern used in merch.js and player.js.
 */
function normalizeUrl(url) {
    if (!url) return null;
    if (url.startsWith('https://') || url.startsWith('http://')) return url;
    if (url.startsWith('cdn.eporiamusic.com')) return `https://${url}`;
    return `${CDN_URL}/${url.replace(/^\//, '')}`;
}

/**
 * normalizeItem — applies normalizeUrl to every URL field of a merch item
 * before sending it to the client.
 */
function normalizeItem(item) {
    if (Array.isArray(item.photos)) {
        item.photos = item.photos.map(normalizeUrl).filter(Boolean);
    }
    if (item.sampleTrack) {
        item.sampleTrack = {
            ...item.sampleTrack,
            artUrl:    normalizeUrl(item.sampleTrack.artUrl),
            streamUrl: normalizeUrl(item.sampleTrack.streamUrl),
        };
    }
    return item;
}

// ─────────────────────────────────────────────────────────────
// EARNINGS HELPER — mirrors wallet.js getEarningsRef()
// ─────────────────────────────────────────────────────────────
function getEarningsRef(artistId, dateOverride) {
    const d     = dateOverride || new Date();
    const year  = d.getFullYear().toString();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return {
        year, month,
        newDoc: () =>
            db.collection('earnings').doc(year)
              .collection('artists').doc(artistId)
              .collection(month).doc()
    };
}

// ─────────────────────────────────────────────────────────────
// AUTH HELPER (optional — for logged-in users only)
// ─────────────────────────────────────────────────────────────
async function tryGetUid(req) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return null;
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        return decoded.uid;
    } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// PAGES
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
    res.render('store', { title: 'Artist Merch Store | Eporia' });
});

router.get('/checkout/success', (req, res) => {
    res.render('store_checkout_success', {
        title:     'Order Confirmed | Eporia',
        sessionId: req.query.session_id || ''
    });
});

router.get('/checkout/cancel', (req, res) => {
    res.render('store', { title: 'Artist Merch Store | Eporia', checkoutCancelled: true });
});

// ─────────────────────────────────────────────────────────────
// API: all active items across all artists (or filtered by artistId)
// GET /store/api/items?category=clothing&limit=48&after=<cursorId>&artistId=<id>
//
// When artistId is provided (e.g. from a public artist profile page),
// queries that artist's merch subcollection directly for efficiency.
// When omitted, uses a collectionGroup query across all artists.
// ─────────────────────────────────────────────────────────────
router.get('/api/items', async (req, res) => {
    try {
        const { category, limit: rawLimit, after, artistId } = req.query;
        const limit = Math.min(parseInt(rawLimit) || 48, 100);

        let query;

        if (artistId) {
            // Single-artist query — used by public artist profile merch grids
            const base = db.collection('artists').doc(artistId).collection('merch')
                .where('status', '==', 'active')
                .orderBy('createdAt', 'desc')
                .limit(limit);

            query = (category && category !== 'all')
                ? db.collection('artists').doc(artistId).collection('merch')
                    .where('status', '==', 'active')
                    .where('category', '==', category)
                    .orderBy('createdAt', 'desc')
                    .limit(limit)
                : base;
        } else {
            // Global storefront — collectionGroup across all artists
            query = (category && category !== 'all')
                ? db.collectionGroup('merch')
                    .where('status', '==', 'active')
                    .where('category', '==', category)
                    .orderBy('createdAt', 'desc')
                    .limit(limit)
                : db.collectionGroup('merch')
                    .where('status', '==', 'active')
                    .orderBy('createdAt', 'desc')
                    .limit(limit);
        }

        if (after) {
            const cursorSnap = await db.collectionGroup('merch')
                .where(admin.firestore.FieldPath.documentId(), '==', after)
                .limit(1).get();
            if (!cursorSnap.empty) query = query.startAfter(cursorSnap.docs[0]);
        }

        const snap = await query.get();

        const artistCache = {};
        const items = await Promise.all(snap.docs.map(async (doc) => {
            const data      = doc.data();
            const pathParts = doc.ref.path.split('/');
            const aId       = artistId || pathParts[1];

            if (!artistCache[aId]) {
                try {
                    const artistDoc = await db.collection('artists').doc(aId).get();
                    artistCache[aId] = artistDoc.exists ? artistDoc.data() : {};
                } catch { artistCache[aId] = {}; }
            }

            const artist = artistCache[aId];
            return normalizeItem({
                id:         doc.id,
                artistId:   aId,
                artistName: artist.name || 'Unknown Artist',
                artistSlug: aId,
                ...data
            });
        }));

        res.json({ items, hasMore: items.length === limit });
    } catch (e) {
        console.error('[store] items error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// API: single item
// GET /store/api/items/:artistId/:itemId
// ─────────────────────────────────────────────────────────────
router.get('/api/items/:artistId/:itemId', async (req, res) => {
    try {
        const { artistId, itemId } = req.params;

        const [itemDoc, artistDoc] = await Promise.all([
            db.collection('artists').doc(artistId).collection('merch').doc(itemId).get(),
            db.collection('artists').doc(artistId).get()
        ]);

        if (!itemDoc.exists) return res.status(404).json({ error: 'Item not found' });
        if (itemDoc.data().status !== 'active') return res.status(404).json({ error: 'Item not available' });

        const artist = artistDoc.exists ? artistDoc.data() : {};
        res.json(normalizeItem({
            id: itemId,
            artistId,
            artistName: artist.name || 'Unknown Artist',
            ...itemDoc.data()
        }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// CHECKOUT — create Stripe Checkout Session
// POST /store/api/checkout
// ─────────────────────────────────────────────────────────────
router.post('/api/checkout', express.json(), async (req, res) => {
    try {
        const { cartItems, region, userEmail, userId } = req.body;

        if (!Array.isArray(cartItems) || cartItems.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }

        const validatedItems = [];
        for (const ci of cartItems) {
            const doc = await db.collection('artists').doc(ci.artistId)
                .collection('merch').doc(ci.itemId).get();

            if (!doc.exists || doc.data().status !== 'active') {
                return res.status(400).json({
                    error: `Item "${ci.name}" is no longer available.`
                });
            }

            const serverItem = doc.data();
            const qty        = Math.max(1, parseInt(ci.qty) || 1);
            const itemPrice  = serverItem.price;

            let shippingCost = 0;
            if (serverItem.fulfillment !== 'digital_auto' && serverItem.shippingRates) {
                const rates      = serverItem.shippingRates;
                const regionKey  = region || 'usDomestic';
                const regionRate = rates[regionKey] || rates.usDomestic || { first: 0, additional: 0 };
                if (rates.freeShippingEnabled && itemPrice * qty >= (rates.freeShippingThreshold || Infinity)) {
                    shippingCost = 0;
                } else {
                    shippingCost = regionRate.first + (regionRate.additional * Math.max(0, qty - 1));
                }
            }

            validatedItems.push({
                itemId:       ci.itemId,
                artistId:     ci.artistId,
                artistName:   ci.artistName || 'Unknown Artist',
                name:         serverItem.name,
                price:        itemPrice,
                qty,
                selectedSize: ci.selectedSize || null,
                shippingCost,
                photo:        normalizeUrl(serverItem.photos?.[0]) || null,
                fulfillment:  serverItem.fulfillment
            });
        }

        const itemsSubtotal = validatedItems.reduce((s, i) => s + i.price * i.qty, 0);
        const shippingTotal = validatedItems.reduce((s, i) => s + i.shippingCost, 0);
        const supporterFee  = Math.round(itemsSubtotal * SUPPORTER_FEE_PCT * 100) / 100;

        const lineItems = [];
        for (const item of validatedItems) {
            const li = {
                price_data: {
                    currency:     'usd',
                    product_data: {
                        name:     item.name,
                        metadata: { itemId: item.itemId, artistId: item.artistId }
                    },
                    unit_amount:  Math.round(item.price * 100)
                },
                quantity: item.qty
            };
            if (item.photo) li.price_data.product_data.images = [item.photo];
            if (item.selectedSize) li.price_data.product_data.description = `Size: ${item.selectedSize}`;
            lineItems.push(li);

            if (item.shippingCost > 0) {
                lineItems.push({
                    price_data: {
                        currency:     'usd',
                        product_data: { name: `Shipping — ${item.name}` },
                        unit_amount:  Math.round(item.shippingCost * 100)
                    },
                    quantity: 1
                });
            }
        }

        if (supporterFee > 0) {
            lineItems.push({
                price_data: {
                    currency:     'usd',
                    product_data: {
                        name:        'Eporia Supporter Fee',
                        description: '100% of item prices go directly to artists. This small fee keeps Eporia running.'
                    },
                    unit_amount:  Math.round(supporterFee * 100)
                },
                quantity: 1
            });
        }

        const sessionMetadata = {
            userId:    userId    || 'guest',
            userEmail: userEmail || '',
            region:    region    || 'usDomestic',
            itemCount: String(validatedItems.length),
            cartJson:  JSON.stringify(validatedItems.map(i => ({
                iid: i.itemId, aid: i.artistId,
                p: i.price,    q: i.qty,
                s: i.shippingCost, sz: i.selectedSize,
                n: i.name.slice(0, 40)
            })))
        };

        const session = await stripe.checkout.sessions.create({
            mode:                  'payment',
            payment_method_types:  ['card'],
            line_items:            lineItems,
            customer_email:        userEmail || undefined,
            metadata:              sessionMetadata,
            success_url:           `${APP_URL}/store/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:            `${APP_URL}/store/checkout/cancel`,
            allow_promotion_codes: true
        });

        res.json({ sessionId: session.id, url: session.url });
    } catch (e) {
        console.error('[store] checkout error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// STRIPE WEBHOOK
// POST /store/webhook  (requires raw body — mount store BEFORE express.json())
// ─────────────────────────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (e) {
        console.error('[store] webhook signature failed:', e.message);
        return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        if (session.payment_status === 'paid') {
            try { await processMerchSale(session); }
            catch (e) { console.error('[store] processMerchSale error:', e); }
        }
    }

    res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────
// PROCESS MERCH SALE — writes earnings records matching wallet.js schema
// ─────────────────────────────────────────────────────────────
async function processMerchSale(session) {
    const { userId, userEmail, region, cartJson } = session.metadata;
    let cartItems;
    try { cartItems = JSON.parse(cartJson); }
    catch { console.error('[store] could not parse cartJson from webhook metadata'); return; }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const batch     = db.batch();
    const now       = new Date();

    for (const ci of cartItems) {
        const artistAmount = ci.p * ci.q;
        const { newDoc }   = getEarningsRef(ci.aid, now);
        batch.set(newDoc(), {
            fromUser:      userId,
            fromUserEmail: userEmail || null,
            toArtist:      ci.aid,
            amount:        artistAmount,
            type:          'merch_sale',
            status:        'committed',
            itemId:        ci.iid,
            itemName:      ci.n,
            qty:           ci.q,
            selectedSize:  ci.sz || null,
            shippingCost:  ci.s,
            region:        region || 'usDomestic',
            stripeSession: session.id,
            timestamp
        });

        const artistRef = db.collection('artists').doc(ci.aid);
        batch.set(artistRef, {
            'earnings.total':     admin.firestore.FieldValue.increment(artistAmount),
            'earnings.thisMonth': admin.firestore.FieldValue.increment(artistAmount),
            'stats.merchSales':   admin.firestore.FieldValue.increment(ci.q),
            lastUpdated:          timestamp
        }, { merge: true });
    }

    if (userId && userId !== 'guest') {
        const stripeAmount = session.amount_total / 100;
        const itemsPaid    = cartItems.reduce((s, i) => s + i.p * i.q, 0);
        const shipPaid     = cartItems.reduce((s, i) => s + i.s, 0);
        const feePaid      = Math.round((stripeAmount - itemsPaid - shipPaid) * 100) / 100;

        const purchaseRef = db.collection('users').doc(userId)
            .collection('wallet').doc(session.id);
        batch.set(purchaseRef, {
            type:          'merch_purchase',
            title:         `Merch order (${cartItems.length} item${cartItems.length !== 1 ? 's' : ''})`,
            description:   cartItems.map(i => i.n).join(', ').slice(0, 200),
            amount:        -Math.abs(stripeAmount),
            itemsSubtotal: itemsPaid,
            shippingTotal: shipPaid,
            supporterFee:  feePaid,
            stripeSession: session.id,
            artists:       [...new Set(cartItems.map(i => i.aid))],
            timestamp
        }, { merge: false });
    }

    await batch.commit();
    console.log(`[store] merch sale processed: session ${session.id}, ${cartItems.length} items`);
}

// ─────────────────────────────────────────────────────────────
// PURCHASE HISTORY — logged-in users only
// GET /store/api/purchases
// ─────────────────────────────────────────────────────────────
router.get('/api/purchases', async (req, res) => {
    const uid = await tryGetUid(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const snap = await db.collection('users').doc(uid)
            .collection('wallet')
            .where('type', '==', 'merch_purchase')
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();
        res.json({ purchases: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;