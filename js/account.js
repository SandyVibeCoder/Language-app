// Required accounts. Username and password sign-in through Firebase, with progress backed up to Firestore.
// The service worker keeps a copy of the Firebase SDK, so a signed-in phone still opens offline.

import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";
const PUSH_DELAY = 1500;

let fb = null;
let ready = null;
let pushTimer = null;
let pending = null;

export const account = {
  enabled: Boolean(firebaseConfig),
  ready: false,
  user: null,
  syncing: false,
  lastSynced: null,
  error: "",
  mode: "signin",
};

function load() {
  if (!account.enabled) return Promise.resolve(null);
  if (ready) return ready;
  ready = (async () => {
    const [appMod, authMod, storeMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    fb = {
      auth: authMod.getAuth(app),
      db: storeMod.getFirestore(app),
      authMod,
      storeMod,
    };
    return fb;
  })().catch((err) => {
    ready = null;
    err.code = err.code || "sdk-load";
    throw err;
  });
  return ready;
}

// Firebase signs people in by email, so a username becomes a private address that never receives mail.
const USER_DOMAIN = "users.travel-speak.app";
export const USERNAME_RULE = /^[a-z0-9._-]{3,20}$/;

export function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function toEmail(username) {
  return `${username}@${USER_DOMAIN}`;
}

function toUsername(email) {
  return String(email || "").replace(`@${USER_DOMAIN}`, "");
}

function friendly(err) {
  const code = err?.code || "";
  if (code === "sdk-load") return "Couldn't load sign-in. Check your connection and try again.";
  if (code.includes("email-already-in-use")) return "That username is taken. Try another.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Wrong username or password.";
  }
  if (code.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (code.includes("network") || !navigator.onLine) return "You're offline. Try again when you're connected.";
  if (code.includes("too-many-requests")) return "Too many tries. Wait a few minutes and try again.";
  if (code.includes("operation-not-allowed")) return "Username sign-in isn't turned on in Firebase yet.";
  return "Something went wrong. Try again.";
}

// Starts Firebase and reports every sign-in or sign-out through onChange.
export async function startAccount(onChange) {
  if (!account.enabled) return;
  try {
    const { auth, authMod } = await load();
    authMod.onAuthStateChanged(auth, (user) => {
      account.ready = true;
      account.user = user ? { uid: user.uid, username: toUsername(user.email) } : null;
      onChange(account.user);
    });
  } catch (err) {
    // Stay quiet at startup; the account screen tries again when someone signs in.
    account.ready = true;
    onChange(account.user);
  }
}

function checkFields(username, password) {
  if (!USERNAME_RULE.test(username)) {
    return "Usernames are 3 to 20 characters: letters, numbers, dots, dashes, or underscores.";
  }
  if (password.length < 6) return "Use a password with at least 6 characters.";
  return "";
}

export async function signIn(rawUsername, password) {
  const username = cleanUsername(rawUsername);
  account.error = checkFields(username, password);
  if (account.error) return false;
  try {
    const { auth, authMod } = await load();
    await authMod.signInWithEmailAndPassword(auth, toEmail(username), password);
    return true;
  } catch (err) {
    account.error = friendly(err);
    return false;
  }
}

export async function createAccount(rawUsername, password, confirm) {
  const username = cleanUsername(rawUsername);
  account.error = checkFields(username, password);
  if (!account.error && password !== confirm) account.error = "The passwords don't match.";
  if (account.error) return false;
  try {
    const { auth, authMod } = await load();
    await authMod.createUserWithEmailAndPassword(auth, toEmail(username), password);
    return true;
  } catch (err) {
    account.error = friendly(err);
    return false;
  }
}

export async function signOutAccount() {
  if (!fb) return;
  await flushPush();
  await fb.authMod.signOut(fb.auth);
  account.lastSynced = null;
}

function progressDoc() {
  return fb.storeMod.doc(fb.db, "progress", account.user.uid);
}

export async function pullProgress() {
  if (!account.user) return null;
  const { storeMod } = await load();
  const snap = await storeMod.getDoc(progressDoc());
  if (!snap.exists()) return null;
  try {
    return JSON.parse(snap.data().state || "null");
  } catch (err) {
    return null;
  }
}

async function writeNow(state) {
  if (!account.user || !state) return;
  const { storeMod } = await load();
  account.syncing = true;
  try {
    await storeMod.setDoc(progressDoc(), {
      state: JSON.stringify(state),
      updatedAt: storeMod.serverTimestamp(),
    });
    account.lastSynced = new Date();
    account.error = "";
    pending = null;
  } finally {
    account.syncing = false;
  }
}

// Called after every local save. Waits a moment so a burst of answers is one write.
// This is the only backup path: it runs on its own, so there's no backup button.
export function queuePush(state) {
  if (!account.user) return;
  pending = state;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    writeNow(pending).catch(() => {});
  }, PUSH_DELAY);
}

export async function flushPush() {
  clearTimeout(pushTimer);
  if (pending) await writeNow(pending).catch(() => {});
}

export async function pushNow(state) {
  pending = state;
  await flushPush();
}
