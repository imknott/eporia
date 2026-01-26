import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js';

const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('artistLoginForm');
    const errorBanner = document.getElementById('errorMsg');
    const submitBtn = document.getElementById('submitBtn');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // UI Loading State
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';
            submitBtn.disabled = true;
            errorBanner.style.display = 'none';

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                // 1. Firebase Auth
                await signInWithEmailAndPassword(auth, email, password);
                
                // 2. Redirect to Studio Dashboard
                // (The studio script will detect the user and load their specific data)
                window.location.href = '/artist/studio';

            } catch (error) {
                console.error(error);
                errorBanner.innerText = parseError(error.code);
                errorBanner.style.display = 'block';
                
                // Reset Button
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        });
    }
});

function parseError(code) {
    switch (code) {
        case 'auth/invalid-credential': return "Incorrect email or password.";
        case 'auth/user-not-found': return "No artist account found with this email.";
        case 'auth/wrong-password': return "Incorrect password.";
        case 'auth/too-many-requests': return "Too many attempts. Please try again later.";
        default: return "Login failed. Please try again.";
    }
}