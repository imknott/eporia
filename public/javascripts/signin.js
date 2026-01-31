/* public/javascripts/signin.js */
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { app } from './firebase-config.js'; 

const auth = getAuth(app);
let authCheckComplete = false;

// UI Helpers
const showAuthSpinner = () => {
    const spinner = document.getElementById('authCheckSpinner');
    if (spinner) spinner.style.display = 'flex';
};

const hideAuthSpinner = () => {
    const spinner = document.getElementById('authCheckSpinner');
    if (spinner) spinner.style.display = 'none';
};

const showLoginForm = () => {
    const wrapper = document.querySelector('.auth-wrapper');
    const container = document.querySelector('.auth-container');
    if (wrapper && container) {
        wrapper.style.display = 'flex'; // Ensure wrapper is visible
        container.style.display = 'block';
        setTimeout(() => { container.style.opacity = '1'; }, 50);
    }
};

// Start by showing the spinner while we talk to Firebase
showAuthSpinner();

onAuthStateChanged(auth, async (user) => {
    // 1. [CRITICAL] Immediate check for the logout flag from the DOM
    const pageData = document.getElementById('pageData'); 
    const isLoggingOut = pageData && pageData.dataset.autoLogout === 'true'; 

    if (isLoggingOut) {
        console.log("🛑 Logout mode active. Blocking auto-redirect.");
        authCheckComplete = true; // Prevent any further auth logic from running 
        hideAuthSpinner(); 
        showLoginForm(); 
        return; // EXIT IMMEDIATELY to prevent redirection 
    }

    // 2. Prevent the listener from running multiple times
    if (authCheckComplete) return; 

    if (user) {
        // 3. CASE: User is signed in and NOT logging out
        authCheckComplete = true; 
        console.log('✅ User already signed in, redirecting...'); 
        
        hideAuthSpinner(); 
        const authWrapper = document.querySelector('.auth-wrapper'); 
        
        if (authWrapper) {
            authWrapper.style.display = 'flex'; 
            authWrapper.innerHTML = `
                <div class="signin-container" style="text-align: center; padding: 60px 20px;">
                    <i class="fas fa-check-circle" style="font-size: 4rem; color: #88C9A1; margin-bottom: 20px;"></i>
                    <h2 style="color: var(--text-main); margin-bottom: 10px; font-size: 1.8rem; font-weight: 900;">Welcome Back!</h2>
                    <p style="color: #888;">Redirecting to your dashboard...</p>
                </div>
            `; 
        }
        
        // Brief delay for UX before moving to the dashboard
        setTimeout(() => {
            window.location.href = '/player/dashboard';
        }, 800); 

    } else if (!user) {
        // 4. CASE: Normal Guest Path (No user found)
        authCheckComplete = true;
        hideAuthSpinner();
        console.log('👤 No user signed in, showing login form');
        showLoginForm(); 
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    
    const pageData = document.getElementById('pageData');
    if (pageData && pageData.dataset.autoLogout === 'true') {
        try {
            // Force sign out immediately on page land
            await signOut(auth);
            // Clear the session cookie manually to be safe
            document.cookie = "session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            console.log("✅ Firebase & Cookie cleared.");
        } catch (err) {
            console.error("Logout failed:", err);
        }

    // Email Login Form
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            setLoading(true);
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                // 1. Perform the Sign In
                const userCred = await signInWithEmailAndPassword(auth, email, password);
                
                // 2. [FIX] Set the Session Cookie manually (Crucial for Dashboard data)
                const token = await userCred.user.getIdToken();
                document.cookie = `session=${token}; path=/; max-age=3600; samesite=lax`;

                // 3. [FIX] Show Success UI & Redirect Immediately
                // We don't wait for the listener anymore.
                const authWrapper = document.querySelector('.auth-wrapper');
                if (authWrapper) {
                    authWrapper.innerHTML = `
                        <div class="signin-container" style="text-align: center; padding: 60px 20px;">
                            <i class="fas fa-check-circle" style="font-size: 4rem; color: #88C9A1; margin-bottom: 20px;"></i>
                            <h2 style="color: var(--text-main); margin-bottom: 10px; font-size: 1.8rem; font-weight: 900;">Welcome Back!</h2>
                            <p style="color: #888;">Redirecting to your dashboard...</p>
                        </div>
                    `;
                }

                setTimeout(() => {
                    window.location.href = '/player/dashboard';
                }, 500);

            } catch (error) {
                showError(error);
                setLoading(false);
            }
        });
    }
}
});

// --- HELPERS ---
function setLoading(isLoading) {
    const btn = document.getElementById('submitBtn');
    if (isLoading) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
        btn.disabled = true;
    } else {
        btn.innerHTML = 'Sign In';
        btn.disabled = false;
    }
}

function showError(error) {
    console.error(error);
    const msgDiv = document.getElementById('errorMsg');
    let msg = "Login failed.";
    
    if (error.code === 'auth/invalid-credential') msg = "Incorrect email or password.";
    else if (error.code === 'auth/user-not-found') msg = "No account found with this email.";
    else if (error.code === 'auth/wrong-password') msg = "Incorrect password.";
    else if (error.code === 'auth/too-many-requests') msg = "Too many attempts. Please try again later.";
    else if (error.code === 'auth/invalid-email') msg = "Invalid email format.";
    
    msgDiv.innerText = msg;
    msgDiv.style.display = 'block';
}