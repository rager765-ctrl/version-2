/**
 * Kwabz Store — Global Configuration
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAt6xHMVvJ82iJSb8XO_bYGfxLKncG8oUE",
  authDomain: "mr-rager.firebaseapp.com",
  projectId: "mr-rager",
  storageBucket: "mr-rager.firebasestorage.app",
  messagingSenderId: "731077938078",
  appId: "1:731077938078:web:878fc483d6e1921bcca48f",
  measurementId: "G-1Y14WBJV3H"
};


export const APP_VERSION = "2.4.8";
export const STORE_NAME = "Kwabz Store";

export const BACKEND_URL = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) 
  ? 'http://localhost:5000' 
  : 'https://nodejs-backend-utf4.onrender.com';

// Twilio Client-Side Config (Warning: Exposed to client)
export const TWILIO_CONFIG = {
  sid: 'ACxxxxxxxxxxxxxxxxxxxxxxxx',
  token: 'xxxxxxxxxxxxxxxxxxxxxxxx',
  from: '+14155238886', // Twilio WhatsApp Number
  adminPhone: '+233000000000' // Your Phone Number
};

