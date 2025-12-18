import { db } from './firebase-config.js';
import {
    doc, onSnapshot, updateDoc, increment, setDoc, getDoc, collection, addDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- INITIALIZE ALL UI LOGIC ---
const init = () => {
    console.log("Eporia UI Initializing...");

    // 1. REVEAL ANIMATIONS
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('active');
        });
    }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

    // 2. NAVBAR & MENU
    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.nav-links');
    if (menuToggle && navLinks) {
        menuToggle.onclick = () => {
            menuToggle.classList.toggle('is-active');
            navLinks.classList.toggle('active');
        };
    }

    // 3. NAVBAR SCROLL SPY
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('section');
    const navObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                navItems.forEach((link) => link.classList.remove('active'));
                const id = entry.target.getAttribute('id');
                const activeLink = document.querySelector(`.nav-item[href="#${id}"]`);
                if (activeLink) activeLink.classList.add('active');
            }
        });
    }, { threshold: 0.4 });
    sections.forEach((section) => { if (section.id) navObserver.observe(section); });

    // 4. WAITLIST LOGIC
    const waitlistForm = document.getElementById('waitlist-form');
    if (waitlistForm) {
        waitlistForm.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(waitlistForm);
            const email = formData.get('email')?.toLowerCase().trim();
            const name = formData.get('name');
            try {
                const userDocRef = doc(db, "waitlist_users", email);
                const userSnap = await getDoc(userDocRef);
                if (userSnap.exists()) return alert("Already on the list!");
                
                await setDoc(userDocRef, { name, email, timestamp: new Date().toISOString() });
                await updateDoc(doc(db, "stats", "waitlist"), { count: increment(1) });
                
                document.querySelector('.hero-form').innerHTML = `<div class="success-state"><h3>Welcome, ${name}!</h3></div>`;
            } catch (err) { console.error("Waitlist Error:", err); }
        };
    }

    // 5. CONTACT FORM (The 304/URL bug fix)
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.onsubmit = async (e) => {
            e.preventDefault();
            e.stopPropagation(); // Stops the URL from changing
            const btn = contactForm.querySelector('button');
            btn.disabled = true;
            btn.innerText = 'Sending...';

            try {
                const formData = new FormData(contactForm);
                await addDoc(collection(db, "contact_messages"), {
                    name: formData.get('contactName'),
                    email: formData.get('contactEmail'),
                    message: formData.get('contactMessage'),
                    timestamp: new Date().toISOString()
                });
                btn.innerHTML = '✓ Sent';
                contactForm.reset();
            } catch (err) { console.error("Contact Error:", err); btn.disabled = false; }
        };
    }

    // 6. CALCULATOR
    const slider = document.getElementById('monthSlider');
    const display = document.getElementById('monthDisplay');
    const amount = document.getElementById('totalAmount');
    if (slider) {
        slider.oninput = function() {
            if (display) display.innerHTML = `${this.value} Months`;
            if (amount) amount.innerHTML = (this.value * 8).toFixed(2);
        };
    }
    
    // 7. HEART & TIPS
    initSocialFeatures();
};

// Initialize Tip Simulator and Heart
function initSocialFeatures() {
    const heartBtn = document.getElementById('main-heart');
    if (heartBtn) {
        heartBtn.onclick = () => heartBtn.classList.toggle('is-active');
    }

    const tips = [{name: "@jak", amt: 1}, {name: "@sophia", amt: 5}]; // Simplified for example
    let idx = 0;
    const toast = document.getElementById('tip-toast');
    const tipText = document.getElementById('tip-text');

    if (toast && tipText) {
        setInterval(() => {
            tipText.innerText = `${tips[idx].name} tipped $${tips[idx].amt}`;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
            idx = (idx + 1) % tips.length;
        }, 7500);
    }
}

// CRITICAL: Run everything after DOM is fully ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}