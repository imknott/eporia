/**
 * routes/store.js
 *
 * Public storefront — no auth required for browsing.
 * Stripe checkout + webhook for merch purchases.
 *
 * Mount in app.js:
 *   const storeRouter = require('./routes/store');
 *   app.use('/store', storeRouter);
 *
 * IMPORTANT: The webhook route must receive the raw body (before express.json parses it).
 * In app.js, make sure you mount this router BEFORE app.use(express.json()).
 * Or handle it as shown below using express.raw() on the webhook route itself.
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY          sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET      whsec_...   (from Stripe dashboard)
 *   APP_URL                    https://eporiamusic.com  (no trailing slash)
 *
 * Routes:
 *   GET  /store                    → renders store.pug
 *   GET  /store/api/items          → all active merch across all artists
 *   GET  /store/api/items/:a/:i    → single item
 *   POST /store/api/checkout       → create Stripe Checkout Session
 *   POST /store/webhook            → Stripe webhook (raw body required)
 *   GET  /store/checkout/success   → success page after Stripe redirect
 *   GET  /store/checkout/cancel    → cancel page
 *   GET  /store/api/purchases      → logged-in user's merch purchase history
 */

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const Stripe  = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const db     = admin.apps.length ? admin.firestore() : null;

const APP_URL              = process.env.APP_URL || 'https://eporiamusic.com';
const SUPPORTER_FEE_PCT    = 0.10;   // 10% Eporia supporter fee on top of item price
const WEBHOOK_SECRET       = process.env.STRIPE_WEBHOOK_SECRET;

// ─────────────────────────────────────────────────────────────
// EARNINGS HELPER — mirrors wallet.js getEarningsRef()
// Path: earnings/{year}/artists/{artistId}/{month}/{autoId}
// ─────────────────────────────────────────────────────────────
function getEarningsRef(artistId, dateOverride) {
    const d     = dateOverride || new Date();
    const year  = d.getFullYear().toString();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return {
        year,
        month,
        newDoc: () =>
            db.collection('earnings')
              .doc(year)
              .collection('artists')
              .doc(artistId)
              .collection(month)
              .doc()
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
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
// PAGE
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
// API: all active items across all artists
// GET /store/api/items?category=clothing&limit=48&after=<cursorId>
// ─────────────────────────────────────────────────────────────
router.get('/api/items', async (req, res) => {
    try {
        const { category, limit: rawLimit, after } = req.query;
        const limit = Math.min(parseInt(rawLimit) || 48, 100);

        let query = db.collectionGroup('merch')
            .where('status', '==', 'active')
            .orderBy('createdAt', 'desc')
            .limit(limit);

        if (category && category !== 'all') {
            query = db.collectionGroup('merch')
                .where('status', '==', 'active')
                .where('category', '==', category)
                .orderBy('createdAt', 'desc')
                .limit(limit);
        }

        if (after) {
            const cursorSnap = await db.collectionGroup('merch')
                .where(admin.firestore.FieldPath.documentId(), '==', after)
                .limit(1)
                .get();
            if (!cursorSnap.empty) {
                query = query.startAfter(cursorSnap.docs[0]);
            }
        }

        const snap = await query.get();

        const artistCache = {};
        const items = await Promise.all(snap.docs.map(async (doc) => {
            const data      = doc.data();
            const pathParts = doc.ref.path.split('/');
            const artistId  = pathParts[1];

            if (!artistCache[artistId]) {
                try {
                    const artistDoc = await db.collection('artists').doc(artistId).get();
                    artistCache[artistId] = artistDoc.exists ? artistDoc.data() : {};
                } catch {
                    artistCache[artistId] = {};
                }
            }

            const artist = artistCache[artistId];
            return {
                id:         doc.id,
                artistId,
                artistName: artist.name || 'Unknown Artist',
                artistSlug: artistId,
                ...data
            };
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
        res.json({
            id: itemId,
            artistId,
            artistName: artist.name || 'Unknown Artist',
            ...itemDoc.data()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// CHECKOUT — create Stripe Checkout Session
// POST /store/api/checkout
// Body:
//   {
//     cartItems: [
//       {
//         itemId:      string,
//         artistId:    string,
//         name:        string,
//         price:       number,       // artist payout price
//         qty:         number,
//         selectedSize: string|null,
//         shippingCost: number,      // computed by client from shippingRates + region
//         photo:       string|null,  // CDN URL for Stripe display
//       }
//     ],
//     region:    'usDomestic' | 'canada' | 'europe' | 'restOfWorld',
//     userEmail: string | null,      // prefill if logged-in
//     userId:    string | null,      // firebase uid if logged-in
//   }
// ─────────────────────────────────────────────────────────────
router.post('/api/checkout', express.json(), async (req, res) => {
    try {
        const { cartItems, region, userEmail, userId } = req.body;

        if (!Array.isArray(cartItems) || cartItems.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }

        // ── Validate each item against Firestore (prevent price tampering) ──
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

            // Use server price — never trust client price
            const itemPrice  = serverItem.price;

            // Compute shipping from server rates
            let shippingCost = 0;
            if (serverItem.fulfillment !== 'digital_auto' && serverItem.shippingRates) {
                const rates = serverItem.shippingRates;
                const regionKey = region || 'usDomestic';
                const regionRate = rates[regionKey] || rates.usDomestic || { first: 0, additional: 0 };
                // Free shipping threshold check
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
                photo:        serverItem.photos?.[0] || null,
                fulfillment:  serverItem.fulfillment
            });
        }

        // ── Totals ──
        const itemsSubtotal  = validatedItems.reduce((s, i) => s + i.price * i.qty, 0);
        const shippingTotal  = validatedItems.reduce((s, i) => s + i.shippingCost, 0);
        const supporterFee   = Math.round(itemsSubtotal * SUPPORTER_FEE_PCT * 100) / 100;
        const grandTotal     = itemsSubtotal + shippingTotal + supporterFee;

        // ── Build Stripe line items ──
        const lineItems = [];

        for (const item of validatedItems) {
            const li = {
                price_data: {
                    currency:     'usd',
                    product_data: {
                        name:     item.name,
                        metadata: {
                            itemId:   item.itemId,
                            artistId: item.artistId
                        }
                    },
                    unit_amount:  Math.round(item.price * 100)  // cents
                },
                quantity: item.qty
            };

            if (item.photo) {
                li.price_data.product_data.images = [item.photo];
            }

            if (item.selectedSize) {
                li.price_data.product_data.description = `Size: ${item.selectedSize}`;
            }

            lineItems.push(li);

            // Add shipping as its own line item so it's visible
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

        // Eporia supporter fee line item
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

        // ── Stripe session metadata (stored for webhook processing) ──
        const sessionMetadata = {
            userId:     userId     || 'guest',
            userEmail:  userEmail  || '',
            region:     region     || 'usDomestic',
            itemCount:  String(validatedItems.length),
            // Serialised cart for webhook — keep under 500 chars per key limit
            // We chunk into groups of items to stay under Stripe's metadata limits
            cartJson:   JSON.stringify(validatedItems.map(i => ({
                iid: i.itemId,
                aid: i.artistId,
                p:   i.price,
                q:   i.qty,
                s:   i.shippingCost,
                sz:  i.selectedSize,
                n:   i.name.slice(0, 40)
            })))
        };

        const session = await stripe.checkout.sessions.create({
            mode:                 'payment',
            payment_method_types: ['card'],
            line_items:           lineItems,
            customer_email:       userEmail || undefined,
            metadata:             sessionMetadata,
            success_url:          `${APP_URL}/store/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:           `${APP_URL}/store/checkout/cancel`,
            // Allow promo codes
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
// POST /store/webhook
//
// IMPORTANT: This route uses express.raw() to get the raw body
// that Stripe needs for signature verification.
// Make sure this route is registered BEFORE any app-level
// express.json() middleware, or use the approach below.
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

        // Only process paid sessions
        if (session.payment_status !== 'paid') {
            return res.json({ received: true });
        }

        try {
            await processMerchSale(session);
        } catch (e) {
            console.error('[store] processMerchSale error:', e);
            // Return 200 so Stripe doesn't retry — we'll handle via admin tools
            // In production you'd want idempotency checks and dead-letter queue
        }
    }

    res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────
// PROCESS MERCH SALE — writes earnings records matching wallet.js schema
// Called by webhook after successful payment
// ─────────────────────────────────────────────────────────────
async function processMerchSale(session) {
    const { userId, userEmail, region, cartJson } = session.metadata;
    let cartItems;
    try {
        cartItems = JSON.parse(cartJson);
    } catch {
        console.error('[store] could not parse cartJson from webhook metadata');
        return;
    }

    const timestamp    = admin.firestore.FieldValue.serverTimestamp();
    const stripeAmount = session.amount_total / 100;  // total paid in dollars
    const batch        = db.batch();
    const now          = new Date();

    // Group items by artistId so we write one earnings record per artist per item
    for (const ci of cartItems) {
        const artistAmount = ci.p * ci.q;  // artist keeps 100% of their item price
        const { newDoc }   = getEarningsRef(ci.aid, now);

        // ── Earnings record (matches wallet.js schema) ─────────────
        // earnings/{year}/artists/{artistId}/{month}/{autoId}
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

        // ── Artist stats cache (fast UI read — not payout source) ──
        const artistRef = db.collection('artists').doc(ci.aid);
        batch.set(artistRef, {
            'earnings.total':      admin.firestore.FieldValue.increment(artistAmount),
            'earnings.thisMonth':  admin.firestore.FieldValue.increment(artistAmount),
            'stats.merchSales':    admin.firestore.FieldValue.increment(ci.q),
            lastUpdated:           timestamp
        }, { merge: true });
    }

    // ── User purchase receipt (logged-in users only) ────────────────
    if (userId && userId !== 'guest') {
        const totalPaid   = stripeAmount;
        const itemsPaid   = cartItems.reduce((s, i) => s + i.p * i.q, 0);
        const shipPaid    = cartItems.reduce((s, i) => s + i.s, 0);
        const feePaid     = Math.round((totalPaid - itemsPaid - shipPaid) * 100) / 100;

        const purchaseRef = db.collection('users').doc(userId)
            .collection('wallet').doc(session.id);  // idempotent — use session id

        batch.set(purchaseRef, {
            type:          'merch_purchase',
            title:         `Merch order (${cartItems.length} item${cartItems.length !== 1 ? 's' : ''})`,
            description:   cartItems.map(i => i.n).join(', ').slice(0, 200),
            amount:        -Math.abs(totalPaid),   // negative = money out
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
// Header: Authorization: Bearer <idToken>
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

        const purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ purchases });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;