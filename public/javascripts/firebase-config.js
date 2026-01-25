// public/javascripts/firebase-config.js

// Change these to the full browser-ready URLs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDdojK95nahENsKVd_HkpWA9G4aGRVt1QY",
  authDomain: "eporia.firebaseapp.com",
  projectId: "eporia",
  storageBucket: "eporia.firebasestorage.app",
  messagingSenderId: "848823380138",
  appId: "1:848823380138:web:76f3d2734b001b1d0ac8d3",
  measurementId: "G-J8C0P18M85"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };