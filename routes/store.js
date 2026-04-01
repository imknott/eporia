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
const turso   = require('../config/turso');
const crypto  = require('crypto');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const getDb = () => admin.firestore();

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
async function tryGetUid(req) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return null;
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        return decoded.uid;
    } catch { return null; }
}

async function createStripeTaxCalculation({ lineItems, shippingAddress, shippingCostCents, supporterFeeCents }) {
    // 1. Filter out digital items, as you specified they are tax-exempt for now
    const physicalItems = lineItems.filter(item => item.fulfillment !== 'digital_auto');
    
    if (physicalItems.length === 0) return null;

    // 2. Map the physical cart items to Stripe Tax line items
    const stripeLineItems = physicalItems.map(item => ({
        amount: Math.round(item.price * item.qty * 100),
        reference: `item_${item.itemId}`, // Useful for reconciling your database later
        tax_behavior: 'exclusive',
        // Optional: If selling clothes, passing a specific tax code can lower rates in some states (e.g., NY exempts clothing under $110)
        // tax_code: 'txcd_20030000' // General clothing code
    }));

    // 3. Add Shipping as a taxable line item (if applicable)
    if (shippingCostCents > 0) {
        stripeLineItems.push({
            amount: shippingCostCents,
            reference: 'shipping_cost',
            tax_behavior: 'exclusive',
            tax_code: 'txcd_92020001' // Standard Stripe tax code for Shipping
        });
    }

    // 4. Add the Supporter Fee as a taxable line item
    if (supporterFeeCents > 0) {
        stripeLineItems.push({
            amount: supporterFeeCents,
            reference: 'eporia_supporter_fee',
            tax_behavior: 'exclusive',
            // Treating the service fee as part of the general transaction
        });
    }

    // 5. Fire the request to Stripe
    try {
        const calculation = await stripe.tax.calculations.create({
            currency: 'usd',
            line_items: stripeLineItems,
            customer_details: {
                address: {
                    line1: shippingAddress.line1,
                    line2: shippingAddress.line2 || '',
                    city: shippingAddress.city,
                    state: shippingAddress.state,
                    postal_code: shippingAddress.zip,
                    country: shippingAddress.country || 'US',
                },
                address_source: 'shipping',
            },
        });

        return calculation;
    } catch (error) {
        console.error('[Stripe Tax] Failed to calculate tax:', error.message);
        throw new Error('Failed to calculate sales tax for this address.');
    }
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
            const base = getDb().collection('artists').doc(artistId).collection('merch')
                .where('status', '==', 'active')
                .orderBy('createdAt', 'desc')
                .limit(limit);

            query = (category && category !== 'all')
                ? getDb().collection('artists').doc(artistId).collection('merch')
                    .where('status', '==', 'active')
                    .where('category', '==', category)
                    .orderBy('createdAt', 'desc')
                    .limit(limit)
                : base;
        } else {
            // Global storefront — collectionGroup across all artists
            query = (category && category !== 'all')
                ? getDb().collectionGroup('merch')
                    .where('status', '==', 'active')
                    .where('category', '==', category)
                    .orderBy('createdAt', 'desc')
                    .limit(limit)
                : getDb().collectionGroup('merch')
                    .where('status', '==', 'active')
                    .orderBy('createdAt', 'desc')
                    .limit(limit);
        }

        if (after) {
            const cursorSnap = await getDb().collectionGroup('merch')
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
                    const artistDoc = await getDb().collection('artists').doc(aId).get();
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
            getDb().collection('artists').doc(artistId).collection('merch').doc(itemId).get(),
            getDb().collection('artists').doc(artistId).get()
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
// STRIPE TAX — helper
//
// Creates a Stripe Tax calculation for the given items and address.
// Used by both the /tax preview endpoint and create-intent.
//
// Stripe Tax tax codes:
//   txcd_99999999 — general physical goods (catch-all)
//   txcd_35010000 — clothing
//   txcd_10000000 — digital goods / software
//
// Returns the full calculation object, or null if Stripe Tax
// is not enabled on the account (falls back gracefully to $0 tax).
// ─────────────────────────────────────────────────────────────
const STRIPE_TAX_CODES = {
    clothing: 'txcd_35010000',
    digital:  'txcd_10000000',
    default:  'txcd_99999999',
};

async function createStripeTaxCalculation({ lineItems, shippingAddress, shippingCostCents }) {
    try {
        const taxLineItems = lineItems.map(item => ({
            amount:      Math.round(item.price * item.qty * 100),
            reference:   item.itemId,
            tax_code:    STRIPE_TAX_CODES[item.category] || STRIPE_TAX_CODES.default,
        }));

        // Add shipping as a separate line item if present
        if (shippingCostCents > 0) {
            taxLineItems.push({
                amount:    shippingCostCents,
                reference: 'shipping',
                tax_code:  'txcd_92010001', // shipping & handling
            });
        }

        const calculation = await stripe.tax.calculations.create({
            currency: 'usd',
            customer_details: {
                address: {
                    line1:       shippingAddress.line1  || '',
                    city:        shippingAddress.city   || '',
                    state:       shippingAddress.state  || '',
                    postal_code: shippingAddress.zip,
                    country:     shippingAddress.country || 'US',
                },
                address_source: 'shipping',
            },
            line_items: taxLineItems,
        });

        return calculation;
    } catch (e) {
        // Stripe Tax not enabled, address unrecognized, etc. — non-fatal
        console.warn('[store] Stripe Tax calculation failed:', e.message);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
// TAX PREVIEW
// POST /store/api/checkout/tax
//
// Called by the checkout modal as the user types their address.
// Returns the estimated tax for display — not authoritative.
// The create-intent call produces the binding calculation.
//
// Input:  { zip, state, city, country, cartItems, shippingCents }
// Output: { taxAmountCents, taxAmountDollars, breakdown }
// ─────────────────────────────────────────────────────────────
router.post('/api/checkout/tax', express.json(), async (req, res) => {
    try {
        const { zip, state, city, country, cartItems, shippingCents } = req.body;
        if (!zip || zip.length < 4) return res.json({ taxAmountCents: 0, taxAmountDollars: '0.00' });

        // Build minimal line items for preview — prices from client are fine here
        // since this is display-only; the binding calculation is in create-intent.
        const lineItems = (cartItems || []).map(ci => ({
            itemId:   ci.itemId  || 'preview',
            price:    parseFloat(ci.price) || 0,
            qty:      parseInt(ci.qty)     || 1,
            category: ci.category          || 'other',
        }));

        const calc = await createStripeTaxCalculation({
            lineItems,
            shippingAddress: { zip, state: state || '', city: city || '', country: country || 'US', line1: '' },
            shippingCostCents: parseInt(shippingCents) || 0,
        });

        if (!calc) return res.json({ taxAmountCents: 0, taxAmountDollars: '0.00' });

        res.json({
            taxAmountCents:  calc.tax_amount_exclusive,
            taxAmountDollars: (calc.tax_amount_exclusive / 100).toFixed(2),
        });
    } catch (e) {
        console.warn('[store] tax preview error:', e.message);
        res.json({ taxAmountCents: 0, taxAmountDollars: '0.00' });
    }
});

// ─────────────────────────────────────────────────────────────
// CHECKOUT — create Stripe PaymentIntent (embedded Elements)
// POST /store/api/checkout/create-intent
//
// Validates cart server-side, calculates shipping + tax via ZipTax,
// computes supporter fee, creates a PaymentIntent for the full amount,
// stores a pending order in Firestore for the webhook to complete.
//
// Returns: { clientSecret, publishableKey, orderSummary }
// ─────────────────────────────────────────────────────────────
router.post('/api/checkout/create-intent', express.json(), async (req, res) => {
    try {
        const {
            cartItems,
            region,
            shippingAddress,   // { name, line1, line2, city, state, zip, country }
            billingAddress,    // { name, line1, line2, city, state, zip, country }
            userEmail,
            userId,
        } = req.body;

        if (!Array.isArray(cartItems) || cartItems.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }

        if (!shippingAddress?.zip) {
            return res.status(400).json({ error: 'Shipping address with ZIP code is required' });
        }

        // ── Validate cart items against Firestore ──────────────────────────
        const validatedItems = [];
        for (const ci of cartItems) {
            const doc = await getDb().collection('artists').doc(ci.artistId)
                .collection('merch').doc(ci.itemId).get();

            if (!doc.exists || doc.data().status !== 'active') {
                return res.status(400).json({ error: `Item "${ci.name}" is no longer available.` });
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
                itemId:      ci.itemId,
                artistId:    ci.artistId,
                artistName:  ci.artistName || 'Unknown Artist',
                name:        serverItem.name,
                price:       itemPrice,
                qty,
                selectedSize: ci.selectedSize || null,
                shippingCost,
                photo:       normalizeUrl(serverItem.photos?.[0]) || null,
                fulfillment: serverItem.fulfillment,
            });
        }

        // ── Calculate totals ───────────────────────────────────────────────
        const itemsSubtotalCents = validatedItems.reduce((s, i) => s + Math.round(i.price * i.qty * 100), 0);
        const shippingTotalCents = validatedItems.reduce((s, i) => s + Math.round(i.shippingCost * 100), 0);
        const supporterFeeCents  = Math.round(itemsSubtotalCents * SUPPORTER_FEE_PCT);

        // ── Stripe Tax — authoritative calculation ─────────────────────────
        // Only on physical goods — digital_auto items are always tax-exempt.
        // The calculation ID is stored and finalized in the webhook after payment.
        const hasPhysical = validatedItems.some(i => i.fulfillment !== 'digital_auto');
        let taxCents         = 0;
        let taxCalculationId = null;

        if (hasPhysical) {
            const taxCalc = await createStripeTaxCalculation({
                lineItems: validatedItems,
                shippingAddress,
                shippingCostCents: shippingTotalCents,
            });
            if (taxCalc) {
                taxCents         = taxCalc.tax_amount_exclusive;
                taxCalculationId = taxCalc.id;
            }
        }

        const totalCents = itemsSubtotalCents + shippingTotalCents + taxCents + supporterFeeCents;

        // ── Create Stripe PaymentIntent ────────────────────────────────────
        const cartJson = JSON.stringify(validatedItems.map(i => ({
            iid: i.itemId, aid: i.artistId,
            p:   i.price,  q:   i.qty,
            s:   i.shippingCost, sz: i.selectedSize,
            n:   i.name.slice(0, 40),
        })));

        const paymentIntent = await stripe.paymentIntents.create({
            amount:   totalCents,
            currency: 'usd',
            receipt_email: userEmail || undefined,
            shipping: shippingAddress ? {
                name:    shippingAddress.name,
                address: {
                    line1:       shippingAddress.line1,
                    line2:       shippingAddress.line2 || '',
                    city:        shippingAddress.city,
                    state:       shippingAddress.state,
                    postal_code: shippingAddress.zip,
                    country:     shippingAddress.country || 'US',
                },
            } : undefined,
            metadata: {
                userId:            userId    || 'guest',
                userEmail:         userEmail || '',
                region:            region    || 'usDomestic',
                itemCount:         String(validatedItems.length),
                taxCalculationId:  taxCalculationId || '',  // finalized to tax.transaction in webhook
                cartJson,
            },
        });

        // ── Store pending order in Firestore ───────────────────────────────
        await getDb().collection('orders').doc(paymentIntent.id).set({
            paymentIntentId:  paymentIntent.id,
            taxCalculationId: taxCalculationId || null,
            userId:           userId    || 'guest',
            userEmail:        userEmail || null,
            region:           region    || 'usDomestic',
            status:           'pending_payment',
            shippingAddress:  shippingAddress || null,
            billingAddress:   billingAddress  || null,
            amountTotal:      totalCents / 100,
            itemsSubtotal:    itemsSubtotalCents / 100,
            shippingTotal:    shippingTotalCents / 100,
            taxAmount:        taxCents / 100,
            supporterFee:     supporterFeeCents / 100,
            items: validatedItems.map(i => ({
                itemId:      i.itemId,
                artistId:    i.artistId,
                name:        i.name,
                qty:         i.qty,
                price:       i.price,
                size:        i.selectedSize || null,
                shipping:    i.shippingCost,
            })),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({
            clientSecret:   paymentIntent.client_secret,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
            orderSummary: {
                items: validatedItems.map(i => ({
                    name:   i.name,
                    artist: i.artistName,
                    qty:    i.qty,
                    price:  (i.price * i.qty).toFixed(2),
                    size:   i.selectedSize,
                    photo:  i.photo,
                })),
                subtotal:     (itemsSubtotalCents / 100).toFixed(2),
                shipping:     (shippingTotalCents / 100).toFixed(2),
                tax:          (taxCents / 100).toFixed(2),
                supporterFee: (supporterFeeCents / 100).toFixed(2),
                total:        (totalCents / 100).toFixed(2),
            },
        });

    } catch (e) {
        console.error('[store] create-intent error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// STRIPE WEBHOOK
// POST /store/webhook  (requires raw body — mount store BEFORE express.json())
//
// Handles payment_intent.succeeded — fires when embedded Elements payment
// confirms successfully. The pending order stored in Firestore during
// create-intent is looked up by paymentIntentId and completed.
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

    if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object;
        try { await processMerchSale(pi); }
        catch (e) { console.error('[store] processMerchSale error:', e); }
    }

    res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────
// PROCESS MERCH SALE — called by webhook on payment_intent.succeeded
//
// Reads the pending order from Firestore (stored during create-intent),
// writes Turso transaction rows per line item, updates artist stats,
// and marks the order as paid.
// ─────────────────────────────────────────────────────────────
async function processMerchSale(paymentIntent) {
    const db  = getDb();
    const now = new Date();

    // Load pending order — created during create-intent
    const orderDoc = await db.collection('orders').doc(paymentIntent.id).get();
    if (!orderDoc.exists) {
        // Fallback: parse cartJson from PaymentIntent metadata (same as before)
        console.warn('[store] order doc not found for PI', paymentIntent.id, '— falling back to metadata');
    }

    const order    = orderDoc.exists ? orderDoc.data() : null;
    const metadata = paymentIntent.metadata || {};

    let cartItems;
    if (order?.items) {
        cartItems = order.items.map(i => ({
            iid: i.itemId,
            aid: i.artistId,
            n:   i.name,
            q:   i.qty,
            p:   i.price,
            s:   i.shipping || 0,
            sz:  i.size || null,
        }));
    } else {
        try { cartItems = JSON.parse(metadata.cartJson || '[]'); }
        catch { console.error('[store] could not parse cartJson from PI metadata'); return; }
    }

    const userId    = order?.userId    || metadata.userId    || 'guest';
    const userEmail = order?.userEmail || metadata.userEmail || null;
    const region    = order?.region    || metadata.region    || 'usDomestic';

    // ── Write one Turso transaction row per line item ─────────────────
    const insertPromises = cartItems.map(ci => {
        const amountCents = Math.round(ci.p * ci.q * 100);
        const txId        = crypto.randomUUID();
        return turso.execute({
            sql: `INSERT INTO transactions
                  (id, transaction_type, amount_cents, sender_id, receiver_id, reference_id, created_at)
                  VALUES (?, 'merch_sale', ?, ?, ?, ?, ?)`,
            args: [txId, amountCents, userId, ci.aid, ci.iid, Math.floor(now.getTime() / 1000)]
        }).catch(e => console.error(`[store] Turso insert failed for item ${ci.iid}:`, e.message));
    });

    if (userId && userId !== 'guest') {
        const purchaseTxId = crypto.randomUUID();
        insertPromises.push(
            turso.execute({
                sql: `INSERT INTO transactions
                      (id, transaction_type, amount_cents, sender_id, receiver_id, reference_id, created_at)
                      VALUES (?, 'merch_purchase', ?, ?, 'eporia', ?, ?)`,
                args: [purchaseTxId, paymentIntent.amount, userId, paymentIntent.id, Math.floor(now.getTime() / 1000)]
            }).catch(e => console.error('[store] Turso purchase insert failed:', e.message))
        );
    }

    await Promise.all(insertPromises);

    // ── Stripe Tax: finalize the calculation as a tax.transaction ────────
    // This converts the estimate into a recorded tax transaction for
    // reporting and remittance. Non-fatal — order is still marked paid.
    const taxCalculationId = order?.taxCalculationId || metadata.taxCalculationId;
    if (taxCalculationId) {
        try {
            await stripe.tax.transactions.createFromCalculation({
                calculation:  taxCalculationId,
                reference:    paymentIntent.id,
                expand:       ['line_items'],
            });
        } catch (e) {
            console.error('[store] Stripe Tax finalization failed:', e.message);
        }
    }

    // ── Firestore: update artist stats + mark order paid ─────────────
    const firestoreBatch = db.batch();
    const artistTotals   = {};
    for (const ci of cartItems) {
        if (!artistTotals[ci.aid]) artistTotals[ci.aid] = { revenue: 0, units: 0 };
        artistTotals[ci.aid].revenue += ci.p * ci.q;
        artistTotals[ci.aid].units   += ci.q;
    }
    for (const [aid, totals] of Object.entries(artistTotals)) {
        firestoreBatch.set(db.collection('artists').doc(aid), {
            'earnings.total':     admin.firestore.FieldValue.increment(totals.revenue),
            'earnings.thisMonth': admin.firestore.FieldValue.increment(totals.revenue),
            'stats.merchSales':   admin.firestore.FieldValue.increment(totals.units),
            lastUpdated:          admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    // Update the order to paid status
    firestoreBatch.update(db.collection('orders').doc(paymentIntent.id), {
        status:   'paid',
        paidAt:   admin.firestore.FieldValue.serverTimestamp(),
        amountPaid: paymentIntent.amount / 100,
    });

    await firestoreBatch.commit();
    console.log(`[store] merch sale processed: PI ${paymentIntent.id}, ${cartItems.length} items`);
}

// ─────────────────────────────────────────────────────────────
// PURCHASE HISTORY — logged-in users only
// GET /store/api/purchases
// ─────────────────────────────────────────────────────────────
router.get('/api/purchases', async (req, res) => {
    const uid = await tryGetUid(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const result = await turso.execute({
            sql: `SELECT id, amount_cents, reference_id, created_at
                  FROM transactions
                  WHERE sender_id = ? AND transaction_type = 'merch_purchase'
                  ORDER BY created_at DESC
                  LIMIT 50`,
            args: [uid]
        });

        const purchases = await Promise.all(result.rows.map(async row => {
            let orderData = {};
            try {
                // reference_id = paymentIntentId for embedded checkout orders
                const orderDoc = await getDb().collection('orders').doc(row.reference_id).get();
                if (orderDoc.exists) orderData = orderDoc.data();
            } catch (_) {}

            return {
                id:            row.id,
                paymentIntent: row.reference_id,
                amount:        -(row.amount_cents / 100).toFixed(2),
                title:         orderData.items
                    ? `Merch order (${orderData.items.length} item${orderData.items.length !== 1 ? 's' : ''})`
                    : 'Merch purchase',
                description:   orderData.items
                    ? orderData.items.map(i => i.name).join(', ').slice(0, 200)
                    : '',
                timestamp:     new Date(row.created_at * 1000).toISOString(),
                items:         orderData.items || [],
            };
        }));

        res.json({ purchases });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;