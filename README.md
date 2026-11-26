# Travel Speak

Spoken phrases in Mandarin, Japanese, Spanish, and German. It is meant to live on an iPhone home screen. An account is required. No ads, and nothing is tracked beyond that account.

**Site:** https://sandyvibecoder.github.io/Language-app/

## Put it on your iPhone

1. Open the link above in **Safari** (the Chrome app cannot add a proper home-screen app).
2. Tap the Share button, the square with an arrow.
3. Tap **Add to Home Screen**, then **Add**.

The icon says **Speak**. Open it and sign in once while you have a signal. After that it works offline, and your streak and XP save to your account whenever you're back online.

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
- Each course is a path of lessons. A lesson mixes meaning questions, word tiles, listening, typing what you hear, saying a phrase out loud, and matching pairs. Pinyin or romaji comes first. Characters stay small.
- Tap an answer, then **Check**, so a slip of the finger doesn't count. Sound effects for right and wrong answers can be turned off under Account.
- Speaking uses the phone's speech recognition. A miss there never costs a heart. **Can't speak now** turns speaking off for an hour.
- Typing ignores capitals, punctuation, accents, tone marks, and macrons. One small typo still counts, with a note.
- Five hearts at the start of each lesson. A mistake costs one. If they run out, the lesson stops and you can try it again. Nothing is for sale. The X asks before you quit mid-lesson.
- XP: 15 for a new lesson, 12 for a unit review, 5 for replaying one, plus 5 for no mistakes and 2 each for 5 and 10 right in a row. A daily streak and a daily goal of 20 XP. No ranking.
- The end of each lesson shows accuracy, time, best run, and the phrases to practice.
- **Spaced review:** every phrase you meet comes back after 1, 3, 7, 16, 35, then 90 days, sooner if you miss it. Due phrases slip into new lessons, the course page shows a **Review** button when some are due, and a finished unit's ↻ node turns gold when a good share of it is fading.
- **Jump ahead:** each locked unit has **Jump here**. Pass a 10-question test with 3 hearts and everything before it is marked done, with those phrases lined up for review.
- All XP amounts live in one place, `LESSON_XP` in `js/engine.js`.

Phrases live in `js/courses.js` if you ever want to change a line.

## Recorded audio

Lines play as natural-voice recordings made with Google Cloud Text-to-Speech (Taiwan Mandarin, Japanese, Latin American Spanish, German). Any line without a recording uses the phone's own voice, so the app works either way.

One-time setup, about 10 minutes. All ~960 clips together are about 5,000 characters, far inside Google's monthly free tier.

1. In console.cloud.google.com, pick or create a project (the Firebase project works) and turn on **Cloud Text-to-Speech API**. Google asks for a billing account even for the free tier.
2. **APIs & Services → Credentials → Create credentials → API key.** Edit the key and restrict it to the Cloud Text-to-Speech API.
3. On GitHub: **Settings → Secrets and variables → Actions → New repository secret.** Name it `GOOGLE_TTS_API_KEY` and paste the key.
4. Re-run the newest **Publish to GitHub Pages** run (Actions tab). Each later deploy only asks for lines that are new or changed.

After an update, the phone saves every clip in the background so they play offline. `node scripts/make_audio.mjs --list` prints every line that gets a recording.

## Privacy

There's no analytics and no ads. Progress saves on the phone first, then to your account in Firebase so it follows you to other devices. Only you can read your progress (see `firestore.rules`).

## Accounts

An account is required. Signed-out visitors see only the sign-in screen. Once signed in, the phone keeps a copy of the sign-in code, so the app still opens offline. Progress saves to the account automatically and syncs across devices. The first sign-in on a phone merges any progress already stored there with the account.

Setup, about 10 minutes, free tier:

1. Go to console.firebase.google.com and create a project. Google Analytics is not needed.
2. **Authentication** → Get started → Sign-in method → turn on **Email/Password**. Leave "Email link" off. Save.
3. **Firestore Database** → Create database → production mode → pick a US region.
4. Firestore → **Rules** → paste the contents of `firestore.rules` → Publish.
5. Project settings → General → Your apps → add a **Web** app. Copy the `firebaseConfig` object into `js/firebase-config.js`, replacing `null`.
6. Push. The site opens on the sign-in screen.

How it works: progress still saves on the phone first, then saves to the account a moment after each change. Signing in on a new device merges both sides, so nothing is lost (finished lessons from both, the higher XP, the most recent streak).

Usernames are stored in Firebase as `username@users.travel-speak.app`, an address that never receives mail. There's no email, so a forgotten password can't be reset by the user. You can reset it for them in the Firebase console under Authentication → Users.
