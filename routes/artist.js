/* routes/artist.js - Main Router Hub */
const express = require('express');
const router = express.Router();
const admin = require("firebase-admin");

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
if (!admin.apps.length) {
    if (process.env.K_SERVICE) {
        admin.initializeApp(); 
        console.log("Firebase initialized via Auto-Detection (Cloud Run Mode)");
    } else {
        try {
            const serviceAccount = require("../serviceAccountKey.json");
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } catch (e) {
            console.error("Local Init Failed:", e.message);
        }
    }
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

router.use('/', loginRouter);
router.use('/', signupRouter);
router.use('/', studioRouter);
router.use('/',commentRouter);
router.use("/", uploadRouter);
router.use("/" ,followRouter);
router.use('/',settingsRouter);
router.use('/', merchRouter);
module.exports = router;