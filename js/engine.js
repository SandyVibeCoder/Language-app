// Lesson building and saved-progress rules. No browser APIs, so it can be checked on its own.
import { COURSES } from "./courses.js";

export const DAILY_GOAL = 20;

// Every XP amount lives here, so the app and the checks can't drift apart.
export const LESSON_XP = {
  lesson: 15,
  checkpoint: 12,
  sounds: 8,
  refresh: 10,
  jump: 20,
  replay: 5,
  perfect: 5,
  combo5: 2,
  combo10: 2,
};

export function baseXpFor(kind) {
  return LESSON_XP[kind] ?? LESSON_XP.lesson;
}

export function bonusXp({ perfect, bestCombo }) {
  const perfectBonus = perfect ? LESSON_XP.perfect : 0;
  const comboBonus = (bestCombo >= 5 ? LESSON_XP.combo5 : 0) + (bestCombo >= 10 ? LESSON_XP.combo10 : 0);
  return { perfectBonus, comboBonus };
}

export const CORE_LESSONS = ["learn", "practice", "listen"];

export const LESSON_META = [
  {
    id: "learn",
    title: "Learn",
    detail: "See each phrase and hear it",
  },
  {
    id: "practice",
    title: "Practice",
    detail: "English and the spoken form, both ways",
  },
  {
    id: "listen",
    title: "Listen",
    detail: "Hear it, then pick the meaning",
  },
  {
    id: "review",
    title: "Review",
    detail: "Misses first, then a short refresher",
    optional: true,
  },
];

export function blankState() {
  return {
    xp: 0,
    streak: 0,
    lastDay: null,
    dailyDay: null,
    dailyXp: 0,
    goalNotedDay: null,
    done: {},
    misses: {},
    srs: {},
    heartsLost: [],
    installHintDismissed: false,
  };
}

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function yesterdayOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return dayKey(date);
}

export function normalizeState(raw) {
  const blank = blankState();
  if (!raw || typeof raw !== "object") return blank;
  return {
    xp: Number.isFinite(raw.xp) ? raw.xp : 0,
    streak: Number.isFinite(raw.streak) ? raw.streak : 0,
    lastDay: typeof raw.lastDay === "string" ? raw.lastDay : null,
    dailyDay: typeof raw.dailyDay === "string" ? raw.dailyDay : null,
    dailyXp: Number.isFinite(raw.dailyXp) ? raw.dailyXp : 0,
    goalNotedDay: typeof raw.goalNotedDay === "string" ? raw.goalNotedDay : null,
    done: migrateDone(raw.done && typeof raw.done === "object" ? { ...raw.done } : {}),
    misses: raw.misses && typeof raw.misses === "object" ? { ...raw.misses } : {},
    srs: cleanSrs(raw.srs),
    heartsLost: Array.isArray(raw.heartsLost) ? raw.heartsLost.filter((t) => Number.isFinite(t)) : [],
    installHintDismissed: Boolean(raw.installHintDismissed),
  };
}

// Combines progress from this phone with progress saved to an account.
// Nothing is lost: finished lessons are kept from both, and counts take the larger value.
export function mergeStates(localRaw, remoteRaw) {
  const a = normalizeState(localRaw);
  const b = normalizeState(remoteRaw);
  const later = (x, y) => (!x ? y : !y ? x : x >= y ? x : y);
  const done = { ...b.done };
  for (const [key, value] of Object.entries(a.done)) if (value && !done[key]) done[key] = value;
  const misses = { ...b.misses };
  for (const [key, value] of Object.entries(a.misses)) misses[key] = Math.max(value || 0, misses[key] || 0);
  const lastDay = later(a.lastDay, b.lastDay);
  const streakFrom = a.lastDay === b.lastDay ? (a.streak >= b.streak ? a : b) : a.lastDay === lastDay ? a : b;
  const dailyDay = later(a.dailyDay, b.dailyDay);
  const dailyXp =
    a.dailyDay === b.dailyDay ? Math.max(a.dailyXp, b.dailyXp) : a.dailyDay === dailyDay ? a.dailyXp : b.dailyXp;
  const srs = { ...b.srs };
  for (const [key, value] of Object.entries(a.srs)) {
    if (!srs[key] || (value.t || 0) > (srs[key].t || 0)) srs[key] = value;
  }
  return {
    xp: Math.max(a.xp, b.xp),
    streak: streakFrom.streak,
    lastDay,
    dailyDay,
    dailyXp,
    goalNotedDay: later(a.goalNotedDay, b.goalNotedDay),
    done,
    misses,
    srs,
    heartsLost: [...new Set([...a.heartsLost, ...b.heartsLost])].sort((x, y) => x - y).slice(-20),
    installHintDismissed: a.installHintDismissed || b.installHintDismissed,
  };
}

export function lessonKey(courseId, unitId, lessonId) {
  return `${courseId}:${unitId}:${lessonId}`;
}

export function missKey(courseId, phraseId) {
  return `${courseId}:${phraseId}`;
}

export function isLessonDone(state, courseId, unitId, lessonId) {
  return Boolean(state.done[lessonKey(courseId, unitId, lessonId)]);
}

export function unitCoreComplete(state, courseId, unitId) {
  if (CORE_LESSONS.every((id) => isLessonDone(state, courseId, unitId, id))) return true;
  const course = COURSES.find((item) => item.id === courseId);
  if (!course) return false;
  const nodes = coursePath(course).filter((node) => node.unitId === unitId);
  return nodes.length > 0 && nodes.every((node) => isNodeDone(state, course, node));
}

export function unitUnlocked(state, course, index) {
  if (index <= 0) return true;
  const prev = course.units[index - 1];
  return unitCoreComplete(state, course.id, prev.id);
}

export function courseUnitsDone(state, course) {
  return course.units.filter((unit) => unitCoreComplete(state, course.id, unit.id)).length;
}

export function visibleStreak(state, today = dayKey()) {
  if (!state.lastDay || !state.streak) return 0;
  if (state.lastDay === today || state.lastDay === yesterdayOf(today)) return state.streak;
  return 0;
}

export function dailyXp(state, today = dayKey()) {
  return state.dailyDay === today ? state.dailyXp : 0;
}

function clone(state) {
  return {
    ...state,
    done: { ...state.done },
    misses: { ...state.misses },
    srs: { ...(state.srs || {}) },
    heartsLost: [...(state.heartsLost || [])],
  };
}

export function recordMiss(state, courseId, phraseId) {
  const next = clone(state);
  const key = missKey(courseId, phraseId);
  next.misses[key] = Math.min(9, (next.misses[key] || 0) + 1);
  return next;
}

export function easeMiss(state, courseId, phraseId) {
  const next = clone(state);
  const key = missKey(courseId, phraseId);
  const count = (next.misses[key] || 0) - 1;
  if (count > 0) next.misses[key] = count;
  else delete next.misses[key];
  return next;
}

export function missCountForUnit(state, courseId, unit) {
  return unit.phrases.filter((phrase) => (state.misses[missKey(courseId, phrase.id)] || 0) > 0).length;
}

// Full XP the first time a lesson is finished, a smaller amount for replays,
// plus bonuses for no mistakes and for answers in a row. Practice (mark: false)
// earns its XP without marking a path lesson done. Every finish counts for the streak.
export function completeLesson(state, { courseId, unitId, lessonId, xp, today, perfect = false, bestCombo = 0, mark = true }) {
  const next = clone(state);
  const key = lessonKey(courseId, unitId, lessonId);
  const first = mark ? !next.done[key] : true;
  if (mark) next.done[key] = next.done[key] || today;

  const base = first ? xp : LESSON_XP.replay;
  const { perfectBonus, comboBonus } = bonusXp({ perfect, bestCombo });
  const awarded = base + perfectBonus + comboBonus;
  if (next.dailyDay !== today) {
    next.dailyDay = today;
    next.dailyXp = 0;
  }
  const before = next.dailyXp;
  next.xp += awarded;
  next.dailyXp += awarded;

  let streakNote = null;
  if (next.lastDay !== today) {
    if (next.lastDay === yesterdayOf(today)) next.streak += 1;
    else next.streak = 1;
    next.lastDay = today;
    streakNote = next.streak;
  }

  const goalJustMet = before < DAILY_GOAL && next.dailyXp >= DAILY_GOAL;
  if (next.dailyXp >= DAILY_GOAL) next.goalNotedDay = today;

  return { state: next, awarded, base, perfectBonus, comboBonus, streakNote, goalJustMet, first };
}

export function dismissInstallHint(state) {
  return { ...clone(state), installHintDismissed: true };
}

export function makeRng(random = Math.random) {
  return {
    next: random,
    shuffle(list) {
      const copy = list.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    pick(list) {
      return list[Math.floor(this.next() * list.length)];
    },
  };
}

function uniqueOptions(candidates, answerText, count, rng) {
  const seen = new Set([answerText]);
  const picked = [];
  for (const item of rng.shuffle(candidates)) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    picked.push(item);
    if (picked.length === count) break;
  }
  return picked;
}

function choiceStep(phrase, direction, pool, rng, romanName) {
  const answerText = direction === "toRoman" ? phrase.roman : phrase.en;
  const field = direction === "toRoman" ? "roman" : "en";
  const distractors = uniqueOptions(
    pool
      .filter((item) => item.id !== phrase.id)
      .map((item) => ({ id: item.id, text: item[field] })),
    answerText,
    3,
    rng,
  );
  const options = rng.shuffle([
    { id: phrase.id, text: answerText },
    ...distractors.map((item) => ({ id: item.id, text: item.text })),
  ]);
  return {
    type: "choice",
    phraseId: phrase.id,
    direction,
    prompt: direction === "toRoman" ? phrase.en : phrase.roman,
    promptLabel: direction === "toRoman" ? `How do you say it? Pick the ${romanName}.` : "What does this mean?",
    options,
    answerId: phrase.id,
  };
}

export function buildPhraseLesson(course, unit, lessonId, state, random = Math.random) {
  const rng = makeRng(random);
  const romanName = course.romanName.toLowerCase();

  if (lessonId === "learn") {
    return {
      kind: "flashcards",
      title: "Learn",
      phrases: rng.shuffle(unit.phrases),
    };
  }

  if (lessonId === "practice") {
    const phrases = rng.shuffle(unit.phrases);
    const steps = phrases.map((phrase, index) =>
      choiceStep(phrase, index % 2 === 0 ? "toRoman" : "toEn", unit.phrases, rng, romanName),
    );
    return { kind: "quiz", title: "Practice", steps, intro: null };
  }

  if (lessonId === "listen") {
    const steps = rng.shuffle(unit.phrases).map((phrase) => {
      const distractors = uniqueOptions(
        unit.phrases.filter((item) => item.id !== phrase.id).map((item) => ({ id: item.id, text: item.en })),
        phrase.en,
        3,
        rng,
      );
      return {
        type: "listen",
        phraseId: phrase.id,
        options: rng.shuffle([
          { id: phrase.id, text: phrase.en },
          ...distractors.map((item) => ({ id: item.id, text: item.text })),
        ]),
        answerId: phrase.id,
      };
    });
    return { kind: "quiz", title: "Listen", steps, intro: null };
  }

  const missed = unit.phrases
    .filter((phrase) => (state.misses[missKey(course.id, phrase.id)] || 0) > 0)
    .sort(
      (a, b) =>
        (state.misses[missKey(course.id, b.id)] || 0) - (state.misses[missKey(course.id, a.id)] || 0),
    );
  const chosen = missed.slice(0, 6);
  const filler = rng.shuffle(unit.phrases.filter((phrase) => !chosen.includes(phrase)));
  while (chosen.length < Math.min(4, unit.phrases.length) && filler.length) {
    chosen.push(filler.shift());
  }
  const toppedUp = missed.length > 0 && chosen.length > Math.min(6, missed.length);
  let intro = "Nothing missed. A short refresher.";
  if (missed.length && !toppedUp) intro = "From the ones you missed.";
  if (missed.length && toppedUp) intro = "A few you missed, plus a short refresher.";

  const steps = rng.shuffle(chosen).map((phrase, index) =>
    choiceStep(phrase, index % 2 === 0 ? "toRoman" : "toEn", unit.phrases, rng, romanName),
  );
  return { kind: "quiz", title: "Review", steps, intro };
}

export function buildSoundsLesson(course, random = Math.random) {
  const rng = makeRng(random);
  const slides = course.sounds.slides.map((slide) => ({ type: "slide", ...slide }));
  const quiz = course.sounds.quiz.map((item) => {
    const options = rng.shuffle(item.options.map((text, index) => ({ id: String(index), text })));
    const answerId = options.find((option) => option.text === item.options[item.answer]).id;
    return {
      type: "choice",
      phraseId: null,
      direction: "quiz",
      prompt: item.prompt,
      promptLabel: "Quick check",
      options,
      answerId,
      speak: item.speak || null,
      reveal: item.reveal || null,
    };
  });
  return {
    kind: "quiz",
    title: course.sounds.title,
    steps: [...slides, ...quiz],
    intro: null,
  };
}

export function phraseById(unit, id) {
  return unit.phrases.find((phrase) => phrase.id === id) || null;
}

const NATIVE_CHAR = /[\u3040-\u30ff\u3400-\u9fff]/;
const LATIN_LETTER = /[A-Za-zĀ-žāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;

function cleanSpoken(text) {
  return String(text || "").replace(/[…？?。、「」！!，,]/g, "").trim();
}

export function speakText(phrase) {
  const spoken = cleanSpoken(phrase.speak);
  const written = cleanSpoken(phrase.script);
  if (spoken && NATIVE_CHAR.test(spoken) && !LATIN_LETTER.test(spoken)) return spoken;
  if (phrase.hear && NATIVE_CHAR.test(phrase.hear) && LATIN_LETTER.test(written)) {
    return String(phrase.hear).replace(/\s+/g, "");
  }
  if (written && NATIVE_CHAR.test(written) && !LATIN_LETTER.test(written)) return written;
  if (spoken) return spoken;
  return written;
}

export function nextLessonId(state, courseId, unit) {
  for (const lesson of LESSON_META) {
    if (!isLessonDone(state, courseId, unit.id, lesson.id)) return lesson.id;
  }
  return null;
}

const TONE_MARKS = {
  ā: 1, ē: 1, ī: 1, ō: 1, ū: 1, ǖ: 1,
  á: 2, é: 2, í: 2, ó: 2, ú: 2, ǘ: 2,
  ǎ: 3, ě: 3, ǐ: 3, ǒ: 3, ǔ: 3, ǚ: 3,
  à: 4, è: 4, ì: 4, ò: 4, ù: 4, ǜ: 4,
};

// Multipliers of a mid pitch. A plain teaching contour was about
// tone 2: 0.92→1.28, tone 3 dip of 0.22, tone 4: 1.28→0.86.
// These spans are at least 1.5× that, and each shape is the one the
// tone lesson describes.
const TONE_SHAPES = {
  1: { ms: 760, pitches: [1.45, 1.45] },
  2: { ms: 640, pitches: [0.76, 1.72] },
  3: { ms: 820, pitches: [1.05, 0.52, 1.34] },
  4: { ms: 320, pitches: [1.75, 0.58] },
  0: { ms: 220, pitches: [1, 0.9] },
};

const TONE_SPEECH = {
  1: { rate: 0.58, pitch: 1.42 },
  2: { rate: 0.66, pitch: 1.05 },
  3: { rate: 0.62, pitch: 0.7 },
  4: { rate: 0.74, pitch: 1.3 },
  0: { rate: 0.86, pitch: 1 },
};

export function tonesFromPinyin(text) {
  const syllables = String(text || "")
    .split(/[^A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ]+/)
    .filter(Boolean);
  const tones = [];
  for (const syllable of syllables) {
    let marked = 0;
    let vowel = false;
    for (const ch of syllable) {
      const tone = TONE_MARKS[ch];
      if (tone) {
        marked = tone;
        vowel = true;
        break;
      }
      if ("aeiouü".includes(ch.toLowerCase())) vowel = true;
    }
    if (!vowel) continue;
    if (marked) {
      tones.push(marked);
      continue;
    }
    if (syllable !== syllable.toLowerCase() || syllable.length > 6) continue;
    tones.push(0);
  }
  return tones;
}

export function toneContour(tone) {
  return TONE_SHAPES[tone] ?? TONE_SHAPES[0];
}

export function speechForTone(tone) {
  return TONE_SPEECH[tone] ?? TONE_SPEECH[0];
}

export const MAX_HEARTS = 5;
export const LESSON_LIMIT = 11;
const BASE_QUESTIONS = 8;

const CHUNK = 5;

export function coursePath(course) {
  const nodes = [];
  course.units.forEach((unit, unitIndex) => {
    for (let start = 0, part = 1; start < unit.phrases.length; start += CHUNK, part += 1) {
      const chunk = unit.phrases.slice(start, start + CHUNK);
      const title = chunk[0].en.replace(/[?？…]/g, "").split("/")[0].trim();
      nodes.push({
        id: `${unit.id}-${part}`,
        unitId: unit.id,
        unitIndex,
        kind: "lesson",
        title,
        phraseIds: chunk.map((phrase) => phrase.id),
      });
    }
    nodes.push({
      id: `${unit.id}-check`,
      unitId: unit.id,
      unitIndex,
      kind: "checkpoint",
      title: "Review",
      phraseIds: [],
    });
    if (unitIndex === 0) {
      nodes.push({
        id: "sounds",
        unitId: "sounds",
        unitIndex: 0,
        kind: "sounds",
        title: course.sounds.title,
        phraseIds: [],
      });
    }
  });
  return nodes;
}

function migrateDone(done) {
  const next = { ...done };
  for (const course of COURSES) {
    const intro = lessonKey(course.id, "sounds", "intro");
    if (next[intro]) next[lessonKey(course.id, "sounds", "sounds")] = next[lessonKey(course.id, "sounds", "sounds")] || next[intro];
    for (const unit of course.units) {
      const nodes = coursePath(course).filter((node) => node.unitId === unit.id);
      const core = CORE_LESSONS.every((id) => next[lessonKey(course.id, unit.id, id)]);
      if (core) {
        const stamp = next[lessonKey(course.id, unit.id, "learn")] || true;
        for (const node of nodes) {
          const key = lessonKey(course.id, unit.id, node.id);
          next[key] = next[key] || stamp;
        }
        continue;
      }
      const lessons = nodes.filter((node) => node.kind === "lesson");
      ["learn", "practice", "listen"].forEach((oldId, index) => {
        const node = lessons[index];
        const oldKey = lessonKey(course.id, unit.id, oldId);
        if (!node || !next[oldKey]) return;
        const key = lessonKey(course.id, unit.id, node.id);
        next[key] = next[key] || next[oldKey];
      });
    }
  }
  return next;
}

export function isNodeDone(state, course, node) {
  if (state.done[lessonKey(course.id, node.unitId, node.id)]) return true;
  if (node.kind === "sounds") return Boolean(state.done[lessonKey(course.id, "sounds", "intro")]);
  const unitNodes = coursePath(course).filter((item) => item.unitId === node.unitId);
  const core = CORE_LESSONS.every((id) => state.done[lessonKey(course.id, node.unitId, id)]);
  if (core) return true;
  const lessons = unitNodes.filter((item) => item.kind === "lesson");
  const index = lessons.findIndex((item) => item.id === node.id);
  const oldId = ["learn", "practice", "listen"][index];
  return Boolean(oldId && state.done[lessonKey(course.id, node.unitId, oldId)]);
}

export function nodeUnlocked(state, course, index) {
  const nodes = coursePath(course);
  if (index <= 0) return true;
  return isNodeDone(state, course, nodes[index - 1]);
}

export function questionCount(steps) {
  return (steps || []).filter((step) => step.type !== "slide").length;
}

export function canQueueRepeat(steps) {
  return questionCount(steps) < LESSON_LIMIT;
}

function dedupePhrases(list) {
  const seen = new Set();
  const out = [];
  for (const phrase of list) {
    if (!phrase || seen.has(phrase.id)) continue;
    seen.add(phrase.id);
    out.push(phrase);
  }
  return out;
}

export function wordsOf(roman) {
  const clean = String(roman || "").replace(/[…?.？。!！¿¡,]/g, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length ? parts : [clean || String(roman)];
}

export function scriptParts(phrase) {
  const words = wordsOf(phrase.roman);
  if (phrase.hear) {
    const parts = String(phrase.hear).trim().split(/\s+/).filter(Boolean);
    if (parts.length === words.length && parts.every((part) => NATIVE_CHAR.test(part) && !LATIN_LETTER.test(part))) {
      return parts;
    }
    return null;
  }
  const glyphs = [...cleanSpoken(phrase.script)];
  if (glyphs.length === words.length && glyphs.every((glyph) => NATIVE_CHAR.test(glyph))) return glyphs;
  return null;
}

function caseKey(word) {
  return word.toLocaleLowerCase("en-US");
}

function setFirstLetter(word, upper) {
  if (!word) return word;
  const first = upper ? word.charAt(0).toLocaleUpperCase("en-US") : word.charAt(0).toLocaleLowerCase("en-US");
  return first + word.slice(1);
}

function intrinsicCapitals(phrases) {
  const marked = new Set();
  for (const phrase of phrases) {
    const words = wordsOf(phrase.roman);
    for (const word of words.slice(1)) {
      if (word.charAt(0) !== word.charAt(0).toLocaleLowerCase("en-US")) marked.add(caseKey(word));
    }
  }
  return marked;
}

function displayTile(word, isStart, intrinsic) {
  if (isStart || intrinsic.has(caseKey(word))) return setFirstLetter(word, true);
  return setFirstLetter(word, false);
}

function choiceStepNew(phrase, direction, pool, rng) {
  const answerText = direction === "toRoman" ? phrase.roman : phrase.en;
  const field = direction === "toRoman" ? "roman" : "en";
  const distractors = uniqueOptions(
    pool
      .filter((item) => item.id !== phrase.id)
      .map((item) => ({ id: item.id, text: item[field], script: item.script })),
    answerText,
    3,
    rng,
  );
  return {
    type: "choice",
    phraseId: phrase.id,
    direction,
    prompt: direction === "toRoman" ? phrase.en : phrase.roman,
    promptScript: direction === "toEn" ? phrase.script : "",
    promptLabel: direction === "toRoman" ? "How do you say this?" : "What does this mean?",
    options: rng.shuffle([{ id: phrase.id, text: answerText, script: phrase.script }, ...distractors]),
    answerId: phrase.id,
  };
}

function listenStep(phrase, pool, rng) {
  const distractors = uniqueOptions(
    pool.filter((item) => item.id !== phrase.id).map((item) => ({ id: item.id, text: item.en })),
    phrase.en,
    3,
    rng,
  );
  return {
    type: "listen",
    phraseId: phrase.id,
    promptLabel: "What did you hear?",
    options: rng.shuffle([{ id: phrase.id, text: phrase.en }, ...distractors]),
    answerId: phrase.id,
  };
}

function tileItem(word, say, isStart, intrinsic) {
  const text = displayTile(word, isStart, intrinsic);
  return { text, say: say || text };
}

function tileStep(phrase, pool, rng) {
  const intrinsic = intrinsicCapitals(pool);
  const parts = scriptParts(phrase);
  const answerItems = wordsOf(phrase.roman).map((word, index) =>
    tileItem(word, parts ? parts[index] : "", index === 0, intrinsic),
  );
  const used = new Set(answerItems.map((item) => caseKey(item.text)));
  const distractors = [];
  for (const other of rng.shuffle(pool)) {
    if (other.id === phrase.id) continue;
    const otherParts = scriptParts(other);
    const otherWords = wordsOf(other.roman);
    for (let index = 0; index < otherWords.length; index += 1) {
      const item = tileItem(otherWords[index], otherParts ? otherParts[index] : "", false, intrinsic);
      const key = caseKey(item.text);
      if (used.has(key)) continue;
      used.add(key);
      distractors.push(item);
      if (distractors.length === 3) break;
    }
    if (distractors.length === 3) break;
  }
  const tiles = rng.shuffle([...answerItems, ...distractors]);
  return {
    type: "tiles",
    phraseId: phrase.id,
    prompt: phrase.en,
    promptLabel: "Tap the words in order",
    answer: answerItems.map((item) => item.text),
    tiles: tiles.map((item) => item.text),
    says: tiles.map((item) => item.say),
  };
}

function matchStep(phrases) {
  return {
    type: "match",
    phraseId: phrases[0]?.id || null,
    promptLabel: "Tap the matching pairs",
    pairs: phrases.slice(0, 5).map((phrase) => ({
      id: phrase.id,
      roman: phrase.roman,
      en: phrase.en,
      script: phrase.script,
    })),
  };
}

// Speaking only uses whole phrases, not patterns like "Wǒ jiào…".
export function canProduce(phrase) {
  return Boolean(phrase?.roman) && !/[…/()]/.test(phrase.roman);
}

function speakStep(phrase) {
  return {
    type: "speak",
    phraseId: phrase.id,
    promptLabel: "Say this out loud",
    prompt: phrase.roman,
  };
}

// Picks a phrase that can be spoken, starting at index, else falls back.
function producible(order, start) {
  for (let i = 0; i < order.length; i += 1) {
    const phrase = order[(start + i) % order.length];
    if (canProduce(phrase)) return phrase;
  }
  return null;
}

function buildMix(title, fresh, pool, rng, focus, opts = {}) {
  const order = dedupePhrases([...fresh, ...rng.shuffle(pool)]);
  const at = (index) => order[index % order.length];
  const speakOk = opts.speak !== false;
  const spoken = (index) => {
    const phrase = speakOk ? producible(order, index) : null;
    if (!phrase) return choiceStepNew(at(index), "toRoman", pool, rng);
    // If speaking gets switched off mid-lesson, this question takes its place.
    return { ...speakStep(phrase), fallback: choiceStepNew(phrase, "toRoman", pool, rng) };
  };
  const pairs = () => matchStep(rng.shuffle(pool).slice(0, Math.min(5, pool.length)));
  if (focus === "listen") {
    // Listening courses (eavesdropping, following a song) hear more and build less.
    const heard = [
      listenStep(at(0), pool, rng),
      choiceStepNew(at(1), "toEn", pool, rng),
      listenStep(at(2), pool, rng),
      choiceStepNew(at(3), "toEn", pool, rng),
      listenStep(at(4), pool, rng),
      spoken(0),
      listenStep(at(1), pool, rng),
      pairs(),
    ];
    return { kind: "mix", title, steps: heard.slice(0, BASE_QUESTIONS) };
  }
  const steps = [
    choiceStepNew(at(0), "toRoman", pool, rng),
    choiceStepNew(at(1), "toEn", pool, rng),
    listenStep(at(2), pool, rng),
    tileStep(at(3), pool, rng),
    tileStep(at(4), pool, rng),
    spoken(0),
    listenStep(at(1), pool, rng),
    pairs(),
  ];
  return { kind: "mix", title, steps: steps.slice(0, BASE_QUESTIONS) };
}

function weakFirst(state, course, phrases) {
  return phrases
    .filter((phrase) => (state.misses[missKey(course.id, phrase.id)] || 0) > 0)
    .sort(
      (a, b) =>
        (state.misses[missKey(course.id, b.id)] || 0) - (state.misses[missKey(course.id, a.id)] || 0),
    );
}

export function buildNodeLesson(course, node, state, random = Math.random, opts = {}) {
  if (node.kind === "sounds") return buildSoundsLesson(course, random);
  const rng = makeRng(random);
  const today = opts.today || dayKey();
  const all = course.units.flatMap((unit) => unit.phrases);
  const byId = new Map(all.map((phrase) => [phrase.id, phrase]));
  const path = coursePath(course);
  const index = path.findIndex((item) => item.unitId === node.unitId && item.id === node.id);
  const earlierIds = new Set(path.slice(0, Math.max(0, index)).flatMap((item) => item.phraseIds || []));
  const earlier = all.filter((phrase) => earlierIds.has(phrase.id));
  const weak = weakFirst(state, course, earlier);
  const due = duePhrases(state, course, earlier, today);
  let fresh = [];
  let pool = [];
  if (node.kind === "checkpoint") {
    const unit = course.units.find((item) => item.id === node.unitId);
    const inUnit = (phrase) => unit.phrases.some((item) => item.id === phrase.id);
    pool = dedupePhrases([
      ...weak.filter(inUnit),
      ...due.filter(inUnit),
      ...rng.shuffle(unit.phrases),
      ...weak,
      ...due,
      ...rng.shuffle(earlier),
    ]).slice(0, 10);
  } else {
    fresh = node.phraseIds.map((id) => byId.get(id)).filter(Boolean);
    const review = dedupePhrases([...weak, ...due, ...rng.shuffle(earlier)])
      .filter((phrase) => !node.phraseIds.includes(phrase.id))
      .slice(0, 5);
    pool = dedupePhrases([...fresh, ...review]);
  }
  if (pool.length < 5) pool = dedupePhrases([...pool, ...rng.shuffle(all)]).slice(0, 5);
  return buildMix(node.title, fresh, pool, rng, course.focus, opts);
}

// ---------- Spaced review ----------
// Each phrase you've met has a box. A right answer on a due phrase moves it up a box
// and pushes the next review further out. A miss drops it to box 0, due today.
export const REVIEW_DAYS = [0, 1, 3, 7, 16, 35, 90];

function cleanSrs(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    if (!Number.isFinite(value.b) || typeof value.d !== "string") continue;
    out[key] = { b: Math.max(0, Math.min(REVIEW_DAYS.length - 1, value.b)), d: value.d, t: Number.isFinite(value.t) ? value.t : 0 };
  }
  return out;
}

export function addDays(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

export function reviewPhrase(state, courseId, phraseId, ok, today = dayKey(), now = Date.now()) {
  const key = missKey(courseId, phraseId);
  const current = state.srs?.[key];
  if (ok && current && current.d > today) return state;
  const next = clone(state);
  if (!ok) {
    next.srs[key] = { b: 0, d: today, t: now };
    return next;
  }
  const box = Math.min(REVIEW_DAYS.length - 1, current ? current.b + 1 : 1);
  next.srs[key] = { b: box, d: addDays(today, REVIEW_DAYS[box]), t: now };
  return next;
}

// Phrases met in a finished lesson (or skipped past with a jump) start in box 1.
export function seedPhrases(state, courseId, phraseIds, today = dayKey(), spread = false, now = Date.now()) {
  const next = clone(state);
  phraseIds.forEach((id, index) => {
    const key = missKey(courseId, id);
    if (next.srs[key]) return;
    next.srs[key] = { b: 1, d: addDays(today, spread ? 1 + (index % 3) : 1), t: now };
  });
  return next;
}

export function isDue(state, courseId, phraseId, today = dayKey()) {
  const entry = state.srs?.[missKey(courseId, phraseId)];
  return Boolean(entry && entry.d <= today);
}

export function duePhrases(state, course, phrases, today = dayKey()) {
  return phrases
    .filter((phrase) => isDue(state, course.id, phrase.id, today))
    .sort((a, b) => {
      const x = state.srs[missKey(course.id, a.id)];
      const y = state.srs[missKey(course.id, b.id)];
      return x.d === y.d ? x.b - y.b : x.d < y.d ? -1 : 1;
    });
}

export function courseDue(state, course, today = dayKey()) {
  return duePhrases(state, course, course.units.flatMap((unit) => unit.phrases), today);
}

// A finished unit "cracks" when a good share of its phrases are due again.
export function unitCracked(state, course, unit, today = dayKey()) {
  if (!unitCoreComplete(state, course.id, unit.id)) return false;
  const seen = unit.phrases.filter((phrase) => state.srs?.[missKey(course.id, phrase.id)]);
  if (!seen.length) return false;
  const due = seen.filter((phrase) => isDue(state, course.id, phrase.id, today)).length;
  return due >= 3 && due >= Math.ceil(seen.length * 0.4);
}

export function buildRefreshLesson(course, unitId, state, random = Math.random, opts = {}) {
  const rng = makeRng(random);
  const today = opts.today || dayKey();
  const unit = unitId ? course.units.find((item) => item.id === unitId) : null;
  const scope = unit ? unit.phrases : course.units.flatMap((item) => item.phrases);
  const seen = scope.filter((phrase) => state.srs?.[missKey(course.id, phrase.id)]);
  const due = duePhrases(state, course, scope, today);
  let pool = dedupePhrases([...due, ...weakFirst(state, course, seen), ...rng.shuffle(seen)]).slice(0, 8);
  if (pool.length < 5) pool = dedupePhrases([...pool, ...rng.shuffle(unit ? unit.phrases : scope)]).slice(0, 5);
  const fresh = due.slice(0, 5);
  const title = unit ? `Refresh: ${unit.title}` : "Review";
  return buildMix(title, fresh, pool, rng, course.focus, opts);
}

// ---------- Jump ahead ----------
export const JUMP_HEARTS = 3;
const JUMP_QUESTIONS = 10;

export function buildJumpTest(course, unitIndex, random = Math.random, opts = {}) {
  const rng = makeRng(random);
  const before = course.units.slice(0, unitIndex);
  const recent = before.at(-1)?.phrases || [];
  const older = before.slice(0, -1).flatMap((unit) => unit.phrases);
  const pool = dedupePhrases([...rng.shuffle(recent).slice(0, 6), ...rng.shuffle(older), ...rng.shuffle(recent)]);
  const order = pool.slice(0, JUMP_QUESTIONS);
  const at = (index) => order[index % order.length];
  const steps = [];
  const kinds = course.focus === "listen"
    ? ["listen", "toEn", "toRoman", "listen", "toEn", "listen", "toRoman", "toEn", "listen", "match"]
    : ["toRoman", "toEn", "listen", "tiles", "toRoman", "tiles", "listen", "toEn", "tiles", "match"];
  kinds.forEach((kind, index) => {
    const phrase = at(index);
    if (kind === "listen") steps.push(listenStep(phrase, pool, rng));
    else if (kind === "toEn" || kind === "toRoman") steps.push(choiceStepNew(phrase, kind, pool, rng));
    else if (kind === "tiles") steps.push(tileStep(phrase, pool, rng));
    else steps.push(matchStep(rng.shuffle(pool).slice(0, 5)));
  });
  const target = course.units[unitIndex];
  return { kind: "mix", title: `Jump to ${target.title}`, steps };
}

// Passing the test marks everything before that unit done and queues those phrases for review.
export function applyJump(state, course, unitIndex, today = dayKey()) {
  let next = clone(state);
  const path = coursePath(course);
  const unitIds = new Set(course.units.slice(0, unitIndex).map((unit) => unit.id));
  for (const node of path) {
    if (!unitIds.has(node.unitId) && !(node.kind === "sounds" && unitIndex > 0)) continue;
    const key = node.kind === "sounds" ? lessonKey(course.id, "sounds", "sounds") : lessonKey(course.id, node.unitId, node.id);
    next.done[key] = next.done[key] || today;
  }
  const ids = course.units.slice(0, unitIndex).flatMap((unit) => unit.phrases.map((phrase) => phrase.id));
  next = seedPhrases(next, course.id, ids, today, true);
  return next;
}

// ---------- Answer matching ----------
export function levenshtein(a, b) {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

// Accents, tone marks, macrons, capitals, and punctuation are ignored when matching speech.
export function normalizeTyped(text, compact = false) {
  const plain = String(text || "")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact ? plain.replace(/\s/g, "") : plain;
}

// ---------- Spoken answers ----------
function speechKey(text, lang) {
  const base = String(lang || "").slice(0, 2).toLowerCase();
  const plain = normalizeTyped(text, base === "zh" || base === "ja");
  return plain;
}

export function speechScore(expected, heard, lang) {
  const want = speechKey(expected, lang);
  const got = speechKey(heard, lang);
  if (!want || !got) return 0;
  if (got.includes(want)) return 1;
  return Math.max(0, 1 - levenshtein(got, want) / Math.max(want.length, got.length));
}

export function speechPasses(expected, alternatives, lang) {
  const base = String(lang || "").slice(0, 2).toLowerCase();
  const need = base === "ja" ? 0.5 : base === "zh" ? 0.6 : 0.65;
  const best = Math.max(0, ...alternatives.map((alt) => speechScore(expected, alt, lang)));
  return { ok: best >= need, score: best };
}

// ---------- Recorded audio ----------
// The key for a recorded clip. scripts/make_audio.mjs and the app both use it,
// so a line asks for exactly the clip that was made for it.
export function clipKey(text, lang) {
  const base = String(lang || "").slice(0, 2).toLowerCase();
  const clean = String(text || "")
    .normalize("NFC")
    .replace(/[…？?。、「」！!，,¿¡.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${base}|${base === "zh" || base === "ja" ? clean.replace(/\s/g, "") : clean.toLowerCase()}`;
}

// Every line the app can speak for a course, for making recorded clips.
export function spokenLines(course) {
  const lines = new Set();
  const english = course.scriptLang === "en";
  const add = (text) => {
    if (text && String(text).trim()) lines.add(String(text).trim());
  };
  for (const unit of course.units) {
    for (const phrase of unit.phrases) {
      add(speakText(phrase));
      if (english) add(phrase.roman);
      const parts = scriptParts(phrase);
      wordsOf(phrase.roman).forEach((word, index) => add(parts ? parts[index] : word));
    }
  }
  for (const slide of course.sounds?.slides || []) {
    for (const example of slide.examples || []) {
      add(example.speak);
      add(english ? example.roman : example.script || example.roman);
    }
  }
  for (const item of course.sounds?.quiz || []) add(item.speak?.script);
  return [...lines];
}
