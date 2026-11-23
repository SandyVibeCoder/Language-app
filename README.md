# Travel Speak

Spoken phrases in Mandarin, Japanese, Spanish, and German. It is meant to live on an iPhone home screen. No account, no ads, and nothing is tracked.

**Site:** https://wsarchet.github.io/Language-app/

## Put it on your iPhone

1. Open the link above in **Safari** (the Chrome app cannot add a proper home-screen app).
2. Tap the Share button, the square with an arrow.
3. Tap **Add to Home Screen**, then **Add**.

The icon says **Speak**. Open it once while you have a signal. After that it works offline. The streak and XP stay on that phone.

## If the link does not load yet

Two one-time steps on GitHub:

1. Merge the pull request into `main`.
2. On the repository page, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

Wait about a minute, then try the link. If it still fails, open the **Actions** tab, click the newest **Publish to GitHub Pages** run, and press **Re-run jobs**.

The workflow tries to turn Pages on by itself. GitHub often blocks that for the automatic token, so the Settings switch above is the reliable step.

## What is inside

- Mandarin for Taiwan, in pinyin with tone marks. Traditional characters are small, next to the answer.
- Japanese for Japan, in romaji with macrons. Kana and kanji are small, next to the answer.
- Spanish as spoken casually in Mexico, for following conversations around you: greetings, fillers, slang, reactions, and fast-speech shortcuts. Lessons lean on listening. A small sound-it-out guide sits next to each answer (capitals mark the stress, rr marks a rolled r).
- German for following the song 99 Luftballons: counting to 99, then the song's key words, then the basics. Lessons lean on listening, with a sound-it-out guide beside each answer.
- Each course is a path of lessons. A lesson mixes meaning questions, word tiles, listening, and matching pairs. Pinyin or romaji comes first. Characters stay small.
- Five hearts at the start of each lesson. A mistake costs one. If they run out, the lesson stops and you can try it again. Nothing is for sale.
- A little XP, a daily streak, and a daily goal of 20 XP. No ranking and no account.

Phrases live in `js/courses.js` if you ever want to change a line.

## Privacy

Nothing is sent to a server. There is no analytics. Progress is saved in the phone's own storage. Deleting the home-screen icon does not always clear it; clearing Safari website data for the site does.

## Accounts (optional)

People can create an account with a username and password. Progress saves to the account automatically and syncs across devices. Without a Firebase config, the app runs exactly as before and shows no sign-in button.

Setup, about 10 minutes, free tier:

1. Go to console.firebase.google.com and create a project. Google Analytics is not needed.
2. **Authentication** → Get started → Sign-in method → turn on **Email/Password**. Leave "Email link" off. Save.
3. **Firestore Database** → Create database → production mode → pick a US region.
4. Firestore → **Rules** → paste the contents of `firestore.rules` → Publish.
5. Project settings → General → Your apps → add a **Web** app. Copy the `firebaseConfig` object into `js/firebase-config.js`, replacing `null`.
6. Push. "Sign in or create an account" appears on the home screen.

How it works: progress still saves on the phone first, then saves to the account a moment after each change. Signing in on a new device merges both sides, so nothing is lost (finished lessons from both, the higher XP, the most recent streak).

Usernames are stored in Firebase as `username@users.travel-speak.app`, an address that never receives mail. There's no email, so a forgotten password can't be reset by the user. You can reset it for them in the Firebase console under Authentication → Users.
