import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserMessage, Translator } from "../translator.js";

test("user message includes glossary, context and escapes markup", () => {
  const msg = buildUserMessage("a <b> c", [{ en: "Hi.", ko: "안녕하세요." }, { en: "Next", ko: "" }], "loss=손실");
  assert.match(msg, /<glossary_and_topic>\nloss=손실\n<\/glossary_and_topic>/);
  assert.match(msg, /EN: Hi\.\nKO: 안녕하세요\./);
  assert.match(msg, /KO: \(translating\.\.\.\)/);
  assert.match(msg, /<translate>\na &lt;b&gt; c\n<\/translate>$/);
});

function fakeClient(chunks, capture) {
  return {
    beta: {
      messages: {
        stream(params) {
          capture.params = params;
          return {
            async *[Symbol.asyncIterator]() {
              for (const t of chunks) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } };
            },
            finalMessage: async () => ({ stop_reason: "end_turn", model: params.model }),
          };
        },
      },
    },
  };
}

test("translator streams deltas and sets fallback + effort for Opus", async () => {
  const cap = {};
  const t = new Translator({ model: "claude-opus-5-5", effort: "low", client: fakeClient(["안녕", "하세요"], cap) });
  const deltas = [];
  const r = await t.translate({ text: "Hello", onDelta: (d) => deltas.push(d) });
  assert.equal(r.text, "안녕하세요");
  assert.deepEqual(deltas, ["안녕", "하세요"]);
  assert.equal(cap.params.fallbacks, "default");
  assert.deepEqual(cap.params.betas, ["server-side-fallback-2026-07-01"]);
  assert.deepEqual(cap.params.output_config, { effort: "low" });
  assert.equal(cap.params.thinking, undefined);
});

test("no fallbacks for Haiku", async () => {
  const cap = {};
  const t = new Translator({ model: "claude-haiku-5-5", client: fakeClient(["네"], cap) });
  await t.translate({ text: "Yes" });
  assert.equal(cap.params.fallbacks, undefined);
  assert.equal(cap.params.betas, undefined);
});
