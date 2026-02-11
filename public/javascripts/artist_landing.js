// public/javascripts/artist_landing.js

document.addEventListener('DOMContentLoaded', () => {
    console.log("Eporia Artist Landing Initialized");

    // ==========================================
    // 1. REALITY CHECK CALCULATOR
    // ==========================================
    const slider = document.getElementById('incomeSlider');
    const incomeDisplay = document.getElementById('incomeValue');
    
    const spotifyStreamsDisplay = document.getElementById('spotifyStreams');
    const eporiaSubsDisplay = document.getElementById('eporiaSubs');
    const eporiaBar = document.getElementById('eporiaBar');
    const spotifyBar = document.getElementById('spotifyBar');

    // CONSTANTS
    const SPOTIFY_PAY_PER_STREAM = 0.003; // Industry avg for indie
    const EPORIA_PAY_PER_SUB = 8.00;      // 80% of $10

    function updateCalculator() {
        if (!slider) return;

        const goal = parseInt(slider.value);
        
        // Format Income Goal
        incomeDisplay.innerText = goal.toLocaleString();

        // Calculate Required Numbers
        const neededStreams = Math.ceil(goal / SPOTIFY_PAY_PER_STREAM);
        const neededSubs = Math.ceil(goal / EPORIA_PAY_PER_SUB);

        // Update Text
        spotifyStreamsDisplay.innerText = neededStreams.toLocaleString();
        eporiaSubsDisplay.innerText = neededSubs.toLocaleString();

        // Visual Logic: "Effort Bar"
        // We set Spotify as the "100% Grind".
        // Eporia's bar represents the relative number of people needed compared to streams.
        // Since 1 sub vs 2666 streams is a huge difference, a linear scale makes Eporia invisible.
        // Instead, we animate the bar to show "Efficiency".
        
        // Let's make the Eporia bar grow based on the Goal to show "Scaling Community"
        // And keep Spotify bar maxed out to show "Endless Grind".
        
        // Actually, a better visual is:
        // Spotify Bar = Always Full (Maximum Effort)
        // Eporia Bar = A tiny fraction, visualising how much "easier" it is.
        // But that might look like "less progress".
        
        // Let's invert the meaning for the visual: "Impact per User"
        // No, let's stick to the simple "Progress towards Goal" metaphor.
        // Both bars are "Full" because both achieve the $Goal.
        // The VISUAL IMPACT comes from the text numbers: 333,000 vs 125.
        
        // Let's add a "Pulse" effect to the Eporia number when it changes
        eporiaSubsDisplay.style.textShadow = "0 0 20px var(--primary)";
        setTimeout(() => {
             eporiaSubsDisplay.style.textShadow = "0 0 10px var(--primary-dim)";
        }, 200);
    }

    if (slider) {
        slider.addEventListener('input', updateCalculator);
        updateCalculator(); // Init
    }

    // ==========================================
    // 2. NEON FLICKER EFFECT
    // ==========================================
    const neonText = document.querySelector('.neon-text');
    
    function flickerNeon() {
        if (!neonText) return;
        // Randomly dim the opacity to create a flicker
        if (Math.random() > 0.95) {
            neonText.style.opacity = '0.5';
            setTimeout(() => {
                neonText.style.opacity = '1';
            }, 50);
        }
    }
    // Run flicker loop
    setInterval(flickerNeon, 1000); // Occasional flicker

    // ==========================================
    // 3. CYBERPUNK PARTICLES
    // ==========================================
    const particleContainer = document.querySelector('.hero-particles');
    
    function createParticles() {
        if (!particleContainer) return;
        
        // Clear existing
        particleContainer.innerHTML = '';

        for (let i = 0; i < 40; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            
            // Random positioning
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            
            // Random properties
            const size = Math.random() * 3 + 1; // 1px to 4px
            const duration = Math.random() * 5 + 3; // 3s to 8s float
            const delay = Math.random() * 5;

            // Style
            particle.style.cssText = `
                position: absolute;
                left: ${x}%;
                top: ${y}%;
                width: ${size}px;
                height: ${size}px;
                background: var(--primary);
                opacity: 0.6;
                border-radius: 50%;
                animation: floatUp ${duration}s linear infinite;
                animation-delay: -${delay}s;
                box-shadow: 0 0 ${size * 2}px var(--primary);
            `;
            
            particleContainer.appendChild(particle);
        }
    }

    createParticles();

    // ==========================================
    // 4. CARD HOVER TILT (Optional Polish)
    // ==========================================
    const cards = document.querySelectorAll('.feature-card');
    
    cards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Subtle tilt calculation
            const xMid = rect.width / 2;
            const yMid = rect.height / 2;
            
            const rotateX = ((y - yMid) / yMid) * -2; // Max 2deg tilt
            const rotateY = ((x - xMid) / xMid) * 2;

            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
            card.style.borderColor = 'var(--primary)';
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0)';
            card.style.borderColor = 'var(--border-color)';
        });
    });
});

// Add Keyframe for Particles if not in CSS
const styleSheet = document.createElement("style");
styleSheet.innerText = `
    @keyframes floatUp {
        0% { transform: translateY(0) scale(1); opacity: 0; }
        20% { opacity: 0.8; }
        80% { opacity: 0.6; }
        100% { transform: translateY(-100px) scale(0); opacity: 0; }
    }
`;
document.head.appendChild(styleSheet);