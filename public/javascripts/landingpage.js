import { GENRES } from './taxonomy.js';

// --- CITY DATA ---
const sceneData = {
    tokyo: {
        title: "Tokyo Scene", sub: "Pulse of Japan", back: "All Japan",
        color: "#FF6B6B",
        circles: [
            { name: "Tokyo", icon: "fa-torii-gate" }, 
            { name: "Osaka", icon: "fa-utensils" }, 
            { name: "Kyoto", icon: "fa-vihara" }
        ],
        playlists: [
            { name: "J-Pop Heat", sub: "Local Chart", color: "linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)" },
            { name: "Shibuya Night", sub: "Lo-Fi Beats", color: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)" },
            { name: "Underground", sub: "Tokyo Techno", color: "linear-gradient(135deg, #434343 0%, #000000 100%)" },
            { name: "City Pop", sub: "Retro Vibes", color: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)" }
        ]
    },
    berlin: {
        title: "Berlin Scene", sub: "Pulse of Germany", back: "All Germany",
        color: "#Feca57",
        circles: [
            { name: "Berlin", icon: "fa-archway" }, 
            { name: "Munich", icon: "fa-beer" }, 
            { name: "Hamburg", icon: "fa-ship" }
        ],
        playlists: [
            { name: "Techno Bunker", sub: "Berghain Ready", color: "linear-gradient(135deg, #0f0c29 0%, #302b63 100%)" },
            { name: "Berlin Indie", sub: "Local Chart", color: "linear-gradient(135deg, #fff1eb 0%, #ace0f9 100%)" },
            { name: "Deep House", sub: "Kreuzberg", color: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
            { name: "Deutschrap", sub: "Street Heat", color: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)" }
        ]
    },
    london: {
        title: "London Scene", sub: "Pulse of UK", back: "All UK",
        color: "#54a0ff",
        circles: [
            { name: "London", icon: "fa-landmark" }, 
            { name: "Manchester", icon: "fa-futbol" }, 
            { name: "Bristol", icon: "fa-spray-can" }
        ],
        playlists: [
            { name: "Grime Classics", sub: "East London", color: "linear-gradient(135deg, #0ba360 0%, #3cba92 100%)" },
            { name: "UK Jazz", sub: "New Wave", color: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)" },
            { name: "Britpop", sub: "Revival", color: "linear-gradient(135deg, #c2e9fb 0%, #a1c4fd 100%)" },
            { name: "Garage", sub: "UKG 2 Step", color: "linear-gradient(135deg, #fdcbf1 0%, #e6dee9 100%)" }
        ]
    },
    nashville: {
        title: "Nashville Scene", sub: "Pulse of TN", back: "All USA",
        color: "#ff9f43",
        circles: [
            { name: "Nashville", icon: "fa-guitar" }, 
            { name: "Memphis", icon: "fa-music" }, 
            { name: "Austin", icon: "fa-star" }
        ],
        playlists: [
            { name: "Country Gold", sub: "Broadway Hits", color: "linear-gradient(135deg, #f6d365 0%, #fda085 100%)" },
            { name: "Americana", sub: "Roots", color: "linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)" },
            { name: "Southern Rock", sub: "Classics", color: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)" },
            { name: "Music City", sub: "Indie Rock", color: "linear-gradient(135deg, #cfd9df 0%, #e2ebf0 100%)" }
        ]
    },
    mexico: {
        title: "CDMX Scene", sub: "Pulse of Mexico", back: "All Mexico",
        color: "#00d2d3",
        circles: [
            { name: "CDMX", icon: "fa-sun" }, 
            { name: "Guadalajara", icon: "fa-hat-cowboy" }, 
            { name: "Monterrey", icon: "fa-mountain" }
        ],
        playlists: [
            { name: "Reggaeton", sub: "Perreo", color: "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)" },
            { name: "Mariachi Mod", sub: "Fusion", color: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)" },
            { name: "Indie Mex", sub: "Local Chart", color: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
            { name: "Cumbia", sub: "Sonidero", color: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)" }
        ]
    }
};

document.addEventListener('DOMContentLoaded', () => {
    initBackgroundAnimation();
    setupStoryLogic();
    setupHeartLogic();
    setupGlobalScene();
    
    enableDragScroll(document.querySelector('.scene-circles'));
    enableDragScroll(document.querySelector('.scene-playlists'));

    // Intro Sequence
    const wallet = document.getElementById('walletContainer');
    if (wallet && window.innerWidth <= 900) wallet.classList.add('mobile-hidden'); 

    setTimeout(() => {
        const heroContent = document.getElementById('heroTextContainer');
        const heroVisual = document.querySelector('.hero-visual');
        if (heroContent) heroContent.classList.add('fade-out-collapse');
        setTimeout(() => {
            if (heroVisual) heroVisual.classList.add('fade-in-center');
        }, 600); 
    }, 2500); 
});

// --- HELPER: WALLET UI UPDATE ---
function animateWalletDrop() {
    const walletEl = document.getElementById('walletAmount');
    const walletBar = document.getElementById('walletBar');
    
    if(walletEl) {
        walletEl.style.transition = "transform 0.2s ease, color 0.2s ease";
        walletEl.style.transform = "scale(1.2)";
        walletEl.style.color = "#88C9A1"; // Green Pop
        
        setTimeout(() => {
            walletEl.innerText = "35.00";
            walletEl.style.transform = "scale(1)";
        }, 200);
    }
    if(walletBar) walletBar.style.width = "62%";
}

// --- TIP & STORY LOGIC ---
function setupStoryLogic() {
    const tipBtn = document.getElementById('replicaTipBtn');
    
    if (tipBtn) {
        tipBtn.addEventListener('click', () => {
            tipBtn.style.transform = "scale(0.95)";
            
            const hint = document.getElementById('clickHint');
            if(hint) hint.remove();

            // DESKTOP: Update immediately (Wallet is visible side-by-side)
            if (window.innerWidth > 900) {
                animateWalletDrop();
            }

            // TRIGGER TRANSITION
            setTimeout(() => triggerStageTransition('tip'), 400);
        });
    }
}

// --- TRANSITION CONTROLLER (SPLIT LOGIC) ---
function triggerStageTransition(type) {
    const isMobile = window.innerWidth <= 900;
    
    const phone = document.getElementById('phoneContainer');
    const wallet = document.getElementById('walletContainer');
    
    // Stages
    const stagePhone = document.getElementById('stagePhone');
    const stageCommunity = document.getElementById('stageCommunity');
    const stageProfile = document.getElementById('stageProfile'); // NEW
    const stageGlobal = document.getElementById('stageGlobal');
    
    const showFinalCTA = () => {
        const ctaHint = document.getElementById('finalCtaHint');
        if(ctaHint) ctaHint.classList.add('visible');
    };

    // Helper to add message to profile
    const triggerProfileMessage = () => {
        const feed = document.getElementById('wallFeed');
        if (feed) {
            feed.innerHTML = ''; // Clear prev
            setTimeout(() => {
                const msg = document.createElement('div');
                msg.className = 'wall-message-card';
                msg.innerHTML = `
                    <img src="https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100" class="message-avatar">
                    <div class="message-content">
                        <div class="message-header">
                            <span class="message-author">Neon Echoes</span>
                            <span class="message-time">Just now</span>
                        </div>
                        <p class="message-text">Hey @eporiadude, we saw your tip! You are the best!</p>
                    </div>
                `;
                feed.appendChild(msg);
            }, 800); // Delay message appearance slightly
        }
    };

    // --- SEQUENCE LOGIC ---
    // Common start: Phone interaction
    const startNextStages = () => {
        // 1. Move to MAP (4s)
        setTimeout(() => {
            stagePhone.classList.add('hidden');
            stageCommunity.classList.remove('hidden'); // Show Map
            
            // 2. Move to PROFILE (4s)
            setTimeout(() => {
                stageCommunity.classList.add('hidden');
                stageProfile.classList.remove('hidden'); // Show Profile
                triggerProfileMessage(); // Animate Message
                
                // 3. Move to GLOBAL (Final)
                setTimeout(() => {
                    stageProfile.classList.add('hidden');
                    stageGlobal.classList.remove('hidden'); // Show Global
                    setTimeout(showFinalCTA, 1000); 
                }, 7000); // Read time for profile message
            }, 4500); // Read time for map
        }, 1500); // Pause after tip
    };

    // Mobile specific: Hide phone, show wallet first
    if (isMobile) {
        phone.classList.add('element-hidden');
        setTimeout(() => {
            phone.style.display = 'none'; 
            wallet.classList.remove('mobile-hidden');
            wallet.style.opacity = 0;
            wallet.style.transform = 'translateY(20px)';
            
            requestAnimationFrame(() => {
                wallet.style.transition = 'all 0.5s ease';
                wallet.style.opacity = 1;
                wallet.style.transform = 'translateY(0)';
                
                if (type === 'tip') setTimeout(() => animateWalletDrop(), 600);
            });

            // Wait for wallet read, then enter main sequence
            setTimeout(startNextStages, 3000); 
        }, 500);
    } 
    // Desktop: Update wallet instantly, then start sequence
    else {
        startNextStages();
    }
}

// --- DRAG SCROLLING FIX ---
function enableDragScroll(el) {
    if (!el) return;
    let isDown = false;
    let startX, startY, scrollLeft, scrollTop;

    el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // STOP TEXT SELECTION
        isDown = true;
        el.style.cursor = 'grabbing';
        startX = e.pageX - el.offsetLeft;
        startY = e.pageY - el.offsetTop;
        scrollLeft = el.scrollLeft;
        scrollTop = el.scrollTop;
    });

    el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = 'grab'; });
    el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = 'grab'; });

    el.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault(); // STOP SELECTION
        const x = e.pageX - el.offsetLeft;
        const y = e.pageY - el.offsetTop;
        const walkX = (x - startX) * 2; 
        const walkY = (y - startY) * 2; 
        el.scrollLeft = scrollLeft - walkX;
        el.scrollTop = scrollTop - walkY;
    });
}

function setupGlobalScene() {
    const tags = document.querySelectorAll('.tag');
    
    function updateScene(cityKey) {
        const data = sceneData[cityKey];
        if(!data) return;

        document.getElementById('sceneTitle').innerText = data.title;
        document.getElementById('sceneSub').innerText = data.sub;
        const backPill = document.querySelector('.scene-back-pill');
        if(backPill) backPill.innerText = data.back;
        
        const circlesContainer = document.querySelector('.scene-circles');
        if (circlesContainer) {
            circlesContainer.innerHTML = ''; 
            data.circles.forEach((item, i) => {
                const div = document.createElement('div');
                const isActive = i === 0;
                div.className = `circle-item ${isActive ? 'active' : ''}`;
                div.innerHTML = `
                    <div class="circle-img">
                        <i class="fas ${item.icon}"></i>
                    </div>
                    <span>${item.name}</span>
                `;
                circlesContainer.appendChild(div);
            });
        }

        const grid = document.getElementById('sceneGrid');
        if (grid) {
            grid.innerHTML = '';
            data.playlists.forEach((pl, i) => {
                const card = document.createElement('div');
                card.className = 'playlist-card';
                card.style.animationDelay = `${i * 0.1}s`;
                card.innerHTML = `
                    <div class="playlist-art" style="background:${pl.color}">
                        <span>${pl.name.substring(0,3)}</span>
                    </div>
                    <div class="playlist-meta">
                        <span class="playlist-title">${pl.name}</span>
                        <span class="playlist-sub">${pl.sub}</span>
                    </div>
                `;
                grid.appendChild(card);
            });
        }

        tags.forEach(t => t.classList.remove('active'));
        const activeTag = document.querySelector(`.tag[data-city="${cityKey}"]`);
        if(activeTag) activeTag.classList.add('active');
    }

    tags.forEach(tag => {
        tag.addEventListener('click', (e) => {
            const city = e.target.dataset.city;
            updateScene(city);
        });
    });

    updateScene('tokyo');
}

function setupHeartLogic() {
    const heartBtn = document.querySelector('.replica-heart');
    const heartIcon = heartBtn ? heartBtn.querySelector('i') : null;
    if (heartBtn) {
        heartBtn.addEventListener('click', () => {
            heartIcon.classList.remove('far');
            heartIcon.classList.add('fas', 'liked');
            triggerStageTransition('heart');
        });
    }
}

function initBackgroundAnimation() {
    const container = document.getElementById('genreBg');
    if (!container) return;
    const tags = [];
    Object.values(GENRES).forEach(c => {
        tags.push(`#${c.name.split('/')[0].replace(/\s+/g, '')}`);
        c.subgenres.forEach(s => tags.push(`#${s.name.replace(/[^a-zA-Z]/g, '')}`));
    });

    setInterval(() => {
        const el = document.createElement('div');
        el.className = 'floating-tag';
        el.innerText = tags[Math.floor(Math.random() * tags.length)];
        el.style.left = Math.random() * 95 + '%';
        el.style.fontSize = (Math.random() * 1.5 + 1) + 'rem';
        el.style.animationDuration = (Math.random() * 10 + 15) + 's';
        container.appendChild(el);
        setTimeout(() => el.remove(), 25000);
    }, 2000);
}