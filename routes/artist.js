/* routes/artist.js */
var express = require('express');
var router = express.Router();
var multer = require('multer');
var path = require('path');

// --- MULTER CONFIG (Handles the MP3) ---
var storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'demo-' + uniqueSuffix + path.extname(file.originalname));
    }
});

var upload = multer({ 
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB Limit
});

// --- ROUTE 1: Artist Landing Page (/artist/) ---
router.get('/', function(req, res, next) {
  res.render('artist', { 
    title: 'For Artists | Eporia' 
  });
});

// --- ROUTE 2: The Application Form (/artist/apply) ---
router.get('/apply', function(req, res, next) {
  res.render('artist_signup', {
    title: 'Apply to Eporia'
  });
});

// --- ROUTE 3: API Endpoint for File Upload ---
// The frontend calls this. We save the file, then tell the frontend "Okay, save the rest to Firebase"
router.post('/upload-demo', upload.single('demoTrack'), function(req, res) {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    // Return the path relative to public (so we can play it later)
    const publicPath = '/uploads/' + req.file.filename;
    
    res.json({ 
        success: true, 
        filePath: publicPath 
    });
});

module.exports = router;