/* routes/users.js */
var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require('firebase-admin');

require('dotenv').config();

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || 'https://cdn.eporiamusic.com';
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'eporia-audio-vault';

// ── R2 & STORAGE ──────────────────────────────────────────────────────────────
const r2 = require('../config/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const turso = require('../config/turso');

const { welcomeNewUser } = require('./player_routes/welcomeNewUser');

// ── STRIPE (wallet top-ups only — no subscriptions) ───────────────────────────
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.preview'
});

// ── FIREBASE ──────────────────────────────────────────────────────────────────
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// Multer: accept up to 2 image fields (profile + banner)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});
const uploadFields = upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'bannerImage',  maxCount: 1 }
]);

// ── R2 URL NORMALIZER ─────────────────────────────────────────────────────────
const R2_DEV_PATTERN = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;
function normalizeArtUrl(url) {
    if (!url) return `${CDN_URL}/assets/placeholder_art.jpg`;
    if (R2_DEV_PATTERN.test(url)) return url.replace(R2_DEV_PATTERN, CDN_URL);
    if (!url.startsWith('http')) return `${CDN_URL}/${url.replace(/^\//, '')}`;
    return url;
}

// ── HELPER: Upload file buffer to R2 ─────────────────────────────────────────
async function uploadToR2(buffer, mime, key) {
    await r2.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: mime
    }));
    return `${CDN_URL}/${key}`;
}

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

// GET /api/me — returns signed-in user's profile for cart / nav use
router.get('/api/me', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!idToken) return res.status(401).json({ error: 'No token provided' });

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded.uid;
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return res.json({ uid, handle: null, avatar: null, email: decoded.email || null });
        }
        const data = userDoc.data();
        res.json({
            uid,
            handle: data.handle   || null,
            avatar: data.photoURL || null,
            email:  decoded.email || null
        });
    } catch (e) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

router.get('/signup', (req, res) => res.render('userSignup', { title: 'Join Eporia' }));
router.get('/signin', (req, res) => res.render('signin',     { title: 'Welcome Back | Eporia' }));
router.get('/logout', (req, res) => {
    res.clearCookie('session');
    res.render('signin', { title: 'Signed Out', autoLogout: true });
});

// ── PUBLIC: Song search (anthem picker) ───────────────────────────────────────
router.get('/api/public/search-songs', async (req, res) => {
    try {
        let query = (req.query.q || '').toLowerCase();
        if (query.startsWith('s:')) query = query.slice(2);
        if (query.length < 2) return res.json({ results: [] });

        const snapshot = await db.collection('songs')
            .orderBy('titleLower')
            .startAt(query)
            .endAt(query + '\uf8ff')
            .limit(10)
            .get();

        const results = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            results.push({
                id:       doc.id,
                title:    data.title      || 'Untitled',
                artist:   data.artistName || 'Unknown Artist',
                artistId: data.artistId   || null,
                img:      normalizeArtUrl(data.artUrl || null),
                audioUrl: data.audioUrl   || null,
                duration: data.duration   || 0,
            });
        });
        res.json({ results });
    } catch (e) {
        console.error('Public Search Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ── PUBLIC: Handle availability check ─────────────────────────────────────────
router.get('/api/check-handle/:handle', async (req, res) => {
    try {
        const rawHandle = req.params.handle.toLowerCase();
        const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
        const snapshot = await db.collection('users').where('handle', '==', handle).limit(1).get();
        res.json({ available: snapshot.empty });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ── PUBLIC: Email availability check ──────────────────────────────────────────
router.get('/api/check-email/:email', async (req, res) => {
    try {
        const email = req.params.email;
        if (!email || !email.includes('@')) return res.json({ available: false });
        try {
            await admin.auth().getUserByEmail(email);
            res.json({ available: false });
        } catch (err) {
            if (err.code === 'auth/user-not-found') res.json({ available: true });
            else throw err;
        }
    } catch (e) {
        res.status(500).json({ error: 'Server check failed' });
    }
});

// ── SESSION LOGIN ─────────────────────────────────────────────────────────────
// Exchanges a Firebase ID token for a server-minted session cookie.
router.post('/api/session-login', express.json(), async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 days
        const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });

        res.cookie('session', sessionCookie, {
            maxAge:   expiresIn,
            httpOnly: true,
            secure:   process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path:     '/'
        });
        res.json({ success: true, uid: decoded.uid });
    } catch (e) {
        console.error('[session-login] failed:', e.message);
        res.status(401).json({ error: 'Invalid ID token' });
    }
});

// =============================================================================
// ACCOUNT CREATION  (free — no payment gate)
// =============================================================================
// POST /api/account/create
// Creates the Firebase Auth user, Firestore doc, R2 profile/banner images,
// and Turso wallet row all in one shot. Returns a custom token so the client
// can sign in immediately.
//
// Does NOT require any payment. Stripe is only called if the user subsequently
// chooses to fund their wallet (see /api/wallet/purchase-intent below).
// =============================================================================
router.post('/api/account/create', uploadFields, async (req, res) => {
    try {
        const {
            email, password, handle, location,
            primaryGenre, subgenres, profileSong,
            musicProfile, settings, geo
        } = req.body;

        // ── Basic validation ──
        if (!handle)            return res.status(400).json({ error: 'Handle is required' });
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        if (!location)          return res.status(400).json({ error: 'Location is required' });

        // ── 1. Create Firebase Auth user ──
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: handle
        });
        const uid = userRecord.uid;

        const profileFile = req.files?.profileImage?.[0] || null;
        const bannerFile  = req.files?.bannerImage?.[0]  || null;

        // ── 2. Upload profile image to R2 ──
        let photoURL = `${CDN_URL}/assets/default-avatar.jpg`;
        if (profileFile) {
            try {
                photoURL = await uploadToR2(profileFile.buffer, profileFile.mimetype, `users/${uid}/profile.jpg`);
            } catch (e) { console.error('Profile R2 upload failed:', e); }
        }

        // ── 3. Upload banner image to R2 (optional) ──
        let coverURL = null;
        if (bannerFile) {
            try {
                coverURL = await uploadToR2(bannerFile.buffer, bannerFile.mimetype, `users/${uid}/banner.jpg`);
            } catch (e) { console.error('Banner R2 upload failed:', e); }
        }

        // ── 4. Parse JSON fields ──
        const parsedSubgenres = (() => { try { return subgenres ? JSON.parse(subgenres) : []; } catch { return []; } })();
        const anthem          = (() => { try { return profileSong && profileSong !== 'null' ? JSON.parse(profileSong) : null; } catch { return null; } })();
        const artistRequests  = (() => { try { return musicProfile ? JSON.parse(musicProfile).requests || '' : ''; } catch { return ''; } })();
        const parsedSettings  = (() => { try { return settings ? JSON.parse(settings) : {}; } catch { return {}; } })();

        const combinedGenres = [...(primaryGenre ? [primaryGenre] : []), ...parsedSubgenres];

        // ── 5. Parse geo ──
        let city = location, state = 'Global', country = 'Unknown', coordinates = null;
        if (geo) {
            try {
                const g = JSON.parse(geo);
                if (g.city)  city    = g.city;
                if (g.state) state   = g.state;
                if (g.country) country = g.country;
                if (g.lat && g.lng) {
                    coordinates = new admin.firestore.GeoPoint(parseFloat(g.lat), parseFloat(g.lng));
                }
            } catch { /* non-fatal */ }
        }

        // ── 6. Write Firestore doc ──
        const now = admin.firestore.FieldValue.serverTimestamp();
        const userRef = db.collection('users').doc(uid);
        const batch = db.batch();

        batch.set(userRef, {
            uid,
            handle:      `@${handle}`,
            displayName: handle,
            email:       userRecord.email,
            photoURL,
            coverURL,
            role:        'member',
            joinDate:    now,
            location, city, state, country, coordinates,
            primaryGenre:   primaryGenre || null,
            subgenres:      parsedSubgenres,
            genres:         combinedGenres,
            artistRequests,
            profileSong:    anthem,
            impactScore:    0,
            theme:          primaryGenre || 'default',
            settings:       parsedSettings,
            // Wallet display values — Turso is source of truth for balance
            walletCredits:  0,
            walletBalance:  0,
        });

        batch.set(userRef.collection('notifications').doc(), {
            type:      'system',
            fromName:  'Eporia',
            message:   'Welcome to Eporia! Explore the underground.',
            timestamp: now,
            read:      false,
        });

        await batch.commit();

        // ── 7. Initialise Turso wallet row ──
        try {
            await turso.execute({
                sql:  'INSERT INTO wallets (user_id, wallet_balance, fandom_pool) VALUES (?, ?, ?)',
                args: [uid, 0, 0]
            });
        } catch (e) {
            // Non-fatal: wallet row may already exist if this is a retry
            console.error('[account/create] Turso wallet init error:', e.message);
        }

        // ── 8. Welcome flow ──
        await welcomeNewUser(db, uid, `@${handle}`, photoURL);

        // ── 9. Return custom token so client can sign in immediately ──
        const customToken = await admin.auth().createCustomToken(uid);
        res.json({ success: true, customToken, uid });

    } catch (e) {
        console.error('[account/create] Error:', e);
        // Surface a clean duplicate-email message
        if (e.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'An account with this email already exists.' });
        }
        res.status(500).json({ error: e.message });
    }
});

// =============================================================================
// WALLET TOP-UP — Step 1: Create PaymentIntent
// =============================================================================
// POST /api/wallet/purchase-intent
// Called after the user is authenticated (custom token signed in).
// Validates the package, adds 12% service fee, and creates a Stripe
// PaymentIntent. The client mounts a PaymentElement and pays.
//
// Credit packages:
//   500  credits → $5.00 base  → $5.60  charged (12% fee)
//   1000 credits → $10.00 base → $11.20 charged (12% fee)
//   custom       → min $5.00   → base × 1.12 charged
//
// 100% of the base amount (in credits) is available to tip artists.
// The 12% service fee covers Stripe fees + server costs and never
// comes out of artist earnings.
// =============================================================================
router.post('/api/wallet/purchase-intent', express.json(), async (req, res) => {
    try {
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (!idToken) return res.status(401).json({ error: 'Unauthorized' });
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded.uid;

        const { package: pkg, customAmount } = req.body;

        // ── Resolve package to base dollar amount + credit count ──
        let baseDollars, credits;

        if (pkg === '500') {
            baseDollars = 5.00;
            credits     = 500;
        } else if (pkg === '1000') {
            baseDollars = 10.00;
            credits     = 1000;
        } else if (pkg === 'custom') {
            baseDollars = parseFloat(customAmount);
            if (isNaN(baseDollars) || baseDollars < 5) {
                return res.status(400).json({ error: 'Minimum custom amount is $5.00' });
            }
            credits = Math.floor(baseDollars * 100); // $1 = 100 credits
        } else {
            return res.status(400).json({ error: 'Invalid package. Choose 500, 1000, or custom.' });
        }

        // ── Add 12% service fee ──
        const totalCents = Math.round(baseDollars * 1.12 * 100);

        // ── Create Stripe PaymentIntent ──
        const paymentIntent = await stripe.paymentIntents.create({
            amount:      totalCents,
            currency:    'usd',
            description: `Eporia Wallet Top-Up: ${credits.toLocaleString()} credits`,
            metadata: {
                firebaseUid:  uid,
                credits:      credits.toString(),
                baseDollars:  baseDollars.toFixed(2),
                type:         'wallet_topup',
                credited:     'false', // toggled to 'true' by /api/wallet/credit
            }
        });

        res.json({
            clientSecret:   paymentIntent.client_secret,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
            credits,
            baseDollars:    baseDollars.toFixed(2),
            totalCharged:   (totalCents / 100).toFixed(2),
        });

    } catch (e) {
        console.error('[wallet/purchase-intent] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// =============================================================================
// WALLET TOP-UP — Step 2: Confirm + Credit Wallet
// =============================================================================
// POST /api/wallet/credit
// Called by the client after stripe.confirmPayment() resolves with
// paymentIntent.status === 'succeeded'. The server re-verifies the payment
// status directly with Stripe before crediting anything, and guards against
// double-crediting with a metadata flag.
// =============================================================================
router.post('/api/wallet/credit', express.json(), async (req, res) => {
    try {
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (!idToken) return res.status(401).json({ error: 'Unauthorized' });
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded.uid;

        const { paymentIntentId } = req.body;
        if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId required' });

        // ── Verify with Stripe — never trust the client alone ──
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ error: 'Payment has not succeeded yet.' });
        }
        if (paymentIntent.metadata.firebaseUid !== uid) {
            return res.status(403).json({ error: 'Payment does not belong to this user.' });
        }

        // ── Idempotency: already credited → return early ──
        if (paymentIntent.metadata.credited === 'true') {
            return res.json({ success: true, alreadyCredited: true });
        }

        const credits     = parseInt(paymentIntent.metadata.credits, 10);
        const baseDollars = parseFloat(paymentIntent.metadata.baseDollars);
        // Turso stores amounts in cents internally
        const creditsCents = Math.round(baseDollars * 100);

        // ── Credit Turso wallet ──
        await turso.execute({
            sql:  'UPDATE wallets SET wallet_balance = wallet_balance + ? WHERE user_id = ?',
            args: [creditsCents, uid]
        });

        // ── Update Firestore display values ──
        await db.collection('users').doc(uid).update({
            walletCredits: admin.firestore.FieldValue.increment(credits),
            walletBalance: admin.firestore.FieldValue.increment(baseDollars),
        });

        // ── Mark as credited in Stripe metadata (idempotency guard) ──
        await stripe.paymentIntents.update(paymentIntentId, {
            metadata: { ...paymentIntent.metadata, credited: 'true' }
        });

        res.json({ success: true, credits, walletBalance: baseDollars });

    } catch (e) {
        console.error('[wallet/credit] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// =============================================================================
// ACCOUNT STATUS CHECK  (simplified — no subscription logic)
// =============================================================================
// GET /api/check-account
// Used by sign-in flow to determine where to redirect the user.
// =============================================================================
router.get('/api/check-account', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        const uid = decoded.uid;

        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists) {
            return res.json({ status: 'missing_record', redirect: '/members/signup' });
        }

        return res.json({ status: 'active', redirect: '/player/dashboard' });

    } catch (e) {
        console.error('[check-account] Error:', e);
        res.status(500).json({ error: 'Check failed' });
    }
});

// =============================================================================
// DELETE ACCOUNT
// Wipes Firestore subcollections + user doc, deletes Firebase Auth record.
// Turso wallet row is also zeroed out.
// =============================================================================
router.delete('/api/account/delete', async (req, res) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'Unauthorized' });

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
    } catch (e) {
        return res.status(403).json({ error: 'Invalid token' });
    }

    try {
        // ── Zero out the Turso wallet (soft wipe) ──
        try {
            await turso.execute({
                sql:  'UPDATE wallets SET wallet_balance = 0, fandom_pool = 0 WHERE user_id = ?',
                args: [uid]
            });
        } catch (e) { console.error('[delete-account] Turso wipe error:', e.message); }

        // ── Delete Firestore subcollections ──
        const deleteSubcollection = async (collRef) => {
            const snap = await collRef.limit(100).get();
            if (snap.empty) return;
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            if (snap.size === 100) await deleteSubcollection(collRef);
        };

        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const userRef = db.collection('users').doc(uid);
            await deleteSubcollection(userRef.collection('wallet'));
            await deleteSubcollection(userRef.collection('likedSongs'));
            await deleteSubcollection(userRef.collection('history'));
            await deleteSubcollection(userRef.collection('following'));
            await deleteSubcollection(userRef.collection('notifications'));
            await userRef.delete();
        }

        // ── Delete Firebase Auth record — must be last ──
        await admin.auth().deleteUser(uid);

        res.json({ success: true });

    } catch (e) {
        console.error('[delete-account] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;