# Travel Speak

Spoken phrases for a trip to Taiwan and Japan. It is meant to live on an iPhone home screen. No account, no ads, and nothing is tracked.

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
- Each course is a path of lessons. A lesson mixes meaning questions, word tiles, listening, and matching pairs. Pinyin or romaji comes first. Characters stay small.
- Five hearts. A mistake costs one, and a heart comes back every 30 minutes. If you run out, a free practice lesson earns one back. Nothing is for sale.
- A little XP, a daily streak, and a daily goal of 20 XP. No ranking and no account.

Phrases live in `js/courses.js` if you ever want to change a line.

## Privacy

Nothing is sent to a server. There is no analytics. Progress is saved in the phone's own storage. Deleting the home-screen icon does not always clear it; clearing Safari website data for the site does.
