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
const adminRouter   = require('./routes/admin');
const storeRouter   = require('./routes/store');

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
            ],

            // ── Frames (Stripe payment iframe) ──────────────────────
            'frame-src': [
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
app.use('/',        indexRouter);
app.use('/members', usersRouter);
app.use('/members', locationAnalytics);
app.use('/artist',  artistRouter);
app.use('/player',  playerRouter);
app.use('/admin',   adminRouter);

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