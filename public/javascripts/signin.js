/* public/javascripts/signin.js */
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    signOut, 
    signInWithPopup, 
    GoogleAuthProvider, 
    RecaptchaVerifier, 
    signInWithPhoneNumber 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js'; 

const auth = getAuth(app);
window.recaptchaVerifier = null;

document.addEventListener('DOMContentLoaded', async () => {
    
    // Auto-Logout Trigger
    const pageData = document.getElementById('pageData');
    if (pageData && pageData.dataset.autoLogout === 'true') {
        await signOut(auth);
        console.log("User signed out.");
    }

    // Email Login
    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            setLoading(true);
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                await signInWithEmailAndPassword(auth, email, password);
                window.location.href = '/player/dashboard';
            } catch (error) {
                showError(error);
                setLoading(false);
            }
        });
    }
});

// --- GOOGLE AUTH ---
window.handleGoogleAuth = async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        window.location.href = '/player/dashboard';
    } catch (error) {
        showError(error);
    }
};

// --- PHONE AUTH UI TOGGLE ---
window.togglePhoneAuth = () => {
    const emailForm = document.getElementById('loginForm');
    const phoneForm = document.getElementById('phoneForm');
    const buttons = document.getElementById('authButtons');
    const divider = document.getElementById('authDivider');

    if (phoneForm.style.display === 'none') {
        // Show Phone
        emailForm.style.display = 'none';
        buttons.style.display = 'none';
        divider.style.display = 'none';
        phoneForm.style.display = 'block';
        
        // Init Recaptcha if needed
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
                'size': 'invisible'
            });
        }
    } else {
        // Show Email
        emailForm.style.display = 'block';
        buttons.style.display = 'flex';
        divider.style.display = 'flex';
        phoneForm.style.display = 'none';
    }
};

// --- PHONE LOGIC ---
window.sendPhoneCode = async () => {
    const number = document.getElementById('phoneNumber').value;
    if(number.length < 10) return alert("Please enter a valid number");
    
    try {
        window.confirmationResult = await signInWithPhoneNumber(auth, number, window.recaptchaVerifier);
        document.getElementById('otpGroup').style.display = 'block';
        alert("Code sent!");
    } catch (error) {
        console.error(error);
        alert("SMS failed: " + error.message);
    }
};

window.verifyPhoneCode = async () => {
    const code = document.getElementById('otpCode').value;
    try {
        await window.confirmationResult.confirm(code);
        window.location.href = '/player/dashboard';
    } catch (error) {
        alert("Invalid code.");
    }
};

// --- HELPERS ---
function setLoading(isLoading) {
    const btn = document.getElementById('submitBtn');
    if(isLoading) {
        btn.innerText = "Verifying...";
        btn.disabled = true;
    } else {
        btn.innerText = "Sign In";
        btn.disabled = false;
    }
}

function showError(error) {
    console.error(error);
    const msgDiv = document.getElementById('errorMsg');
    let msg = "Login failed.";
    if (error.code === 'auth/invalid-credential') msg = "Incorrect email or password.";
    if (error.code === 'auth/user-not-found') msg = "No account found with this email.";
    
    msgDiv.innerText = msg;
    msgDiv.style.display = 'block';
}