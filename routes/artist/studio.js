/* routes/artist/studio.js */
const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
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

module.exports = router;