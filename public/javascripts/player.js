/* public/javascripts/player.js */

console.log("Eporia Real-Time Script Loaded");

window.isPlaying = false;
let syncInterval = null;

// --- COMMAND CENTER ---
window.sendCmd = function(action) {
    // FIX: Point to /player/send-command
    fetch('/player/send-command?action=' + action).catch(err => console.error(err));
};

// --- START/STOP SYNCING ---
function startSync() {
    if (syncInterval) clearInterval(syncInterval);
    
    syncInterval = setInterval(() => {
        // FIX: Point to /player/player-status
        fetch('/player/player-status')
            .then(res => res.json())
            .then(data => {
                updateProgressBar(data.position, data.duration);
            })
            .catch(err => console.error("Sync Error", err));
    }, 500);
}

// --- UPDATE UI ---
function updateProgressBar(current, total) {
    if (!total || total === 0) total = 1;
    const percentage = (current / total) * 100;
    
    const bar = document.getElementById('progressBar');
    const currText = document.getElementById('currentTime');
    const totText = document.getElementById('totalTime');

    if (bar) bar.style.width = percentage + "%";
    if (currText) currText.innerText = formatTime(current);
    if (totText) totText.innerText = formatTime(total);
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// --- INITIALIZE ---
startSync();

// --- BUTTONS ---
window.togglePlay = function() {
    const btn = document.getElementById('playBtn');
    if (window.isPlaying) {
        window.sendCmd('pause');
        if(btn) btn.innerHTML = "▶";
        window.isPlaying = false;
    } else {
        window.sendCmd('play');
        if(btn) btn.innerHTML = "⏸";
        window.isPlaying = true;
    }
};

window.playSong = function(url, title) {
    const encoded = encodeURIComponent(url);
    // FIX: Point to /player/send-command
    fetch('/player/send-command?action=load&url=' + encoded);
    
    document.querySelector('.song-info').innerText = title;
    document.getElementById('playBtn').innerHTML = "⏸";
    window.isPlaying = true;
};

window.toggleHeart = function() {
    const btn = document.getElementById('heartBtn');
    btn.classList.toggle('active');
};
window.sendTip = function() {
    const btn = document.querySelector('.tip-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = "<span>✓ Sent $1</span>";
    btn.style.color = "#fff";
    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.color = "";
    }, 2000);
};