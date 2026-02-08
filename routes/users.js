/* routes/users.js */
var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require("firebase-admin");

// [FIX 1] Load Environment Variables Immediately
require('dotenv').config();

// --- CONFIGURATION ---
const CDN_URL = process.env.R2_PUBLIC_URL || "https://cdn.eporiamusic.com";
const BUCKET_NAME = process.env.R2_BUCKET_NAME || "eporia-audio-vault";

// --- R2 & AWS SDK SETUP ---
const r2 = require('../config/r2'); 
const { PutObjectCommand } = require("@aws-sdk/client-s3");

// [FIX 2] Initialize Stripe with the real key (No placeholder fallback)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

// --- 1. FIREBASE SETUP ---
if (!admin.apps.length) {
    try {
        var serviceAccount = require("../serviceAccountKey.json");
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.log("Using Default Credentials (Cloud Run Mode)");
        try {
            admin.initializeApp({ projectId: "eporia" });
        } catch (initError) { console.error("Firebase Init Failed:", initError); }
    }
}
const db = admin.firestore();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ==========================================
// PUBLIC ROUTES
// ==========================================

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
            results.push({
                id: doc.id,
                title: data.title,
                artist: data.artistName || 'Unknown Artist',
                img: data.artUrl || `${CDN_URL}/assets/placeholder_art.jpg`, // [FIX] Use CDN
                audioUrl: data.audioUrl,
                duration: data.duration || 0
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
// ACCOUNT CREATION & PAYMENT
// ==========================================

router.post('/api/create-account', upload.single('profileImage'), async (req, res) => {
    try {
        const { 
            email, password, handle, location, 
            primaryGenre, subgenres, profileSong, 
            idToken, geo, plan, settings,billingInterval,
            allocationMode
        } = req.body;

        if (!handle) return res.status(400).json({ error: "Handle is required" });
        if (!location) return res.status(400).json({ error: "Location is required" });

        // 1. Create Auth User
        let userRecord;
        if (idToken) {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            userRecord = await admin.auth().getUser(decodedToken.uid);
        } else {
            if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
            userRecord = await admin.auth().createUser({ email, password, displayName: handle });
        }

        // 2. Handle Profile Image -> Cloudflare R2
        // [FIX] Use CDN variable
        let photoURL = userRecord.photoURL || `${CDN_URL}/assets/default-avatar.jpg`; 
        
        if (req.file) {
            try {
                const fileExt = req.file.mimetype.split('/')[1] || 'jpg';
                const r2Key = `profiles/${userRecord.uid}.${fileExt}`;
                const command = new PutObjectCommand({
                    Bucket: BUCKET_NAME, // [FIX] Use BUCKET_NAME constant
                    Key: r2Key,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype,
                });
                await r2.send(command);
                photoURL = `${CDN_URL}/${r2Key}`; // [FIX] Use CDN variable
            } catch (r2Error) { console.error("R2 Upload Failed:", r2Error); }
        }

        // 3. Parse JSON Data safely
        const parsedSubgenres = subgenres ? JSON.parse(subgenres) : [];
        const anthem = profileSong ? JSON.parse(profileSong) : null;
        
        let parsedSettings = {};
        try {
            parsedSettings = settings ? JSON.parse(settings) : {};
        } catch (e) { console.error("Settings parse error", e); }

        const combinedGenres = [];
        if (primaryGenre) combinedGenres.push(primaryGenre);
        if (parsedSubgenres.length > 0) combinedGenres.push(...parsedSubgenres);

        // Location Parsing
        let city = location;
        let state = "Global"; 
        let country = "Unknown";
        let coordinates = null;
        if (geo) {
            try {
                const geoData = JSON.parse(geo);
                if (geoData.city) city = geoData.city;
                if (geoData.state) state = geoData.state;
                if (geoData.country) country = geoData.country;
                if (geoData.lat && geoData.lng) {
                    coordinates = new admin.firestore.GeoPoint(parseFloat(geoData.lat), parseFloat(geoData.lng));
                }
            } catch (e) { }
        }

        // 4. Save User to Firestore (Pending Payment)
        const now = admin.firestore.FieldValue.serverTimestamp();
        const batch = db.batch();
        const newUserRef = db.collection('users').doc(userRecord.uid);
        
        const mode = allocationMode || 'manual';

        batch.set(newUserRef, {
            uid: userRecord.uid,
            handle: `@${handle}`,
            displayName: handle,
            email: userRecord.email,
            photoURL: photoURL,
            role: 'member', 
            joinDate: now,
            location: location, 
            city: city, state: state, country: country, coordinates: coordinates,
            primaryGenre: primaryGenre || null,
            subgenres: parsedSubgenres, 
            genres: combinedGenres,
            profileSong: anthem,
            impactScore: 0,
            theme: primaryGenre || 'default',
            
            settings: {
                ...parsedSettings,
                allocationMode: mode 
            },
            
            subscription: {
                status: 'pending_payment',
                plan: plan || 'discovery',
                interval: billingInterval || 'month', // [NEW] Save the interval
                allocationMode: mode,
                startDate: null
            },
            
            // Wallet starts at 0, funded in /signup/finish
            walletBalance: 0 
        });

        // Add Notification
        const notifRef = newUserRef.collection('notifications').doc();
        batch.set(notifRef, {
            type: 'system',
            fromName: 'Eporia',
            message: 'Welcome to the beta! Your subscription is being processed.',
            timestamp: now,
            read: false
        });

        await batch.commit();

        // 5. Create Stripe Checkout Session (The Pro Way)
        const safeInterval = billingInterval || 'month';
        const selectedPlan = plan || 'discovery';
        
        // Lookup the correct Price ID
        const priceId = STRIPE_PRICES[safeInterval][selectedPlan];

        if (!priceId) {
            console.error(`Missing Price ID for ${selectedPlan} / ${safeInterval}`);
            throw new Error("Invalid plan configuration.");
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'cashapp', 'us_bank_account', 'link'],
            allow_promotion_codes: true,
            line_items: [{
                price: priceId, // [FIX] Pass the ID directly
                quantity: 1,
            }],
            mode: 'subscription',
            client_reference_id: userRecord.uid,
            success_url: `${req.protocol}://${req.get('host')}/members/signup/finish?session_id={CHECKOUT_SESSION_ID}&uid=${userRecord.uid}`,
            cancel_url: `${req.protocol}://${req.get('host')}/members/signup?error=cancelled`,
        });

        res.json({ success: true, paymentUrl: session.url });
    } catch (error) {
        console.error("Signup Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- FINALIZE SIGNUP (The Funding Logic) ---
router.get('/signup/finish', async (req, res) => {
    const { session_id, uid } = req.query;

    if (!session_id || !uid) {
        return res.redirect('/members/signup?error=missing_params');
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status !== 'paid') {
            return res.redirect('/members/signup?error=payment_failed');
        }

        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) throw new Error("User not found during activation");
        
        const userData = userDoc.data();
        const plan = userData.subscription?.plan || 'discovery';
        const mode = userData.subscription?.allocationMode || 'manual';
        // [NEW] Get the interval (default to month if missing)
        const interval = userData.subscription?.interval || 'month'; 

        // 1. Define Pricing Logic
        // Monthly Base
        const MONTHLY_RATES = { discovery: 7.99, supporter: 12.99, champion: 24.99 };
        
        // Yearly Rates (10% discount applied: Monthly * 12 * 0.9)
        const YEARLY_RATES = { discovery: 86.29, supporter: 140.29, champion: 269.89 };

        // Determine actual price paid based on interval
        const pricePaid = interval === 'year' ? YEARLY_RATES[plan] : MONTHLY_RATES[plan];
        
        let walletDeposit = 0;

        // 2. Calculate Credits (The "Accounting" Part)
        if (mode === 'manual') {
            // MANUAL: User gets 80% of what they paid to distribute
            // If Year: They get ~$69.03 immediately to spend over the year
            // If Month: They get ~$6.39
            walletDeposit = Number((pricePaid * 0.80).toFixed(2));
        } else {
            // AUTO: User gets 0 direct credits (System handles it)
            // 70% goes to Community Pool tracking
            const poolContribution = Number((pricePaid * 0.70).toFixed(2));
            
            // Log to community pool stats
            await db.collection('stats').doc('community_pool').set({
                total: admin.firestore.FieldValue.increment(poolContribution),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            walletDeposit = 0; 
        }

        // 3. Update User Record
        await userRef.update({
            'subscription.status': 'active',
            'subscription.stripeCustomerId': session.customer,
            'subscription.startDate': admin.firestore.FieldValue.serverTimestamp(),
            'subscription.currentPeriodEnd': admin.firestore.Timestamp.fromDate(
                new Date(Date.now() + (interval === 'year' ? 31536000000 : 2592000000)) // +1 year or +1 month
            ),
            'walletBalance': walletDeposit
        });

        const customToken = await admin.auth().createCustomToken(uid);

        res.send(`
            <html>
                <head>
                    <title>Finalizing...</title>
                    <link rel='stylesheet' href='/stylesheets/layout.css'>
                    <style>
                        body { background: #FDFCF5; display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column; font-family: 'Nunito', sans-serif; }
                        .loader { border: 4px solid #eee; border-top: 4px solid #88C9A1; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>
                <body>
                    <div class="loader"></div>
                    <h2 style="color:#5C4B3D; margin-top:20px;">Allocating your credits...</h2>
                    <p style="color:#888; font-size:0.9rem;">
                        ${interval === 'year' ? 'Annual credits applied:' : 'Adding to wallet:'} 
                        <strong>$${walletDeposit}</strong>
                    </p>
                    <script type="module">
                        import { getAuth, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
                        import { app } from '/javascripts/firebase-config.js';
                        
                        const auth = getAuth(app);
                        signInWithCustomToken(auth, "${customToken}").then(() => {
                            window.location.href = '/player/dashboard';
                        }).catch(err => {
                            console.error(err);
                            alert("Login failed. Please log in manually.");
                            window.location.href = '/members/signin';
                        });
                    </script>
                </body>
            </html>
        `);

    } catch (e) {
        console.error("Finish Signup Error:", e);
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

module.exports = router;