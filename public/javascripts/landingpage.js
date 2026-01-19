import { db } from './firebase-config.js';
import {
    doc, onSnapshot, updateDoc, increment, setDoc, getDoc, collection, addDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * 1. REVEAL ANIMATIONS (Must run first)
 */
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
        }
    });
}, { threshold: 0.15 });

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

/**
 * 2. UI ELEMENT SELECTIONS
 */
const waitlistForm = document.getElementById('waitlist-form');
const counterElement = document.querySelector('.badge');
const slider = document.getElementById('monthSlider');
const display = document.getElementById('monthDisplay');
const amount = document.getElementById('totalAmount');

/**
 * 3. REAL-TIME WAITLIST COUNTER
 */
const waitlistRef = doc(db, "stats", "waitlist");
let currentDisplayedCount = 0;

onSnapshot(waitlistRef, (docSnap) => {
    if (docSnap.exists() && counterElement) {
        const targetCount = docSnap.data().count;
        const textSpan = document.getElementById('waitlist-text');

        // Simple update if odometer isn't needed, or keep your logic:
        const formatted = new Intl.NumberFormat().format(targetCount);
        const displayText = `Join the ${formatted}+ on the waitlist`;

        if (textSpan) textSpan.innerText = displayText;
        else counterElement.innerText = displayText;
    }
}, (error) => {
    console.error("Counter Error:", error);
});

/**
 * 4. WAITLIST FORM SUBMISSION
 */
if (waitlistForm) {
    waitlistForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(waitlistForm);
        const email = formData.get('email')?.toLowerCase().trim();
        const name = formData.get('name');
        const interest = formData.get('interest');

        if (!email) return;

        try {
            const userDocRef = doc(db, "waitlist_users", email);
            
            // REMOVED: const userSnap = await getDoc(userDocRef); 
            // REMOVED: if (userSnap.exists()) ...

            // DIRECT WRITE
            // If email exists, this is an "Update", which rules deny.
            // If email is new, this is a "Create", which rules allow.
            await setDoc(userDocRef, {
                name: name,
                email: email,
                interest: interest,
                timestamp: new Date().toISOString()
            });

            // Update Counter (Allowed because rules allow update on 'stats')
            await updateDoc(waitlistRef, {
                count: increment(1)
            });
            // Success State UI
            const formParent = document.querySelector('.hero-form');
            if (formParent) {
                formParent.innerHTML = `
                <div class="success-state">
                <div class="success-icon">✓</div>
                <h3>Welcome to the Revolution!</h3>
                <p>You're officially on the list, <strong>${name}</strong>.</p>
                <p style="font-size: 0.9rem; margin-top: 15px; opacity: 0.7;">
                Check your inbox soon for your Founding Member status.
                </p>
                </div>`;
            }
        } catch (error) {
            console.error("Signup Error:", error.code);
            
            if (error.code === 'permission-denied') {
                alert("You are already on the waitlist!");
            } else {
                alert("Submission failed. Please try again.");
            }
        }
    });
}

/**
 * 5. NAVIGATION & CALCULATOR
 */
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');

if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
        menuToggle.classList.toggle('is-active');
        navLinks.classList.toggle('active');
    });
}

if (slider) {
    slider.oninput = function () {
        if (display) display.innerHTML = `${this.value} Months`;
        if (amount) amount.innerHTML = (this.value * 8).toFixed(2);
    };
}

// Navbar Scroll Spy
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('section');

const navObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            navItems.forEach((link) => link.classList.remove('active'));
            const id = entry.target.getAttribute('id');
            const activeLink = document.querySelector(`.nav-item[href="#${id}"]`);
            if (activeLink) activeLink?.classList.add('active');
        }
    });
}, { threshold: 0.5 });

sections.forEach((section) => {
    if (section.id) navObserver.observe(section);
});

const queueDrawer = document.getElementById('queueDrawer');
if (queueDrawer) {
    queueDrawer.addEventListener('click', () => {
        queueDrawer.classList.toggle('is-open');
        // Stop the bounce animation once the user interacts
        queueDrawer.style.animation = 'none';
    });
}

/**
 * 6. CONTACT FORM SUBMISSION
 */
const contactForm = document.getElementById('contact-form');

if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Select the button using the new class from your CSS
        const btn = contactForm.querySelector('.btn-send');
        const originalText = btn.innerHTML; // Saves the "Send Message" text
        
        // 1. UI Loading State
        btn.innerHTML = 'Sending...';
        btn.style.opacity = '0.8';
        btn.disabled = true;

        const formData = new FormData(contactForm);
        
        try {
            // 2. Send to "contact_messages" collection
            // We use addDoc (Auto-ID) so we don't need 'read' permissions, only 'create'
            await addDoc(collection(db, "contact_messages"), {
                name: formData.get('contactName'),
                email: formData.get('contactEmail'),
                type: formData.get('contactType') || 'General', // Fallback if empty
                message: formData.get('contactMessage'),
                timestamp: new Date().toISOString(),
                status: 'unread' // Useful for your admin panel sorting
            });

            // 3. Success Feedback (Matches your Green Theme)
            contactForm.reset();
            btn.innerHTML = '<i class="fas fa-check"></i> Sent Successfully';
            btn.style.background = '#88C9A1'; // var(--primary) from your CSS
            btn.style.color = '#ffffff';
            btn.style.borderColor = '#88C9A1';
            
            // 4. Reset button after 3 seconds
            setTimeout(() => {
                btn.innerHTML = originalText;
                // clear inline styles to revert to CSS classes
                btn.style.background = ''; 
                btn.style.color = '';
                btn.style.borderColor = '';
                btn.style.opacity = '1';
                btn.disabled = false;
            }, 3500);

        } catch (error) {
            console.error("Contact Form Error:", error);
            
            // Error Feedback
            btn.innerHTML = 'Error. Try Again.';
            btn.style.background = '#e74c3c'; // Red for error
            btn.style.color = 'white';
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = '';
                btn.style.color = '';
                btn.disabled = false;
            }, 3000);
        }
    });
}

/**
 * 7. SOCIAL TIP SIMULATOR
 */
const tips = [
    { name: "@jak", amount: 1 },
    { name: "@sophia_v", amount: 5 },
    { name: "@music_head", amount: 1 },
    { name: "@laura_m", amount: 3 },
    { name: "@alex88", amount: 1 },
    { name: "@beat_lover", amount: 10 },
    { name: "@sound_junkie", amount: 2 },
    { name: "@vibe_check", amount: 1 },
    { name: "@indie_fan", amount: 5 },
    { name: "@creators_first", amount: 1 }
];

let tipIndex = 0;
const toast = document.getElementById('tip-toast');
const tipText = document.getElementById('tip-text');

function showNextTip() {
    if (!toast || !tipText) return;

    // 1. Set the content
    const currentTip = tips[tipIndex];
    tipText.innerText = `${currentTip.name} tipped $${currentTip.amount}`;

    // 2. Show the toast
    toast.classList.add('show');

    // 3. Hide the toast after 1.5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
    }, 1500);

    // 4. Update index for next time
    tipIndex = (tipIndex + 1) % tips.length;
}

// Run every 3.5 seconds (gives time for animation + pause)
setInterval(showNextTip, 7500);

// Start first one after a short delay
setTimeout(showNextTip, 2000);

/**
 * 8. HEART INTERACTION LOGIC
 */
const heartBtn = document.getElementById('main-heart');
const cardArtwork = document.querySelector('.card-artwork');

if (heartBtn) {
    heartBtn.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevents double-triggering if you click the button inside the artwork
        this.classList.toggle('is-active');
        
        // Optional: If they like it, show a specific "Liked!" toast
        if (this.classList.contains('is-active')) {
            console.log("Track added to favorites");
        }
    });
}

// Instagram-style Double Tap on the Image
if (cardArtwork) {
    cardArtwork.addEventListener('dblclick', () => {
        heartBtn.classList.add('is-active');
        // You could even trigger the Tip Toast here if you want!
    });
}