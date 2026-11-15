// Lesson building and saved-progress rules. No browser APIs, so it can be checked on its own.
import { COURSES } from "./courses.js";

export const DAILY_GOAL = 20;

export const LESSON_XP = {
  sounds: 8,
  learn: 10,
  practice: 12,
  listen: 12,
  review: 8,
  lesson: 15,
  checkpoint: 12,
  heart: 5,
};

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
    heartsLost: Array.isArray(raw.heartsLost) ? raw.heartsLost.filter((t) => Number.isFinite(t)) : [],
    installHintDismissed: Boolean(raw.installHintDismissed),
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

// Awards XP only the first time a lesson is finished. Repeats still count for the streak.
export function completeLesson(state, { courseId, unitId, lessonId, xp, today }) {
  const next = clone(state);
  const key = lessonKey(courseId, unitId, lessonId);
  const first = !next.done[key];
  next.done[key] = next.done[key] || today;

  let awarded = 0;
  if (first) {
    awarded = xp;
    next.xp += xp;
    if (next.dailyDay !== today) {
      next.dailyDay = today;
      next.dailyXp = 0;
    }
    next.dailyXp += xp;
  }

  let streakNote = null;
  if (next.lastDay !== today) {
    if (next.lastDay === yesterdayOf(today)) next.streak += 1;
    else next.streak = 1;
    next.lastDay = today;
    streakNote = next.streak;
  }

  const before = first ? next.dailyXp - awarded : dailyXp(next, today);
  const goalJustMet = first && before < DAILY_GOAL && next.dailyXp >= DAILY_GOAL;
  if (next.dailyDay === today && next.dailyXp >= DAILY_GOAL) next.goalNotedDay = today;

  return { state: next, awarded, streakNote, goalJustMet, first };
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

export function speakText(phrase) {
  if (phrase.speak) return phrase.speak;
  return phrase.script.replace(/[…？?。、「」]/g, "").trim();
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
export const LESSON_LIMIT = 10;
const BASE_QUESTIONS = 7;

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

function wordsOf(roman) {
  const clean = String(roman || "").replace(/[…?.？。!！]/g, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length ? parts : [clean || String(roman)];
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

function tileStep(phrase, pool, rng) {
  const answer = wordsOf(phrase.roman);
  const used = new Set(answer);
  const distractors = [];
  for (const other of rng.shuffle(pool)) {
    if (other.id === phrase.id) continue;
    for (const word of wordsOf(other.roman)) {
      if (used.has(word)) continue;
      used.add(word);
      distractors.push(word);
      if (distractors.length === 3) break;
    }
    if (distractors.length === 3) break;
  }
  return {
    type: "tiles",
    phraseId: phrase.id,
    prompt: phrase.en,
    promptLabel: "Tap the words in order",
    answer,
    tiles: rng.shuffle([...answer, ...distractors]),
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

function buildMix(title, fresh, pool, rng) {
  const order = dedupePhrases([...fresh, ...rng.shuffle(pool)]);
  const at = (index) => order[index % order.length];
  const steps = [
    choiceStepNew(at(0), "toRoman", pool, rng),
    choiceStepNew(at(1), "toEn", pool, rng),
    listenStep(at(2), pool, rng),
    tileStep(at(3), pool, rng),
    choiceStepNew(at(4), "toRoman", pool, rng),
    listenStep(at(0), pool, rng),
    matchStep(rng.shuffle(pool).slice(0, Math.min(5, pool.length))),
  ];
  return { kind: "mix", title, steps: steps.slice(0, BASE_QUESTIONS) };
}

export function buildNodeLesson(course, node, state, random = Math.random) {
  if (node.kind === "sounds") return buildSoundsLesson(course, random);
  const rng = makeRng(random);
  const all = course.units.flatMap((unit) => unit.phrases);
  const byId = new Map(all.map((phrase) => [phrase.id, phrase]));
  const path = coursePath(course);
  const index = path.findIndex((item) => item.unitId === node.unitId && item.id === node.id);
  const earlierIds = new Set(path.slice(0, Math.max(0, index)).flatMap((item) => item.phraseIds || []));
  const earlier = all.filter((phrase) => earlierIds.has(phrase.id));
  const weak = earlier
    .filter((phrase) => (state.misses[missKey(course.id, phrase.id)] || 0) > 0)
    .sort(
      (a, b) =>
        (state.misses[missKey(course.id, b.id)] || 0) - (state.misses[missKey(course.id, a.id)] || 0),
    );
  let fresh = [];
  let pool = [];
  if (node.kind === "checkpoint") {
    const unit = course.units.find((item) => item.id === node.unitId);
    pool = dedupePhrases([
      ...weak.filter((phrase) => unit.phrases.some((item) => item.id === phrase.id)),
      ...rng.shuffle(unit.phrases),
      ...weak,
      ...rng.shuffle(earlier),
    ]).slice(0, 10);
  } else {
    fresh = node.phraseIds.map((id) => byId.get(id)).filter(Boolean);
    const review = dedupePhrases([...weak, ...rng.shuffle(earlier)])
      .filter((phrase) => !node.phraseIds.includes(phrase.id))
      .slice(0, 5);
    pool = dedupePhrases([...fresh, ...review]);
  }
  if (pool.length < 5) pool = dedupePhrases([...pool, ...rng.shuffle(all)]).slice(0, 5);
  return buildMix(node.title, fresh, pool, rng);
}
