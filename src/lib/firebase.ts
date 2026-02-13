import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBLDU77aA_QNv4_6MG_-Q5NnPXhsqmVpyQ",
  authDomain: "fastcalories-18ba8.firebaseapp.com",
  projectId: "fastcalories-18ba8",
  storageBucket: "fastcalories-18ba8.firebasestorage.app",
  messagingSenderId: "356075693003",
  appId: "1:356075693003:web:34fbf33264bca3e159cc4e",
  measurementId: "G-4RXWEBF3KH"
};

const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
