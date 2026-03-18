/* routes/artist.js - Main Router Hub */
const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

// ==========================================
// IMPORT & MOUNT SUB-ROUTERS
// ==========================================
const loginRouter = require('./artist/login');
const signupRouter = require('./artist/signup');
const studioRouter = require('./artist/studio');
const commentRouter = require("./artist/comments");
const tipRouter = require("./artist/tips");
const settingsRouter = require('./artist/settings');
const followRouter = require("./artist/follows");
const uploadRouter = require("./artist/upload");
const merchRouter  = require("./artist/merch");
const distroRouter = require('./artist/distro');
const themeRouter  = require('./artist/studio_theme');   // ← NEW


router.use('/', loginRouter);
router.use('/', signupRouter);
router.use('/', studioRouter);
router.use('/',commentRouter);
router.use("/", uploadRouter);
router.use("/" ,followRouter);
router.use('/',settingsRouter);
router.use('/', merchRouter);
router.use('/', distroRouter);
router.use('/' ,tipRouter);
router.use('/', themeRouter);   // ← NEW


module.exports = router;