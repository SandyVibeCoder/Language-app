// Checks phrase data and the progress rules. No browser, no network.
import { readFileSync, statSync } from "node:fs";
import { COURSES, courseById, unitById } from "../js/courses.js";
import { account } from "../js/account.js";
import {
  CORE_LESSONS,
  DAILY_GOAL,
  JUMP_HEARTS,
  LESSON_XP,
  addDays,
  applyJump,
  buildJumpTest,
  buildRefreshLesson,
  checkTyped,
  clipKey,
  courseDue,
  isDue,
  reviewPhrase,
  seedPhrases,
  speechPasses,
  spokenLines,
  unitCracked,
  isNodeDone,
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
  mergeStates,
  missCountForUnit,
  normalizeState,
  recordMiss,
  scriptParts,
  speakText,
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

assert(COURSES.length === 4, "four courses");
assert(new Set(COURSES.map((c) => c.id)).size === 4, "unique course ids");

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
      } else if (course.id === "de") {
        assert(!/[ǎěǐǒǔāēīōū¿¡]/u.test(phrase.roman), `stray mark in de ${phrase.id}: ${phrase.roman}`);
        assert(/^[A-Za-zÄÖÜäöü ,'…-]+$/.test(phrase.script), `guide should be plain letters ${phrase.id}: ${phrase.script}`);
        assert(phrase.speak && !/[?!…]/.test(phrase.speak), `de speech text ${phrase.id}`);
      } else if (course.id === "es") {
        assert(!/[ǎěǐǒǔāēīōū]/u.test(phrase.roman), `pinyin-style mark in es ${phrase.id}: ${phrase.roman}`);
        assert(/^[A-Za-z ,'…-]+$/.test(phrase.script), `guide should be plain letters ${phrase.id}: ${phrase.script}`);
        assert(phrase.speak && !/[¿¡?!…]/.test(phrase.speak), `es speech text ${phrase.id}`);
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
  xp: 10,
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
assert(result.awarded === LESSON_XP.replay && result.first === false, "a replay earns the smaller practice XP");
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
assert(state.dailyXp === 27, "same-day xp adds up, replays included");

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
const esRewards = Array.from({ length: 8 }, (_, i) => `images/reward-es-${String(i + 1).padStart(2, "0")}.webp`);
const deRewards = Array.from({ length: 8 }, (_, i) => `images/reward-de-${String(i + 1).padStart(2, "0")}.webp`);
const rewardFiles = [...zhRewards, ...jaRewards, ...esRewards, ...deRewards];
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
for (const file of rewardFiles) {
  const bytes = statSync(new URL("../" + file, import.meta.url)).size;
  assert(bytes > 1000 && bytes < 150 * 1024, `${file} is ${bytes} bytes`);
  assert(sw.includes(`./${file}`), `${file} missing from the service worker`);
}
assert(new Set(zhRewards).size === 12, "Mandarin has 12 posters");
assert(new Set(jaRewards).size === 12, "Japanese has 12 posters");
assert(zhRewards.every((file) => !jaRewards.includes(file)), "the two courses do not share a poster");
assert(new Set(esRewards).size === 8 && esRewards.every((file) => !zhRewards.includes(file) && !jaRewards.includes(file)), "Spanish has its own 8 posters");
assert(new Set(rewardFiles).size === rewardFiles.length, "no course shares a poster");

const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const zhBlock = appSource.split("const ZH_REWARDS")[1]?.split("const JA_REWARDS")[0] || "";
const jaBlock = appSource.split("const JA_REWARDS")[1]?.split("const ES_REWARDS")[0] || "";
const esBlock = appSource.split("const ES_REWARDS")[1]?.split("const DE_REWARDS")[0] || "";
const deBlock = appSource.split("const DE_REWARDS")[1]?.split("function rewardFor")[0] || "";
const listed = (block) => [...block.matchAll(/src: "(images\/reward-[^"]+)"/g)].map((match) => match[1]);
assert(listed(zhBlock).join() === zhRewards.join(), "Mandarin rotation order");
assert(listed(jaBlock).join() === jaRewards.join(), "Japanese rotation order");
assert(listed(esBlock).join() === esRewards.join(), "Spanish rotation order");
assert(listed(deBlock).join() === deRewards.join(), "German rotation order");
assert(appSource.includes("% posters.length"), "posters cycle when there are fewer units");
assert(sw.includes('const CACHE = "travel-speak-v25"'), "service worker cache version");
assert(sw.includes("AUDIO_CACHE") && sw.includes("/audio/"), "recorded clips are cached");
assert(sw.includes("firebasejs/10.14.1") && appSource.length > 0, "the sign-in SDK is cached for offline");
assert(sw.includes("./js/hear.js"), "character map is cached");
assert(appSource.includes("utterance.lang = lang"), "speech sets utterance.lang");
assert(appSource.includes('id.startsWith("zh-tw")') && appSource.includes('id.startsWith("zh-cn")'), "Mandarin voice prefers Taiwan, then China");
assert(appSource.includes("step.says"), "each tile speaks its character");
assert(appSource.includes("session.tiles.length > 0"), "Check turns on after the first tile");
assert(appSource.includes('toLocaleLowerCase("en-US")'), "tile answers ignore case");
assert(appSource.includes("data-say"), "target-language text can be tapped to hear");
assert(appSource.includes("match-col"), "matching pairs stay in two columns");
assert(sw.includes("skipWaiting()") && sw.includes("clients.claim()"), "service worker takes over on the next load");
assert(sw.includes('request.mode === "navigate"'), "pages load from the network first");
assert(appSource.includes("controllerchange"), "the page reloads once when the worker updates");
assert((appSource.match(/\$\{lessonBar\(/g) || []).length >= 2, "X stays on lesson screens");
assert(appSource.includes('aria-label="Close lesson"'), "lesson close button");
assert(appSource.includes("topbar(course.name)"), "course keeps its back header");
const barFn = appSource.split("function lessonBar")[1]?.split("function quitModal")[0] || "";
assert(!barFn.includes("backSvg"), "the lesson header has one way out, the X");
assert(appSource.includes('data-action="quit-confirm"'), "quitting mid-lesson asks first");
assert(appSource.includes('action === "check-pick"'), "choices are picked, then checked");
assert(appSource.includes("function sfx("), "sound effects");

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

const nativeScript = /[\u3040-\u30ff\u3400-\u9fff]/;
const latinSpeech = /[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
for (const course of COURSES) {
  if (course.id !== "zh" && course.id !== "ja") continue;
  for (const unit of course.units) {
    for (const phrase of unit.phrases) {
      const parts = scriptParts(phrase);
      assert(parts, `${course.id}/${phrase.id} has a character for each spoken word`);
      const spoken = speakText(phrase);
      assert(nativeScript.test(spoken) && !latinSpeech.test(spoken), `${course.id}/${phrase.id} speaks ${spoken}`);
      if (phrase.hear) {
        const joined = phrase.hear.replace(/\s+/g, "");
        const written = phrase.script.replace(/[…？?。、「」！!，,]/g, "").replace("Wi-Fi", "ワイファイ");
        assert(joined === written, `${course.id}/${phrase.id} hear lines up with ${written}`);
      }
    }
  }
  for (const slide of course.sounds.slides) {
    for (const example of slide.examples || []) {
      assert(nativeScript.test(example.script || "") && !latinSpeech.test(example.script || ""), `${course.id} example ${example.roman}`);
    }
  }
  for (const item of course.sounds.quiz) {
    if (!item.speak) continue;
    assert(nativeScript.test(item.speak.script) && !latinSpeech.test(item.speak.script), `${course.id} quiz speak ${item.speak.script}`);
  }
}
const dui = mandarin.units.flatMap((unit) => unit.phrases).find((phrase) => phrase.roman === "Duì");
assert(dui && scriptParts(dui)[0] === "對" && speakText(dui) === "對", "Duì is spoken as 對");

for (const course of COURSES) {
  const path = coursePath(course);
  assert(path.length >= 12, `${course.id} path length ${path.length}`);
  const soundsAt = path.findIndex((node) => node.kind === "sounds");
  const firstDone = path.findIndex((node) => node.id === `${course.units[0].id}-check`);
  assert(soundsAt > firstDone && firstDone > 0, `${course.id} sounds come after the first unit`);
  assert(path[0].kind === "lesson", `${course.id} starts with a lesson`);
  assert(nodeUnlocked(blankState(), course, 0) && !nodeUnlocked(blankState(), course, 1), `${course.id} first node only`);
  const marked = new Set();
  for (const unit of course.units) {
    for (const phrase of unit.phrases) {
      const words = phrase.roman.replace(/[…?.？。!！¿¡,]/g, "").trim().split(/\s+/).filter(Boolean);
      for (const word of words.slice(1)) {
        if (word.charAt(0) !== word.charAt(0).toLocaleLowerCase("en-US")) marked.add(word.toLocaleLowerCase("en-US"));
      }
    }
  }
  for (const node of path) {
    if (node.kind === "sounds") continue;
    const built = buildNodeLesson(course, node, blankState(), () => 0.3);
    assert(built.steps.length === 8 && built.steps.length < LESSON_LIMIT, `${course.id}/${node.id} length ${built.steps.length}`);
    for (const step of built.steps) {
      if (step.type === "type") assert(step.answer && !/[…/()]/.test(step.answer), `${course.id}/${node.id} typed answer ${step.answer}`);
      if (step.type === "speak") assert(step.fallback?.type === "choice", `${course.id}/${node.id} speak has a fallback`);
    }
    const quiet = buildNodeLesson(course, node, blankState(), () => 0.3, { speak: false });
    assert(!quiet.steps.some((step) => step.type === "speak"), `${course.id}/${node.id} no speaking when it's off`);
    const types = new Set(built.steps.map((step) => step.type));
    const match = built.steps.find((step) => step.type === "match");
    assert(match && match.pairs.length === 5, `${course.id}/${node.id} pairs`);
    if (course.focus === "listen") {
      const heard = built.steps.filter((step) => step.type === "listen").length;
      assert(heard >= 4 && types.has("choice") && !types.has("tiles"), `${course.id}/${node.id} listening mix`);
      continue;
    }
    assert(types.has("choice") && types.has("tiles") && types.has("listen"), `${course.id}/${node.id} mix`);
    if (node.kind === "lesson") assert(types.has("type") || types.has("speak"), `${course.id}/${node.id} typing or speaking`);
    const tiles = built.steps.find((step) => step.type === "tiles");
    assert(tiles.tiles.length > tiles.answer.length, `${course.id}/${node.id} distractors`);
    const lead = tiles.answer[0];
    assert(lead.charAt(0) === lead.charAt(0).toLocaleUpperCase("en-US"), `${course.id}/${node.id} first tile ${lead}`);
    for (const word of tiles.tiles) {
      if (word === lead) continue;
      const upper = word.charAt(0) !== word.charAt(0).toLocaleLowerCase("en-US");
      if (upper) assert(marked.has(word.toLocaleLowerCase("en-US")), `${course.id}/${node.id} capital ${word}`);
    }
    if (course.id === "zh" || course.id === "ja") {
      assert(tiles.says?.length === tiles.tiles.length, `${course.id}/${node.id} tile speech`);
      for (const say of tiles.says) {
        assert(nativeScript.test(say) && !latinSpeech.test(say), `${course.id}/${node.id} speaks ${say}`);
      }
    }
  }
}
const sample = buildNodeLesson(COURSES[0], coursePath(COURSES[0])[0], blankState(), () => 0.2);
assert(canQueueRepeat(sample.steps), "a fresh lesson can still repeat a miss");
const capped = Array.from({ length: LESSON_LIMIT }, () => ({ type: "choice" }));
assert(!canQueueRepeat(capped), "ten questions leave no room for another");
const slides = [
  ...Array.from({ length: 6 }, () => ({ type: "slide" })),
  ...Array.from({ length: LESSON_LIMIT - 1 }, () => ({ type: "choice" })),
];
assert(canQueueRepeat(slides), "slides do not count toward the question cap");
assert(!canQueueRepeat([...slides, { type: "listen" }]), "the last question fills the lesson");
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


// Accounts: the app imports these, so a missing export breaks the home screen.
assert(typeof courseById === "function" && typeof unitById === "function", "courses.js exports its helpers");
assert(account && typeof account.enabled === "boolean", "account module loads");
const appText = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
assert(appText.includes('from "./account.js"'), "app wires in accounts");
const swText = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
assert(swText.includes("./js/account.js") && swText.includes("./js/firebase-config.js"), "account files work offline");

// Merging phone progress with account progress keeps everything from both.
{
  const phone = { ...blankState(), xp: 40, streak: 2, lastDay: "2026-11-20", dailyDay: "2026-11-20", dailyXp: 15,
    done: { "es:greetings-1:greetings-1": "2026-11-20" }, misses: { "es:g-onda": 2, "zh:g-hello": 1 } };
  const cloud = { ...blankState(), xp: 120, streak: 5, lastDay: "2026-11-18", dailyDay: "2026-11-18", dailyXp: 30,
    done: { "zh:greetings-1:greetings-1": "2026-11-10" }, misses: { "es:g-onda": 1, "ja:g-hello": 3 } };
  const merged = mergeStates(phone, cloud);
  assert(merged.xp === 120, "merge keeps the higher XP");
  assert(Object.keys(merged.done).length === 2, "merge keeps lessons finished on either side");
  assert(merged.misses["es:g-onda"] === 2 && merged.misses["ja:g-hello"] === 3 && merged.misses["zh:g-hello"] === 1, "merge keeps every miss");
  assert(merged.lastDay === "2026-11-20" && merged.streak === 2, "merge takes the streak from the most recent day");
  assert(merged.dailyDay === "2026-11-20" && merged.dailyXp === 15, "merge takes today's XP from the most recent day");
  const same = mergeStates({ ...phone, lastDay: "2026-11-20", streak: 3 }, { ...cloud, lastDay: "2026-11-20", streak: 6 });
  assert(same.streak === 6, "same day keeps the longer streak");
  assert(JSON.stringify(mergeStates(phone, null)) === JSON.stringify(mergeStates(phone, blankState())), "merge with no account data");
}

// XP: replays, perfect lessons, and runs of right answers.
{
  const base = blankState();
  const one = completeLesson(base, { courseId: "zh", unitId: "u", lessonId: "l", xp: LESSON_XP.lesson, today: "2026-11-20", perfect: true, bestCombo: 10 });
  assert(one.awarded === LESSON_XP.lesson + LESSON_XP.perfect + LESSON_XP.combo5 + LESSON_XP.combo10, "first finish with every bonus");
  const two = completeLesson(one.state, { courseId: "zh", unitId: "u", lessonId: "l", xp: LESSON_XP.lesson, today: "2026-11-20", bestCombo: 5 });
  assert(two.awarded === LESSON_XP.replay + LESSON_XP.combo5 && !two.first, "replay XP plus run bonus");
  const practice = completeLesson(two.state, { courseId: "zh", unitId: "all", lessonId: "refresh-all", xp: LESSON_XP.refresh, today: "2026-11-20", mark: false });
  assert(practice.awarded === LESSON_XP.refresh && !practice.state.done["zh:all:refresh-all"], "review XP without marking the path");
}

// Spaced review.
{
  const zh = courseById("zh");
  const unit = zh.units[0];
  let s = seedPhrases(blankState(), "zh", unit.phrases.map((p) => p.id), "2026-11-20");
  assert(!isDue(s, "zh", unit.phrases[0].id, "2026-11-20") && isDue(s, "zh", unit.phrases[0].id, "2026-11-21"), "seeded phrases are due tomorrow");
  const id = unit.phrases[0].id;
  s = reviewPhrase(s, "zh", id, true, "2026-11-21");
  assert(s.srs[`zh:${id}`].b === 2 && s.srs[`zh:${id}`].d === "2026-11-24", "a right answer moves it out 3 days");
  const same = reviewPhrase(s, "zh", id, true, "2026-11-21");
  assert(same === s, "a right answer before it's due changes nothing");
  s = reviewPhrase(s, "zh", id, false, "2026-11-22");
  assert(s.srs[`zh:${id}`].b === 0 && isDue(s, "zh", id, "2026-11-22"), "a miss makes it due today");
  assert(addDays("2026-12-30", 3) === "2027-01-02", "dates roll over");
  let done = blankState();
  for (const node of coursePath(zh).filter((n) => n.unitId === unit.id)) done.done[`zh:${unit.id}:${node.id}`] = "2026-11-20";
  done = seedPhrases(done, "zh", unit.phrases.map((p) => p.id), "2026-11-20");
  assert(!unitCracked(done, zh, unit, "2026-11-20"), "a fresh unit isn't cracked");
  assert(unitCracked(done, zh, unit, "2026-11-23"), "a unit cracks once many phrases are due");
  assert(courseDue(done, zh, "2026-11-23").length === unit.phrases.length, "the course lists due phrases");
  const refresh = buildRefreshLesson(zh, unit.id, done, () => 0.3, { today: "2026-11-23" });
  assert(refresh.steps.length === 8 && refresh.steps.every((step) => !step.phraseId || unit.phrases.some((p) => p.id === step.phraseId)), "a unit refresh stays in that unit");
  const merged = mergeStates({ ...blankState(), srs: { "zh:a": { b: 1, d: "2026-11-21", t: 5 } } }, { ...blankState(), srs: { "zh:a": { b: 3, d: "2026-12-01", t: 9 }, "zh:b": { b: 1, d: "2026-11-21", t: 1 } } });
  assert(merged.srs["zh:a"].b === 3 && merged.srs["zh:b"], "merge keeps the newest review of each phrase");
}

// Jump ahead.
for (const course of COURSES) {
  const test = buildJumpTest(course, 3, () => 0.4);
  assert(test.steps.length === 10 && test.steps.at(-1).type === "match", `${course.id} jump test`);
  const allowed = new Set(course.units.slice(0, 3).flatMap((u) => u.phrases.map((p) => p.id)));
  assert(test.steps.every((step) => !step.phraseId || allowed.has(step.phraseId)), `${course.id} jump test only covers earlier units`);
  const jumped = applyJump(blankState(), course, 3, "2026-11-20");
  const path = coursePath(course);
  const firstOfFour = path.findIndex((n) => n.unitId === course.units[3].id);
  assert(nodeUnlocked(jumped, course, firstOfFour), `${course.id} jump opens the unit`);
  assert(!isNodeDone(jumped, course, path[firstOfFour]), `${course.id} the target unit itself is still to do`);
  assert(Object.keys(jumped.srs).length === allowed.size, `${course.id} skipped phrases go into review`);
}
assert(JUMP_HEARTS === 3, "jump tests have 3 hearts");

// Typed and spoken answers.
assert(checkTyped("¿Qué onda?", "que onda").ok, "accents and punctuation optional");
assert(checkTyped("Hasta mañana", "asta manana").typo, "one slip is a typo, still right");
assert(!checkTyped("Hasta mañana", "buenos dias").ok, "wrong words are wrong");
assert(checkTyped("Xièxie", "xie xie", true).ok, "pinyin without tones or spaces");
assert(checkTyped("Sumimasen", "sumimasen").ok && checkTyped("Arigatō", "arigato", true).ok, "romaji without macrons");
assert(checkTyped("Neunundneunzig Luftballons", "neunundneunzig luftballons").ok, "German");
assert(speechPasses("謝謝", ["謝謝你"], "zh-TW").ok, "heard speech can include a little extra");
assert(!speechPasses("謝謝", ["你好"], "zh-TW").ok, "different speech fails");
assert(speechPasses("Buenos días", ["buenos dias"], "es-MX").ok, "Spanish speech ignores accents");

// Recorded clips: every spoken line has one key per course.
for (const course of COURSES) {
  const lines = spokenLines(course);
  assert(lines.length > 100, `${course.id} spoken lines`);
  for (const unit of course.units) {
    for (const phrase of unit.phrases) {
      assert(lines.some((line) => clipKey(line, course.voice) === clipKey(speakText(phrase), course.voice)), `${course.id}/${phrase.id} has a clip key`);
    }
  }
}
assert(clipKey("¿Qué onda?", "es-MX") === clipKey("Qué onda", "es-MX"), "clip keys ignore punctuation");

// Accounts are required.
assert(/function lockedOut\(\) \{\s*return !account\.user;/.test(appText), "no way past sign-in without an account");

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("checks passed");
