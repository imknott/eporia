
// ================================================================
//  EPORIA — LANDING PAGE INLINE SCRIPTS
//  public/javascripts/landing.js
// ================================================================
'use strict';

function animateStats() {
    const stats = document.querySelectorAll('.stat-number');
    stats.forEach(stat => {
        const target = parseInt(stat.getAttribute('data-target'));
        const duration = 2000;
        const increment = target / (duration / 16);
        let current = 0;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                stat.textContent = target + (target === 80 ? '%' : '');
                clearInterval(timer);
            } else {
                stat.textContent = Math.floor(current) + (target === 80 ? '%' : '');
            }
        }, 16);
    });
}

function updateEarnings() {
    const slider = document.getElementById('supporterCount');
    if (!slider) return;
    const supporterCount   = parseInt(slider.value);
    const membershipPrice  = 10;
    const artistShare      = 0.8;
    const spotifyPerStream = 0.003;

    document.getElementById('supporterDisplay').textContent = supporterCount;
    const supporterLabel = document.getElementById('supporterLabel');
    if (supporterLabel) supporterLabel.textContent = supporterCount === 1 ? 'superfan' : 'superfans';

    const oneSupporterPays    = membershipPrice * artistShare;
    const totalEporiaEarnings = supporterCount * oneSupporterPays;
    const streamsNeeded       = Math.round(totalEporiaEarnings / spotifyPerStream);
    const spotifyEarnings     = streamsNeeded * spotifyPerStream;
    const streamsPerSupporter = Math.round(oneSupporterPays / spotifyPerStream);

    document.getElementById('streamsNeeded').textContent     = streamsNeeded.toLocaleString();
    document.getElementById('spotifyEarning').textContent    = spotifyEarnings.toFixed(2);
    document.getElementById('eporiaSupporter').textContent   = supporterCount;
    document.getElementById('eporiaEarning').textContent     = totalEporiaEarnings.toFixed(2);
    document.getElementById('streamsMultiplier').textContent = streamsPerSupporter.toLocaleString();
}

function flickerNeon() {
    const flicker = document.querySelector('.neon-flicker');
    if (flicker) flicker.style.opacity = Math.random() > 0.9 ? '0.3' : '1';
}

function createParticles() {
    const container = document.querySelector('.hero-particles');
    if (!container) return;
    for (let i = 0; i < 30; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left              = Math.random() * 100 + '%';
        particle.style.top               = Math.random() * 100 + '%';
        particle.style.animationDelay    = Math.random() * 3 + 's';
        particle.style.animationDuration = (Math.random() * 3 + 2) + 's';
        container.appendChild(particle);
    }
}

function initCardHovers() {
    document.querySelectorAll('.feature-card').forEach(card => {
        card.addEventListener('mouseenter', function () { this.style.transform = 'translateY(-10px)'; });
        card.addEventListener('mouseleave', function () { this.style.transform = 'translateY(0)'; });
    });
}

function initPaymentTabs() {
    const tabs   = document.querySelectorAll('.payment-tab');
    const panels = document.querySelectorAll('.payment-panel');
    if (!tabs.length) return;
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.panel;
            tabs.forEach(t   => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panel = document.getElementById(target);
            if (panel) panel.classList.add('active');
        });
    });
}

function initRevenueFlow() {
    const fills = document.querySelectorAll('.flow-bar-fill');
    if (!fills.length) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.width = entry.target.dataset.width;
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.3 });
    fills.forEach(fill => { fill.style.width = '0'; observer.observe(fill); });
}

window.addEventListener('load', () => {
    setTimeout(animateStats, 500);
    updateEarnings();
    const slider = document.getElementById('supporterCount');
    if (slider) slider.addEventListener('input', updateEarnings);
    initCardHovers();
    initPaymentTabs();
    initRevenueFlow();
});

setInterval(flickerNeon, 100);
createParticles();