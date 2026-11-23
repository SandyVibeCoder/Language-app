import { COURSES, courseById, unitById } from "./courses.js";
import {
  DAILY_GOAL,
  blankState,
  MAX_HEARTS,
  buildNodeLesson,
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

function lockedOut() {
  return account.enabled && !account.user;
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
  try {
    window.speechSynthesis?.cancel();
  } catch (err) {
    /* The lesson still works with the written phrase. */
  }
}

function pickVoice(lang) {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const norm = (value) => String(value || "").toLowerCase().replace(/_/g, "-");
  const want = norm(lang);
  const base = want.slice(0, 2);
  let best = null;
  let bestScore = 0;
  for (const voice of voices) {
    const id = norm(voice.lang);
    let score = 0;
    if (id === want) score = 5;
    else if (id.startsWith(`${want}-`) || id.startsWith(want)) score = 4;
    else if (id.startsWith(`${base}-`)) score = 2;
    else if (id.startsWith(base)) score = 1;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

function accentNote(course) {
  if (!course?.accentNote) return "";
  const voice = pickVoice(course.voice);
  if (!voice) return "";
  const id = voice.lang.toLowerCase().replace(/_/g, "-");
  return id.startsWith(course.voice.toLowerCase()) ? "" : course.accentNote;
}

function speak(text, lang, onstart, tune) {
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
    utterance.lang = lang;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
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
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !tones.length) return Promise.resolve(false);
  if (!playToneContours.ctx) {
    try {
      playToneContours.ctx = new AudioCtx();
    } catch (err) {
      return Promise.resolve(false);
    }
  }
  const ctx = playToneContours.ctx;
  ctx.resume?.().catch(() => {});
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
  speak(text, lang);
}

function playLine(text, lang, toneRoman, slow) {
  const token = ++voiceToken;
  stopTones();
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
      const text = session.voice === "failed" ? "No voice on this phone. Use the choices." : playing ? "Playing…" : "";
      if (status.textContent !== text) status.textContent = text;
    }
    const course = currentCourse();
    const step = currentStep();
    if (session?.voice === "failed" && step?.type === "listen" && course && !root().querySelector(".fallback")) {
      const phrase = findPhrase(course, step.phraseId);
      const anchor = root().querySelector("[data-action='play']");
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
  if (step.type === "choice" && step.direction !== "toRoman") return "";
  const phrase = step.phraseId ? findPhrase(course, step.phraseId) : null;
  return phrase ? speakText(phrase) : "";
}

function answerLine(course, step) {
  const phrase = step?.phraseId ? findPhrase(course, step.phraseId) : null;
  if (step?.type === "tiles") return `${step.answer.join(" ")}  ${phrase?.script || ""}`.trim();
  if (step?.type === "listen" && phrase) return `${phrase.en} · ${phrase.roman}`;
  if (step?.type === "match") return "Match each line with its meaning.";
  if (step?.type === "choice" && phrase) return step.direction === "toRoman" ? `${phrase.roman}  ${phrase.script}` : phrase.en;
  if (step?.reveal) return step.reveal;
  const option = step?.options?.find((item) => item.id === step.answerId);
  return option?.text || "";
}

function queueRepeat(step) {
  if (!step || session.queued?.[step.uid]) return;
  if (!canQueueRepeat(session.built.steps)) return;
  session.queued[step.uid] = true;
  session.built.steps.push({ ...step, uid: `${step.uid}r`, repeat: true });
}

function spendHeart() {
  session.hearts = Math.max(0, (session.hearts ?? MAX_HEARTS) - 1);
  if (session.hearts <= 0) session.failed = true;
}

function grade(ok) {
  const step = currentStep();
  const course = currentCourse();
  const say = feedbackSpeech(course, step);
  session.feedback = { ok, line: answerLine(course, step), say };
  if (step.phraseId) save(ok ? easeMiss(state, session.courseId, step.phraseId) : recordMiss(state, session.courseId, step.phraseId));
  if (!ok) {
    session.wrongs += 1;
    spendHeart();
    if (!session.failed) queueRepeat(step);
  }
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
  session.pickedOption = null;
  session.voice = "idle";
  session.index += 1;
  if (!currentStep()) {
    finishLesson();
    return;
  }
  session.phase = "run";
  render();
}

function beginBuilt(courseId, unitId, lessonId, nodeKind, built, practice) {
  stopSpeech();
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
    hearts: MAX_HEARTS,
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

function beginNode(courseId, node) {
  const course = courseById(courseId);
  const built = buildNodeLesson(course, node, state);
  beginBuilt(courseId, node.unitId, node.id, node.kind, built, false);
}

function startNode(courseId, nodeId) {
  const course = courseById(courseId);
  const nodes = coursePath(course);
  const index = nodes.findIndex((node) => node.id === nodeId);
  const node = nodes[index];
  if (!node || !nodeUnlocked(state, course, index)) return;
  beginNode(courseId, node);
  writeHistory("push");
}

function retryLesson() {
  const node = currentNode();
  if (!node || !session?.courseId) return;
  beginNode(session.courseId, node);
  writeHistory("replace");
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
    const node = coursePath(course).find((item) => item.id === saved.lessonId);
    if (!node) {
      view = { name: "course", courseId: saved.courseId };
      session = null;
      render();
      return;
    }
    beginNode(saved.courseId, node);
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
  const xp = session.nodeKind === "sounds" ? 8 : session.nodeKind === "checkpoint" ? 12 : 15;
  const lessonId = session.nodeKind === "sounds" ? "sounds" : session.lessonId;
  const result = completeLesson(state, {
    courseId: session.courseId,
    unitId: session.unitId,
    lessonId,
    xp,
    today: dayKey(),
  });
  save(result.state);
  session.phase = "done";
  session.result = result;
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
    else session.tiles.push({ key, text: el.dataset.text });
    render();
    return;
  }
  if (action === "check") {
    if (session.feedback) return;
    const step = currentStep();
    const got = session.tiles.map((tile) => tile.text);
    grade(got.length === step.answer.length && got.every((word, index) => word === step.answer[index]));
    return;
  }
  if (action === "pick") {
    if (session.feedback) return;
    const step = currentStep();
    session.pickedOption = el.dataset.option;
    grade(session.pickedOption === step.answerId);
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
        for (const pair of step.pairs) {
          save(
            session.matchMissed
              ? recordMiss(state, session.courseId, pair.id)
              : easeMiss(state, session.courseId, pair.id),
          );
        }
        session.feedback = {
          ok: !session.matchMissed,
          line: session.matchMissed ? "Some pairs were mixed. They'll come back." : "All five pairs matched.",
        };
      }
      render();
      return;
    }
    session.matchMissed = true;
    session.badPair = [session.matchSel.id, id];
    session.matchSel = null;
    session.wrongs += 1;
    spendHeart();
    if (session.failed) {
      session.feedback = { ok: false, line: "Out of hearts. This lesson stops here." };
      render();
      return;
    }
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
  if (lockedOut() || view.name === "account") html = renderAccount();
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
  if (session?.phase === "run" && step?.type === "listen" && session.autoFor !== session.index) {
    session.autoFor = session.index;
    const phrase = findPhrase(course, step.phraseId);
    if (phrase) playLine(speakText(phrase), course.voice, phrase.roman);
  }
}

function heartRow() {
  const hearts = session?.hearts ?? MAX_HEARTS;
  const icons = Array.from({ length: MAX_HEARTS }, (_, index) => `<span class="heart ${index < hearts ? "on" : "off"}">♥</span>`).join("");
  const label = `${hearts} of ${MAX_HEARTS} hearts`;
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
        <div class="stack">
          <button type="button" class="secondary" data-action="sign-out">Sign out</button>
        </div>
        <p class="fine">Signing out returns you to the sign-in screen. Progress on this phone is kept for the next sign-in.</p>
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
  const status = progress.done > 0 ? `${progress.done} of ${progress.total}` : "Not started";
  return `
    <button type="button" class="course-card tone-${course.id}" data-action="course" data-course="${course.id}">
      <span class="place">${esc(course.place)}</span>
      <strong>${esc(course.name)}</strong>
      <span class="meta">${esc(course.romanName)} · ${status}</span>
      <span class="track slim" aria-hidden="true"><span class="fill" style="width:${pct}%"></span></span>
    </button>`;
}

function renderCourse(course) {
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
        head = `<li class="path-slot head"><header class="unit-head"><p class="eyebrow">Unit ${unitNumber}</p><h2>${esc(unit.title)}</h2><p>${esc(unit.blurb)}</p></header></li>`;
      }
      const icon = done ? "✓" : node.kind === "checkpoint" ? "★" : node.kind === "sounds" ? "Aa" : String((index % 9) + 1);
      const label = node.kind === "checkpoint" ? "Review" : node.title;
      return `${head}<li class="path-slot ${pos}">
        <button type="button" class="path-node ${done ? "done" : ""} ${isCurrent ? "current" : ""} ${unlocked ? "" : "locked"} ${node.kind}" data-action="node" data-node="${esc(node.id)}" ${unlocked ? "" : "disabled"}>
          <span>${icon}</span>
        </button>
        <span class="node-label">${esc(label)}</span>
      </li>`;
    })
    .join("");
  return `
    ${topbar(course.name)}
    <main class="main path-main">
      ${banner()}
      <p class="lede tight">${esc(course.blurb)}</p>
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

function lessonBar(title) {
  return `
    <header class="topbar lesson-bar">
      <button type="button" class="icon-btn" data-action="back" aria-label="Close lesson">
        ${closeSvg()}
      </button>
      <h1>${esc(title)}</h1>
      <button type="button" class="icon-btn" data-action="back" aria-label="Back">
        ${backSvg()}
      </button>
    </header>`;
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
  return `<div class="feedback ${ok ? "ok" : "bad"}" role="status"><strong>${ok ? "Nice." : "Not quite."}</strong>${line}</div>`;
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
  else body = renderChoice(course, step, note);
  const showContinue = step?.type === "slide" || session.feedback;
  const tileReady = step?.type === "tiles" && session.tiles.length === step.answer.length;
  const showCheck = step?.type === "tiles" && !session.feedback;
  const continueLabel = session.failed ? "Try again" : session.index === total - 1 ? "Finish" : "Continue";
  const continueAction = session.failed ? "retry" : "continue";
  const leave = session.failed ? `<button type="button" class="text" data-action="done-stop">Back to the path</button>` : "";
  const dock = `
    ${feedbackBlock()}
    ${showCheck ? `<button type="button" class="primary" data-action="check" ${tileReady ? "" : "disabled"}>Check</button>` : ""}
    ${showContinue ? `<button type="button" class="primary" data-action="${continueAction}">${continueLabel}</button>` : ""}
    ${leave}`;
  return `
    ${lessonBar(session.built.title)}
    ${lessonProgress(session.index, total)}
    <div class="lesson-hearts">${heartRow()}</div>
    <main class="main lesson">
      <p class="count">${Math.min(session.index + 1, total)} of ${total}</p>
      ${body}
    </main>
    <footer class="dock ${session.feedback ? (session.feedback.ok ? "is-ok" : "is-bad") : ""}">${dock}</footer>`;
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
  if (!session.feedback) return "option";
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

function renderTiles(course, step) {
  const phrase = findPhrase(course, step.phraseId);
  const chosen = session.tiles
    .map(
      (tile) =>
        `<button type="button" class="tile say" data-action="tile" data-key="${esc(tile.key)}" data-text="${esc(tile.text)}" data-say="${esc(tile.text)}">${esc(tile.text)}</button>`,
    )
    .join("");
  const bank = step.tiles
    .map((word, index) => {
      const used = session.tiles.some((tile) => tile.key === String(index));
      return `<button type="button" class="tile say" data-action="tile" data-key="${index}" data-text="${esc(word)}" data-say="${esc(word)}" ${used ? "disabled" : ""}>${esc(word)}</button>`;
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

function renderDone(course) {
  const result = session.result || {};
  const nodes = coursePath(course);
  const index = nodes.findIndex((node) => node.id === session.lessonId);
  const node = nodes[index];
  const unitNodes = nodes.filter((item) => item.unitId === session.unitId && item.kind !== "sounds");
  const unitJustDone =
    !session.practice &&
    node &&
    unitNodes.length > 0 &&
    unitNodes[unitNodes.length - 1].id === session.lessonId &&
    unitNodes.every((item) => isNodeDone(state, course, item));
  const lines = [];
  lines.push(result.first ? "Nice." : "Nice practice.");
  if (result.awarded) lines.push(`+${result.awarded} XP`);
  else lines.push("XP for this one is already saved.");
  if (result.streakNote) lines.push(`${result.streakNote} ${result.streakNote === 1 ? "day" : "days"} in a row`);
  if (result.goalJustMet) lines.push("Daily goal done.");
  if (unitJustDone) {
    const more = nodes.some((item, itemIndex) => itemIndex > index && item.kind !== "sounds");
    lines.push(more ? "This unit is done. The next one is open." : "That's the last unit in this course.");
  }
  const next = nodes[index + 1];
  const canNext = Boolean(next);
  const primary = canNext ? `Next: ${next.title}` : "Back to the path";
  const stop = canNext ? `<button type="button" class="text" data-action="done-stop">Stop here</button>` : "";
  const burst = motionOk()
    ? `<canvas class="confetti" data-kind="${result.goalJustMet ? "goal" : "lesson"}" aria-hidden="true"></canvas>`
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
  root().addEventListener("click", onClick);
  root().addEventListener("keydown", (event) => {
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
