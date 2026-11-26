// Makes natural-sounding recorded clips for every line the app speaks, with Google Cloud Text-to-Speech.
// Runs in the Publish workflow when the GOOGLE_TTS_API_KEY secret is set. Only new or changed lines
// are requested, so after the first run each deploy costs nothing or close to it.
// Without a key it does nothing, and the app keeps using the phone's own voice.
//
//   GOOGLE_TTS_API_KEY=... node scripts/make_audio.mjs          make missing clips
//   node scripts/make_audio.mjs --list                          print the lines, make nothing

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/courses.js";
import { clipKey, spokenLines } from "../js/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "audio");
const MANIFEST = join(OUT, "manifest.json");
const KEY = process.env.GOOGLE_TTS_API_KEY || "";
const LIST_ONLY = process.argv.includes("--list");

// Voices to try in order for each course. If Google rejects a name, the next one is tried,
// and last of all Google picks a voice for the language.
const VOICES = {
  zh: { languageCode: "cmn-TW", names: ["cmn-TW-Wavenet-A", "cmn-TW-Standard-A"], rate: 0.85 },
  ja: { languageCode: "ja-JP", names: ["ja-JP-Neural2-B", "ja-JP-Wavenet-B", "ja-JP-Standard-A"], rate: 0.9 },
  es: { languageCode: "es-US", names: ["es-US-Neural2-A", "es-US-Wavenet-A", "es-US-Standard-A"], rate: 0.95 },
  de: { languageCode: "de-DE", names: ["de-DE-Neural2-G", "de-DE-Wavenet-F", "de-DE-Standard-A"], rate: 0.95 },
};

function fileFor(courseId, key) {
  return `audio/${courseId}/${createHash("sha1").update(key).digest("hex").slice(0, 16)}.mp3`;
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return { version: 1, voices: {}, clips: {} };
  }
}

async function synth(text, voice) {
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(KEY)}`;
  const attempt = async (name) => {
    for (let tries = 0; tries < 4; tries += 1) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: name ? { languageCode: voice.languageCode, name } : { languageCode: voice.languageCode },
          audioConfig: { audioEncoding: "MP3", speakingRate: voice.rate },
        }),
      });
      if (res.ok) {
        const body = await res.json();
        return Buffer.from(body.audioContent, "base64");
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** tries));
        continue;
      }
      const detail = await res.text();
      const err = new Error(`${res.status} ${detail.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    throw new Error("Google kept asking to slow down.");
  };
  const names = voice.chosen ? [voice.chosen] : [...voice.names, ""];
  let last = null;
  for (const name of names) {
    try {
      const audio = await attempt(name);
      voice.chosen = voice.chosen || name;
      return audio;
    } catch (err) {
      last = err;
      if (err.status !== 400 && err.status !== 404) throw err;
    }
  }
  throw last;
}

async function main() {
  const jobs = [];
  for (const course of COURSES) {
    for (const line of spokenLines(course)) jobs.push({ course, line, key: clipKey(line, course.voice) });
  }
  const unique = [...new Map(jobs.map((job) => [job.key, job])).values()];
  if (LIST_ONLY) {
    for (const job of unique) console.log(`${job.key}\t${job.line}`);
    console.log(`${unique.length} clips, ${unique.reduce((n, job) => n + job.line.length, 0)} characters`);
    return;
  }
  if (!KEY) {
    console.log("No GOOGLE_TTS_API_KEY, so no new recorded clips. The app uses the phone's voice for lines without one.");
    return;
  }

  const old = readManifest();
  const manifest = { version: 1, voices: {}, clips: {} };
  let made = 0;
  let failed = 0;
  const queue = [];
  for (const job of unique) {
    const course = job.course.id;
    const voice = VOICES[course];
    if (!voice) continue;
    const file = fileFor(course, job.key);
    const sameVoice = old.voices?.[course] && voice.names.includes(old.voices[course]);
    if (sameVoice) voice.chosen = old.voices[course];
    if (sameVoice && old.clips?.[job.key] === file && existsSync(join(ROOT, file))) {
      manifest.clips[job.key] = file;
      manifest.voices[course] = old.voices[course];
      continue;
    }
    queue.push({ ...job, file, voice });
  }

  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const job = queue.shift();
      try {
        const audio = await synth(job.line, job.voice);
        mkdirSync(dirname(join(ROOT, job.file)), { recursive: true });
        writeFileSync(join(ROOT, job.file), audio);
        manifest.clips[job.key] = job.file;
        manifest.voices[job.course.id] = job.voice.chosen || job.voice.languageCode;
        made += 1;
      } catch (err) {
        failed += 1;
        console.warn(`Couldn't make "${job.line}": ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  // Remove clips for lines the app no longer speaks.
  const keep = new Set(Object.values(manifest.clips));
  for (const course of Object.keys(VOICES)) {
    const dir = join(OUT, course);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!keep.has(`audio/${course}/${name}`)) rmSync(join(dir, name));
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(manifest));
  console.log(`Recorded clips: ${Object.keys(manifest.clips).length} ready, ${made} new, ${failed} failed.`);
}

main().catch((err) => {
  // Audio is a nice-to-have. A failure here never blocks publishing the app.
  console.warn(`Recorded clips skipped: ${err.message}`);
});
