/* public/javascripts/artistSignup.js */
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { db } from "/javascripts/firebaseConfig.js"; 

const form = document.getElementById('artistForm');
const submitBtn = document.getElementById('submitBtn');

if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        submitBtn.disabled = true;
        submitBtn.innerText = "Uploading Demo...";
        
        const formData = new FormData(form);
        const email = formData.get('email').toLowerCase().trim();
        
        try {
            // 1. UPLOAD FILE TO SERVER
            const uploadRes = await fetch('/artist/upload-demo', {
                method: 'POST',
                body: formData
            });
            const uploadJson = await uploadRes.json();
            
            if (!uploadJson.success) throw new Error("File upload failed");

            // 2. PREPARE DATA
            const artistData = {
                artistName: formData.get('artistName'),
                email: email,
                website: formData.get('website'),
                location: {
                    city: formData.get('city'),
                    country: formData.get('country')
                },
                bio: formData.get('bio'),
                socials: {
                    instagram: formData.get('instagram'),
                    tiktok: formData.get('tiktok'),
                    facebook: formData.get('facebook'),
                    youtube: formData.get('youtube')
                },
                interests: {
                    merch: formData.get('interestMerch') === 'on',
                    physical: formData.get('interestPhysical') === 'on',
                    digital: formData.get('interestDigital') === 'on'
                },
                demoTrackPath: uploadJson.filePath,
                status: "pending_review",
                timestamp: new Date().toISOString()
            };

            // 3. BLIND WRITE (The Security Fix)
            // We use setDoc. 
            // If the doc doesn't exist -> CREATE (Allowed by Rules)
            // If the doc DOES exist -> UPDATE (Blocked by Rules -> Throws Error)
            const appRef = doc(db, "artist_applications", email);
            await setDoc(appRef, artistData); 

            // 4. SUCCESS UI
            document.querySelector('.signup-container').innerHTML = `
                <div class="success-state">
                    <div class="success-icon">🎉</div>
                    <h1 style="color: var(--sidebar-bg)">Application Sent!</h1>
                    <p style="font-size: 20px; color: #555; line-height: 1.6;">
                        Thanks, <strong>${artistData.artistName}</strong>.
                    </p>
                    <p style="color: #999">We'll email you at ${email} with next steps.</p>
                    <a href="/" style="display: inline-block; margin-top: 30px; text-decoration: none; color: var(--accent-orange); font-weight: 800;">← Back to Home</a>
                </div>
            `;

        } catch (error) {
            console.error("Submission Error:", error);
            
            // CHECK FOR PERMISSION ERROR (Means duplicate)
            if (error.code === 'permission-denied') {
                alert("This email has already submitted an application!");
            } else {
                alert("Something went wrong. Please check your file size and try again.");
            }
            
            submitBtn.disabled = false;
            submitBtn.innerText = "Submit Application";
        }
    });
}