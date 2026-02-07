/* routes/users.js */
var express = require('express');
var router = express.Router();
var multer = require('multer');
var admin = require("firebase-admin");

// [FIX 1] Load Environment Variables Immediately
require('dotenv').config();

// --- R2 & AWS SDK SETUP ---
const r2 = require('../config/r2'); 
const { PutObjectCommand } = require("@aws-sdk/client-s3");

// [FIX 1] Initialize Stripe with the real key (No placeholder fallback)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

// --- [FIX 4] PUBLIC SONG SEARCH (For Anthem Selection) ---
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
                img: data.artUrl || 'https://via.placeholder.com/150',
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
            idToken, geo, plan, settings,
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
        let photoURL = userRecord.photoURL || "https://cdn.eporiamusic.com/assets/default-avatar.jpg"; 
        if (req.file) {
            try {
                const fileExt = req.file.mimetype.split('/')[1] || 'jpg';
                const r2Key = `profiles/${userRecord.uid}.${fileExt}`;
                const command = new PutObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: r2Key,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype,
                });
                await r2.send(command);
                photoURL = `https://cdn.eporiamusic.com/${r2Key}`;
            } catch (r2Error) { console.error("R2 Upload Failed:", r2Error); }
        }

        // 3. Parse JSON Data safely
        const parsedSubgenres = subgenres ? JSON.parse(subgenres) : [];
        const anthem = profileSong ? JSON.parse(profileSong) : null;
        
        // [FIX 2] Parse settings properly to avoid "undefined" crash
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
            theme:primaryGenre,
            
            settings: {
                ...parsedSettings,
                allocationMode: mode 
            },
            
            subscription: {
                status: 'pending_payment', 
                plan: plan || 'discovery',
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

        // 5. Create Stripe Checkout Session
        const PLAN_PRICES = {
            'discovery': 799,
            'supporter': 1299,
            'champion': 2499
        };
        const amount = PLAN_PRICES[plan] || 799; 
        const planName = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Discovery';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Eporia ${planName} Membership`,
                        description: 'Monthly subscription for fair-trade streaming.',
                    },
                    unit_amount: amount,
                    recurring: { interval: 'month' },
                },
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

// --- [FIX 3] FINALIZE SIGNUP (The Funding Logic) ---
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

        // [CRITICAL] Calculate Initial Wallet Balance
        const PLAN_PRICES = { 
            'discovery': 7.99, 
            'supporter': 12.99, 
            'champion': 24.99 
        };
        const price = PLAN_PRICES[plan] || 7.99;
        
        // Manual = 80% user allocation (20% fee)
        // Auto = 70% user allocation (30% fee)
        const userShare = mode === 'manual' ? 0.80 : 0.70;
        const initialBalance = Number((price * userShare).toFixed(2));

        await userRef.update({
            'subscription.status': 'active',
            'subscription.stripeCustomerId': session.customer,
            'subscription.startDate': admin.firestore.FieldValue.serverTimestamp(),
            'walletBalance': initialBalance 
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
                    <p style="color:#888; font-size:0.9rem;">Adding $${initialBalance} to your wallet</p>
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

module.exports = router;