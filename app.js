var createError   = require('http-errors');
var express       = require('express');
var path          = require('path');
var cookieParser  = require('cookie-parser');
var logger        = require('morgan');
var cors          = require('cors');
var helmet        = require('helmet');

// ==========================================
// ROUTERS
// ==========================================
var indexRouter      = require('./routes/index');
var usersRouter      = require('./routes/users');
var artistRouter     = require('./routes/artist');
var playerRouter     = require('./routes/player');
var locationAnalytics = require('./routes/locationAnalytics');
const guestMsgRouter = require('./routes/guestMessages');
const adminData = require('./routes/admin');
const adminRouter = adminData.router; // Extract the router from the object
const storeRouter   = require('./routes/store');
const publicProfilesRoutes = require('./routes/public_profiles');


var app = express();

// ==========================================
// VIEW ENGINE
// ==========================================
app.set('views',       path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// ==========================================
// SECURITY HEADERS  (must be FIRST — before routes)
//
// Helmet's default CSP blocks virtually everything the app uses:
// Firebase, CDNjs, Google Fonts, Stripe, Essentia.js, Tone.js,
// and any inline <script> blocks.  We configure each directive
// to explicitly allow the domains we need.
//
// 'unsafe-inline' for script-src is required because:
//   - users.js sends an HTML page with an inline <script> that
//     calls signInWithCustomToken after Stripe checkout.
//   - Several Pug templates contain inline script/style blocks.
// Everything else in Helmet (HSTS, X-Frame-Options, etc.) still
// applies and is unchanged from defaults.
// ==========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            // ── Scripts ─────────────────────────────────────────────
            'script-src': [
                "'self'",
                "'unsafe-inline'",          // inline <script> blocks in pug / users.js
                'https://www.gstatic.com',  // Firebase JS SDK
                'https://apis.google.com',  // Firebase Auth popup support
                'https://cdnjs.cloudflare.com', // Font Awesome, Cropper.js, etc.
                'https://cdn.jsdelivr.net', // Essentia.js / other CDN libs
                'https://cdn.skypack.dev',  // legacy — kept for any other skypack imports
                'https://esm.sh',           // Tone.js (audioEngine.js + workbenchController.js)
                'https://unpkg.com',        // maplibre-gl (citySoundscapeMap.js)
                'https://js.stripe.com',    // Stripe.js checkout
                // Cloudflare Web Analytics — injected automatically by Cloud Run
                'https://static.cloudflareinsights.com',
            ],

            // ── Styles ──────────────────────────────────────────────
            'style-src': [
                "'self'",
                "'unsafe-inline'",              // inline style="" attributes
                'https://fonts.googleapis.com', // Google Fonts stylesheet
                'https://cdnjs.cloudflare.com', // Font Awesome CSS
                'https://unpkg.com',            // maplibre-gl CSS (citySoundscapeMap.js)
            ],

            // ── Fonts ───────────────────────────────────────────────
            'font-src': [
                "'self'",
                'data:',
                'https://fonts.gstatic.com',    // Google Fonts files
                'https://cdnjs.cloudflare.com', // Font Awesome webfonts
            ],

            // ── Images ──────────────────────────────────────────────
            // Allow https: broadly so R2 CDN, placeholder services,
            // and any artist-uploaded art loads without listing every domain.
            'img-src': [
                "'self'",
                'data:',
                'blob:',
                'https:',
            ],

            'connect-src': [
                "'self'",
                // Firebase Auth & Firestore REST
                'https://*.googleapis.com',
                'https://*.firebaseio.com',
                'https://firebase.googleapis.com',
                'https://identitytoolkit.googleapis.com',
                'https://securetoken.googleapis.com',
                // Firestore realtime listener (WebSocket)
                'wss://*.firebaseio.com',
                // Firebase SDK source maps (fetched by browser devtools)
                'https://www.gstatic.com',
                // Stripe API calls made from the client
                'https://api.stripe.com',
                // R2 CDN (direct audio/image fetches)
                'https://cdn.eporiamusic.com',
                'https://*.r2.dev',
                // Tone.js ES module fetch (audioEngine + workbenchController)
                'https://esm.sh',
                // maplibre-gl fetch + tile glyph requests (citySoundscapeMap.js)
                'https://unpkg.com',
                'https://demotiles.maplibre.org',
                // OpenStreetMap raster tiles — MapLibre fetches these as ArrayBuffers
                // via XHR/fetch, so connect-src is required (img-src does nothing here)
                'https://a.tile.openstreetmap.org',
                'https://b.tile.openstreetmap.org',
                'https://c.tile.openstreetmap.org',
                // CARTO dark-matter tiles — used by citySoundscapeMap.js for the dark theme map
                'https://a.basemaps.cartocdn.com',
                'https://b.basemaps.cartocdn.com',
                'https://c.basemaps.cartocdn.com',
                'https://d.basemaps.cartocdn.com',
                // Cloudflare Web Analytics beacon POST endpoint
                'https://cloudflareinsights.com',
                // Photon by Komoot — free location autocomplete (artist signup)
                'https://photon.komoot.io',
            ],

            // ── Frames (Stripe payment iframe) ──────────────────────
            'frame-src': [
                "'self'",                   // local iframes e.g. /legal/terms, /legal/privacy
                'https://js.stripe.com',
                'https://hooks.stripe.com',
            ],

            // ── Audio / Video (R2-hosted tracks) ────────────────────
            'media-src': [
                "'self'",
                'blob:',
                'https:',
            ],

            // ── Web Workers (audio worklets, WASM) ──────────────────
            'worker-src': [
                "'self'",
                'blob:',
            ],

            // ── WASM (Essentia.js) ───────────────────────────────────
            'script-src-attr': ["'unsafe-inline'"],

            // ── Default fallback ────────────────────────────────────
            'default-src': ["'self'"],

            // ── Object / base restrictions ───────────────────────────
            'object-src':  ["'none'"],
            'base-uri':    ["'self'"],
        },
    },

    // Allow R2 CDN resources to load cross-origin
    crossOriginResourcePolicy:   { policy: 'cross-origin' },
    crossOriginEmbedderPolicy:   false, // COEP breaks Firebase popups
}));

// ==========================================
// CORS
// ==========================================
app.use(cors({
    origin:         process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ==========================================
// LOGGING & STATIC
// ==========================================
app.use(logger('dev'));
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// CRITICAL: Mount the store router BEFORE express.json()
//
// Why: The Stripe webhook at POST /store/webhook needs the raw
// request body as a Buffer so stripe.webhooks.constructEvent()
// can verify the signature.  express.json() consumes and parses
// the body stream, leaving nothing for express.raw() inside the
// route handler.  Mounting the store router first lets its own
// express.raw() middleware run before the global JSON parser.
//
// All other /store routes (GET pages, API endpoints) don't send
// a JSON body from the browser, so they're unaffected.
// ==========================================
app.use('/store', storeRouter);

// ==========================================
// GLOBAL JSON PARSER  (after store router)
// ==========================================
app.use(express.json());

// ==========================================
// ALL OTHER ROUTES
// ==========================================
// ==========================================
// ROOT REDIRECT — Dashboard is now the primary entry point.
// The marketing landing page stays accessible at /landing
// for organic search, referral links, and artist onboarding.
// A direct GET / just bounces straight into the experience.
// ==========================================
app.get('/', (req, res) => res.redirect('/player/dashboard'));
app.use('/landing', indexRouter);  // landing page still reachable
app.use('/',        indexRouter);  // handles /privacy, /terms, /about, etc.
app.use('/members', usersRouter);
app.use('/members', locationAnalytics);
app.use('/artist',  artistRouter);
app.use('/player',  playerRouter);
app.use('/admin', adminRouter);
app.use('/api', guestMsgRouter);


// ==========================================
// PUBLIC PROFILE ROUTES  (no auth required)
// /artist/:slug  → public artist profile page
// /u/:handle     → public user profile page
// /api/public/*  → JSON API for profile data
//
// Must be mounted AFTER /artist router so that authenticated
// routes like /artist/studio are matched first. Unmatched
// /artist/:slug requests fall through to this router.
// ==========================================
const admin = require('firebase-admin');
const CDN_URL = (() => {
    const raw = process.env.R2_PUBLIC_URL || 'https://cdn.eporiamusic.com';
    return raw.startsWith('http') ? raw : `https://${raw}`;
})();
app.use('/', publicProfilesRoutes(admin.apps.length ? admin.firestore() : null, CDN_URL));


// ==========================================
// 404 HANDLER
// ==========================================
app.use(function (req, res, next) {
    next(createError(404));
});

// ==========================================
// ERROR HANDLER
// ==========================================
app.use(function (err, req, res, next) {
    res.locals.message = err.message;
    res.locals.error   = req.app.get('env') === 'development' ? err : {};
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;