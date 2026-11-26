import { COURSES, courseById, unitById } from "./courses.js";
import {
  DAILY_GOAL,
  JUMP_HEARTS,
  blankState,
  MAX_HEARTS,
  applyJump,
  baseXpFor,
  buildJumpTest,
  buildNodeLesson,
  buildRefreshLesson,
  checkTyped,
  clipKey,
  courseDue,
  seedPhrases,
  reviewPhrase,
  speechPasses,
  unitCracked,
  canQueueRepeat,
  completeLesson,
  coursePath,
  dailyXp,
  dayKey,
  dismissInstallHint,
  easeMiss,
  isNodeDone,
  mergeStates,
  nodeUnlocked,
  normalizeState,
  phraseById,
  recordMiss,
  speakText,
  speechForTone,
  toneContour,
  tonesFromPinyin,
  visibleStreak,
} from "./engine.js";
import {
  account,
  createAccount,
  flushPush,
  pullProgress,
  pushNow,
  queuePush,
  signIn,
  signOutAccount,
  startAccount,
} from "./account.js";

const STORAGE_KEY = "travel-speak-v1";
const PREFS_KEY = "travel-speak-prefs";
const SPEAK_PAUSE_MS = 60 * 60 * 1000;

// Settings that belong to this phone, not the account.
function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { sfx: raw.sfx !== false, speakPausedUntil: Number(raw.speakPausedUntil) || 0 };
  } catch (err) {
    return { sfx: true, speakPausedUntil: 0 };
  }
}
let prefs = loadPrefs();
function savePrefs(change) {
  prefs = { ...prefs, ...change };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    /* Settings fall back to defaults next time. */
  }
}

let state = blankState();
let saveOk = true;
let view = { name: "home" };
let resetScroll = false;
let session = null;
let voiceToken = 0;

const root = () => document.getElementById("app");

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch (err) {
    return blankState();
  }
}

function save(next) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveOk = true;
  } catch (err) {
    saveOk = false;
  }
  queuePush(state);
}

// After sign-in, combine this phone's progress with the account's, keep it here, and back it up.
async function syncAfterSignIn() {
  account.syncing = true;
  render();
  try {
    const remote = await pullProgress();
    const merged = remote ? mergeStates(state, remote) : state;
    save(merged);
    await pushNow(merged);
  } catch (err) {
    account.error = navigator.onLine ? "Couldn't reach your account. Progress is still saved on this phone." : "";
  } finally {
    account.syncing = false;
    render();
  }
}

let pendingView = null;

// An account is required. Nothing past the sign-in screen opens without one.
function lockedOut() {
  return !account.user;
}

function onAccountChange(user) {
  if (user) {
    const next = pendingView;
    pendingView = null;
    syncAfterSignIn().finally(() => {
      if (next && next.name && next.name !== "account") {
        showHistory(next);
        return;
      }
      if (view.name === "account") {
        session = null;
        view = { name: "home" };
        writeHistory("replace");
        resetScroll = true;
        render();
      }
    });
    return;
  }
  stopSpeech();
  session = null;
  view = { name: "account" };
  render();
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function scriptLang(course) {
  if (course.scriptLang) return course.scriptLang;
  return course.id === "zh" ? "zh-Hant" : "ja";
}

function findPhrase(course, phraseId) {
  for (const unit of course.units) {
    const phrase = phraseById(unit, phraseId);
    if (phrase) return phrase;
  }
  return null;
}

function hearable(course, say, className, inner) {
  if (!say) return `<span class="${className}">${inner}</span>`;
  return `<button type="button" class="say ${className}" data-say="${esc(say)}">${inner}</button>`;
}

function scriptLine(course, phrase, say) {
  if (!phrase?.script) return "";
  const inner = esc(phrase.script);
  if (scriptLang(course) === "en") return `<p class="script" lang="en">${inner}</p>`;
  return hearable(course, say || phrase.script, "script", inner);
}

// ---------- Shared audio context: tone shapes and sound effects ----------
function audioCtx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx.ctx) {
    try {
      audioCtx.ctx = new AudioCtx();
    } catch (err) {
      return null;
    }
  }
  audioCtx.ctx.resume?.().catch(() => {});
  return audioCtx.ctx;
}

const SFX = {
  right: [[660, 0, 0.09], [990, 0.09, 0.16]],
  wrong: [[220, 0, 0.12, "square"], [174, 0.12, 0.2, "square"]],
  combo: [[784, 0, 0.08], [988, 0.08, 0.08], [1319, 0.16, 0.18]],
  done: [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.12], [1047, 0.36, 0.32]],
  fail: [[392, 0, 0.18, "triangle"], [330, 0.18, 0.18, "triangle"], [262, 0.36, 0.34, "triangle"]],
};

function sfx(name) {
  if (!prefs.sfx) return;
  const notes = SFX[name];
  const ctx = notes ? audioCtx() : null;
  if (!ctx) return;
  const start = ctx.currentTime + 0.01;
  const master = ctx.createGain();
  master.gain.value = name === "wrong" ? 0.06 : 0.12;
  master.connect(ctx.destination);
  for (const [freq, at, dur, type] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(1, start + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start + at);
    osc.stop(start + at + dur + 0.02);
  }
}

// ---------- Recorded clips ----------
// audio/manifest.json lists natural-voice clips made by scripts/make_audio.mjs.
// A line without a clip uses the phone's own voice.
let clipMap = {};
let clipVoices = {};
let clipPlayer = null;

function loadClips() {
  fetch("audio/manifest.json", { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      clipMap = data?.clips || {};
      clipVoices = data?.voices || {};
    })
    .catch(() => {});
}

function clipUrl(text, lang) {
  return clipMap[clipKey(text, lang)] || null;
}

function hasClips(course) {
  return Boolean(course && clipVoices[course.id]);
}

function stopClip() {
  if (!clipPlayer) return;
  try {
    clipPlayer.pause();
  } catch (err) {
    /* Already stopped. */
  }
  clipPlayer = null;
}

function playClip(url, slow, onstart, token) {
  return new Promise((resolve) => {
    stopClip();
    const player = new Audio(url);
    clipPlayer = player;
    player.playbackRate = slow ? 0.7 : 1;
    player.preservesPitch = true;
    player.webkitPreservesPitch = true;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    player.onplaying = () => {
      if (token === voiceToken) onstart?.();
    };
    player.onended = () => finish(token === voiceToken);
    player.onerror = () => finish(null);
    player.play().catch(() => finish(null));
  });
}

let toneGen = 0;
let toneNodes = [];
let toneMasters = [];

function stopTones() {
  toneGen += 1;
  for (const node of toneNodes) {
    try {
      node.stop();
    } catch (err) {
      /* Already finished. */
    }
  }
  for (const master of toneMasters) {
    try {
      master.disconnect();
    } catch (err) {
      /* Already disconnected. */
    }
  }
  toneNodes = [];
  toneMasters = [];
}

function stopSpeech() {
  voiceToken += 1;
  stopTones();
  stopClip();
  stopListening();
  try {
    window.speechSynthesis?.cancel();
  } catch (err) {
    /* The lesson still works with the written phrase. */
  }
}

function voiceScore(lang, id) {
  const want = String(lang || "").toLowerCase().replace(/_/g, "-");
  const base = want.slice(0, 2);
  if (base === "zh") {
    if (id === "zh-tw" || id.startsWith("zh-tw")) return 6;
    if (id === "zh-hant" || id.startsWith("zh-hant")) return 5;
    if (id === "zh-cn" || id.startsWith("zh-cn") || id.startsWith("zh-hans")) return 4;
    if (id.startsWith("zh")) return 2;
    return 0;
  }
  if (id === want) return 5;
  if (id.startsWith(`${want}-`) || id.startsWith(want)) return 4;
  if (id.startsWith(`${base}-`)) return 2;
  if (id.startsWith(base)) return 1;
  return 0;
}

function pickVoice(lang) {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const norm = (value) => String(value || "").toLowerCase().replace(/_/g, "-");
  let best = null;
  let bestScore = 0;
  for (const voice of voices) {
    const score = voiceScore(lang, norm(voice.lang));
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

function accentNote(course) {
  if (!course?.accentNote || hasClips(course)) return "";
  const voice = pickVoice(course.voice);
  if (!voice) return "";
  const id = voice.lang.toLowerCase().replace(/_/g, "-");
  return id.startsWith(course.voice.toLowerCase()) ? "" : course.accentNote;
}

function speak(text, lang, onstart, tune) {
  const url = text ? clipUrl(text, lang) : null;
  if (url) {
    const token = voiceToken;
    const slow = Boolean(tune && tune.rate < 0.6);
    // A clip that can't play (offline before it was saved) falls back to the phone's voice.
    return playClip(url, slow, onstart, token).then((ok) => (ok === null && token === voiceToken ? speakWithPhone(text, lang, onstart, tune) : Boolean(ok)));
  }
  return speakWithPhone(text, lang, onstart, tune);
}

function speakWithPhone(text, lang, onstart, tune) {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance !== "function" || !text) {
    return Promise.resolve(false);
  }
  const token = voiceToken;
  return new Promise((resolve) => {
    let started = false;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(token === voiceToken ? ok : false);
    };
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.lang = lang;
    const zh = String(lang).toLowerCase().startsWith("zh");
    utterance.rate = tune?.rate ?? (zh ? 0.82 : 0.9);
    if (tune?.pitch) utterance.pitch = tune.pitch;
    utterance.onstart = () => {
      if (token !== voiceToken) return;
      started = true;
      onstart?.();
    };
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    try {
      synth.resume?.();
      if (synth.speaking || synth.pending) synth.cancel();
      synth.speak(utterance);
    } catch (err) {
      finish(false);
      return;
    }
    window.setTimeout(() => {
      if (!started) finish(false);
    }, 1800);
    window.setTimeout(() => finish(started), 10000);
  });
}

function playToneContours(tones, onstart) {
  const ctx = tones.length ? audioCtx() : null;
  if (!ctx) return Promise.resolve(false);
  const gen = toneGen;
  const base = 210;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.2, ctx.currentTime);
  master.connect(ctx.destination);
  toneMasters.push(master);
  let when = ctx.currentTime + 0.03;
  for (const tone of tones) {
    const shape = toneContour(tone);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "triangle";
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    const dur = shape.ms / 1000;
    const freqs = shape.pitches.map((mult) => base * mult);
    osc.frequency.setValueAtTime(freqs[0], when);
    for (let i = 1; i < freqs.length; i += 1) {
      const at = when + (dur * i) / (freqs.length - 1);
      if (freqs[i] === freqs[i - 1]) osc.frequency.setValueAtTime(freqs[i], at);
      else osc.frequency.exponentialRampToValueAtTime(freqs[i], at);
    }
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(1, when + Math.min(0.04, dur * 0.18));
    gain.gain.setValueAtTime(1, when + dur * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.start(when);
    osc.stop(when + dur + 0.02);
    toneNodes.push(osc);
    when += dur + 0.08;
  }
  onstart?.();
  const wait = Math.max(0, (when - ctx.currentTime) * 1000 + 20);
  return new Promise((resolve) => {
    window.setTimeout(() => {
      try {
        master.disconnect();
      } catch (err) {
        /* Already disconnected. */
      }
      resolve(gen === toneGen);
    }, wait);
  });
}

function speakNow(text, lang) {
  if (!text || !lang) return;
  voiceToken += 1;
  stopTones();
  stopClip();
  speak(text, lang);
}

function playLine(text, lang, toneRoman, slow) {
  const token = ++voiceToken;
  stopTones();
  stopClip();
  try {
    window.speechSynthesis?.cancel();
  } catch (err) {
    /* A missing voice still leaves the written phrase. */
  }
  if (session) {
    session.voice = "trying";
    session.hearFailed = false;
  }
  paintAudio();
  const markPlaying = () => {
    if (token !== voiceToken || !session || session.phase !== "run") return;
    session.voice = "playing";
    paintAudio();
  };
  const zhTones =
    session?.unitId === "sounds" && String(lang || "").toLowerCase().startsWith("zh")
      ? tonesFromPinyin(toneRoman || "")
      : [];
  const base =
    zhTones.length === 1 ? speechForTone(zhTones[0]) : zhTones.length > 1 ? { rate: 0.64, pitch: 1 } : null;
  const tune = slow ? { rate: Math.min(base?.rate ?? 0.9, 0.55), pitch: base?.pitch || 1 } : base;
  const contour = zhTones.length ? playToneContours(zhTones, markPlaying) : Promise.resolve(false);
  contour
    .then((toneOk) => {
      if (token !== voiceToken) return false;
      return speak(text, lang, markPlaying, tune).then((speechOk) => toneOk || speechOk);
    })
    .then((ok) => {
      if (token !== voiceToken || !session || session.phase !== "run") return;
      session.voice = ok ? "done" : "failed";
      session.hearFailed = !ok;
      paintAudio();
    });
}

function keepScroll(change) {
  const main = root().querySelector(".main");
  const top = main ? main.scrollTop : 0;
  const win = window.scrollY;
  change();
  if (main) main.scrollTop = top;
  if (window.scrollY !== win) window.scrollTo(0, win);
}

function paintAudio() {
  keepScroll(() => {
    const play = root().querySelector("[data-action='play']");
    if (play && session) {
      const failed = session.voice === "failed";
      const playing = session.voice === "playing" || session.voice === "trying";
      const label = failed ? "Try again" : playing ? "Playing…" : "Play";
      if (play.textContent !== label) play.textContent = label;
    }
    const status = root().querySelector("[data-audio-status]");
    if (status && session) {
      const playing = session.voice === "playing" || session.voice === "trying";
      const failText = currentStep()?.type === "type" ? "" : "No voice on this phone. Use the choices.";
      const text = session.voice === "failed" ? failText : playing ? "Playing…" : "";
      if (status.textContent !== text) status.textContent = text;
    }
    const course = currentCourse();
    const step = currentStep();
    if (session?.voice === "failed" && step?.type === "listen" && course && !root().querySelector(".fallback")) {
      const phrase = findPhrase(course, step.phraseId);
      const play = root().querySelector("[data-action='play']");
      const anchor = play?.closest(".listen-row") || play;
      if (phrase && anchor) {
        anchor.insertAdjacentHTML(
          "afterend",
          `<div class="fallback">
            ${hearable(course, speakText(phrase), "roman", esc(phrase.roman))}
            ${scriptLine(course, phrase, speakText(phrase))}
            <p class="hint">No voice on this phone. Use the ${esc(course.romanName.toLowerCase())} and pick the meaning.</p>
          </div>`,
        );
      }
    }
    if (session?.voice === "failed" && step?.type === "type" && course && !root().querySelector(".fallback")) {
      const phrase = findPhrase(course, step.phraseId);
      const play = root().querySelector("[data-action='play']");
      (play?.closest(".listen-row") || play)?.insertAdjacentHTML(
        "afterend",
        `<div class="fallback"><p class="prompt">${esc(phrase?.en || "")}</p><p class="hint">No voice on this phone. Type the ${esc(course.romanName.toLowerCase())} for this meaning.</p></div>`,
      );
    }
    if (session?.hearFailed && session.queue && !root().querySelector("[data-hear-note]")) {
      root().querySelector(".flip-scene")?.insertAdjacentHTML(
        "afterend",
        '<p class="hint" data-hear-note>No voice on this phone. You can still read the phrase.</p>',
      );
    }
  });
}

function currentCourse() {
  return view.courseId ? courseById(view.courseId) : null;
}

function currentNode() {
  const course = currentCourse();
  if (!course || !view.lessonId) return null;
  return coursePath(course).find((node) => node.id === view.lessonId) || null;
}

function feedbackSpeech(course, step) {
  if (!step || step.type === "match" || step.type === "listen") return "";
  if (step.type === "type" || step.type === "speak") {
    const phrase = findPhrase(course, step.phraseId);
    return phrase ? speakText(phrase) : "";
  }
  if (step.type === "choice" && step.direction !== "toRoman") return "";
  const phrase = step.phraseId ? findPhrase(course, step.phraseId) : null;
  return phrase ? speakText(phrase) : "";
}

function answerLine(course, step) {
  const phrase = step?.phraseId ? findPhrase(course, step.phraseId) : null;
  if (step?.type === "tiles") return `${step.answer.join(" ")}  ${phrase?.script || ""}`.trim();
  if (step?.type === "listen" && phrase) return `${phrase.en} · ${phrase.roman}`;
  if ((step?.type === "type" || step?.type === "speak") && phrase) {
    return `${phrase.roman}${scriptLang(course) === "en" ? "" : `  ${phrase.script}`} · ${phrase.en}`;
  }
  if (step?.type === "match") return "Match each line with its meaning.";
  if (step?.type === "choice" && phrase) return step.direction === "toRoman" ? `${phrase.roman}  ${phrase.script}` : phrase.en;
  if (step?.reveal) return step.reveal;
  const option = step?.options?.find((item) => item.id === step.answerId);
  return option?.text || "";
}

function queueRepeat(step) {
  if (!step || session.queued?.[step.uid] || session.mode === "jump") return;
  if (!canQueueRepeat(session.built.steps)) return;
  session.queued[step.uid] = true;
  session.built.steps.push({ ...step, uid: `${step.uid}r`, repeat: true });
}

function spendHeart() {
  session.hearts = Math.max(0, (session.hearts ?? MAX_HEARTS) - 1);
  if (session.hearts <= 0) session.failed = true;
}

function noteAnswer(ok) {
  session.answered += 1;
  if (ok) {
    session.correct += 1;
    session.combo += 1;
    session.bestCombo = Math.max(session.bestCombo, session.combo);
  } else {
    session.combo = 0;
  }
}

function sayResult(ok) {
  if (!ok) sfx(session.failed ? "fail" : "wrong");
  else sfx(session.combo === 5 || session.combo === 10 ? "combo" : "right");
}

function markMissed(phraseId) {
  if (phraseId && !session.missed.includes(phraseId)) session.missed.push(phraseId);
}

// opts.free: a miss that costs no heart (speaking, where the phone may mishear).
function grade(ok, opts = {}) {
  const step = currentStep();
  const course = currentCourse();
  const say = feedbackSpeech(course, step);
  session.feedback = { ok, line: answerLine(course, step), say, note: opts.note || "" };
  noteAnswer(ok);
  if (step.phraseId) {
    let next = ok ? easeMiss(state, session.courseId, step.phraseId) : recordMiss(state, session.courseId, step.phraseId);
    next = reviewPhrase(next, session.courseId, step.phraseId, ok, dayKey());
    save(next);
    if (!ok) markMissed(step.phraseId);
  }
  if (!ok && !opts.free) {
    session.wrongs += 1;
    spendHeart();
    if (!session.failed) queueRepeat(step);
  }
  sayResult(ok);
  render();
}

// ---------- Speaking ----------
let recognizer = null;

function recognitionClass() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function speakingOn() {
  return Boolean(recognitionClass()) && prefs.speakPausedUntil < Date.now();
}

function freshSpeak() {
  return { status: "idle", tries: 0, heard: "", message: "" };
}

function stopListening() {
  const rec = recognizer;
  recognizer = null;
  if (!rec) return;
  try {
    rec.abort();
  } catch (err) {
    /* Already stopped. */
  }
}

function expectedSpeech(course, phrase) {
  return scriptLang(course) === "en" ? phrase.roman : speakText(phrase);
}

function turnOffSpeaking(message) {
  stopListening();
  savePrefs({ speakPausedUntil: Date.now() + SPEAK_PAUSE_MS });
  session.built.steps = session.built.steps.map((step, index) =>
    index >= session.index && step.type === "speak" && step.fallback ? { ...step.fallback, uid: step.uid } : step,
  );
  session.speak = freshSpeak();
  session.notice = message;
  render();
}

function startListening() {
  const Recognition = recognitionClass();
  const course = currentCourse();
  const step = currentStep();
  if (!Recognition || !step || step.type !== "speak" || session.feedback) return;
  stopSpeech();
  let rec;
  try {
    rec = new Recognition();
  } catch (err) {
    turnOffSpeaking("Speaking isn't available on this phone, so those questions are off for now.");
    return;
  }
  recognizer = rec;
  rec.lang = course.voice;
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 5;
  const forIndex = session.index;
  let heardSomething = false;
  session.speak = { ...session.speak, status: "listening", message: "" };
  render();
  rec.onresult = (event) => {
    heardSomething = true;
    const alternatives = [];
    for (const result of event.results) {
      for (let i = 0; i < result.length; i += 1) alternatives.push(result[i].transcript);
    }
    handleHeard(alternatives, forIndex, rec);
  };
  rec.onerror = (event) => {
    if (recognizer !== rec || !session || session.index !== forIndex) return;
    recognizer = null;
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      turnOffSpeaking("The microphone isn't available, so speaking questions are off for an hour.");
      return;
    }
    session.speak.status = "idle";
    session.speak.message =
      event.error === "no-speech" ? "Didn't hear anything. Tap the mic and try again." : "Couldn't listen just now. Tap the mic to try again.";
    render();
  };
  rec.onend = () => {
    if (recognizer !== rec || !session || session.index !== forIndex) return;
    recognizer = null;
    if (!heardSomething && session.speak.status === "listening") {
      session.speak.status = "idle";
      session.speak.message = "Didn't hear anything. Tap the mic and try again.";
      render();
    }
  };
  try {
    rec.start();
  } catch (err) {
    recognizer = null;
    session.speak.status = "idle";
    render();
  }
}

function handleHeard(alternatives, forIndex, rec) {
  if (recognizer === rec) recognizer = null;
  if (!session || session.index !== forIndex || session.feedback) return;
  const course = currentCourse();
  const step = currentStep();
  const phrase = findPhrase(course, step.phraseId);
  if (!phrase) return;
  const result = speechPasses(expectedSpeech(course, phrase), alternatives, course.voice);
  const heard = alternatives[0] || "";
  session.speak.heard = heard;
  if (result.ok) {
    grade(true);
    return;
  }
  session.speak.tries += 1;
  if (session.speak.tries >= 2) {
    grade(false, { free: true, note: heard ? `It sounded like “${heard}”. It'll come back for practice.` : "" });
    return;
  }
  session.speak.status = "idle";
  session.speak.message = "Not quite. Listen once more, then try again.";
  sfx("wrong");
  render();
}

function advance() {
  stopSpeech();
  session.feedback = null;
  session.tiles = [];
  session.matchSel = null;
  session.badPair = null;
  session.matched = [];
  session.matchMissed = false;
  session.matchOrder = null;
  session.matchCols = null;
  session.matchBad = [];
  session.pickedOption = null;
  session.typed = "";
  session.speak = freshSpeak();
  session.notice = "";
  session.voice = "idle";
  session.index += 1;
  if (!currentStep()) {
    finishLesson();
    return;
  }
  session.phase = "run";
  render();
}

function beginBuilt(courseId, unitId, lessonId, nodeKind, built, practice, extra = {}) {
  stopSpeech();
  const mode = extra.mode || "node";
  const maxHearts = mode === "jump" ? JUMP_HEARTS : MAX_HEARTS;
  built.steps = (built.steps || []).map((step, index) => ({ ...step, uid: String(index) }));
  session = {
    courseId,
    unitId,
    lessonId,
    nodeKind,
    built,
    index: 0,
    phase: "run",
    feedback: null,
    tiles: [],
    matchSel: null,
    matched: [],
    matchMissed: false,
    badPair: null,
    matchOrder: null,
    queued: {},
    hearts: maxHearts,
    maxHearts,
    mode,
    jumpIndex: extra.jumpIndex ?? null,
    refreshUnit: extra.refreshUnit ?? null,
    answered: 0,
    correct: 0,
    combo: 0,
    bestCombo: 0,
    missed: [],
    startedAt: Date.now(),
    typed: "",
    speak: freshSpeak(),
    notice: "",
    confirmQuit: false,
    failed: false,
    voice: "idle",
    wrongs: 0,
    result: null,
    practice,
    resume: null,
    autoFor: null,
    gated: false,
  };
  view = { name: "lesson", courseId, unitId, lessonId };
  resetScroll = true;
  render();
}

function lessonOpts() {
  return { speak: speakingOn(), today: dayKey() };
}

function beginNode(courseId, node) {
  const course = courseById(courseId);
  const built = buildNodeLesson(course, node, state, Math.random, lessonOpts());
  beginBuilt(courseId, node.unitId, node.id, node.kind, built, false);
}

function beginRefresh(courseId, unitId) {
  const course = courseById(courseId);
  const built = buildRefreshLesson(course, unitId || null, state, Math.random, lessonOpts());
  beginBuilt(courseId, unitId || "review", `refresh-${unitId || "all"}`, "refresh", built, false, {
    mode: "refresh",
    refreshUnit: unitId || null,
  });
}

function beginJump(courseId, unitIndex) {
  const course = courseById(courseId);
  const unit = course?.units[unitIndex];
  if (!unit || unitIndex < 1) return;
  const built = buildJumpTest(course, unitIndex, Math.random, lessonOpts());
  beginBuilt(courseId, unit.id, `jump-${unitIndex}`, "jump", built, false, { mode: "jump", jumpIndex: unitIndex });
}

// Starts any lesson from its id: a path node, refresh-<unit|all>, or jump-<unit number>.
function beginById(courseId, lessonId) {
  const course = courseById(courseId);
  if (!course) return false;
  if (String(lessonId).startsWith("refresh-")) {
    const unitId = lessonId.slice("refresh-".length);
    beginRefresh(courseId, unitId === "all" ? null : unitId);
    return true;
  }
  if (String(lessonId).startsWith("jump-")) {
    beginJump(courseId, Number(lessonId.slice("jump-".length)));
    return Boolean(session);
  }
  const node = coursePath(course).find((item) => item.id === lessonId);
  if (!node) return false;
  beginNode(courseId, node);
  return true;
}

function startNode(courseId, nodeId) {
  const course = courseById(courseId);
  const nodes = coursePath(course);
  const index = nodes.findIndex((node) => node.id === nodeId);
  const node = nodes[index];
  if (!node || !nodeUnlocked(state, course, index)) return;
  const unit = unitById(course, node.unitId);
  if (node.kind === "checkpoint" && unit && isNodeDone(state, course, node) && unitCracked(state, course, unit)) {
    beginRefresh(courseId, unit.id);
  } else {
    beginNode(courseId, node);
  }
  writeHistory("push");
}

function startRefresh(courseId, unitId) {
  beginRefresh(courseId, unitId);
  writeHistory("push");
}

function startJump(courseId, unitIndex) {
  beginJump(courseId, unitIndex);
  if (session) writeHistory("push");
}

function retryLesson() {
  if (!session?.courseId) return;
  if (beginById(session.courseId, session.lessonId)) writeHistory("replace");
}

function screenSnapshot() {
  return {
    name: view.name,
    courseId: view.courseId || null,
    unitId: view.unitId || null,
    lessonId: view.lessonId || null,
    phase: session?.phase || null,
    result: session?.phase === "done" ? session.result : null,
    wrongs: session?.wrongs || 0,
    title: session?.built?.title || null,
  };
}

function screenUrl(saved) {
  const path = window.location.pathname;
  if (!saved || saved.name === "home") return path;
  const params = new URLSearchParams();
  params.set("screen", saved.name);
  if (saved.courseId) params.set("course", saved.courseId);
  if (saved.unitId) params.set("unit", saved.unitId);
  if (saved.lessonId) params.set("lesson", saved.lessonId);
  if (saved.phase === "done") params.set("phase", "done");
  return `${path}?${params.toString()}`;
}

function writeHistory(mode) {
  const saved = screenSnapshot();
  const data = { app: true, view: saved };
  if (mode === "replace") history.replaceState(data, "", screenUrl(saved));
  else history.pushState(data, "", screenUrl(saved));
}

function goHome() {
  stopSpeech();
  session = null;
  view = { name: "home" };
  writeHistory("push");
  resetScroll = true;
  render();
}

function goCourse(courseId) {
  stopSpeech();
  session = null;
  view = { name: "course", courseId };
  writeHistory("push");
  resetScroll = true;
  render();
}

function restoreDone(saved) {
  session = {
    courseId: saved.courseId,
    unitId: saved.unitId,
    lessonId: saved.lessonId,
    built: { title: saved.title || "Done" },
    queue: null,
    flipped: false,
    finished: 0,
    index: 0,
    picked: null,
    voice: "idle",
    wrongs: saved.wrongs || 0,
    phase: "done",
    result: saved.result,
    confettiPlayed: true,
  };
  view = {
    name: "lesson",
    courseId: saved.courseId,
    unitId: saved.unitId,
    lessonId: saved.lessonId,
  };
  resetScroll = true;
  render();
}

function showHistory(saved) {
  stopSpeech();
  if (lockedOut()) {
    pendingView = saved && saved.name && saved.name !== "account" ? saved : { name: "home" };
    session = null;
    view = { name: "account" };
    resetScroll = true;
    render();
    return;
  }
  if (!saved || saved.name === "home") {
    session = null;
    view = { name: "home" };
    resetScroll = true;
    render();
    return;
  }
  if (saved.name === "account") {
    session = null;
    view = { name: "account" };
    resetScroll = true;
    render();
    return;
  }
  if (saved.name === "lesson" && saved.phase === "done" && saved.result) {
    restoreDone(saved);
    return;
  }
  if (saved.name === "lesson") {
    const course = courseById(saved.courseId);
    if (!course) {
      goHome();
      return;
    }
    if (!beginById(saved.courseId, saved.lessonId)) {
      view = { name: "course", courseId: saved.courseId };
      session = null;
      render();
    }
    return;
  }
  session = null;
  view = {
    name: saved.name,
    courseId: saved.courseId,
    unitId: saved.unitId,
    lessonId: saved.lessonId,
  };
  resetScroll = true;
  render();
}

function goBack() {
  if (history.state?.app) history.back();
}

function finishLesson() {
  if (!session || session.phase === "done") return;
  stopSpeech();
  const today = dayKey();
  const course = currentCourse();
  let start = state;
  if (session.mode === "jump") start = applyJump(state, course, session.jumpIndex, today);
  const lessonId = session.nodeKind === "sounds" ? "sounds" : session.lessonId;
  const result = completeLesson(start, {
    courseId: session.courseId,
    unitId: session.unitId,
    lessonId,
    xp: baseXpFor(session.mode === "node" ? session.nodeKind : session.mode),
    today,
    perfect: session.answered > 0 && session.answered === session.correct,
    bestCombo: session.bestCombo,
    mark: session.mode === "node",
  });
  let next = result.state;
  const node = session.mode === "node" ? currentNode() : null;
  if (node?.phraseIds?.length) next = seedPhrases(next, session.courseId, node.phraseIds, today);
  save(next);
  const { state: _saved, ...kept } = result;
  kept.summary = {
    mode: session.mode,
    jumpIndex: session.jumpIndex,
    accuracy: session.answered ? Math.round((session.correct / session.answered) * 100) : 100,
    seconds: Math.max(1, Math.round((Date.now() - session.startedAt) / 1000)),
    bestCombo: session.bestCombo,
    missed: session.missed.slice(0, 8),
  };
  sfx("done");
  session.phase = "done";
  session.result = kept;
  writeHistory("replace");
  resetScroll = true;
  render();
}

function currentStep() {
  return session?.built?.steps?.[session.index] || null;
}

function onClick(event) {
  if (!root().contains(event.target)) return;
  const sayEl = event.target.closest("[data-say]");
  if (sayEl && sayEl.dataset.say) {
    const course = currentCourse();
    if (course) speakNow(sayEl.dataset.say, course.voice);
  }
  const el = event.target.closest("[data-action]");
  if (!el || !root().contains(el)) return;
  const action = el.dataset.action;

  if (action === "back") {
    event.preventDefault();
    goBack();
    return;
  }
  if (action === "course") return goCourse(el.dataset.course);
  if (action === "node") return startNode(view.courseId, el.dataset.node);
  if (action === "refresh") return startRefresh(view.courseId, el.dataset.unit || null);
  if (action === "jump") return startJump(view.courseId, Number(el.dataset.unitIndex));
  if (action === "toggle-sfx") {
    savePrefs({ sfx: !prefs.sfx });
    if (prefs.sfx) sfx("right");
    render();
    return;
  }
  if (action === "toggle-speak") {
    savePrefs({ speakPausedUntil: speakingOn() ? Date.now() + SPEAK_PAUSE_MS : 0 });
    render();
    return;
  }
  if (action === "retry") return retryLesson();
  if (["account", "sign-in", "create-account", "toggle-mode", "sign-out"].includes(action)) {
    event.preventDefault();
    accountAction(action);
    return;
  }
  if (action === "dismiss-install") {
    save(dismissInstallHint(state));
    render();
    return;
  }
  if (!session || session.phase === "done") {
    if (action === "done-next") return afterLesson(true);
    if (action === "done-stop") return afterLesson(false);
    return;
  }
  if (action === "quit") {
    event.preventDefault();
    if (session.answered > 0 && !session.failed) {
      session.confirmQuit = true;
      render();
      return;
    }
    goBack();
    return;
  }
  if (action === "quit-cancel") {
    session.confirmQuit = false;
    render();
    return;
  }
  if (action === "quit-confirm") {
    session.confirmQuit = false;
    goBack();
    return;
  }
  if (action === "mic") {
    if (session.speak.status === "listening") {
      const rec = recognizer;
      try {
        rec?.stop();
      } catch (err) {
        /* Already stopped. */
      }
      return;
    }
    startListening();
    return;
  }
  if (action === "skip-speak") {
    turnOffSpeaking("Speaking is off for an hour. You can turn it back on from Account.");
    return;
  }
  if (action === "type-check") {
    if (session.feedback) return;
    const step = currentStep();
    const value = document.getElementById("type-input")?.value || "";
    if (!value.trim()) return;
    session.typed = value;
    const course = currentCourse();
    const result = checkTyped(step.answer, value, scriptLang(course) !== "en");
    grade(result.ok, { note: result.ok && result.typo ? `Watch the spelling: ${step.answer}` : "" });
    return;
  }
  if (action === "check-pick") {
    if (session.feedback || !session.pickedOption) return;
    const step = currentStep();
    grade(session.pickedOption === step.answerId);
    return;
  }

  if (action === "replay" || action === "play" || action === "slow" || action === "example") {
    event.preventDefault();
    const course = currentCourse();
    const step = currentStep();
    const slow = action === "slow";
    if (action === "example") {
      const example = step?.examples?.[Number(el.dataset.index)];
      if (example) playLine(example.speak || example.script, course.voice, example.roman, slow);
      return;
    }
    if (step?.speak?.script) playLine(step.speak.script, course.voice, step.speak.roman || "", slow);
    else if (step?.phraseId) {
      const phrase = findPhrase(course, step.phraseId);
      if (phrase) playLine(speakText(phrase), course.voice, phrase.roman, slow);
    }
    return;
  }
  if (action === "tile") {
    if (session.feedback) return;
    const key = el.dataset.key;
    if (session.tiles.some((tile) => tile.key === key)) session.tiles = session.tiles.filter((tile) => tile.key !== key);
    else session.tiles.push({ key, text: el.dataset.text, say: el.dataset.say || el.dataset.text });
    render();
    return;
  }
  if (action === "check") {
    if (session.feedback) return;
    const step = currentStep();
    const got = session.tiles.map((tile) => tile.text);
    const sameWord = (a, b) => a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US");
    grade(got.length === step.answer.length && got.every((word, index) => sameWord(word, step.answer[index])));
    return;
  }
  if (action === "pick") {
    if (session.feedback) return;
    session.pickedOption = el.dataset.option;
    render();
    return;
  }
  if (action === "pair") {
    if (session.feedback) return;
    const [side, id] = el.dataset.pair.split(":");
    if (session.matched.includes(id)) return;
    session.badPair = null;
    if (!session.matchSel || session.matchSel.side === side) {
      session.matchSel = { side, id };
      render();
      return;
    }
    if (session.matchSel.id === id) {
      session.matched.push(id);
      session.matchSel = null;
      const step = currentStep();
      if (session.matched.length === step.pairs.length) {
        if (session.matchMissed) queueRepeat(step);
        const bad = session.matchBad || [];
        const today = dayKey();
        for (const pair of step.pairs) {
          const wrong = bad.includes(pair.id);
          let next = wrong ? recordMiss(state, session.courseId, pair.id) : easeMiss(state, session.courseId, pair.id);
          next = reviewPhrase(next, session.courseId, pair.id, !wrong, today);
          save(next);
          if (wrong) markMissed(pair.id);
        }
        session.matchBad = [];
        const ok = !session.matchMissed;
        noteAnswer(ok);
        session.feedback = {
          ok,
          line: ok ? `All ${step.pairs.length} pairs matched.` : "Some pairs were mixed. They'll come back.",
        };
        sayResult(ok);
      } else {
        sfx("right");
      }
      render();
      return;
    }
    session.matchMissed = true;
    session.badPair = [session.matchSel.id, id];
    session.matchBad = [...new Set([...(session.matchBad || []), session.matchSel.id, id])];
    session.matchSel = null;
    session.wrongs += 1;
    spendHeart();
    session.combo = 0;
    if (session.failed) {
      session.feedback = { ok: false, line: "Out of hearts. This lesson stops here." };
      sfx("fail");
      render();
      return;
    }
    sfx("wrong");
    render();
    return;
  }
  if (action === "next" || action === "continue") {
    const step = currentStep();
    if (session.failed) return;
    if (step?.type === "slide" || session.feedback) advance();
  }
}

function afterLesson(goOn) {
  const course = currentCourse();
  const summary = session.result?.summary;
  if (goOn && course && summary?.mode === "jump" && !session.failed) {
    const unit = course.units[summary.jumpIndex];
    const first = coursePath(course).find((node) => node.unitId === unit?.id);
    stopSpeech();
    if (first) {
      beginNode(course.id, first);
      writeHistory("replace");
      return;
    }
  }
  if (summary?.mode === "refresh" || summary?.mode === "jump") {
    stopSpeech();
    goBack();
    return;
  }
  const nodes = course ? coursePath(course) : [];
  const index = nodes.findIndex((node) => node.id === session.lessonId);
  const next = nodes[index + 1];
  stopSpeech();
  if (goOn && next && !session.failed) {
    startNode(course.id, next.id);
    return;
  }
  goBack();
}

function revealCard() {
  if (!session || session.flipped) return;
  session.flipped = true;
  const card = root().querySelector(".flip-card");
  const slot = root().querySelector("[data-flip-slot]");
  if (!card || !slot) {
    render();
    return;
  }
  card.classList.add("is-flipped");
  card.setAttribute("aria-pressed", "true");
  slot.outerHTML = `<div class="pair" data-flip-slot>
      <button type="button" class="secondary" data-action="again">Again</button>
      <button type="button" class="primary" data-action="got">Got it</button>
    </div>`;
}

function motionOk() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function startConfetti(canvas, kind) {
  if (!motionOk()) {
    canvas.remove();
    return;
  }
  const host = canvas.parentElement;
  const width = host.clientWidth;
  const height = host.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const big = kind === "goal";
  const colors = ["#9d3414", "#d4653a", "#1c3f68", "#d7a441", "#1f7a4d"];
  const makePiece = (wide) => {
    const spread = (Math.random() - 0.5) * (wide ? 2.3 : 1.35);
    const speed = (wide ? 460 : 300) * (0.62 + Math.random() * 0.55);
    return {
      x: width / 2 + (Math.random() - 0.5) * (wide ? 90 : 40),
      y: height * 0.4,
      vx: Math.sin(spread) * speed,
      vy: -Math.cos(spread) * speed * 0.92,
      w: 5 + Math.random() * (wide ? 7 : 4),
      h: 3 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 7,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  };
  const pieces = Array.from({ length: big ? 84 : 38 }, () => makePiece(big));
  canvas.dataset.pieces = String(pieces.length);
  const duration = big ? 2300 : 1500;
  let last = performance.now();
  let extra = false;
  const started = last;
  const tick = (now) => {
    if (!canvas.isConnected) return;
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const elapsed = now - started;
    if (big && !extra && elapsed > 280) {
      extra = true;
      for (let i = 0; i < 42; i += 1) pieces.push(makePiece(true));
      canvas.dataset.pieces = String(pieces.length);
    }
    ctx.clearRect(0, 0, width, height);
    const fade = elapsed < duration * 0.65 ? 1 : Math.max(0, 1 - (elapsed - duration * 0.65) / (duration * 0.35));
    ctx.globalAlpha = fade;
    for (const piece of pieces) {
      piece.vy += 1280 * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.vx *= 0.992;
      piece.rot += piece.vr * dt;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rot);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}

function render() {
  const previous = root().querySelector(".main");
  const keepMain = resetScroll ? 0 : previous?.scrollTop || 0;
  const keepWin = resetScroll ? 0 : window.scrollY;
  const shouldReset = resetScroll;
  resetScroll = false;
  const app = root();
  const course = currentCourse();
  app.className = `${course ? `tone-${course.id}` : "tone-home"}${view.name === "lesson" ? " screen" : ""}`;
  let html = "";
  if (account.enabled && !account.ready) html = `<p class="boot">Travel Speak</p>`;
  else if (lockedOut() || view.name === "account") html = renderAccount();
  else if (view.name === "home") html = renderHome();
  else if (view.name === "course" || view.name === "unit") html = renderCourse(course);
  else html = renderLesson(course);
  app.innerHTML = html;
  const burst = app.querySelector(".confetti");
  if (burst && session && !session.confettiPlayed) {
    session.confettiPlayed = true;
    startConfetti(burst, burst.dataset.kind);
  }
  const title =
    view.name === "home"
      ? "Travel Speak"
      : view.name === "account"
        ? "Account"
      : view.name === "lesson"
        ? session?.built?.title || "Lesson"
        : course?.name || "Travel Speak";
  document.title = title === "Travel Speak" ? title : `${title} · Travel Speak`;
  const next = app.querySelector(".main");
  if (next) next.scrollTop = keepMain;
  if (shouldReset) window.scrollTo(0, 0);
  else if (window.scrollY !== keepWin) window.scrollTo(0, keepWin);
  if (shouldReset) app.querySelector(".path-node.current")?.scrollIntoView({ block: "center" });
  const step = currentStep();
  const heard = step?.type === "listen" || (step?.type === "type" && !session.feedback);
  if (session?.phase === "run" && heard && session.autoFor !== session.index) {
    session.autoFor = session.index;
    const phrase = findPhrase(course, step.phraseId);
    if (phrase) playLine(speakText(phrase), course.voice, phrase.roman);
  }
  if (session?.phase === "run" && step?.type === "type" && !session.feedback && session.focusFor !== session.index) {
    session.focusFor = session.index;
    document.getElementById("type-input")?.focus({ preventScroll: true });
  }
}

function heartRow() {
  const max = session?.maxHearts ?? MAX_HEARTS;
  const hearts = session?.hearts ?? max;
  const icons = Array.from({ length: max }, (_, index) => `<span class="heart ${index < hearts ? "on" : "off"}">♥</span>`).join("");
  const label = `${hearts} of ${max} hearts`;
  return `<div class="hearts" aria-label="${label}"><span class="heart-icons">${icons}</span><span>${esc(label)}</span></div>`;
}

function banner() {
  const bits = [];
  if (!navigator.onLine) bits.push("You're offline. Everything here still works.");
  if (!saveOk) bits.push("Couldn't save on this phone. Progress may not stick if you leave.");
  if (!bits.length) return "";
  return `<p class="banner">${bits.map(esc).join(" ")}</p>`;
}

function accountLine() {
  if (!account.enabled || !account.user) return "";
  const note = account.syncing ? "Saving…" : `Signed in as ${account.user.username}. Progress saves to your account.`;
  return `
    <section class="account-line">
      <p class="fine">${esc(note)}</p>
      <button type="button" class="text" data-action="account">Account</button>
    </section>`;
}

function renderAccount() {
  const error = account.error ? `<p class="banner error" role="alert">${esc(account.error)}</p>` : "";
  const top = account.user ? topbar("Account") : `<header class="topbar"><h1>Travel Speak</h1></header>`;
  if (account.user) {
    const status = account.syncing ? "Saving to your account now." : "Your progress saves to your account automatically.";
    return `
      ${top}
      <main class="main account">
        ${error}
        <p class="lede">Signed in as <strong>${esc(account.user.username)}</strong>.</p>
        <p>${esc(status)} Sign in with the same username on another phone or computer to pick up where you left off.</p>
        <section class="settings" aria-label="Settings on this phone">
          <h2>On this phone</h2>
          <button type="button" class="setting" data-action="toggle-sfx" aria-pressed="${prefs.sfx}">
            <span>Sound effects</span><strong>${prefs.sfx ? "On" : "Off"}</strong>
          </button>
          ${recognitionClass() ? `<button type="button" class="setting" data-action="toggle-speak" aria-pressed="${speakingOn()}">
            <span>Speaking questions</span><strong>${speakingOn() ? "On" : "Off for now"}</strong>
          </button>` : `<p class="fine">This browser can't listen, so speaking questions are skipped.</p>`}
        </section>
        <div class="stack">
          <button type="button" class="secondary" data-action="sign-out">Sign out</button>
        </div>
        <p class="fine">Signing out returns you to the sign-in screen. Progress on this phone is kept for the next sign-in.</p>
      </main>`;
  }
  if (!account.enabled) {
    return `
      ${top}
      <main class="main account">
        <h2>Accounts aren't set up yet</h2>
        <p class="lede">Travel Speak needs an account to save progress. The app's owner still has to add the Firebase settings in js/firebase-config.js.</p>
      </main>`;
  }
  const creating = account.mode === "create";
  return `
    ${top}
    <main class="main account">
      ${error}
      <h2>${creating ? "Create an account" : "Sign in"}</h2>
      <p class="lede">${creating ? "Create an account to use the lessons. Your streak, XP, and finished lessons save to that account." : "Sign in to use the lessons. Your progress is saved to your account."}</p>
      <label class="field"><span>Username</span><input id="acct-user" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(account.draftUser || "")}"></label>
      <label class="field"><span>Password</span><input id="acct-pass" type="password" autocomplete="${creating ? "new-password" : "current-password"}"></label>
      ${creating ? `<label class="field"><span>Password again</span><input id="acct-pass2" type="password" autocomplete="new-password"></label>` : ""}
      <button type="button" class="primary" data-action="${creating ? "create-account" : "sign-in"}" ${account.busy ? "disabled" : ""}>${account.busy ? "One moment…" : creating ? "Create account" : "Sign in"}</button>
      <button type="button" class="text" data-action="toggle-mode">${creating ? "Have an account? Sign in" : "New here? Create an account"}</button>
      ${creating ? `<p class="fine">There's no email, so write your password down. If you forget it, only the app's owner can reset it.</p>` : ""}
    </main>`;
}

function goAccount() {
  stopSpeech();
  session = null;
  view = { name: "account" };
  writeHistory("push");
  resetScroll = true;
  render();
}

async function accountAction(action) {
  const value = (id) => document.getElementById(id)?.value || "";
  if (action === "account") return goAccount();
  if (action === "toggle-mode") {
    account.mode = account.mode === "create" ? "signin" : "create";
    account.error = "";
    account.draftUser = value("acct-user");
    render();
    return;
  }
  if (action === "sign-out") {
    account.mode = "signin";
    account.error = "";
    pendingView = null;
    stopSpeech();
    session = null;
    view = { name: "account" };
    writeHistory("replace");
    resetScroll = true;
    await signOutAccount();
    render();
    return;
  }
  if (!navigator.onLine) {
    account.error = "You're offline. Try again when you're connected.";
    render();
    return;
  }
  const username = value("acct-user");
  const password = value("acct-pass");
  const confirm = value("acct-pass2");
  account.draftUser = username;
  account.busy = true;
  render();
  if (action === "sign-in") await signIn(username, password);
  else if (action === "create-account") await createAccount(username, password, confirm);
  account.busy = false;
  render();
}

function renderHome() {
  const today = dayKey();
  const streak = visibleStreak(state, today);
  const xpToday = dailyXp(state, today);
  const goal = Math.min(100, Math.round((xpToday / DAILY_GOAL) * 100));
  const goalLabel = xpToday >= DAILY_GOAL ? "Daily goal done" : `${xpToday} of ${DAILY_GOAL} XP today`;
  const install =
    !isStandalone() && !state.installHintDismissed
      ? `<section class="install">
          <h2>Add this to your iPhone</h2>
          <p>Open this page in Safari. Tap Share, then Add to Home Screen, then Add. The icon says Speak. After one visit online, it works offline.</p>
          <button type="button" class="text" data-action="dismiss-install">Hide this</button>
        </section>`
      : "";
  return `
    <main class="main home">
      ${banner()}
      <p class="eyebrow">Your courses</p>
      <h1>Travel Speak</h1>
      <p class="lede">Say a little Mandarin, Japanese, Spanish, and German. You don't have to read the writing.</p>
      <section class="stats" aria-label="Progress">
        <div class="stat"><strong>${streak}</strong><span>${streak === 1 ? "day streak" : "day streak"}</span></div>
        <div class="stat"><strong>${state.xp}</strong><span>XP</span></div>
      </section>
      <div class="goal">
        <div class="track" role="meter" aria-valuemin="0" aria-valuemax="${DAILY_GOAL}" aria-valuenow="${Math.min(xpToday, DAILY_GOAL)}" aria-label="Daily goal">
          <div class="fill" style="width:${goal}%"></div>
        </div>
        <span>${esc(goalLabel)}</span>
      </div>
      <div class="course-list">
        ${COURSES.map((course) => courseCard(course)).join("")}
      </div>
      ${install}
      ${accountLine()}
    </main>`;
}

function pathProgress(course) {
  const nodes = coursePath(course);
  const done = nodes.filter((node) => isNodeDone(state, course, node)).length;
  return { done, total: nodes.length };
}

function courseCard(course) {
  const progress = pathProgress(course);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const due = courseDue(state, course).length;
  const status = `${progress.done > 0 ? `${progress.done} of ${progress.total}` : "Not started"}${due ? ` · ${due} to review` : ""}`;
  return `
    <button type="button" class="course-card tone-${course.id}" data-action="course" data-course="${course.id}">
      <span class="place">${esc(course.place)}</span>
      <strong>${esc(course.name)}</strong>
      <span class="meta">${esc(course.romanName)} · ${status}</span>
      <span class="track slim" aria-hidden="true"><span class="fill" style="width:${pct}%"></span></span>
    </button>`;
}

function renderCourse(course) {
  const today = dayKey();
  const nodes = coursePath(course);
  const current = nodes.findIndex((node, index) => nodeUnlocked(state, course, index) && !isNodeDone(state, course, node));
  let seenUnit = "";
  let unitNumber = 0;
  const rows = nodes
    .map((node, index) => {
      const unlocked = nodeUnlocked(state, course, index);
      const done = isNodeDone(state, course, node);
      const isCurrent = index === current;
      const slot = index % 4;
      const pos = slot === 1 ? "right" : slot === 3 ? "left" : "mid";
      let head = "";
      if (node.kind === "sounds") {
        head = `<li class="path-slot head"><p class="path-kicker">Sounds</p></li>`;
      } else if (node.unitId !== seenUnit) {
        seenUnit = node.unitId;
        unitNumber += 1;
        const unit = unitById(course, node.unitId);
        const unitIndex = course.units.findIndex((item) => item.id === unit.id);
        const jump = !unlocked && unitIndex > 0
          ? `<button type="button" class="jump-btn" data-action="jump" data-unit-index="${unitIndex}">Know this already? Jump here</button>`
          : "";
        const crack = unitCracked(state, course, unit, today) ? `<p class="crack-note">Some of these are fading. Tap ↻ to refresh.</p>` : "";
        head = `<li class="path-slot head"><header class="unit-head"><p class="eyebrow">Unit ${unitNumber}</p><h2>${esc(unit.title)}</h2><p>${esc(unit.blurb)}</p>${crack}${jump}</header></li>`;
      }
      const nodeUnit = unitById(course, node.unitId);
      const cracked = node.kind === "checkpoint" && done && nodeUnit && unitCracked(state, course, nodeUnit, today);
      const icon = cracked ? "↻" : done ? "✓" : node.kind === "checkpoint" ? "★" : node.kind === "sounds" ? "Aa" : String((index % 9) + 1);
      const label = cracked ? "Refresh" : node.kind === "checkpoint" ? "Review" : node.title;
      return `${head}<li class="path-slot ${pos}">
        <button type="button" class="path-node ${done ? "done" : ""} ${cracked ? "cracked" : ""} ${isCurrent ? "current" : ""} ${unlocked ? "" : "locked"} ${node.kind}" data-action="node" data-node="${esc(node.id)}" ${unlocked ? "" : "disabled"} aria-label="${esc(label)}${cracked ? ", needs a refresh" : ""}">
          <span>${icon}</span>
        </button>
        <span class="node-label">${esc(label)}</span>
      </li>`;
    })
    .join("");
  const due = courseDue(state, course, today).length;
  const review = due
    ? `<button type="button" class="review-card" data-action="refresh">
        <strong>Review</strong>
        <span>${due} ${due === 1 ? "phrase is" : "phrases are"} due. A short lesson keeps them fresh.</span>
      </button>`
    : "";
  return `
    ${topbar(course.name)}
    <main class="main path-main">
      ${banner()}
      <p class="lede tight">${esc(course.blurb)}</p>
      ${review}
      <ol class="winding">${rows}</ol>
    </main>`;
}


function topbar(title) {
  return `
    <header class="topbar">
      <button type="button" class="back-btn" data-action="back" aria-label="Back">
        ${backSvg()}<span>Back</span>
      </button>
      <h1>${esc(title)}</h1>
    </header>`;
}

// One way out of a lesson: the X. Mid-lesson it asks first, so a stray tap doesn't lose the lesson.
function lessonBar(title, running = false) {
  return `
    <header class="topbar lesson-bar">
      <button type="button" class="icon-btn" data-action="${running ? "quit" : "back"}" aria-label="Close lesson">
        ${closeSvg()}
      </button>
      <h1>${esc(title)}</h1>
      <span class="icon-btn spacer" aria-hidden="true"></span>
    </header>`;
}

function quitModal() {
  if (!session?.confirmQuit) return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="quit-title">
        <h2 id="quit-title">Quit this lesson?</h2>
        <p>You'll lose your progress in this lesson. Your XP and streak so far are safe.</p>
        <button type="button" class="primary" data-action="quit-cancel">Keep going</button>
        <button type="button" class="text danger" data-action="quit-confirm">Quit</button>
      </div>
    </div>`;
}

function renderLesson(course) {
  if (!session) return renderCourse(course);
  if (session.phase === "done") return renderDone(course);
  return renderQuestion(course);
}

function lessonProgress(doneCount, total) {
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  return `<div class="track lesson-track" aria-hidden="true"><div class="fill" style="width:${pct}%"></div></div>`;
}

function feedbackBlock() {
  if (!session.feedback) return "";
  const ok = session.feedback.ok;
  const line = session.feedback.say
    ? hearable(currentCourse(), session.feedback.say, "feedback-line", esc(session.feedback.line))
    : `<p>${esc(session.feedback.line)}</p>`;
  const note = session.feedback.note ? `<p class="feedback-note">${esc(session.feedback.note)}</p>` : "";
  const combo = ok && session.combo >= 3 ? `<span class="combo">${session.combo} in a row</span>` : "";
  return `<div class="feedback ${ok ? "ok" : "bad"}" role="status"><strong>${ok ? "Nice." : "Not quite."}${combo}</strong>${line}${note}</div>`;
}

function renderQuestion(course) {
  const step = currentStep();
  const total = session.built.steps.length;
  const note = accentNote(course);
  let body = "";
  if (!step) body = "";
  else if (step.type === "slide") body = renderSlide(course, step, note);
  else if (step.type === "listen") body = renderListen(course, step);
  else if (step.type === "tiles") body = renderTiles(course, step);
  else if (step.type === "match") body = renderMatch(course, step);
  else if (step.type === "type") body = renderType(course, step);
  else if (step.type === "speak") body = renderSpeak(course, step);
  else body = renderChoice(course, step, note);
  const showContinue = step?.type === "slide" || session.feedback;
  const picks = step?.type === "choice" || step?.type === "listen";
  const tileReady = step?.type === "tiles" && session.tiles.length > 0;
  const ready = step?.type === "tiles" ? tileReady : picks ? Boolean(session.pickedOption) : step?.type === "type" ? Boolean(session.typed.trim()) : false;
  const showCheck = (step?.type === "tiles" || picks || step?.type === "type") && !session.feedback;
  const checkAction = step?.type === "tiles" ? "check" : step?.type === "type" ? "type-check" : "check-pick";
  const continueLabel = session.failed ? "Try again" : session.index === total - 1 ? "Finish" : "Continue";
  const continueAction = session.failed ? "retry" : "continue";
  const leave = session.failed ? `<button type="button" class="text" data-action="done-stop">Back to the path</button>` : "";
  const dock = `
    ${feedbackBlock()}
    ${showCheck ? `<button type="button" class="primary" data-action="${checkAction}" ${ready ? "" : "disabled"}>Check</button>` : ""}
    ${showContinue ? `<button type="button" class="primary" data-action="${continueAction}">${continueLabel}</button>` : ""}
    ${leave}`;
  const notice = session.notice ? `<p class="banner">${esc(session.notice)}</p>` : "";
  return `
    ${lessonBar(session.built.title, true)}
    ${lessonProgress(session.index, total)}
    <div class="lesson-hearts">${heartRow()}</div>
    <main class="main lesson">
      ${notice}
      <p class="count">${Math.min(session.index + 1, total)} of ${total}</p>
      ${body}
    </main>
    <footer class="dock ${session.feedback ? (session.feedback.ok ? "is-ok" : "is-bad") : ""}">${dock}</footer>
    ${quitModal()}`;
}

function renderSlide(course, step, note) {
  const examples = (step.examples || [])
    .map(
      (example, index) => `
      <figure class="example">
        <figcaption>
          ${hearable(course, example.speak || (scriptLang(course) === "en" ? example.roman : example.script || example.roman), "roman", esc(example.roman))}
          ${scriptLang(course) === "en" ? `<span class="script" lang="en">${esc(example.script || "")}</span>` : hearable(course, example.script || example.roman, "script", esc(example.script || ""))}
        </figcaption>
        <p>${esc(example.gloss || "")}</p>
        <button type="button" class="secondary slim" data-action="example" data-index="${index}">Hear it</button>
      </figure>`,
    )
    .join("");
  return `
    <article class="slide">
      <h2>${esc(step.title)}</h2>
      ${(step.body || []).map((para) => `<p>${esc(para)}</p>`).join("")}
      ${note ? `<p class="hint">${esc(note)}</p>` : ""}
      <div class="examples">${examples}</div>
    </article>`;
}

function optionClass(step, id) {
  if (!session.feedback) return id === session.pickedOption ? "option is-on" : "option";
  if (id === step.answerId) return "option is-right";
  if (id === session.pickedOption) return "option is-wrong";
  return "option is-dim";
}

function renderChoice(course, step, note) {
  const phrase = step.phraseId ? findPhrase(course, step.phraseId) : null;
  const options = step.options
    .map((option) => {
      const optionPhrase = findPhrase(course, option.id);
      const say = optionPhrase ? speakText(optionPhrase) : "";
      const script = step.direction === "toRoman" && option.script && scriptLang(course) !== "en" ? `<small class="script">${esc(option.script)}</small>` : "";
      const sayAttr = say ? ` data-say="${esc(say)}"` : "";
      return `<button type="button" class="${optionClass(step, option.id)}${say ? " say" : ""}" data-action="pick" data-option="${esc(option.id)}"${sayAttr}><span>${esc(option.text)}</span>${script}</button>`;
    })
    .join("");
  const targetPrompt = step.direction === "toEn" && phrase ? speakText(phrase) : "";
  const prompt = targetPrompt
    ? hearable(course, targetPrompt, "prompt roman", esc(step.prompt))
    : `<p class="prompt">${esc(step.prompt)}</p>`;
  const guide = step.promptScript
    ? scriptLang(course) === "en"
      ? `<p class="script" lang="en">${esc(step.promptScript)}</p>`
      : hearable(course, targetPrompt || step.promptScript, "script", esc(step.promptScript))
    : "";
  return `
    <p class="prompt-label">${esc(step.promptLabel || "")}</p>
    ${prompt}
    ${guide}
    ${note && session.unitId === "sounds" ? `<p class="hint">${esc(note)}</p>` : ""}
    ${step.speak ? `<button type="button" class="secondary slim" data-action="play">${esc(step.speak.label || "Hear it")}</button>` : ""}
    <div class="options">${options}</div>`;
}

function renderListen(course, step) {
  const options = step.options
    .map(
      (option) =>
        `<button type="button" class="${optionClass(step, option.id)}" data-action="pick" data-option="${esc(option.id)}">${esc(option.text)}</button>`,
    )
    .join("");
  const phrase = session.feedback ? findPhrase(course, step.phraseId) : null;
  const shown = phrase
    ? `${hearable(course, speakText(phrase), "roman", esc(phrase.roman))}${scriptLine(course, phrase, speakText(phrase))}`
    : "";
  return `
    <p class="prompt-label">${esc(step.promptLabel || "What did you hear?")}</p>
    <div class="listen-row">
      <button type="button" class="play" data-action="replay">Replay</button>
      <button type="button" class="secondary slim" data-action="slow">Slow</button>
    </div>
    <p class="hint" data-audio-status></p>
    ${shown}
    <div class="options">${options}</div>`;
}

function renderType(course, step) {
  const phrase = findPhrase(course, step.phraseId);
  const english = scriptLang(course) === "en";
  const hint = english
    ? `Type it in ${course.romanName}. Accents are optional.`
    : `Type it in ${course.romanName.toLowerCase()}. ${course.id === "zh" ? "Tone marks" : "Long-vowel marks"} and spaces are optional.`;
  const shown = phrase && session.feedback
    ? `${hearable(course, speakText(phrase), "roman", esc(phrase.roman))}${scriptLine(course, phrase, speakText(phrase))}`
    : "";
  return `
    <p class="prompt-label">${esc(step.promptLabel)}</p>
    <div class="listen-row">
      <button type="button" class="play" data-action="play">Play</button>
      <button type="button" class="secondary slim" data-action="slow">Slow</button>
    </div>
    <p class="hint" data-audio-status></p>
    <label class="field type-field">
      <span class="sr-only">Your answer</span>
      <input id="type-input" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
        lang="${esc(english ? course.voice : "en")}" enterkeyhint="done" value="${esc(session.typed)}" ${session.feedback ? "disabled" : ""}
        placeholder="Type what you hear">
    </label>
    <p class="hint">${esc(hint)}</p>
    ${shown}`;
}

function renderSpeak(course, step) {
  const phrase = findPhrase(course, step.phraseId);
  if (!phrase) return "";
  const say = speakText(phrase);
  const listening = session.speak.status === "listening";
  const message = session.speak.message
    ? `<p class="hint speak-msg">${esc(session.speak.message)}${session.speak.heard ? ` It sounded like “${esc(session.speak.heard)}”.` : ""}</p>`
    : "";
  return `
    <p class="prompt-label">${esc(step.promptLabel)}</p>
    ${hearable(course, say, "prompt roman", esc(phrase.roman))}
    ${scriptLine(course, phrase, say)}
    <p class="hint">${esc(phrase.en)}</p>
    ${session.feedback ? "" : `
      <button type="button" class="mic ${listening ? "is-on" : ""}" data-action="mic" aria-label="${listening ? "Stop listening" : "Tap to speak"}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span>${listening ? "Listening… tap when done" : "Tap to speak"}</span>
      </button>
      ${message}
      <button type="button" class="text" data-action="skip-speak">Can't speak now</button>`}`;
}

function renderTiles(course, step) {
  const phrase = findPhrase(course, step.phraseId);
  const chosen = session.tiles
    .map(
      (tile) =>
        `<button type="button" class="tile say" data-action="tile" data-key="${esc(tile.key)}" data-text="${esc(tile.text)}" data-say="${esc(tile.say || tile.text)}">${esc(tile.text)}</button>`,
    )
    .join("");
  const bank = step.tiles
    .map((word, index) => {
      const used = session.tiles.some((tile) => tile.key === String(index));
      const say = step.says?.[index] || word;
      return `<button type="button" class="tile say" data-action="tile" data-key="${index}" data-text="${esc(word)}" data-say="${esc(say)}" ${used ? "disabled" : ""}>${esc(word)}</button>`;
    })
    .join("");
  return `
    <p class="prompt-label">${esc(step.promptLabel)}</p>
    <p class="prompt">${esc(step.prompt)}</p>
    <div class="tile-answer">${chosen || `<span class="hint">Tap the words below, in order.</span>`}</div>
    <div class="tile-bank">${bank}</div>
    ${phrase && session.feedback ? scriptLine(course, phrase, speakText(phrase)) : ""}`;
}

function shuffleItems(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function matchColumns(course, step) {
  if (session.matchCols && session.matchOrderFor === session.index) return session.matchCols;
  const left = [];
  const right = [];
  step.pairs.forEach((pair) => {
    const phrase = findPhrase(course, pair.id);
    left.push({
      side: "roman",
      id: pair.id,
      text: pair.roman,
      script: scriptLang(course) === "en" ? "" : pair.script,
      say: phrase ? speakText(phrase) : pair.roman,
    });
    right.push({ side: "en", id: pair.id, text: pair.en });
  });
  session.matchCols = { left: shuffleItems(left), right: shuffleItems(right) };
  session.matchOrderFor = session.index;
  return session.matchCols;
}

function matchCell(item) {
  const gone = session.matched.includes(item.id);
  const selected = session.matchSel && session.matchSel.side === item.side && session.matchSel.id === item.id;
  const bad = session.badPair && session.badPair.includes(item.id);
  const cls = `match-cell${item.say ? " say" : ""}${gone ? " is-gone" : ""}${selected ? " is-on" : ""}${bad ? " is-wrong" : ""}`;
  const script = item.script ? `<small class="script">${esc(item.script)}</small>` : "";
  const say = item.say ? ` data-say="${esc(item.say)}"` : "";
  return `<button type="button" class="${cls}" data-action="pair" data-pair="${item.side}:${esc(item.id)}"${say}${gone ? " disabled" : ""}><span>${esc(item.text)}</span>${script}</button>`;
}

function renderMatch(course, step) {
  const columns = matchColumns(course, step);
  return `
    <p class="prompt-label">${esc(step.promptLabel)}</p>
    <div class="match-grid">
      <div class="match-col">${columns.left.map(matchCell).join("")}</div>
      <div class="match-col">${columns.right.map(matchCell).join("")}</div>
    </div>`;
}

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function summaryBlock(course, summary) {
  if (!summary) return "";
  const stats = `
    <section class="summary-stats" aria-label="How it went">
      <div class="stat"><strong>${summary.accuracy}%</strong><span>accuracy</span></div>
      <div class="stat"><strong>${clock(summary.seconds)}</strong><span>time</span></div>
      <div class="stat"><strong>${summary.bestCombo}</strong><span>best run</span></div>
    </section>`;
  const missed = (summary.missed || [])
    .map((id) => findPhrase(course, id))
    .filter(Boolean)
    .map(
      (phrase) => `<li>${hearable(course, speakText(phrase), "roman", esc(phrase.roman))}<span>${esc(phrase.en)}</span></li>`,
    )
    .join("");
  const practice = missed
    ? `<section class="to-practice"><h3>To practice</h3><p class="fine">These come back in your next lessons and reviews. Tap one to hear it.</p><ul>${missed}</ul></section>`
    : "";
  return stats + practice;
}

function renderDone(course) {
  const result = session.result || {};
  const summary = result.summary || null;
  const mode = summary?.mode || "node";
  const nodes = coursePath(course);
  const index = nodes.findIndex((node) => node.id === session.lessonId);
  const node = nodes[index];
  const unitNodes = nodes.filter((item) => item.unitId === session.unitId && item.kind !== "sounds");
  const unitJustDone =
    mode === "node" &&
    !session.practice &&
    node &&
    unitNodes.length > 0 &&
    unitNodes[unitNodes.length - 1].id === session.lessonId &&
    unitNodes.every((item) => isNodeDone(state, course, item));
  const lines = [];
  lines.push(mode === "jump" ? "You jumped ahead." : mode === "refresh" ? "Refreshed." : result.first ? "Nice." : "Nice practice.");
  if (result.awarded) {
    const base = result.base ?? result.awarded;
    lines.push(`+${base} XP${mode === "node" && !result.first ? " for practice" : ""}`);
    if (result.perfectBonus) lines.push(`+${result.perfectBonus} XP, no mistakes`);
    if (result.comboBonus) lines.push(`+${result.comboBonus} XP, ${summary?.bestCombo || 5} in a row`);
  }
  if (result.streakNote) lines.push(`${result.streakNote} ${result.streakNote === 1 ? "day" : "days"} in a row`);
  if (result.goalJustMet) lines.push("Daily goal done.");
  if (mode === "jump") {
    const unitNumber = (summary.jumpIndex ?? 0) + 1;
    lines.push(`Everything before Unit ${unitNumber} is marked done, and those phrases are lined up for review.`);
  }
  if (unitJustDone) {
    const more = nodes.some((item, itemIndex) => itemIndex > index && item.kind !== "sounds");
    lines.push(more ? "This unit is done. The next one is open." : "That's the last unit in this course.");
  }
  const next = mode === "node" ? nodes[index + 1] : null;
  const jumpUnit = mode === "jump" ? course.units[summary.jumpIndex] : null;
  const canNext = Boolean(next || jumpUnit);
  const primary = jumpUnit ? `Start ${jumpUnit.title}` : next ? `Next: ${next.title}` : "Back to the path";
  const stop = canNext ? `<button type="button" class="text" data-action="done-stop">Stop here</button>` : "";
  const burst = motionOk()
    ? `<canvas class="confetti" data-kind="${result.goalJustMet || mode === "jump" ? "goal" : "lesson"}" aria-hidden="true"></canvas>`
    : "";
  const reward = unitJustDone ? rewardFor(course, node.unitIndex) : null;
  const poster = reward
    ? `<figure class="reward"><img src="${esc(reward.src)}" alt="${esc(reward.alt)}" width="720" height="960"></figure>`
    : "";
  return `
    ${lessonBar("Done")}
    ${burst}
    <main class="main lesson done">
      ${poster}
      <div class="celebrate">${checkSvg(true)}<h2>${esc(lines[0])}</h2></div>
      <ul class="done-lines">${lines.slice(1).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      ${summaryBlock(course, summary)}
    </main>
    <footer class="dock">
      <button type="button" class="primary" data-action="done-next">${esc(primary)}</button>
      ${stop}
    </footer>`;
}

const ZH_REWARDS = [
  {
    src: "images/reward-taiwan-beach.webp",
    alt: "Retro travel poster of a beach day in Taiwan, with palms and bubble tea.",
  },
  {
    src: "images/reward-lantern-beach.webp",
    alt: "Retro travel poster of a sunset beach strung with paper lanterns.",
  },
  {
    src: "images/reward-sailboat.webp",
    alt: "Retro travel poster of a sailboat in a green island bay.",
  },
  {
    src: "images/reward-tw-01.webp",
    alt: "Retro travel poster of a lantern-lit night market.",
  },
  {
    src: "images/reward-tw-02.webp",
    alt: "Retro travel poster of a fruit stall with pineapples and papayas.",
  },
  {
    src: "images/reward-tw-03.webp",
    alt: "Retro travel poster of a quiet turquoise cove under palm trees.",
  },
  {
    src: "images/reward-tw-04.webp",
    alt: "Retro travel poster of a steaming pool in a forest gorge.",
  },
  {
    src: "images/reward-tw-05.webp",
    alt: "Retro travel poster of stone stairs under strings of lanterns.",
  },
  {
    src: "images/reward-tw-06.webp",
    alt: "Retro travel poster of a scooter on a coastal road.",
  },
  {
    src: "images/reward-tw-07.webp",
    alt: "Retro travel poster of bubble tea at a night-market stall.",
  },
  {
    src: "images/reward-tw-08.webp",
    alt: "Retro travel poster of a waterfall in a green gorge.",
  },
  {
    src: "images/reward-tw-09.webp",
    alt: "Retro travel poster of a harbor at sunset, with fishing boats.",
  },
];

const JA_REWARDS = [
  {
    src: "images/reward-japan-cherry.webp",
    alt: "Retro travel poster of a Japan beach under cherry blossoms, with Mount Fuji.",
  },
  {
    src: "images/reward-japan-surf.webp",
    alt: "Retro travel poster of a surf beach in Japan, with Mount Fuji.",
  },
  {
    src: "images/reward-hot-spring.webp",
    alt: "Retro travel poster of a mountain hot spring in autumn.",
  },
  {
    src: "images/reward-jp-01.webp",
    alt: "Retro travel poster of a park bench under cherry blossoms.",
  },
  {
    src: "images/reward-jp-02.webp",
    alt: "Retro travel poster of an outdoor hot spring beside a wooden deck.",
  },
  {
    src: "images/reward-jp-03.webp",
    alt: "Retro travel poster of a sunny beach with dunes.",
  },
  {
    src: "images/reward-jp-04.webp",
    alt: "Retro travel poster of an autumn river under red maples.",
  },
  {
    src: "images/reward-jp-05.webp",
    alt: "Retro travel poster of a lantern-lit canal at night.",
  },
  {
    src: "images/reward-jp-06.webp",
    alt: "Retro travel poster of a hot spring in the snow, with mountains behind it.",
  },
  {
    src: "images/reward-jp-07.webp",
    alt: "Retro travel poster of a wooden veranda beside a raked-sand garden.",
  },
  {
    src: "images/reward-jp-08.webp",
    alt: "Retro travel poster of a path through a bamboo grove.",
  },
  {
    src: "images/reward-jp-09.webp",
    alt: "Retro travel poster of a garden pond with koi and a stone lantern.",
  },
];

const ES_REWARDS = [
  {
    src: "images/reward-es-01.webp",
    alt: "Retro travel poster of a Pacific beach at sunset, with palm trees and a sailboat.",
  },
  {
    src: "images/reward-es-02.webp",
    alt: "Retro travel poster of a stepped stone pyramid rising above the jungle.",
  },
  {
    src: "images/reward-es-03.webp",
    alt: "Retro travel poster of blue agave fields below distant mountains.",
  },
  {
    src: "images/reward-es-04.webp",
    alt: "Retro travel poster of a colorful colonial street with a church dome.",
  },
  {
    src: "images/reward-es-05.webp",
    alt: "Retro travel poster of a cenote, with sunlight falling into turquoise water.",
  },
  {
    src: "images/reward-es-06.webp",
    alt: "Retro travel poster of tall cactus in the desert under a rising moon.",
  },
  {
    src: "images/reward-es-07.webp",
    alt: "Retro travel poster of hot-air balloons drifting over an old valley at sunrise.",
  },
  {
    src: "images/reward-es-08.webp",
    alt: "Retro travel poster of colorful paper banners strung over a plaza at night.",
  },
];

const DE_REWARDS = [
  {
    src: "images/reward-de-01.webp",
    alt: "Retro travel poster of a castle on a hill above a river and vineyards.",
  },
  {
    src: "images/reward-de-02.webp",
    alt: "Retro travel poster of an alpine lake below snowy peaks, with a wooden dock.",
  },
  {
    src: "images/reward-de-03.webp",
    alt: "Retro travel poster of a row of half-timbered houses with flower boxes.",
  },
  {
    src: "images/reward-de-04.webp",
    alt: "Retro travel poster of red balloons rising over a city skyline at dusk.",
  },
  {
    src: "images/reward-de-05.webp",
    alt: "Retro travel poster of a wooden cabin in a pine forest.",
  },
  {
    src: "images/reward-de-06.webp",
    alt: "Retro travel poster of a snowy Christmas market at night, with lit stalls.",
  },
  {
    src: "images/reward-de-07.webp",
    alt: "Retro travel poster of a striped lighthouse and wicker beach chairs by the North Sea.",
  },
  {
    src: "images/reward-de-08.webp",
    alt: "Retro travel poster of a blue-and-white maypole in a mountain village.",
  },
];

function rewardFor(course, unitIndex) {
  const sets = { zh: ZH_REWARDS, ja: JA_REWARDS, es: ES_REWARDS, de: DE_REWARDS };
  const posters = sets[course.id] || ZH_REWARDS;
  return posters[Math.max(0, unitIndex) % posters.length];
}

function backSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 L8 12 l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function closeSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7 l10 10 M17 7 L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
}
function checkSvg(large = false) {
  return `<svg class="check ${large ? "lg" : ""}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="4"/><path d="M20 33.5 l8 8 16-18" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function boot() {
  const path = window.location.pathname;
  if (!path.endsWith("/") && !path.endsWith(".html")) {
    window.location.replace(`${path}/${window.location.search}${window.location.hash}`);
    return;
  }
  state = load();
  loadClips();
  root().addEventListener("click", onClick);
  root().addEventListener("input", (event) => {
    if (event.target.id !== "type-input" || !session) return;
    session.typed = event.target.value;
    const check = root().querySelector("[data-action='type-check']");
    if (check) check.disabled = !session.typed.trim();
  });
  root().addEventListener("keydown", (event) => {
    if (event.target.id === "type-input" && event.key === "Enter") {
      event.preventDefault();
      root().querySelector("[data-action='type-check']")?.click();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const el = event.target.closest("[data-action]");
    if (!el || el.tagName === "BUTTON") return;
    event.preventDefault();
    el.click();
  });
  window.addEventListener("online", render);
  window.addEventListener("offline", render);
  window.addEventListener("popstate", (event) => {
    showHistory(event.state?.view || { name: "home" });
  });
  if (!history.state?.app) {
    history.replaceState({ app: true, view: { name: "home" } }, "", screenUrl({ name: "home" }));
  }
  showHistory(history.state?.view || { name: "home" });
  startAccount(onAccountChange);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPush();
  });
  window.addEventListener("online", () => {
    if (account.user) queuePush(state);
  });
  if ("serviceWorker" in navigator) {
    const reloadKey = "travel-speak-sw-reload";
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (sessionStorage.getItem(reloadKey) === "1") {
        sessionStorage.removeItem(reloadKey);
        return;
      }
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    });
    const swUrl = new URL("sw.js", window.location.href);
    navigator.serviceWorker.register(swUrl.href).catch(() => {});
  }
}

boot();
