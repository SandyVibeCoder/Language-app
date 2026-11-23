// Paste your Firebase web app config here to turn on accounts.
// Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration → Config.
// These values are public by design. Your Firestore rules (firestore.rules) are what keep each person's data private.
// Leave this as null and the app works exactly as before: progress stays on the phone, and no sign-in button shows.

export const firebaseConfig = {
  apiKey: "AIzaSyALIV1428aGe3OTSSsK4TBMsa5Y6gqYZRc",
  authDomain: "travel-speak-sandy.firebaseapp.com",
  projectId: "travel-speak-sandy",
  storageBucket: "travel-speak-sandy.firebasestorage.app",
  messagingSenderId: "85336592883",
  appId: "1:85336592883:web:a71afb273146fc4705c286",
};

// Example of the shape, with fake values:
// export const firebaseConfig = {
//   apiKey: "AIza...",
//   authDomain: "travel-speak.firebaseapp.com",
//   projectId: "travel-speak",
//   storageBucket: "travel-speak.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abc123",
// };
