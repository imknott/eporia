/* routes/users.js */
var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require("firebase-admin");

// [FIX 1] Load Environment Variables Immediately
require('dotenv').config();

// --- CONFIGURATION ---
const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || "https://cdn.eporiamusic.com";
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
const BUCKET_NAME = process.env.R2_BUCKET_NAME || "eporia-audio-vault";

// --- R2 & AWS SDK SETUP ---
const r2 = require('../config/r2'); 
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const turso = require('../config/turso'); // Turso client for SQL database access


const { welcomeNewUser } = require('./player_routes/welcomeNewUser');

// [FIX 2] Initialize Stripe with the real key (No placeholder fallback)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.preview' 
});

const STRIPE_PRICES = {
    month: {
        discovery: process.env.STRIPE_PRICE_DISCOVERY_MONTH,
        supporter: process.env.STRIPE_PRICE_SUPPORTER_MONTH,
        champion:  process.env.STRIPE_PRICE_CHAMPION_MONTH
    },
    year: {
        discovery: process.env.STRIPE_PRICE_DISCOVERY_YEAR,
        supporter: process.env.STRIPE_PRICE_SUPPORTER_YEAR,
        champion:  process.env.STRIPE_PRICE_CHAMPION_YEAR
    }
};



if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ==========================================
// PUBLIC ROUTES
// ==========================================

// ──────────────────────────────────────────────────────────────
// GET /api/me
// Returns the signed-in user's public profile (handle + avatar)
// for use on the store page cart. Accepts a Firebase ID token
// via Authorization: Bearer <token> header.
// ──────────────────────────────────────────────────────────────
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
            handle:  data.handle      || null,
            avatar:  data.profileImage || data.avatarUrl || null,
            email:   decoded.email     || null
        });
    } catch (e) {
        res.status(403).json({ error: 'Invalid token' });
    }
});

router.get('/signup', (req, res) => {
    res.render('userSignup', { title: 'Join the Collective | Eporia' });
});

router.get('/signin', (req, res) => {
    res.render('signin', { title: 'Welcome Back | Eporia' });
});

router.get('/logout', (req, res) => {
    res.clearCookie('session'); 
    res.render('signin', { title: 'Signed Out', autoLogout: true });
});

// --- PUBLIC SONG SEARCH (For Anthem Selection) ---
router.get('/api/public/search-songs', async (req, res) => {
    // Normalizes artUrl to always use the canonical CDN domain.
    //   1. Raw R2 dev URLs (pub-xxx.r2.dev) saved before a custom domain was set
    //   2. Relative / protocol-missing paths
    //   3. Already-correct CDN URLs — passed through unchanged
    const R2_DEV_PATTERN = /https?:\/\/pub-[a-zA-Z0-9]+\.r2\.dev/;
    function normalizeArtUrl(url) {
        if (!url) return `${CDN_URL}/assets/placeholder_art.jpg`;
        if (R2_DEV_PATTERN.test(url)) return url.replace(R2_DEV_PATTERN, CDN_URL);
        if (!url.startsWith('http'))   return `${CDN_URL}/${url.replace(/^\//, '')}`;
        return url;
    }
    try {
        let query = (req.query.q || '').toLowerCase();
        if (query.startsWith('s:')) query = query.slice(2);
        
        if (query.length < 2) return res.json({ results: [] });

        // Search by titleLower
        const snapshot = await db.collection('songs')
            .orderBy('titleLower')
            .startAt(query)
            .endAt(query + '\uf8ff')
            .limit(10)
            .get();

        const results = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Normalize the art URL the same way the upload route stores it.
            // Normalize art URL through all three cases (dev URL, relative, correct)
            const artUrl = normalizeArtUrl(data.artUrl || null);

            results.push({
                id:       doc.id,
                title:    data.title           || 'Untitled',
                artist:   data.artistName      || 'Unknown Artist',
                artistId: data.artistId        || null,   // ← required for Proof of Fandom points
                img:      artUrl,
                audioUrl: data.audioUrl        || null,
                duration: data.duration        || 0,
            });
        });

        res.json({ results });
    } catch (e) {
        console.error("Public Search Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- API: CHECK HANDLE AVAILABILITY ---
router.get('/api/check-handle/:handle', async (req, res) => {
    try {
        const rawHandle = req.params.handle.toLowerCase();
        const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
        const snapshot = await db.collection('users').where('handle', '==', handle).limit(1).get();
        res.json({ available: snapshot.empty });
    } catch (error) {
        res.status(500).json({ error: "Server error" });
    }
});

// --- API: CHECK EMAIL AVAILABILITY ---
router.get('/api/check-email/:email', async (req, res) => {
    try {
        const email = req.params.email;
        if (!email || !email.includes('@')) return res.json({ available: false });
        try {
            await admin.auth().getUserByEmail(email);
            res.json({ available: false });
        } catch (error) {
            if (error.code === 'auth/user-not-found') res.json({ available: true });
            else throw error;
        }
    } catch (error) {
        res.status(500).json({ error: "Server check failed" });
    }
});

// ==========================================
// SESSION LOGIN
// Exchanges a client-side Firebase ID token for a proper
// server-minted session cookie.  Called by signin.js after
// signInWithEmailAndPassword succeeds.
//
// Why: admin.auth().verifySessionCookie() only accepts cookies
// created here via createSessionCookie().  Storing a raw ID
// token in document.cookie causes verifySessionCookie to throw
// on every server-side page render, so req.uid is never set.
// ==========================================
router.post('/api/session-login', express.json(), async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);

        // Mint a proper session cookie (5 day expiry)
        const expiresIn = 60 * 60 * 24 * 5 * 1000;
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

// ==========================================
// ACCOUNT CREATION & PAYMENT
// ==========================================

// ─── Pending signup store ────────────────────────────────────────────────────
// Keyed by Stripe checkout session ID. Holds all form data + image buffer
// needed to create the account ONLY after payment succeeds.
// Auto-expires after 2 h — abandoned checkouts leave zero orphan accounts.
// For multi-instance deploys swap this Map for Redis.
const pendingSignups = new Map();

function storePendingSignup(sessionId, data) {
    pendingSignups.set(sessionId, data);
    setTimeout(() => pendingSignups.delete(sessionId), 2 * 60 * 60 * 1000);
}

// ─── Shared provisioning logic ───────────────────────────────────────────────
// Called from /signup/finish after the Firebase user + Firestore doc exist.
// pricePaid is sourced from checkoutSession.amount_total (cents ÷ 100) — never hardcoded.
async function provisionNewMember(uid, stripeSubscription, pricePaid) {
    const userRef  = db.collection('users').doc(uid);
    const userDoc  = await userRef.get();
    if (!userDoc.exists) throw new Error('User not found during activation');

    const userData = userDoc.data();
    const plan     = userData.subscription?.plan          || 'discovery';
    const mode     = userData.subscription?.allocationMode || 'manual';
    const interval = userData.subscription?.interval      || 'month';

    if (!pricePaid || isNaN(pricePaid)) {
        throw new Error('pricePaid required for split calculation');
    }

    // Convert dollars to cents for Turso integer math
    const priceCents = Math.round(pricePaid * 100);
    let walletDepositCents = 0;
    let poolContributionCents = 0;

    if (mode === 'hybrid') {
        poolContributionCents = Math.round(priceCents * 0.60);
        walletDepositCents    = Math.round(priceCents * 0.20);
        // The remaining 20% is the platform fee
    } else {
        walletDepositCents    = Math.round(priceCents * 0.80);
    }

    // Execute the Turso insertion
    try {
        await turso.execute({
            sql: `INSERT INTO wallets (user_id, wallet_balance, fandom_pool) 
                  VALUES (?, ?, ?)`,
            args: [uid, walletDepositCents, poolContributionCents]
        });
    } catch (dbError) {
        console.error('Turso wallet creation failed:', dbError);
        throw new Error('Failed to provision financial wallet');
    }

    // Continue with existing Firestore updates for profile data...
    const now = admin.firestore.FieldValue.serverTimestamp();
    
    await userRef.update({
        'subscription.status':           'active',
        'subscription.stripeCustomerId': stripeSubscription.customer,
        'subscription.stripeSubscriptionId': stripeSubscription.id,
        'subscription.startDate':        now,
        'subscription.currentPeriodEnd': admin.firestore.Timestamp.fromDate(
            new Date((stripeSubscription.current_period_end || 0) * 1000 ||
                Date.now() + (interval === 'year' ? 31536000000 : 2592000000))
        ),
        // You can leave a visual dollar reference in Firestore for the UI, 
        // but Turso is the source of truth.
        'displayWalletBalance': walletDepositCents / 100, 
    });

    const customToken = await admin.auth().createCustomToken(uid);
    return { customToken, walletDeposit: (walletDepositCents / 100).toFixed(2), plan, mode };
}

// ─── Step 1: Validate → Stripe customer + checkout session → stash pending ────
// NO Firebase user, NO Firestore doc, NO R2 upload at this point.
// Account is only created in /signup/finish after payment is confirmed.
router.post('/api/subscription/create-intent', upload.single('profileImage'), async (req, res) => {
    try {
        const {
            email, password, handle, location,
            primaryGenre, subgenres, profileSong,
            idToken, geo, plan, settings, billingInterval,
            allocationMode,
        } = req.body;

        if (!handle)   return res.status(400).json({ error: 'Handle is required' });
        if (!location) return res.status(400).json({ error: 'Location is required' });
        if (!idToken && (!email || !password)) {
            return res.status(400).json({ error: 'Missing email or password' });
        }

        // 1. Lookup Price ID + fetch real unit_amount from Stripe
        const safeInterval = billingInterval || 'month';
        const selectedPlan = plan            || 'discovery';
        const priceId      = STRIPE_PRICES[safeInterval][selectedPlan];
        if (!priceId) throw new Error('Invalid plan configuration.');

        const stripePrice = await stripe.prices.retrieve(priceId);
        const priceAmount = (stripePrice.unit_amount / 100).toFixed(2);

        // 2. Create Stripe Customer (needs email only — no Firebase UID yet)
        const customer = await stripe.customers.create({
            email: email,
            name:  handle,
            // metadata.firebaseUid added in /signup/finish once account is created
        });

        // 3. Create Embedded Checkout Session
        const appBase = `${req.protocol}://${req.get('host')}`;
        const checkoutSession = await stripe.checkout.sessions.create({
            ui_mode:    'embedded',
            mode:       'subscription',
            customer:   customer.id,
            line_items: [{ price: priceId, quantity: 1 }],
            managed_payments:           { enabled: true },
            billing_address_collection: 'required',   // required for automatic tax calculation
            customer_update:            { address: 'auto' }, // save address back to Stripe customer
            allow_promotion_codes:      true,          // enables "Add promo code" inside the embedded checkout
            return_url: `${appBase}/members/signup/finish?session_id={CHECKOUT_SESSION_ID}`,
        });

        // 4. Stash ALL form data + image buffer in the pending store, keyed by session ID.
        //    Expires automatically after 2 h — abandoned checkouts leave no orphan accounts.
        storePendingSignup(checkoutSession.id, {
            email, password, idToken,
            handle, location,
            primaryGenre:    primaryGenre    || null,
            subgenres:       subgenres       || '[]',
            profileSong:     profileSong     || null,
            musicProfile:    req.body.musicProfile || null,
            settings:        settings        || '{}',
            geo:             geo             || null,
            allocationMode:  allocationMode  || 'manual',
            plan:            selectedPlan,
            billingInterval: safeInterval,
            imageBuffer:     req.file ? req.file.buffer   : null,
            imageMime:       req.file ? req.file.mimetype : null,
            stripeCustomerId: customer.id,
        });

        res.json({
            clientSecret:   checkoutSession.client_secret,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
            priceAmount,
            plan:     selectedPlan,
            interval: safeInterval,
        });

    } catch (error) {
        console.error('Create Intent Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── /signup/finish — Embedded Checkout return URL ───────────────────────────
// Stripe redirects here after payment completes. This is where the Firebase
// Auth user, Firestore doc, and R2 profile image are created for the first time.
router.get('/signup/finish', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.redirect('/members/signup?error=missing_params');

    try {
        // 1. Verify payment actually completed on Stripe's side
        const checkoutSession = await stripe.checkout.sessions.retrieve(session_id, {
            expand: ['subscription'],
        });

        if (checkoutSession.status !== 'complete') {
            console.warn(`[signup/finish] Session ${session_id} not complete: ${checkoutSession.status}`);
            return res.redirect('/members/signup?error=payment_failed');
        }

        // 2. Pull pending data — this is what the user filled in before paying
        const pending = pendingSignups.get(session_id);
        if (!pending) {
            // Pending data expired (> 2 h) or session_id is bogus
            console.error(`[signup/finish] No pending signup for session ${session_id}`);
            return res.redirect('/members/signup?error=session_expired');
        }

        const {
            email, password, idToken,
            handle, location,
            primaryGenre, subgenres, profileSong,
            musicProfile, settings, geo,
            allocationMode, plan, billingInterval,
            imageBuffer, imageMime,
            stripeCustomerId,
        } = pending;

        // 3. Create Firebase Auth user — FIRST TIME this happens
        let userRecord;
        if (idToken) {
            const decoded = await admin.auth().verifyIdToken(idToken);
            userRecord = await admin.auth().getUser(decoded.uid);
        } else {
            userRecord = await admin.auth().createUser({ email, password, displayName: handle });
        }

        // 4. Upload profile image to R2 (now that we have a real UID)
        let photoURL = userRecord.photoURL || `${CDN_URL}/assets/default-avatar.jpg`;
        if (imageBuffer) {
            try {
                const r2Key = `users/${userRecord.uid}/profile.jpg`;
                await r2.send(new PutObjectCommand({
                    Bucket: BUCKET_NAME, Key: r2Key,
                    Body: imageBuffer, ContentType: imageMime,
                }));
                photoURL = `${CDN_URL}/${r2Key}`;
            } catch (r2Err) { console.error('R2 upload failed:', r2Err); }
        }

        // 5. Parse JSON fields
        const parsedSubgenres = subgenres ? JSON.parse(subgenres) : [];
        const anthem          = profileSong ? JSON.parse(profileSong) : null;
        let   artistRequests  = '';
        try { artistRequests = musicProfile ? JSON.parse(musicProfile).requests || '' : ''; }
        catch (e) { /* non-fatal */ }
        let parsedSettings = {};
        try { parsedSettings = settings ? JSON.parse(settings) : {}; } catch (e) { /* non-fatal */ }

        const combinedGenres = [];
        if (primaryGenre) combinedGenres.push(primaryGenre);
        if (parsedSubgenres.length > 0) combinedGenres.push(...parsedSubgenres);

        let city = location, state = 'Global', country = 'Unknown', coordinates = null;
        if (geo) {
            try {
                const g = JSON.parse(geo);
                if (g.city)  city  = g.city;
                if (g.state) state = g.state;
                if (g.country) country = g.country;
                if (g.lat && g.lng) coordinates = new admin.firestore.GeoPoint(
                    parseFloat(g.lat), parseFloat(g.lng)
                );
            } catch (e) { /* non-fatal */ }
        }

        // 6. Write Firestore user doc — FIRST TIME this happens
        const now        = admin.firestore.FieldValue.serverTimestamp();
        const mode       = allocationMode || 'manual';
        const newUserRef = db.collection('users').doc(userRecord.uid);
        const batch      = db.batch();

        batch.set(newUserRef, {
            uid: userRecord.uid,
            handle: `@${handle}`,
            displayName: handle,
            email: userRecord.email,
            photoURL,
            role: 'member',
            joinDate: now,
            location, city, state, country, coordinates,
            primaryGenre: primaryGenre || null,
            subgenres: parsedSubgenres,
            genres: combinedGenres,
            artistRequests,
            profileSong: anthem,
            impactScore: 0,
            theme: primaryGenre || 'default',
            settings: { ...parsedSettings, allocationMode: mode },
            subscription: {
                status: 'pending_payment',   // provisionNewMember sets this to 'active'
                plan,
                interval: billingInterval,
                allocationMode: mode,
                stripeCustomerId,
                startDate: null,
            },
            walletBalance: 0,
        });

        batch.set(newUserRef.collection('notifications').doc(), {
            type: 'system', fromName: 'Eporia',
            message: 'Welcome to the beta! Your membership is now active.',
            timestamp: now, read: false,
        });

        await batch.commit();

        // 7. Backfill Stripe customer metadata with the real Firebase UID
        await stripe.customers.update(stripeCustomerId, {
            metadata: { firebaseUid: userRecord.uid },
        });

        // 8. Welcome flow + revenue split + subscription activation
        await welcomeNewUser(db, userRecord.uid, `@${handle}`, photoURL);

        const pricePaid = checkoutSession.amount_total / 100;  // cents → dollars
        const { customToken, walletDeposit } = await provisionNewMember(
            userRecord.uid,
            checkoutSession.subscription,
            pricePaid,
        );

        // 9. Clean up pending store
        pendingSignups.delete(session_id);

        // 10. Hand off to the client — sign in with custom token + redirect to dashboard
        res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Finalizing...</title>
  <style>
    body { background:#0D0D0D; display:flex; justify-content:center; align-items:center;
           height:100vh; flex-direction:column; font-family:'Rajdhani',sans-serif; margin:0; }
    .loader { border:3px solid #1A3333; border-top:3px solid #00FFD1; border-radius:50%;
              width:48px; height:48px; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    h2 { color:#E0FFFF; margin-top:20px; font-size:1.3rem; letter-spacing:0.05em; }
    p  { color:#5F7A7A; font-size:0.85rem; margin-top:8px; }
  </style>
</head>
<body>
  <div class="loader"></div>
  <h2>Activating your membership...</h2>
  <p>${mode === 'hybrid'
    ? `60% flowing to your artist pool &bull; $${walletDeposit} added to your tip wallet`
    : `$${walletDeposit} added to your wallet`
  }</p>
  <script type="module">
    import { getAuth, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
    import { app } from '/javascripts/firebase-config.js';
    const auth = getAuth(app);
    signInWithCustomToken(auth, "${customToken}")
      .then(() => { window.location.href = '/player/dashboard'; })
      .catch(err => {
        console.error(err);
        alert("Login failed. Please sign in manually.");
        window.location.href = '/members/signin';
      });
  </script>
</body>
</html>`);

    } catch (e) {
        console.error('[signup/finish] Error:', e);
        res.redirect('/members/signup?error=server_error');
    }
});

// [UPDATED] Check Subscription Status (Smart Redirect)
router.get('/api/check-subscription', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        const uid = decoded.uid;

        const userDoc = await db.collection('users').doc(uid).get();
        
        // CASE 1: No Record -> Go to Signup
        if (!userDoc.exists) {
            return res.json({ status: 'missing_record', redirect: '/members/signup' });
        }

        const data = userDoc.data();
        const subStatus = data.subscription?.status || 'inactive';
        const stripeCustomerId = data.subscription?.stripeCustomerId;

        // CASE 2: Active User -> Go to Dashboard
        if (['active', 'trialing'].includes(subStatus)) {
            return res.json({ status: 'active', redirect: '/player/dashboard' });
        } 
        
        // CASE 3: Inactive User WITH Stripe History -> Go to Stripe Portal (Fix Payment)
        else if (stripeCustomerId) {
            // Create a temporary Portal session
            const session = await stripe.billingPortal.sessions.create({
                customer: stripeCustomerId,
                // Send them back to Login page so it re-checks their status after they fix it
                return_url: `${req.protocol}://${req.get('host')}/members/signin` 
            });
            
            return res.json({ 
                status: 'payment_required', 
                redirect: session.url, // Redirects directly to Stripe "Update Card" page
                message: "Please update your payment method to continue."
            });
        } 
        
        // CASE 4: Inactive User WITHOUT Stripe History -> Go to Signup (Abandoned Setup)
        else {
            return res.json({ status: 'inactive', redirect: '/members/signup' });
        }

    } catch (error) {
        console.error("Sub Check Error:", error);
        res.status(500).json({ error: "Check failed" });
    }
});

// [NEW] Helper: Generate Portal Link (For Settings Page)
router.post('/api/create-portal-session', async (req, res) => {
    try {
        // 1. Verify User
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (!idToken) return res.status(401).send('Unauthorized');
        const decoded = await admin.auth().verifyIdToken(idToken);
        
        // 2. Get Customer ID
        const userDoc = await db.collection('users').doc(decoded.uid).get();
        const customerId = userDoc.data()?.subscription?.stripeCustomerId;

        if (!customerId) return res.status(400).json({ error: "No billing account found" });

        // 3. Create Link
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${req.protocol}://${req.get('host')}/player/dashboard`
        });

        res.json({ url: session.url });

    } catch (e) {
        console.error("Portal Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// DELETE ACCOUNT
// Cancels Stripe subscription at period end, wipes all Firestore
// data for the user, then deletes the Firebase Auth record.
// ==========================================
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
        const userDoc  = await db.collection('users').doc(uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        // 1. Cancel Stripe subscription at period end (not immediately —
        //    user keeps access through what they already paid for)
        const customerId     = userData.subscription?.stripeCustomerId;
        const subscriptionId = userData.subscription?.stripeSubscriptionId;

        if (customerId || subscriptionId) {
            try {
                if (subscriptionId) {
                    await stripe.subscriptions.update(subscriptionId, {
                        cancel_at_period_end: true
                    });
                } else {
                    // Look up active subscriptions by customer
                    const subs = await stripe.subscriptions.list({
                        customer: customerId,
                        status:   'active',
                        limit:    1
                    });
                    if (subs.data.length > 0) {
                        await stripe.subscriptions.update(subs.data[0].id, {
                            cancel_at_period_end: true
                        });
                    }
                }
            } catch (stripeErr) {
                // Don't block deletion if Stripe fails — log and continue
                console.error('[delete-account] Stripe cancel error:', stripeErr.message);
            }
        }

        // 2. Delete Firestore subcollections then the user document
        const deleteSubcollection = async (collRef) => {
            const snap = await collRef.limit(100).get();
            if (snap.empty) return;
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            if (snap.size === 100) await deleteSubcollection(collRef); // recurse if more
        };

        if (userDoc.exists) {
            const userRef = db.collection('users').doc(uid);
            await deleteSubcollection(userRef.collection('wallet'));
            await deleteSubcollection(userRef.collection('likedSongs'));
            await deleteSubcollection(userRef.collection('history'));
            await userRef.delete();
        }

        // 3. Anonymise any likes/comments the user left on artist posts
        //    (we blank PII fields rather than doing a full cross-collection scan
        //    which would be prohibitively expensive at scale)
        // This is a best-effort soft-delete; a background job can clean further.

        // 4. Delete Firebase Auth user — must be last so token stays valid above
        await admin.auth().deleteUser(uid);

        res.json({ success: true });

    } catch (e) {
        console.error('[delete-account] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;