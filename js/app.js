import { COURSES, courseById, unitById } from "./courses.js";
import {
  CORE_LESSONS,
  DAILY_GOAL,
  LESSON_META,
  LESSON_XP,
  blankState,
  buildPhraseLesson,
  buildSoundsLesson,
  completeLesson,
  courseUnitsDone,
  dailyXp,
  dayKey,
  dismissInstallHint,
  easeMiss,
  isLessonDone,
  missCountForUnit,
  nextLessonId,
  normalizeState,
  phraseById,
  recordMiss,
  speakText,
  unitCoreComplete,
  unitUnlocked,
  visibleStreak,
} from "./engine.js";

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
  return course.id === "zh" ? "zh-Hant" : "ja";
}

function findPhrase(course, phraseId) {
  for (const unit of course.units) {
    const phrase = phraseById(unit, phraseId);
    if (phrase) return phrase;
  }
  return null;
}

function stopSpeech() {
  voiceToken += 1;
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

function speak(text, lang, onstart) {
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
    utterance.rate = String(lang).toLowerCase().startsWith("zh") ? 0.82 : 0.9;
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

function playLine(text, lang) {
  const token = ++voiceToken;
  if (session) {
    session.voice = "trying";
    session.hearFailed = false;
  }
  paintAudio();
  const promise = speak(text, lang, () => {
    if (token !== voiceToken || !session || session.phase !== "run") return;
    session.voice = "playing";
    paintAudio();
  });
  promise.then((ok) => {
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
    const course = currentCourse();
    const step = currentStep();
    if (session?.voice === "failed" && step?.type === "listen" && course && !root().querySelector(".fallback")) {
      const phrase = findPhrase(course, step.phraseId);
      const anchor = root().querySelector("[data-action='play']");
      if (phrase && anchor) {
        anchor.insertAdjacentHTML(
          "afterend",
          `<div class="fallback">
            <p class="roman">${esc(phrase.roman)}</p>
            <p class="script" lang="${scriptLang(course)}">${esc(phrase.script)}</p>
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

function currentUnit() {
  const course = currentCourse();
  if (!course || !view.unitId || view.unitId === "sounds") return null;
  return unitById(course, view.unitId);
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

function goUnit(courseId, unitId) {
  stopSpeech();
  session = null;
  view = { name: "unit", courseId, unitId };
  writeHistory("push");
  resetScroll = true;
  render();
}

function beginLesson(courseId, unitId, lessonId) {
  stopSpeech();
  const course = courseById(courseId);
  const built =
    unitId === "sounds"
      ? buildSoundsLesson(course)
      : buildPhraseLesson(course, unitById(course, unitId), lessonId, state);
  session = {
    courseId,
    unitId,
    lessonId,
    built,
    queue: built.phrases ? built.phrases.slice() : null,
    flipped: false,
    finished: 0,
    index: 0,
    picked: null,
    voice: "idle",
    wrongs: 0,
    phase: "run",
    result: null,
  };
  view = { name: "lesson", courseId, unitId, lessonId };
  resetScroll = true;
  render();
}

function startLesson(courseId, unitId, lessonId) {
  beginLesson(courseId, unitId, lessonId);
  writeHistory("push");
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
  if (!saved || saved.name === "home") {
    session = null;
    view = { name: "home" };
    resetScroll = true;
    render();
    return;
  }
  if (saved.name === "lesson" && saved.phase === "done" && saved.result) {
    restoreDone(saved);
    return;
  }
  if (saved.name === "lesson") {
    beginLesson(saved.courseId, saved.unitId, saved.lessonId);
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
  const xp = session.unitId === "sounds" ? LESSON_XP.sounds : LESSON_XP[session.lessonId];
  const unitId = session.unitId === "sounds" ? "sounds" : session.unitId;
  const lessonId = session.unitId === "sounds" ? "intro" : session.lessonId;
  const result = completeLesson(state, {
    courseId: session.courseId,
    unitId,
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
  const el = event.target.closest("[data-action]");
  if (!el || !root().contains(el)) return;
  const action = el.dataset.action;

  if (action === "back") {
    event.preventDefault();
    goBack();
    return;
  }
  if (action === "course") return goCourse(el.dataset.course);
  if (action === "unit") return goUnit(view.courseId, el.dataset.unit);
  if (action === "start") return startLesson(view.courseId, view.unitId || el.dataset.unit, el.dataset.lesson);
  if (action === "start-sounds") return startLesson(el.dataset.course || view.courseId, "sounds", "intro");
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

  if (action === "flip") {
    revealCard();
    return;
  }
  if (action === "hear" || action === "play" || action === "example") {
    event.preventDefault();
  }
  if (action === "hear") {
    const course = currentCourse();
    const phrase = session.queue ? session.queue[0] : findPhrase(course, currentStep()?.phraseId);
    if (phrase) playLine(speakText(phrase), course.voice);
    return;
  }
  if (action === "again") {
    const phrase = session.queue[0];
    save(recordMiss(state, session.courseId, phrase.id));
    session.queue = session.queue.slice(1).concat(phrase);
    session.flipped = false;
    render();
    return;
  }
  if (action === "got") {
    session.queue = session.queue.slice(1);
    session.finished += 1;
    session.flipped = false;
    if (session.queue.length === 0) finishLesson();
    else render();
    return;
  }
  if (action === "pick") {
    if (session.picked) return;
    const step = currentStep();
    session.picked = el.dataset.option;
    const right = session.picked === step.answerId;
    if (!right) session.wrongs += 1;
    if (step.phraseId) {
      save(
        right
          ? easeMiss(state, session.courseId, step.phraseId)
          : recordMiss(state, session.courseId, step.phraseId),
      );
    }
    render();
    return;
  }
  if (action === "next") {
    stopSpeech();
    session.index += 1;
    session.picked = null;
    session.voice = "idle";
    if (!currentStep()) finishLesson();
    else render();
    return;
  }
  if (action === "play") {
    const course = currentCourse();
    const step = currentStep();
    if (step.speak?.script) playLine(step.speak.script, course.voice);
    else {
      const phrase = findPhrase(course, step.phraseId);
      if (phrase) playLine(speakText(phrase), course.voice);
    }
    return;
  }
  if (action === "example") {
    const course = currentCourse();
    const example = currentStep()?.examples?.[Number(el.dataset.index)];
    if (example) playLine(example.script, course.voice);
  }
}

function afterLesson(goOn) {
  const courseId = session.courseId;
  const unitId = session.unitId;
  const lessonId = session.lessonId;
  const wrongs = session.wrongs;
  stopSpeech();
  if (!goOn || unitId === "sounds") {
    goBack();
    return;
  }
  const course = courseById(courseId);
  const unit = unitById(course, unitId);
  const next = nextLessonId(state, courseId, unit);
  const misses = missCountForUnit(state, courseId, unit);
  if (next && next !== "review") {
    startLesson(courseId, unitId, next);
    return;
  }
  if (next === "review" && lessonId !== "review" && (wrongs > 0 || misses > 0)) {
    startLesson(courseId, unitId, "review");
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
  if (view.name === "home") html = renderHome();
  else if (view.name === "course") html = renderCourse(course);
  else if (view.name === "unit") html = renderUnit(course, currentUnit());
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
      : view.name === "lesson"
        ? session?.built?.title || "Lesson"
        : course?.name || "Travel Speak";
  document.title = title === "Travel Speak" ? title : `${title} · Travel Speak`;
  const next = app.querySelector(".main");
  if (next) next.scrollTop = keepMain;
  if (shouldReset) window.scrollTo(0, 0);
  else if (window.scrollY !== keepWin) window.scrollTo(0, keepWin);
}

function banner() {
  const bits = [];
  if (!navigator.onLine) bits.push("You're offline. Everything here still works.");
  if (!saveOk) bits.push("Couldn't save on this phone. Progress may not stick if you leave.");
  if (!bits.length) return "";
  return `<p class="banner">${bits.map(esc).join(" ")}</p>`;
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
      <p class="eyebrow">For the trip</p>
      <h1>Travel Speak</h1>
      <p class="lede">Say a little in Taiwan and Japan. You don't have to read the writing.</p>
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
      <p class="fine">Saved on this phone only. No account.</p>
    </main>`;
}

function lessonsDone(course) {
  let count = 0;
  for (const unit of course.units) {
    for (const id of CORE_LESSONS) {
      if (isLessonDone(state, course.id, unit.id, id)) count += 1;
    }
  }
  return count;
}

function courseCard(course) {
  const units = courseUnitsDone(state, course);
  const lessons = lessonsDone(course);
  const total = course.units.length * CORE_LESSONS.length;
  const pct = Math.round((lessons / total) * 100);
  const status =
    units > 0 ? `${units} of ${course.units.length} units` : lessons > 0 ? "In progress" : "Not started";
  return `
    <button type="button" class="course-card tone-${course.id}" data-action="course" data-course="${course.id}">
      <span class="place">${esc(course.place)}</span>
      <strong>${esc(course.name)}</strong>
      <span class="meta">${esc(course.romanName)} · ${status}</span>
      <span class="track slim" aria-hidden="true"><span class="fill" style="width:${pct}%"></span></span>
    </button>`;
}

function renderCourse(course) {
  const soundsDone = isLessonDone(state, course.id, "sounds", "intro");
  const items = course.units
    .map((unit, index) => {
      const open = unitUnlocked(state, course, index);
      const done = unitCoreComplete(state, course.id, unit.id);
      const pips = CORE_LESSONS.map((id) =>
        `<i class="${isLessonDone(state, course.id, unit.id, id) ? "on" : ""}"></i>`,
      ).join("");
      const body = `
        <span class="node ${done ? "done" : ""} ${open ? "" : "locked"}">${done ? checkSvg() : index + 1}</span>
        <span class="path-copy">
          <strong>${esc(unit.title)}</strong>
          <small>${open ? `${unit.phrases.length} phrases` : `After ${esc(course.units[index - 1].title)}`}</small>
          ${open ? `<span class="pips" aria-hidden="true">${pips}</span>` : ""}
        </span>`;
      if (!open) return `<li><div class="path-card is-locked">${body}</div></li>`;
      return `<li><button type="button" class="path-card ${done ? "is-done" : ""}" data-action="unit" data-unit="${unit.id}">${body}</button></li>`;
    })
    .join("");
  return `
    ${topbar(course.name)}
    <main class="main">
      ${banner()}
      <p class="lede tight">${esc(course.blurb)}</p>
      <ol class="path">
        <li>
          <button type="button" class="path-card ${soundsDone ? "is-done" : ""}" data-action="start-sounds" data-course="${course.id}">
            <span class="node ${soundsDone ? "done" : ""}">${soundsDone ? checkSvg() : "Aa"}</span>
            <span class="path-copy">
              <strong>${esc(course.sounds.title)}</strong>
              <small>${soundsDone ? "Done" : esc(course.sounds.blurb)}</small>
            </span>
          </button>
        </li>
        ${items}
      </ol>
    </main>`;
}

function renderUnit(course, unit) {
  if (!unit) return renderCourse(course);
  const misses = missCountForUnit(state, course.id, unit);
  const rows = LESSON_META.map((lesson, index) => {
    const done = isLessonDone(state, course.id, unit.id, lesson.id);
    const extra =
      lesson.id === "review" && misses > 0 ? `${misses} to revisit` : done ? "Done" : lesson.optional ? "Optional" : "Ready";
    return `
      <button type="button" class="lesson-row" data-action="start" data-lesson="${lesson.id}">
        <span class="node ${done ? "done" : ""}">${done ? checkSvg() : index + 1}</span>
        <span class="path-copy">
          <strong>${esc(lesson.title)}</strong>
          <small>${esc(lesson.detail)}</small>
        </span>
        <span class="row-state">${esc(extra)}</span>
      </button>`;
  }).join("");
  return `
    ${topbar(unit.title)}
    <main class="main">
      ${banner()}
      <p class="lede tight">${esc(unit.blurb)}</p>
      <aside class="tip"><strong>Good to know.</strong> ${esc(unit.tip)}</aside>
      <div class="lesson-list">${rows}</div>
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

function renderLesson(course) {
  if (!session) return renderHome();
  if (session.phase === "done") return renderDone(course);
  if (session.built.kind === "flashcards") return renderCards(course);
  return renderSteps(course);
}

function lessonProgress(doneCount, total) {
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  return `<div class="track lesson-track" aria-hidden="true"><div class="fill" style="width:${pct}%"></div></div>`;
}

function renderCards(course) {
  const phrase = session.queue[0];
  const total = session.finished + session.queue.length;
  const actions = session.flipped
    ? `<div class="pair" data-flip-slot>
         <button type="button" class="secondary" data-action="again">Again</button>
         <button type="button" class="primary" data-action="got">Got it</button>
       </div>`
    : `<button type="button" class="primary" data-action="flip" data-flip-slot>Show the phrase</button>`;
  return `
    ${topbar(session.built.title)}
    ${lessonProgress(session.finished, total)}
    <main class="main lesson cards">
      <p class="count">${session.finished + 1} of ${total}</p>
      <div class="flip-scene">
        <div class="flip-card${session.flipped ? " is-flipped" : ""}" data-action="flip" tabindex="0" role="button" aria-pressed="${session.flipped ? "true" : "false"}" aria-label="${esc(session.flipped ? phrase.roman : phrase.en)}">
          <div class="flip-face flip-front">
            <p class="english">${esc(phrase.en)}</p>
            <p class="hint">Tap the card when you want the phrase.</p>
          </div>
          <div class="flip-face flip-back">
            <p class="roman">${esc(phrase.roman)}</p>
            <p class="script" lang="${scriptLang(course)}">${esc(phrase.script)}</p>
            ${phrase.hint ? `<p class="hint">${esc(phrase.hint)}</p>` : ""}
          </div>
        </div>
      </div>
      ${session.hearFailed ? '<p class="hint">No voice on this phone. You can still read the phrase.</p>' : ""}
    </main>
    <footer class="dock">
      <button type="button" class="secondary" data-action="hear">Hear it</button>
      ${actions}
    </footer>`;
}

function renderSteps(course) {
  const step = currentStep();
  const total = session.built.steps.length;
  const note = accentNote(course);
  let body = "";
  if (step.type === "slide") body = renderSlide(course, step, note);
  else if (step.type === "listen") body = renderListen(course, step, note);
  else body = renderChoice(course, step, note);

  const showNext = step.type === "slide" || session.picked;
  const phraseReady = session.picked && step.phraseId;
  const dock = showNext
    ? `${phraseReady ? '<button type="button" class="secondary" data-action="hear">Hear it</button>' : ""}
       <button type="button" class="primary" data-action="next">${session.index === total - 1 ? "Finish" : "Continue"}</button>`
    : "";
  return `
    ${topbar(session.built.title)}
    ${lessonProgress(session.index, total)}
    <main class="main lesson">
      <p class="count">${session.index + 1} of ${total}</p>
      ${session.index === 0 && session.built.intro ? `<p class="intro">${esc(session.built.intro)}</p>` : ""}
      ${body}
    </main>
    <footer class="dock">${dock}</footer>`;
}

function renderSlide(course, step, note) {
  const examples = (step.examples || [])
    .map(
      (example, index) => `
      <figure class="example">
        <figcaption>
          <span class="roman">${esc(example.roman)}</span>
          <span class="script" lang="${scriptLang(course)}">${esc(example.script)}</span>
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

function renderChoice(course, step, note) {
  const phrase = step.phraseId ? findPhrase(course, step.phraseId) : null;
  const options = step.options
    .map((option) => {
      let cls = "option";
      if (session.picked) {
        if (option.id === step.answerId) cls += " is-right";
        else if (option.id === session.picked) cls += " is-wrong";
        else cls += " is-dim";
      }
      return `<button type="button" class="${cls}" data-action="pick" data-option="${esc(option.id)}" ${session.picked ? "disabled" : ""}>${esc(option.text)}</button>`;
    })
    .join("");
  const reveal = session.picked ? answerBlock(course, phrase, step.reveal) : "";
  return `
    <p class="prompt-label">${esc(step.promptLabel || "")}</p>
    <p class="prompt">${esc(step.prompt)}</p>
    ${note && session.unitId === "sounds" ? `<p class="hint">${esc(note)}</p>` : ""}
    <div class="options" ${session.picked ? 'aria-live="polite"' : ""}>${options}</div>
    ${reveal}`;
}

function renderListen(course, step, note) {
  const phrase = findPhrase(course, step.phraseId);
  const failed = session.voice === "failed";
  const playing = session.voice === "playing" || session.voice === "trying";
  const playLabel = failed ? "Try again" : playing ? "Playing…" : "Play";
  const options = step.options
    .map((option) => {
      let cls = "option";
      if (session.picked) {
        if (option.id === step.answerId) cls += " is-right";
        else if (option.id === session.picked) cls += " is-wrong";
        else cls += " is-dim";
      }
      return `<button type="button" class="${cls}" data-action="pick" data-option="${esc(option.id)}" ${session.picked ? "disabled" : ""}>${esc(option.text)}</button>`;
    })
    .join("");
  const fallback = failed
    ? `<div class="fallback">
         <p class="roman">${esc(phrase.roman)}</p>
         <p class="script" lang="${scriptLang(course)}">${esc(phrase.script)}</p>
         <p class="hint">No voice on this phone. Use the ${esc(course.romanName.toLowerCase())} and pick the meaning.</p>
       </div>`
    : "";
  return `
    <p class="prompt-label">Hear it, then pick the meaning.</p>
    <button type="button" class="play" data-action="play">${esc(playLabel)}</button>
    ${note ? `<p class="hint">${esc(note)}</p>` : ""}
    ${fallback}
    <div class="options">${options}</div>
    ${session.picked ? answerBlock(course, phrase) : ""}`;
}

function answerBlock(course, phrase, reveal) {
  if (!phrase) return reveal ? `<p class="reveal">${esc(reveal)}</p>` : "";
  return `
    <div class="answer-card">
      <p class="english small">${esc(phrase.en)}</p>
      <p class="roman">${esc(phrase.roman)} <span class="script" lang="${scriptLang(course)}">${esc(phrase.script)}</span></p>
      ${phrase.hint ? `<p class="hint">${esc(phrase.hint)}</p>` : ""}
      ${reveal ? `<p class="hint">${esc(reveal)}</p>` : ""}
    </div>`;
}

function renderDone(course) {
  const result = session.result;
  const unit = currentUnit();
  const lessonId = session.lessonId;
  const lines = [];
  lines.push(result.first ? "Nice." : "Nice practice.");
  if (result.awarded) lines.push(`+${result.awarded} XP`);
  else lines.push("XP for this one is already saved.");
  if (result.streakNote) {
    lines.push(`${result.streakNote} ${result.streakNote === 1 ? "day" : "days"} in a row`);
  }
  if (result.goalJustMet) lines.push("Daily goal done.");
  const unitIndex = unit ? course.units.findIndex((item) => item.id === unit.id) : -1;
  const unitJustDone =
    unit && result.first && unitCoreComplete(state, course.id, unit.id) && CORE_LESSONS.includes(lessonId);
  if (unitJustDone) {
    lines.push(unitIndex < course.units.length - 1 ? "This unit is done. The next one is open." : "That's the last unit in this course.");
  }
  if (session.wrongs > 0 && lessonId !== "review" && lessonId !== "intro") {
    lines.push("Review can pick up the ones that slipped.");
  }

  let primary = session.unitId === "sounds" ? "Back to the path" : "Back to the lessons";
  let goesOn = false;
  if (session.unitId !== "sounds" && unit) {
    const next = nextLessonId(state, course.id, unit);
    const misses = missCountForUnit(state, course.id, unit);
    if (next && next !== "review") {
      const meta = LESSON_META.find((item) => item.id === next);
      primary = `Next: ${meta.title}`;
      goesOn = true;
    } else if (next === "review" && lessonId !== "review" && (session.wrongs > 0 || misses > 0)) {
      primary = "Review those";
      goesOn = true;
    }
  }
  const stop = goesOn ? `<button type="button" class="text" data-action="done-stop">Stop here</button>` : "";
  const burst = motionOk()
    ? `<canvas class="confetti" data-kind="${result.goalJustMet ? "goal" : "lesson"}" aria-hidden="true"></canvas>`
    : "";
  const reward = unitJustDone ? rewardFor(course, unitIndex) : null;
  const poster = reward
    ? `<figure class="reward"><img src="${esc(reward.src)}" alt="${esc(reward.alt)}" width="720" height="960"></figure>`
    : "";
  return `
    ${topbar("Done")}
    ${burst}
    <main class="main lesson done">
      ${poster}
      <div class="celebrate">${checkSvg(true)}<h2>${esc(lines[0])}</h2></div>
      <ul class="done-lines">${lines
        .slice(1)
        .map((line) => `<li>${esc(line)}</li>`)
        .join("")}</ul>
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

function rewardFor(course, unitIndex) {
  const posters = course.id === "ja" ? JA_REWARDS : ZH_REWARDS;
  return posters[Math.max(0, unitIndex) % posters.length];
}

function backSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 L8 12 l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
  if ("serviceWorker" in navigator) {
    const swUrl = new URL("sw.js", window.location.href);
    navigator.serviceWorker.register(swUrl.href).catch(() => {});
  }
}

boot();
