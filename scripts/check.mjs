// Checks phrase data and the progress rules. No browser, no network.
import { readFileSync, statSync } from "node:fs";
import { COURSES } from "../js/courses.js";
import {
  CORE_LESSONS,
  DAILY_GOAL,
  LESSON_XP,
  blankState,
  buildNodeLesson,
  buildPhraseLesson,
  buildSoundsLesson,
  completeLesson,
  LESSON_LIMIT,
  canQueueRepeat,
  coursePath,
  courseUnitsDone,
  dayKey,
  makeRng,
  missCountForUnit,
  normalizeState,
  recordMiss,
  speechForTone,
  toneContour,
  tonesFromPinyin,
  nodeUnlocked,
  unitCoreComplete,
  unitUnlocked,
  visibleStreak,
  yesterdayOf,
} from "../js/engine.js";

const tone = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/u;
const japaneseBanned = /[áàǎéèěíìǐóòǒúùǔǘǚǜü]/u;
// Characters that are the simplified form of a different traditional character.
const simplifiedOnly = new Set(
  (
    "国语们时样为会这来个对过还发问门开书长头马贝车电经现点无气写听业东体实与万两钱贵买卖开关请谢见识兴网线医药护账结运计转远张码间烧题买币带内么号楼铁听说认欢关历气后里云尔产广达" +
    "丰习乡书买乱争于亏云亚产亩亲亿仅从仓仪们价众优伙会伞伟传伤体余亩丰" +
    "门问间闲闻闭" +
    "车轮软轨转轻较" +
    "页顶项顺须顾预领频" +
    "饣饭饮饲饱" +
    "钅银钱钢" +
    "鱼鲜" +
    "鸟鸡鸣" +
    "页风飞" +
    "马驱驶驻" +
    "贝财货贪贫购贮" +
    "见观规视览觉" +
    "讠讲设许论访证识诉词译" +
    "纟红级纪纯纱纳纸纹纺线练组细终绍经结给络绝统绢绣继" +
    "钅针钉钞钟钢钱" +
    "饣饥饭饮" +
    "氵汉汤" 
  ).split(""),
);

let failed = 0;
function assert(cond, message) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", message);
  }
}

assert(COURSES.length === 2, "two courses");
assert(new Set(COURSES.map((c) => c.id)).size === 2, "unique course ids");

for (const course of COURSES) {
  assert(course.units.length === 8, `${course.id} has 8 units`);
  assert(course.sounds.slides.length >= 4, `${course.id} sounds slides`);
  assert(course.sounds.quiz.length >= 3, `${course.id} sounds quiz`);
  const ids = new Set();
  for (const unit of course.units) {
    assert(unit.phrases.length >= 10 && unit.phrases.length <= 20, `${course.id}/${unit.id} phrase count ${unit.phrases.length}`);
    assert(unit.tip && unit.blurb && unit.title, `${course.id}/${unit.id} copy`);
    const ens = new Set();
    const romans = new Set();
    for (const phrase of unit.phrases) {
      assert(phrase.en && phrase.roman && phrase.script, `${course.id}/${phrase.id} fields`);
      assert(!ids.has(phrase.id), `duplicate id ${course.id}/${phrase.id}`);
      ids.add(phrase.id);
      assert(!ens.has(phrase.en), `duplicate english ${course.id}/${unit.id}: ${phrase.en}`);
      assert(!romans.has(phrase.roman), `duplicate roman ${course.id}/${unit.id}: ${phrase.roman}`);
      ens.add(phrase.en);
      romans.add(phrase.roman);
      if (course.id === "zh") {
        assert(tone.test(phrase.roman), `missing tone mark ${phrase.id}: ${phrase.roman}`);
        for (const ch of phrase.script + (phrase.speak || "")) {
          assert(!simplifiedOnly.has(ch), `simplified char ${ch} in ${phrase.id}`);
        }
      } else {
        assert(!japaneseBanned.test(phrase.roman), `pinyin-style mark in ja ${phrase.id}: ${phrase.roman}`);
        assert(!/[一-龯]/.test(phrase.roman), `han in ja roman ${phrase.id}`);
      }
    }

    const rng = () => 0.2;
    for (const lessonId of ["learn", "practice", "listen", "review"]) {
      const built = buildPhraseLesson(course, unit, lessonId, blankState(), rng);
      if (lessonId === "learn") {
        assert(built.phrases.length === unit.phrases.length, `learn size ${unit.id}`);
      } else {
        assert(built.steps.length > 0, `steps ${unit.id} ${lessonId}`);
        for (const step of built.steps) {
          assert(step.options.length === 4, `${unit.id} ${lessonId} options ${step.options.length}`);
          assert(step.options.some((o) => o.id === step.answerId), `${unit.id} answer missing`);
          const texts = step.options.map((o) => o.text);
          assert(new Set(texts).size === texts.length, `${unit.id} duplicate option text`);
        }
      }
    }
    const practice = buildPhraseLesson(course, unit, "practice", blankState(), makeRng(() => Math.random()).next);
    const dirs = practice.steps.map((s) => s.direction);
    assert(dirs.includes("toRoman") && dirs.includes("toEn"), `${course.id}/${unit.id} both directions`);
  }

  const sounds = buildSoundsLesson(course, () => 0.3);
  assert(sounds.steps.some((s) => s.type === "slide"), `${course.id} slide`);
  assert(sounds.steps.some((s) => s.type === "choice"), `${course.id} quiz step`);
}

// Streak, XP, and unlocks.
let state = blankState();
const course = COURSES[0];
const first = course.units[0];
assert(unitUnlocked(state, course, 0), "first unit open");
assert(!unitUnlocked(state, course, 1), "second unit locked");

let result = completeLesson(state, {
  courseId: "zh",
  unitId: first.id,
  lessonId: "learn",
  xp: LESSON_XP.learn,
  today: "2026-11-15",
});
state = result.state;
assert(result.awarded === 10, "first xp");
assert(result.streakNote === 1, "streak starts at 1");
assert(visibleStreak(state, "2026-11-15") === 1, "visible today");
assert(visibleStreak(state, "2026-11-16") === 1, "visible next day");
assert(visibleStreak(state, "2026-11-17") === 0, "lapsed streak hides");

result = completeLesson(state, {
  courseId: "zh",
  unitId: first.id,
  lessonId: "learn",
  xp: 10,
  today: "2026-11-15",
});
state = result.state;
assert(result.awarded === 0 && result.first === false, "no second xp");
assert(state.streak === 1, "same-day streak stays");

result = completeLesson(state, {
  courseId: "zh",
  unitId: first.id,
  lessonId: "practice",
  xp: 12,
  today: "2026-11-15",
});
state = result.state;
assert(result.goalJustMet === true, "daily goal crosses 20");
assert(state.dailyXp === 22, "same-day xp adds up");

result = completeLesson(state, {
  courseId: "zh",
  unitId: first.id,
  lessonId: "listen",
  xp: 12,
  today: "2026-11-16",
});
state = result.state;
assert(state.streak === 2, "streak increments");
assert(state.dailyXp === 12, "new day daily xp");

for (const id of CORE_LESSONS) {
  if (state.done[`zh:${first.id}:${id}`]) continue;
  result = completeLesson(state, {
    courseId: "zh",
    unitId: first.id,
    lessonId: id,
    xp: 10,
    today: "2026-11-16",
  });
  state = result.state;
}
assert(unitCoreComplete(state, "zh", first.id), "core complete");
assert(unitUnlocked(state, course, 1), "next unit opens");
assert(courseUnitsDone(state, course) === 1, "one unit done");

state = recordMiss(state, "zh", first.phrases[0].id);
const review = buildPhraseLesson(course, first, "review", state, () => 0.1);
assert(review.steps.some((s) => s.phraseId === first.phrases[0].id), "review includes the miss");
assert(missCountForUnit(state, "zh", first) === 1, "miss count");

assert(yesterdayOf("2026-03-01") === "2026-02-28", "month boundary");
assert(yesterdayOf("2024-03-01") === "2024-02-29", "leap day");
assert(DAILY_GOAL === 20, "goal");
assert(dayKey(new Date(2026, 0, 2)) === "2026-01-02", "day key");

const zhRewards = [
  "images/reward-taiwan-beach.webp",
  "images/reward-lantern-beach.webp",
  "images/reward-sailboat.webp",
  ...Array.from({ length: 9 }, (_, i) => `images/reward-tw-${String(i + 1).padStart(2, "0")}.webp`),
];
const jaRewards = [
  "images/reward-japan-cherry.webp",
  "images/reward-japan-surf.webp",
  "images/reward-hot-spring.webp",
  ...Array.from({ length: 9 }, (_, i) => `images/reward-jp-${String(i + 1).padStart(2, "0")}.webp`),
];
const rewardFiles = [...zhRewards, ...jaRewards];
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
for (const file of rewardFiles) {
  const bytes = statSync(new URL("../" + file, import.meta.url)).size;
  assert(bytes > 1000 && bytes < 150 * 1024, `${file} is ${bytes} bytes`);
  assert(sw.includes(`./${file}`), `${file} missing from the service worker`);
}
assert(new Set(zhRewards).size === 12, "Mandarin has 12 posters");
assert(new Set(jaRewards).size === 12, "Japanese has 12 posters");
assert(zhRewards.every((file) => !jaRewards.includes(file)), "the two courses do not share a poster");

const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const zhBlock = appSource.split("const ZH_REWARDS")[1]?.split("const JA_REWARDS")[0] || "";
const jaBlock = appSource.split("const JA_REWARDS")[1]?.split("function rewardFor")[0] || "";
const listed = (block) => [...block.matchAll(/src: "(images\/reward-[^"]+)"/g)].map((match) => match[1]);
assert(listed(zhBlock).join() === zhRewards.join(), "Mandarin rotation order");
assert(listed(jaBlock).join() === jaRewards.join(), "Japanese rotation order");
assert(appSource.includes("% posters.length"), "posters cycle when there are fewer units");
assert(sw.includes('const CACHE = "travel-speak-v11"'), "service worker cache version");
assert((appSource.match(/\$\{lessonBar\(/g) || []).length >= 2, "X stays on lesson screens");
assert(appSource.includes('aria-label="Close lesson"'), "lesson close button");
assert(appSource.includes("topbar(course.name)"), "course keeps its back header");
assert(appSource.includes('aria-label="Back"'), "back arrow stays in the lesson header");

const tone1 = toneContour(1);
const tone2 = toneContour(2);
const tone3 = toneContour(3);
const tone4 = toneContour(4);
const span = (shape) => Math.max(...shape.pitches) - Math.min(...shape.pitches);
assert(tone1.pitches.every((pitch) => pitch === tone1.pitches[0]) && tone1.pitches[0] >= 1.35, "tone 1 high and flat");
assert(tone1.ms >= 700 && tone1.ms > tone4.ms * 2, "tone 1 longer than the fall");
assert(tone2.pitches.at(-1) - tone2.pitches[0] >= 0.36 * 1.5, "tone 2 rise is widened");
assert(tone2.pitches[0] < 0.9 && tone2.pitches.at(-1) > 1.5, "tone 2 big rise");
assert(tone3.pitches[1] === Math.min(...tone3.pitches) && tone3.pitches[1] <= 0.6, "tone 3 deep dip");
assert(tone3.pitches.at(-1) > tone3.pitches[0], "tone 3 rises after the dip");
assert(tone3.pitches[0] - tone3.pitches[1] >= 0.22 * 1.5, "tone 3 dip is widened");
assert(tone4.pitches[0] - tone4.pitches.at(-1) >= 0.42 * 1.5 && tone4.ms <= 380, "tone 4 sharp steep fall");
assert(span(tone2) > span(tone1) && span(tone4) > 0.6, "contours are dramatic");
assert(JSON.stringify(tonesFromPinyin("mā má mǎ mà ma")) === JSON.stringify([1, 2, 3, 4, 0]), "pinyin tones");
assert(JSON.stringify(tonesFromPinyin("bú shì")) === JSON.stringify([2, 4]), "two syllables");
assert(JSON.stringify(tonesFromPinyin("ní hǎo")) === JSON.stringify([2, 3]), "hello tones");
assert(speechForTone(1).rate < 0.82 && speechForTone(1).pitch > 1.2, "tone 1 speech slower and higher");
assert(speechForTone(3).pitch < 0.85 && speechForTone(3).rate < 0.82, "tone 3 speech lower and slower");
assert(speechForTone(4).rate < 0.82 && speechForTone(4).pitch > 1.1, "tone 4 speech slower");
const mandarin = COURSES.find((item) => item.id === "zh");
for (const slide of mandarin.sounds.slides) {
  for (const example of slide.examples) {
    assert(tonesFromPinyin(example.roman).length > 0, `tone lesson example ${example.roman}`);
  }
}
for (const item of mandarin.sounds.quiz) {
  if (!item.speak) continue;
  assert(tonesFromPinyin(item.speak.roman).length > 0, `tone quiz ${item.speak.script}`);
}

for (const course of COURSES) {
  const path = coursePath(course);
  assert(path.length >= 12, `${course.id} path length ${path.length}`);
  const soundsAt = path.findIndex((node) => node.kind === "sounds");
  const greetDone = path.findIndex((node) => node.id === "greetings-check");
  assert(soundsAt > greetDone && greetDone > 0, `${course.id} tones come after greetings`);
  assert(path[0].kind === "lesson", `${course.id} starts with a lesson`);
  assert(nodeUnlocked(blankState(), course, 0) && !nodeUnlocked(blankState(), course, 1), `${course.id} first node only`);
  for (const node of path) {
    if (node.kind === "sounds") continue;
    const built = buildNodeLesson(course, node, blankState(), () => 0.3);
    assert(built.steps.length === 7 && built.steps.length < LESSON_LIMIT, `${course.id}/${node.id} length ${built.steps.length}`);
    const types = new Set(built.steps.map((step) => step.type));
    assert(types.has("choice") && types.has("tiles") && types.has("listen") && types.has("match"), `${course.id}/${node.id} mix`);
    const match = built.steps.find((step) => step.type === "match");
    assert(match.pairs.length === 5, `${course.id}/${node.id} pairs`);
    const tiles = built.steps.find((step) => step.type === "tiles");
    assert(tiles.tiles.length > tiles.answer.length, `${course.id}/${node.id} distractors`);
  }
}
const sample = buildNodeLesson(COURSES[0], coursePath(COURSES[0])[0], blankState(), () => 0.2);
assert(canQueueRepeat(sample.steps), "a fresh lesson can still repeat a miss");
const capped = Array.from({ length: LESSON_LIMIT }, () => ({ type: "choice" }));
assert(!canQueueRepeat(capped), "ten questions leave no room for another");
const slides = [
  ...Array.from({ length: 6 }, () => ({ type: "slide" })),
  ...Array.from({ length: 9 }, () => ({ type: "choice" })),
];
assert(canQueueRepeat(slides), "slides do not count toward the question cap");
assert(!canQueueRepeat([...slides, { type: "listen" }]), "the tenth question fills the lesson");
const legacy = blankState();
legacy.done["zh:greetings:learn"] = "2026-01-01";
legacy.done["zh:greetings:practice"] = "2026-01-01";
legacy.done["zh:greetings:listen"] = "2026-01-01";
legacy.done["zh:sounds:intro"] = "2026-01-01";
const migrated = normalizeState(legacy);
const greetNodes = coursePath(COURSES[0]).filter((node) => node.unitId === "greetings");
assert(greetNodes.every((node) => migrated.done[`zh:greetings:${node.id}`]), "old greetings lessons migrate");
assert(migrated.done["zh:sounds:sounds"], "old tone lesson migrates");

const total = COURSES.reduce((n, c) => n + c.units.reduce((m, u) => m + u.phrases.length, 0), 0);
console.log(`phrases: ${total}`);
for (const c of COURSES) {
  console.log(c.id, c.units.map((u) => `${u.id}:${u.phrases.length}`).join(" "));
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("checks passed");
