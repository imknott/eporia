/* routes/artist.js - Main Router Hub */
const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
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


module.exports = router;