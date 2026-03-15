/* routes/artist/studio.js */
const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const crypto = require('crypto');
const multer  = require('multer');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ─────────────────────────────────────────────────────────────
// R2 / CDN SETUP  (needed for the posts image upload route)
// ─────────────────────────────────────────────────────────────
const r2 = require('../../config/r2');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const turso = require('../../config/turso');

const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || 'https://cdn.eporiamusic.com';
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────
// URL NORMALIZER
// Stored URLs may be missing the https:// protocol (e.g. from
// older uploads). Always ensure a full URL before returning to
// the client so the browser doesn't treat it as a relative path.
// ─────────────────────────────────────────────────────────────
function normalizeUrl(url) {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
}

// ==========================================
// MIDDLEWARE: VERIFY USER
// ==========================================
async function verifyUser(req, res, next) {
    const idToken = req.headers.authorization;
    if (!idToken) return res.status(401).json({ error: 'No authentication token provided' });

    try {
        const token = idToken.startsWith('Bearer ') ? idToken.split(' ')[1] : idToken;
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
    }
}

// ==========================================
// PAGE RENDER ROUTES
// ==========================================
router.get('/studio', (req, res) => {
    res.render('artist_studio', { title: 'Artist Studio | Eporia' });
});

router.get('/pending-status', async (req, res) => {
    try {
        const db = admin.firestore();
        const artistId = req.query.id;
        if (!artistId) return res.redirect('/artist/login');

        const artistDoc = await db.collection('artists').doc(artistId).get();
        if (!artistDoc.exists) return res.redirect('/artist/login');

        const artistData = artistDoc.data();

        res.render('pending_approval', {
            status:          artistData.status,
            appliedAt:       artistData.appliedAt?.toDate(),
            rejectionReason: artistData.rejectionReason,
            artistId
        });
    } catch (error) {
        res.redirect('/artist/login');
    }
});

// ==========================================
// STUDIO DASHBOARD API
// ==========================================
router.get('/api/studio/dashboard', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('artists')
            .where('ownerUid', '==', req.uid)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({ error: 'No artist profile linked to this login.' });
        }

        const doc  = snapshot.docs[0];
        const data = doc.data();

        if (!data.dashboardAccess || data.status !== 'approved') {
            return res.json({ isPending: true, status: data.status, artistId: doc.id });
        }

        // Count merch items
        let merchCount = 0;
        try {
            const merchSnap = await db.collection('artists').doc(doc.id)
                .collection('merch')
                .where('status', '==', 'active')
                .get();
            merchCount = merchSnap.size;
        } catch (_) { /* non-fatal */ }

        res.json({
            artistId: doc.id,
            profile: {
                name:   data.name   || '',
                handle: data.handle || '',
                bio:    data.bio    || '',
                // FIX: normalize URLs — both old (profileImage) and new (avatarUrl) field names
                image:  normalizeUrl(data.profileImage || data.avatarUrl)  || null,
                banner: normalizeUrl(data.bannerImage  || data.bannerUrl)  || null
            },
            stats: {
                listeners: data.stats?.monthlyListeners || 0,
                followers: data.stats?.followers        || 0,
                tipsTotal: data.stats?.tipsTotal        || 0.00
            },
            recentActivity: [],
            catalog: {
                albums: 0,
                tracks: 0,
                merch:  merchCount
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// SECURITY & SETUP API
// ==========================================
router.get('/api/studio/check-status/:artistId', async (req, res) => {
    try {
        const db  = admin.firestore();
        const doc = await db.collection('artists').doc(req.params.artistId).get();
        if (!doc.exists) return res.status(404).json({ error: 'Artist not found' });

        const data = doc.data();
        res.json({
            needsSetup:   !data.ownerEmail,
            artistName:   data.name,
            artistHandle: data.handle
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/studio/setup-credentials', express.json(), async (req, res) => {
    try {
        const db = admin.firestore();
        const { artistId, email, password } = req.body;

        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: `Artist: ${artistId}`
        });

        await db.collection('artists').doc(artistId).update({
            ownerUid:  userRecord.uid,
            ownerEmail: email,
            status:    'active',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const customToken = await admin.auth().createCustomToken(userRecord.uid);
        res.json({ success: true, token: customToken });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// CATALOG API — artist's own songs + albums
// ==========================================
router.get('/api/studio/catalog', verifyUser, async (req, res) => {
    try {
        const db = admin.firestore();

        // Resolve artistId from ownerUid
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });
        const artistId = artistSnap.docs[0].id;

        const filter = req.query.filter || 'all'; // 'all' | 'singles' | 'albums'

        // Fetch songs (all tracks live in global 'songs' collection keyed by artistId)
        let songsQuery = db.collection('songs')
            .where('artistId', '==', artistId)
            .limit(200);

        const snap = await songsQuery.get();

        let songs = snap.docs.map(d => {
            const data = d.data();
            return {
                id:         d.id,
                title:      data.title      || 'Untitled',
                artUrl:     normalizeUrl(data.artUrl) || null,
                audioUrl:   data.audioUrl   || null,
                masterUrl:      normalizeUrl(data.masterUrl)   || null,
                masteredUrl:    normalizeUrl(data.masteredUrl) || null,
                isMastered:     data.isMastered     || false,
                isLossless:     data.isLossless      || false,
                originalFormat: data.originalFormat  || null,
                duration:   data.duration   || 0,
                genre:      data.genre      || null,
                bpm:        data.bpm        || null,
                key:        data.key        || null,
                mode:       data.mode       || null,
                energy:     data.energy     || null,
                isSingle:   data.isSingle   !== false,
                album:      data.album      || null,
                trackNumber:data.trackNumber|| null,
                plays:      data.stats?.plays || 0,
                likes:      data.stats?.likes || 0,
                uploadedAt: data.uploadedAt?.toMillis?.() || 0,
            };
        });

        // Sort newest first
        songs.sort((a, b) => b.uploadedAt - a.uploadedAt);

        // Filter
        if (filter === 'singles') songs = songs.filter(s => s.isSingle);
        if (filter === 'albums')  songs = songs.filter(s => !s.isSingle);
        // Masters: lossless originals (wav/flac/aiff/alac) OR tracks that had
        // the mastering chain applied. MP3-only uploads are excluded.
        if (filter === 'masters') songs = songs.filter(s => s.isLossless || s.isMastered);

        // Strip internal sort field
        songs = songs.map(({ uploadedAt, ...rest }) => rest);

        // Also fetch album docs for album covers
        const albumsSnap = await db.collection('artists').doc(artistId)
            .collection('albums').orderBy('uploadedAt', 'desc').limit(50).get();
        const albums = albumsSnap.docs.map(d => ({
            id:         d.id,
            title:      d.data().title,
            artUrl:     normalizeUrl(d.data().artUrl) || null,
            trackCount: d.data().trackCount || 0,
            uploadedAt: d.data().uploadedAt?.toMillis?.() || 0,
        }));

        res.json({ songs, albums, artistId });
    } catch (e) {
        console.error('[catalog] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// posts_routes lives at routes/player_routes/ — go up one level from routes/artist/
const db = admin.firestore();
const postsRoutes = require('../player_routes/posts_routes')(db, verifyUser, upload, r2, PutObjectCommand, BUCKET_NAME, CDN_URL);
router.use('/', postsRoutes);

// ==========================================
// PAYMENTS: GET EARNINGS SUMMARY
//
// Returns earnings aggregated from the artist's earningsLog subcollection.
// Each doc in earningsLog represents a credit event (subscription share,
// tip, merch sale, etc.) with a `cents` field and a `creditedAt` timestamp.
//
// GET /artist/api/studio/earnings
// ==========================================
// ==========================================
// PAYMENTS: GET EARNINGS SUMMARY
// ==========================================
router.get('/api/studio/earnings', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const artistId = artistSnap.docs[0].id;

        // 1. Calculate Lifetime and This Month Earned via SQL
        const earnedResult = await turso.execute({
            sql: `SELECT 
                    COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN amount_cents ELSE 0 END), 0) as this_month_cents,
                    COALESCE(SUM(amount_cents), 0) as lifetime_cents
                  FROM transactions 
                  WHERE receiver_id = ? AND transaction_type IN ('artist_payout', 'monthly_allocation')`,
            args: [artistId]
        });

        // 2. Calculate Lifetime Spent/Deducted (Cover licenses, payouts sent to bank)
        const spentResult = await turso.execute({
            sql: `SELECT COALESCE(SUM(amount_cents), 0) as spent_cents
                  FROM transactions 
                  WHERE sender_id = ? AND transaction_type IN ('cover_licence_fee', 'stripe_payout')`,
            args: [artistId]
        });

        const thisMonthCents = earnedResult.rows[0].this_month_cents;
        const lifetimeCents  = earnedResult.rows[0].lifetime_cents;
        const spentCents     = spentResult.rows[0].spent_cents;
        
        const balanceCents   = lifetimeCents - spentCents;

        res.json({ 
            thisMonthCents, 
            pendingCents: thisMonthCents, // Current month earnings pending 15th payout
            lifetimeCents, 
            balanceCents 
        });

    } catch (error) {
        console.error('[studio] earnings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// PAYMENTS: CREATE STRIPE ACCOUNT SESSION
//
// Creates a short-lived AccountSession so the frontend can mount Stripe
// Connect embedded components (payments history, notification banner).
// Also returns whether the artist has completed onboarding.
//
// POST /artist/api/studio/stripe-session
// ==========================================
router.post('/api/studio/stripe-session', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const artistData = artistSnap.docs[0].data();

        if (!artistData.stripeAccountId) {
            return res.status(400).json({ code: 'NO_STRIPE_ACCOUNT', error: 'No Stripe account linked.' });
        }

        // Fetch the Stripe account to check onboarding status
        const account = await stripe.accounts.retrieve(artistData.stripeAccountId);
        const onboarded = account.details_submitted && account.charges_enabled;

        // Create a session so the frontend can mount embedded components
        const session = await stripe.accountSessions.create({
            account:    artistData.stripeAccountId,
            components: {
                payments: {
                    enabled: true,
                    features: { refund_management: false, dispute_management: false },
                },
                notification_banner: {
                    enabled: true,
                    features: { external_account_collection: true },
                },
            },
        });

        // Sync onboarding status to Firestore if it just changed
        if (onboarded && !artistData.stripeOnboarded) {
            await db.collection('artists').doc(artistSnap.docs[0].id)
                .update({ stripeOnboarded: true });
        }

        res.json({
            clientSecret:   session.client_secret,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
            onboarded,
        });

    } catch (error) {
        console.error('[studio] stripe session error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// PAYMENTS: GENERATE STRIPE ONBOARDING LINK (for artists, not admins)
//
// POST /artist/api/studio/stripe-onboarding-link
// ==========================================
router.post('/api/studio/stripe-onboarding-link', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const artistData = artistSnap.docs[0].data();

        if (!artistData.stripeAccountId) {
            return res.status(400).json({ error: 'No Stripe account found.' });
        }

        const accountLink = await stripe.accountLinks.create({
            account:     artistData.stripeAccountId,
            refresh_url: `${process.env.APP_URL}/artist/studio`,
            return_url:  `${process.env.APP_URL}/artist/studio`,
            type:        'account_onboarding',
        });

        res.json({ url: accountLink.url });

    } catch (error) {
        console.error('[studio] onboarding link error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// DOWNLOAD MASTER TRACK
//
// Streams the master file from R2 directly
// to the artist. Verifies ownership before
// serving so one artist can't grab another's.
//
// POST /artist/api/studio/download-master
// Body: { trackId }
// ==========================================
router.post('/api/studio/download-master', verifyUser, express.json(), async (req, res) => {
    try {
        const { trackId } = req.body;
        if (!trackId) return res.status(400).json({ error: 'trackId is required' });

        // 1. Resolve the requesting artist
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });
        const artistId = artistSnap.docs[0].id;

        // 2. Fetch the song doc and verify ownership
        const songDoc = await db.collection('songs').doc(trackId).get();
        if (!songDoc.exists) return res.status(404).json({ error: 'Track not found' });

        const song = songDoc.data();
        if (song.artistId !== artistId) {
            return res.status(403).json({ error: 'Forbidden: this track does not belong to your account' });
        }

        if (!song.isLossless && !song.isMastered) {
            return res.status(400).json({ error: 'This track is MP3-only and has no high-quality master to download.' });
        }

        // Prefer the processed master (mastering chain output) if available,
        // otherwise fall back to the lossless original.
        const downloadUrl = song.masteredUrl || song.masterUrl;
        if (!downloadUrl) {
            return res.status(404).json({ error: 'No master file found for this track.' });
        }

        // 3. Derive the R2 object key from the stored CDN URL
        //    masterUrl is stored as  ${R2_PUBLIC_URL}/<key>
        const cdnBase = CDN_URL.replace(/\/$/, '');
        const r2Key = downloadUrl.replace(/^https?:\/\/[^/]+\//, '');

        if (!r2Key) return res.status(500).json({ error: 'Could not resolve storage key from master URL' });

        // 4. Fetch from R2
        const r2Res = await r2.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key:    r2Key,
        }));

        // 5. Derive a clean filename and content-type
        const ext         = r2Key.split('.').pop().toLowerCase() || 'wav';
        const safeTitle   = (song.title || 'master').replace(/[^a-zA-Z0-9 _-]/g, '').trim();
        const filename    = `${safeTitle} (Master).${ext}`;
        const contentType = r2Res.ContentType || `audio/${ext}`;

        // 6. Stream back to client as a download
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', contentType);
        if (r2Res.ContentLength) res.setHeader('Content-Length', r2Res.ContentLength);

        r2Res.Body.pipe(res);

    } catch (err) {
        console.error('[download-master] error:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

// ==========================================
// PAYMENT STATUS
// Returns lifetime distro flag + spendable balance.
// Used by the upload modal and payments view.
//
// GET /artist/api/studio/payment-status
// ==========================================
router.get('/api/studio/payment-status', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const data = artistSnap.docs[0].data();
        res.json({
            lifetimeDistro:   data.lifetimeDistro   || false,
            lifetimeDistroAt: data.lifetimeDistroAt  || null,
            balanceCents:     data.balanceCents       || 0,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// CREATE PAYMENT INTENT
// Resolves the amount directly from the Stripe
// Price object so Stripe is the source of truth.
// This ensures every charge is tied to the
// product in your dashboard and survives a
// database crash — Stripe has the record.
//
// POST /artist/api/studio/create-payment-intent
// Body: { type: 'cover'|'distro', coverCount?: number }
// ==========================================
router.post('/api/studio/create-payment-intent', verifyUser, express.json(), async (req, res) => {
    try {
        const { type, coverCount = 1 } = req.body;

        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const artistId   = artistSnap.docs[0].id;
        const artistData = artistSnap.docs[0].data();

        let amount, description, priceId;

        if (type === 'cover') {
            priceId = process.env.STRIPE_COVER_LICENCE_FEE;
            if (!priceId) return res.status(500).json({ error: 'Cover licence Price ID not configured.' });

            // Fetch the unit price from Stripe — this is the authoritative amount
            const price = await stripe.prices.retrieve(priceId);
            const feeEach = price.unit_amount; // in cents
            const count   = Math.max(1, parseInt(coverCount, 10) || 1);
            amount      = feeEach * count;
            description = `Cover Song Licence ×${count} — Eporia`;

        } else if (type === 'distro') {
            if (artistData.lifetimeDistro) {
                return res.status(400).json({ error: 'Lifetime distribution is already active on your account.' });
            }
            priceId = process.env.STRIPE_LIFETIME_DISTRIBUTION_FEE;
            if (!priceId) return res.status(500).json({ error: 'Distribution Price ID not configured.' });

            const price = await stripe.prices.retrieve(priceId);
            amount      = price.unit_amount;
            description = 'Lifetime Distribution — Eporia';

        } else {
            return res.status(400).json({ error: 'Invalid payment type. Expected "cover" or "distro".' });
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency:    'usd',
            description,
            // Attach to the Stripe product via the price — visible in your dashboard
            metadata: {
                artistId,
                type,
                priceId,
                coverCount: String(coverCount),
            },
            automatic_payment_methods: { enabled: true },
        });

        res.json({
            clientSecret:   paymentIntent.client_secret,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
            amount,
            description,
        });
    } catch (e) {
        console.error('[create-payment-intent] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// DEDUCT COVER LICENCE FROM EARNINGS BALANCE
// ==========================================
router.post('/api/studio/deduct-cover-from-balance', verifyUser, express.json(), async (req, res) => {
    try {
        const coverCount = Math.max(1, parseInt(req.body.coverCount || 1, 10) || 1);

        const priceId = process.env.STRIPE_COVER_LICENCE_FEE;
        if (!priceId) return res.status(500).json({ error: 'Cover licence Price ID not configured.' });
        const price    = await stripe.prices.retrieve(priceId);
        const totalFeeCents = price.unit_amount * coverCount;

        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const artistId = artistSnap.docs[0].id;

        // Execute a Turso Transaction to safely deduct the balance
        const tx = await turso.transaction();

        try {
            // Step A: Calculate current balance dynamically
            const earnedResult = await tx.execute({
                sql: `SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE receiver_id = ? AND transaction_type IN ('artist_payout', 'monthly_allocation')`,
                args: [artistId]
            });
            const spentResult = await tx.execute({
                sql: `SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE sender_id = ?`,
                args: [artistId]
            });

            const currentBalance = earnedResult.rows[0].total - spentResult.rows[0].total;

            if (currentBalance < totalFeeCents) {
                throw new Error(`Insufficient balance. You have $${(currentBalance / 100).toFixed(2)} but need $${(totalFeeCents / 100).toFixed(2)}.`);
            }

            // Step B: Record the deduction in the ledger
            const transactionId = admin.firestore().collection('temp').doc().id; 
            await tx.execute({
                sql: `INSERT INTO transactions 
                      (id, transaction_type, amount_cents, sender_id, receiver_id) 
                      VALUES (?, 'cover_licence_fee', ?, ?, 'EPORIA_TREASURY')`,
                args: [transactionId, totalFeeCents, artistId]
            });

            await tx.commit();
            
            res.json({ success: true, newBalanceCents: currentBalance - totalFeeCents });

        } catch (txError) {
            await tx.rollback();
            return res.status(400).json({ error: txError.message });
        }

    } catch (e) {
        console.error('[deduct-cover] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// CONFIRM LIFETIME DISTRIBUTION PAYMENT
// Called after stripe.confirmPayment() succeeds
// on the client. Verifies the PaymentIntent with
// Stripe before writing to Firestore so the flag
// can't be set by a forged client-side call.
//
// POST /artist/api/studio/confirm-distro-payment
// Body: { paymentIntentId: string }
// ==========================================
router.post('/api/studio/confirm-distro-payment', verifyUser, express.json(), async (req, res) => {
    try {
        const { paymentIntentId } = req.body;
        if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId is required' });

        // Verify with Stripe — never trust a client-supplied "success" flag
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status !== 'succeeded') {
            return res.status(400).json({ error: `Payment not yet complete (status: ${pi.status})` });
        }

        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const artistRef  = artistSnap.docs[0].ref;
        const artistData = artistSnap.docs[0].data();

        if (artistData.lifetimeDistro) {
            return res.json({ success: true, alreadyActive: true });
        }

        await artistRef.update({
            lifetimeDistro:              true,
            lifetimeDistroAt:            admin.firestore.FieldValue.serverTimestamp(),
            lifetimeDistroPaymentIntent: paymentIntentId,
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[confirm-distro] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// HITS ACT — EXPENSE TRACKER (TURSO SQL VERSION)
// ==========================================


// Assume `turso` is your initialized @libsql/client instance
// const turso = require('../config/turso'); 

const HITS_CATEGORIES = [
    'Studio Recording',
    'Session Musicians',
    'Music Video Production',
    'Equipment & Gear',
    'Software & Plugins',
    'Sample Licensing',
    'Cover Art & Design',
    'Music Distribution',
    'Marketing & Promotion',
    'Legal & Copyright',
    'Travel & Accommodation',
    'Other Production Cost',
];

const HITS_DEDUCTION_LIMIT = 150_000_00; // $150,000 in cents

// Helper to grab the artist ID using the auth UID
async function getArtistByUid(uid) {
    // Artists live in Firestore — NOT in Turso.
    // Turso only holds wallets, transactions, and expenses.
    const snap = await db.collection('artists')
        .where('ownerUid', '==', uid)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, name: doc.data().name || null };
}

// ── GET /api/studio/expenses ─────────────────────────────────────────────────
router.get('/api/studio/expenses', verifyUser, async (req, res) => {
    try {
        const artist = await getArtistByUid(req.uid);
        if (!artist) return res.status(404).json({ error: 'Artist not found' });

        const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

        const result = await turso.execute({
            sql: `SELECT id, description, category, amount_cents AS amountCents, 
                         date, year, receipt_url AS receiptUrl, notes, created_at AS createdAt 
                  FROM expenses 
                  WHERE artist_id = ? AND year = ? 
                  ORDER BY date DESC LIMIT 200`,
            args: [artist.id, year]
        });

        const expenses = result.rows;
        const totalCents = expenses.reduce((sum, e) => sum + (e.amountCents || 0), 0);

        res.json({
            expenses,
            totalCents,
            totalDollars:      (totalCents / 100).toFixed(2),
            deductionLimitCents: HITS_DEDUCTION_LIMIT,
            remainingCents:    Math.max(0, HITS_DEDUCTION_LIMIT - totalCents),
            categories:        HITS_CATEGORIES,
            year,
        });
    } catch (e) {
        console.error('[expenses] GET error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/studio/expenses ────────────────────────────────────────────────
router.post('/api/studio/expenses', verifyUser, express.json(), async (req, res) => {
    try {
        const artist = await getArtistByUid(req.uid);
        if (!artist) return res.status(404).json({ error: 'Artist not found' });

        const { description, category, amount, date, notes } = req.body;

        if (!description || !category || !amount || !date)
            return res.status(400).json({ error: 'description, category, amount, and date are required' });

        if (!HITS_CATEGORIES.includes(category))
            return res.status(400).json({ error: `Invalid category. Valid categories: ${HITS_CATEGORIES.join(', ')}` });

        const amountCents = Math.round(parseFloat(amount) * 100);
        if (isNaN(amountCents) || amountCents <= 0)
            return res.status(400).json({ error: 'amount must be a positive number' });

        const year = new Date(date).getFullYear();
        const expenseId = crypto.randomUUID(); // Generate a string ID like Firestore

        await turso.execute({
            sql: `INSERT INTO expenses 
                  (id, artist_id, description, category, amount_cents, date, year, notes) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [expenseId, artist.id, description, category, amountCents, date, year, notes || null]
        });

        res.json({ success: true, id: expenseId });
    } catch (e) {
        console.error('[expenses] POST error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ── DELETE /api/studio/expenses/:id ─────────────────────────────────────────
router.delete('/api/studio/expenses/:id', verifyUser, async (req, res) => {
    try {
        const artist = await getArtistByUid(req.uid);
        if (!artist) return res.status(404).json({ error: 'Artist not found' });

        await turso.execute({
            sql: 'DELETE FROM expenses WHERE id = ? AND artist_id = ?',
            args: [req.params.id, artist.id]
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[expenses] DELETE error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/studio/expenses/:id/receipt ────────────────────────────────────
router.post('/api/studio/expenses/:id/receipt', verifyUser, upload.single('receipt'), async (req, res) => {
    try {
        const artist = await getArtistByUid(req.uid);
        if (!artist) return res.status(404).json({ error: 'Artist not found' });

        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        // Cloudflare R2 Upload Logic (unchanged)
        const key = `artists/${artist.id}/receipts/${req.params.id}_${Date.now()}.${req.file.originalname.split('.').pop()}`;
        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME, Key: key,
            Body: req.file.buffer, ContentType: req.file.mimetype,
        }));
        const receiptUrl = `${CDN_URL}/${key}`;

        // Update Turso record
        await turso.execute({
            sql: 'UPDATE expenses SET receipt_url = ? WHERE id = ? AND artist_id = ?',
            args: [receiptUrl, req.params.id, artist.id]
        });

        res.json({ success: true, receiptUrl });
    } catch (e) {
        console.error('[expenses] receipt error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/studio/expenses/export.csv ──────────────────────────────────────
router.get('/api/studio/expenses/export.csv', verifyUser, async (req, res) => {
    try {
        const artist = await getArtistByUid(req.uid);
        if (!artist) return res.status(404).json({ error: 'Artist not found' });

        const artistName = artist.name || 'Unknown Artist';
        const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

        const result = await turso.execute({
            sql: `SELECT description, category, amount_cents AS amountCents, 
                         date, receipt_url AS receiptUrl, notes 
                  FROM expenses 
                  WHERE artist_id = ? AND year = ? 
                  ORDER BY date ASC`,
            args: [artist.id, year]
        });

        const expenses = result.rows;
        const totalCents = expenses.reduce((sum, e) => sum + (e.amountCents || 0), 0);

        // ── Build CSV ────────────────────────────────────────────────────────
        const lines = [
            `"HITS Act Production Cost Report — ${artistName}"`,
            `"Tax Year: ${year}"`,
            `"Maximum Deduction Allowed: $150,000.00"`,
            `"Total Documented Expenses: $${(totalCents / 100).toFixed(2)}"`,
            `"Eligible for Immediate §179 Deduction: ${totalCents <= HITS_DEDUCTION_LIMIT ? 'Yes' : 'Partial — exceeds $150,000 cap'}"`,
            `""`,
            `"Date","Category","Description","Amount (USD)","Notes","Receipt"`,
        ];

        expenses.forEach(e => {
            const amt     = `$${(e.amountCents / 100).toFixed(2)}`;
            const receipt = e.receiptUrl ? 'Yes' : 'No';
            const notes   = (e.notes || '').replace(/"/g, '""');
            const desc    = (e.description || '').replace(/"/g, '""');
            lines.push(`"${e.date}","${e.category}","${desc}","${amt}","${notes}","${receipt}"`);
        });

        lines.push(`"","","TOTAL","$${(totalCents / 100).toFixed(2)}","",""` );
        lines.push(`"","","REMAINING DEDUCTION AVAILABLE","$${(Math.max(0, HITS_DEDUCTION_LIMIT - totalCents) / 100).toFixed(2)}","",""` );

        const csv = lines.join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="hits-act-expenses-${year}.csv"`);
        res.send(csv);
    } catch (e) {
        console.error('[expenses] CSV export error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// MERCH ANALYTICS
//
// GET /api/studio/merch-analytics?period=30|90|365|all
//
// Returns per-item sales breakdown from Turso transactions.
// One transaction row per line item (reference_id = itemId) means
// this is a single GROUP BY query — no JSON scanning required.
// Enriches results with Firestore merch doc for name/photo/price.
// ==========================================
router.get('/api/studio/merch-analytics', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const artistId = artistSnap.docs[0].id;

        // Period filter — defaults to last 30 days
        const period  = req.query.period || '30';
        let   sinceTs = 0;
        if (period !== 'all') {
            const days = parseInt(period) || 30;
            sinceTs    = Math.floor(Date.now() / 1000) - (days * 86400);
        }

        // ── Per-item revenue + units sold ─────────────────────────────────────
        const itemResult = await turso.execute({
            sql: `SELECT
                      reference_id          AS item_id,
                      COUNT(*)              AS sale_count,
                      SUM(amount_cents)     AS revenue_cents
                  FROM transactions
                  WHERE receiver_id       = ?
                    AND transaction_type  = 'merch_sale'
                    AND created_at        >= ?
                  GROUP BY reference_id
                  ORDER BY revenue_cents DESC`,
            args: [artistId, sinceTs]
        });

        // ── Total revenue + units this period ─────────────────────────────────
        const totalResult = await turso.execute({
            sql: `SELECT
                      COUNT(*)          AS total_sales,
                      SUM(amount_cents) AS total_revenue_cents
                  FROM transactions
                  WHERE receiver_id      = ?
                    AND transaction_type = 'merch_sale'
                    AND created_at       >= ?`,
            args: [artistId, sinceTs]
        });

        // ── Monthly revenue trend (last 6 months) ────────────────────────────
        const trendResult = await turso.execute({
            sql: `SELECT
                      strftime('%Y-%m', datetime(created_at, 'unixepoch')) AS month,
                      SUM(amount_cents) AS revenue_cents,
                      COUNT(*)          AS sale_count
                  FROM transactions
                  WHERE receiver_id      = ?
                    AND transaction_type = 'merch_sale'
                    AND created_at       >= ?
                  GROUP BY month
                  ORDER BY month ASC`,
            args: [artistId, Math.floor(Date.now() / 1000) - (180 * 86400)]
        });

        // ── Enrich item rows with Firestore merch data ─────────────────────────
        const itemRows = await Promise.all(itemResult.rows.map(async row => {
            let itemName  = 'Unknown Item';
            let itemPhoto = null;
            let itemPrice = null;
            let category  = null;

            try {
                const doc = await db.collection('artists').doc(artistId)
                    .collection('merch').doc(row.item_id).get();
                if (doc.exists) {
                    const d   = doc.data();
                    itemName  = d.name  || itemName;
                    itemPhoto = d.photos?.[0] ? normalizeUrl(d.photos[0]) : null;
                    itemPrice = d.price || null;
                    category  = d.category || null;
                }
            } catch (_) {}

            return {
                itemId:       row.item_id,
                name:         itemName,
                photo:        itemPhoto,
                price:        itemPrice,
                category,
                saleCount:    row.sale_count,
                revenueCents: row.revenue_cents,
                revenueDollars: (row.revenue_cents / 100).toFixed(2),
            };
        }));

        const totals = totalResult.rows[0] || { total_sales: 0, total_revenue_cents: 0 };

        res.json({
            period,
            totalSales:         totals.total_sales,
            totalRevenueCents:  totals.total_revenue_cents,
            totalRevenueDollars: (totals.total_revenue_cents / 100).toFixed(2),
            items:              itemRows,
            trend:              trendResult.rows.map(r => ({
                month:          r.month,
                revenueDollars: (r.revenue_cents / 100).toFixed(2),
                saleCount:      r.sale_count,
            })),
        });
    } catch (e) {
        console.error('[merch-analytics] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ANALYTICS: OVERVIEW (revenue trend + income breakdown)
//
// GET /api/studio/analytics/overview?period=30|90|365|all
//
// All money data from Turso — one query for trend, one for breakdown.
// ==========================================
router.get('/api/studio/analytics/overview', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });
        const artistId = artistSnap.docs[0].id;

        const period  = req.query.period || '30';
        const sinceTs = period === 'all'
            ? 0
            : Math.floor(Date.now() / 1000) - (parseInt(period) * 86400);

        // ── Breakdown by type ─────────────────────────────────────────────────
        const breakdownResult = await turso.execute({
            sql: `SELECT
                      transaction_type,
                      COUNT(*)          AS tx_count,
                      SUM(amount_cents) AS revenue_cents
                  FROM transactions
                  WHERE receiver_id     = ?
                    AND transaction_type IN ('artist_payout','monthly_allocation','merch_sale')
                    AND created_at      >= ?
                  GROUP BY transaction_type`,
            args: [artistId, sinceTs]
        });

        let tipsCents = 0, allocCents = 0, merchCents = 0, totalTx = 0;
        breakdownResult.rows.forEach(r => {
            totalTx += r.tx_count;
            if (r.transaction_type === 'artist_payout')      tipsCents  = r.revenue_cents;
            if (r.transaction_type === 'monthly_allocation') allocCents = r.revenue_cents;
            if (r.transaction_type === 'merch_sale')         merchCents = r.revenue_cents;
        });
        const totalCents = tipsCents + allocCents + merchCents;

        // ── Monthly trend (last 12 months always, regardless of period) ───────
        const trendSince = Math.floor(Date.now() / 1000) - (365 * 86400);
        const trendResult = await turso.execute({
            sql: `SELECT
                      strftime('%Y-%m', datetime(created_at, 'unixepoch')) AS month,
                      SUM(amount_cents) AS revenue_cents,
                      COUNT(*)          AS tx_count
                  FROM transactions
                  WHERE receiver_id      = ?
                    AND transaction_type IN ('artist_payout','monthly_allocation','merch_sale')
                    AND created_at       >= ?
                  GROUP BY month
                  ORDER BY month ASC`,
            args: [artistId, trendSince]
        });

        res.json({
            period,
            totalRevenueDollars:  (totalCents  / 100).toFixed(2),
            tipsDollars:          (tipsCents   / 100).toFixed(2),
            allocationsDollars:   (allocCents  / 100).toFixed(2),
            merchDollars:         (merchCents  / 100).toFixed(2),
            totalTransactions:    totalTx,
            trend: trendResult.rows.map(r => ({
                month:          r.month,
                revenueDollars: (r.revenue_cents / 100).toFixed(2),
                txCount:        r.tx_count,
            })),
        });
    } catch (e) {
        console.error('[analytics] overview error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ANALYTICS: TOP SONGS by likes
//
// GET /api/studio/analytics/top-songs
//
// Reads from Firestore songs collection — likes/plays live there.
// ==========================================
router.get('/api/studio/analytics/top-songs', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });
        const artistId = artistSnap.docs[0].id;

        const snap = await db.collection('songs')
            .where('artistId', '==', artistId)
            .orderBy('stats.likes', 'desc')
            .limit(10)
            .get();

        const songs = snap.docs.map(doc => {
            const d = doc.data();
            return {
                id:     doc.id,
                title:  d.title  || 'Untitled',
                album:  d.album  || null,
                genre:  d.genre  || null,
                artUrl: d.artUrl ? normalizeUrl(d.artUrl) : null,
                likes:  d.stats?.likes  || 0,
                plays:  d.stats?.plays  || 0,
            };
        });

        res.json({ songs });
    } catch (e) {
        console.error('[analytics] top-songs error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ANALYTICS: RECENT TRANSACTIONS
//
// GET /api/studio/analytics/transactions?limit=20
//
// Latest income events from Turso for the activity feed.
// ==========================================
router.get('/api/studio/analytics/transactions', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });
        const artistId = artistSnap.docs[0].id;

        const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
        const result = await turso.execute({
            sql: `SELECT id, transaction_type AS type, amount_cents, created_at AS createdAt
                  FROM transactions
                  WHERE receiver_id      = ?
                    AND transaction_type IN ('artist_payout','monthly_allocation','merch_sale')
                  ORDER BY created_at DESC
                  LIMIT ?`,
            args: [artistId, limit]
        });

        const transactions = result.rows.map(r => ({
            id:            r.id,
            type:          r.type,
            amountDollars: (r.amount_cents / 100).toFixed(2),
            createdAt:     r.createdAt,
        }));

        res.json({ transactions });
    } catch (e) {
        console.error('[analytics] transactions error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// PUBLIC PROFILE CUSTOMIZATION
//
// GET  /api/studio/public-profile   — load current publicProfile settings
// POST /api/studio/public-profile   — save publicProfile settings
//
// Stored on artists/{artistId}.publicProfile:
//   featuredTrackIds: string[]   — up to 6 song IDs from their catalog
//   socialLinks: {
//     instagram, tiktok, youtube, spotify, soundcloud, website, email
//   }
//   credits: {
//     producers: string[]
//     bandMembers: [{ name, role }]
//     acknowledgements: string
//   }
// ==========================================
router.get('/api/studio/public-profile', verifyUser, async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const data = artistSnap.docs[0].data();
        const pp   = data.publicProfile || {};

        // Return their full song catalog so the featured-track picker can display titles
        const songsSnap = await db.collection('songs')
            .where('artistId', '==', artistSnap.docs[0].id)
            .orderBy('uploadedAt', 'desc')
            .limit(100)
            .get();

        const catalog = songsSnap.docs.map(d => ({
            id:     d.id,
            title:  d.data().title || 'Untitled',
            artUrl: d.data().artUrl ? normalizeUrl(d.data().artUrl) : null,
            album:  d.data().album || null,
        }));

        res.json({
            featuredTrackIds: pp.featuredTrackIds || [],
            socialLinks:      pp.socialLinks      || {},
            credits:          pp.credits          || { producers: [], bandMembers: [], acknowledgements: '' },
            catalog,
        });
    } catch (e) {
        console.error('[public-profile] GET error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/studio/public-profile', verifyUser, express.json(), async (req, res) => {
    try {
        const artistSnap = await db.collection('artists')
            .where('ownerUid', '==', req.uid).limit(1).get();
        if (artistSnap.empty) return res.status(404).json({ error: 'Artist not found' });

        const { featuredTrackIds, socialLinks, credits } = req.body;

        // Sanitize social links — only allow known keys, strip non-URL values
        const ALLOWED_SOCIALS = ['instagram','tiktok','youtube','spotify','soundcloud','website','email'];
        const cleanSocials = {};
        if (socialLinks && typeof socialLinks === 'object') {
            for (const key of ALLOWED_SOCIALS) {
                const val = (socialLinks[key] || '').trim();
                if (val) cleanSocials[key] = val;
            }
        }

        // Sanitize credits
        const cleanCredits = {
            producers:       Array.isArray(credits?.producers)   ? credits.producers.filter(Boolean).slice(0, 20)  : [],
            bandMembers:     Array.isArray(credits?.bandMembers) ? credits.bandMembers.slice(0, 20) : [],
            acknowledgements: (credits?.acknowledgements || '').slice(0, 500),
        };

        // Sanitize featuredTrackIds — max 6, must be strings
        const cleanFeatured = Array.isArray(featuredTrackIds)
            ? featuredTrackIds.filter(id => typeof id === 'string').slice(0, 6)
            : [];

        await artistSnap.docs[0].ref.update({
            'publicProfile.featuredTrackIds': cleanFeatured,
            'publicProfile.socialLinks':      cleanSocials,
            'publicProfile.credits':          cleanCredits,
            'publicProfile.updatedAt':        admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[public-profile] POST error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;