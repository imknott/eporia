/* public/javascripts/artistProfile.js */

// --- TAB SWITCHING ---
window.switchTab = function(tabName) {
    // 1. Hide all contents
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(el => el.style.display = 'none');
    
    // 2. Remove 'active' from all buttons
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    // 3. Show target content
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    
    // 4. Set active button state (finding the one clicked is tricky without passing 'this', 
    // so we search by onclick attribute or just trust the user clicked the right one)
    // Simpler way: find button with matching onclick
    buttons.forEach(btn => {
        if(btn.getAttribute('onclick').includes(tabName)) {
            btn.classList.add('active');
        }
    });
};

// ... (Keep existing Toggle Follow and Tip Logic) ...
window.toggleFollow = function(btn) {
    if (btn.innerText === "Follow") {
        btn.innerText = "Following";
        btn.style.background = "#88C9A1"; 
        btn.style.color = "white";
    } else {
        btn.innerText = "Follow";
        btn.style.background = "white";
        btn.style.color = "#5C4B3D";
    }
};

window.openTipModal = function() {
    const amount = prompt("Enter tip amount:", "$5.00");
    if (amount) alert(`Thanks! You sent ${amount}`);
};