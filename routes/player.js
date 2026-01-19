var express = require('express');
var router = express.Router();

// --- THE SHARED BRAIN (Server Memory) ---
// This persists as long as the server is running
let commandMailbox = null; 
let songUrlMailbox = null;

let playerState = {
    position: 0,
    duration: 1,
    isPlaying: false
};

// --- ROUTE 1: The Dashboard (UI) ---
router.get('/dashboard', (req, res) => {
    res.render('player');
});

// --- ROUTE 2: Browser Sends Command ---
router.get('/send-command', (req, res) => {
    const action = req.query.action;
    const url = req.query.url;

    if (action) {
        commandMailbox = action;
        if (url) songUrlMailbox = url;
        
        // Optimistic Update for UI responsiveness
        if (action === 'play') playerState.isPlaying = true;
        if (action === 'pause') playerState.isPlaying = false;
        
        console.log("MAILBOX: Received command -> " + action);
        res.send("OK");
    } else {
        res.status(400).send("No action specified");
    }
});

// --- ROUTE 3: C++ Polls for Commands & Reports Status ---
router.get('/poll-command', (req, res) => {
    
    // 1. Capture Stats from C++ (Piggybacking)
    if (req.query.pos) {
        playerState.position = parseFloat(req.query.pos);
        playerState.duration = parseFloat(req.query.len);
    }

    // 2. Deliver Mail
    if (commandMailbox) {
        res.json({ action: commandMailbox, url: songUrlMailbox });
        // Clear mailbox after delivery
        commandMailbox = null; 
    } else {
        res.json({ action: "none" });
    }
});

// --- ROUTE 4: Browser Asks for Status (Progress Bar) ---
router.get('/player-status', (req, res) => {
    res.json(playerState);
});

module.exports = router;