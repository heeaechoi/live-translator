// 번역 품질 테스트: 실제 Claude API로 예시 문장들을 번역하고 속도를 측정합니다.
// 사용법:  npm run quality            (기본 예시 전체)
//          npm run quality -- 파일.txt (내 영어 문장들, 한 줄에 한 문장)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Translator } from "../translator.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error("❌ ANTHROPIC_API_KEY가 없어요. .env 파일에 키를 넣어주세요.");
  process.exit(1);
}

// 실제 음성인식처럼 잘게 끊기고, 구두점이 없고, 잘못 들은 단어가 섞인 문장들
const SAMPLES = {
  "강의 (문맥 이어짐)": [
    "Welcome back everyone.",
    "In today's lecture we're going to talk about transformers,",
    "which are the architecture behind most modern language models",
    "Now, before we dive in,",
    "let me quickly recap what we covered last week",
    "We looked at recurrent neural networks and why they struggle with long sequences",
  ],
  "일상 대화 (구두점 없음, 군더더기)": [
    "so yeah I was thinking we could um maybe push the launch to next Friday",
    "because the design team still needs a couple more days",
    "and honestly I'd rather ship something we're proud of than rush it you know what I mean",
  ],
  "음성인식 오류 (잘못 들은 단어)": [
    "the patient was given two hundred milli grams of i b profen",
    "we need to make sure the data is pre processed before we feed it into the new rel network",
  ],
  "관용구 / 숫자 / 고유명사": [
    "That presentation really hit it out of the park.",
    "Revenue grew 23.5% year over year to $4.2 billion, beating Wall Street estimates.",
    "Elon Musk said Tesla would open a new factory in Austin, Texas next spring.",
    "Let's not beat around the bush, we're over budget.",
  ],
  "잡음만 있는 조각": ["um uh you know"],
};

let groups = SAMPLES;
const file = process.argv[2];
if (file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  groups = { [path.basename(file)]: lines };
}

const translator = new Translator();
const notes = process.env.TRANSLATOR_NOTES || "";
console.log(`\n번역 엔진: ${translator.model} (effort: ${translator.effort})\n`);

const firstTimes = [];
const totalTimes = [];
for (const [name, lines] of Object.entries(groups)) {
  console.log(`━━ ${name} ━━`);
  const context = [];
  for (const en of lines) {
    const t0 = Date.now();
    let first = 0;
    try {
      const r = await translator.translate({
        text: en,
        context,
        notes,
        onDelta: () => { if (!first) first = Date.now() - t0; },
      });
      const total = Date.now() - t0;
      firstTimes.push(first || total);
      totalTimes.push(total);
      context.push({ en, ko: r.text });
      console.log(`EN  ${en}`);
      console.log(`KO  ${r.text || "(출력 없음)"}${r.stopReason === "refusal" ? "  ⚠︎거절됨" : ""}`);
      console.log(`    ⏱ 첫 글자 ${(first / 1000).toFixed(2)}초 · 완료 ${(total / 1000).toFixed(2)}초\n`);
    } catch (err) {
      console.log(`EN  ${en}\n❌  오류: ${err.status ?? ""} ${err.message}\n`);
      if (err.status === 401) process.exit(1);
    }
  }
}

if (totalTimes.length) {
  const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length / 1000).toFixed(2);
  console.log(`━━ 요약: ${totalTimes.length}문장 · 첫 글자 평균 ${avg(firstTimes)}초 · 완료 평균 ${avg(totalTimes)}초`);
}
