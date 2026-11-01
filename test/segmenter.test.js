import { test } from "node:test";
import assert from "node:assert/strict";
import { Segmenter } from "../public/segmenter.js";

function make(opts = {}) {
  const commits = [];
  const timers = [];
  const seg = new Segmenter({
    onCommit: (t) => commits.push(t),
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => {},
    ...opts,
  });
  return { seg, commits, fireSilence: () => timers.at(-1)?.() };
}

test("commits completed sentences while the result is still interim", () => {
  const { seg, commits } = make();
  seg.update([{ text: "Hello everyone.", isFinal: false }]);
  assert.deepEqual(commits, []); // last words held back, may still be revised
  seg.update([{ text: "Hello everyone. Today we will talk", isFinal: false }]);
  assert.deepEqual(commits, ["Hello everyone."]);
  seg.update([{ text: "Hello everyone. Today we will talk about neural networks.", isFinal: true }]);
  assert.deepEqual(commits, ["Hello everyone.", "Today we will talk about neural networks."]);
});

test("does not resend committed words when the recognizer revises", () => {
  const { seg, commits } = make();
  seg.update([{ text: "This is great. And then", isFinal: false }]);
  seg.update([{ text: "This is great. And then we", isFinal: false }]);
  seg.update([{ text: "This is great. And then we left", isFinal: true }]);
  assert.deepEqual(commits, ["This is great.", "And then we left"]);
});

test("silence flushes pending words", () => {
  const { seg, commits, fireSilence } = make();
  seg.update([{ text: "so the main idea here", isFinal: false }]);
  assert.deepEqual(commits, []);
  fireSilence();
  assert.deepEqual(commits, ["so the main idea here"]);
  assert.equal(seg.pendingText(), "");
});

test("long run-on speech is split at a clause, then forcibly", () => {
  const { seg, commits } = make({ softMaxWords: 10, hardMaxWords: 16 });
  const clause = "if you look at the data from last year, ";
  seg.update([{ text: clause + "you will see that the numbers keep going up and up", isFinal: false }]);
  assert.equal(commits[0], "if you look at the data from last year,");
  const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
  seg.reset();
  seg.update([{ text: words, isFinal: false }]);
  assert.equal(commits.at(-1).split(" ").length, 18); // holds back 2 newest words
});

test("handles multiple result indexes", () => {
  const { seg, commits } = make();
  seg.update([{ text: "First part", isFinal: true }, { text: "second", isFinal: false }]);
  assert.deepEqual(commits, ["First part"]);
  seg.update([{ text: "First part", isFinal: true }, { text: "second part", isFinal: true }]);
  assert.deepEqual(commits, ["First part", "second part"]);
});

test("unpunctuated speech is split before a conjunction, not mid-phrase", () => {
  const { seg, commits } = make();
  seg.update([{ text: "so yeah I was thinking we could maybe push the launch to next Friday because the design team still", isFinal: false }]);
  assert.equal(commits[0], "so yeah I was thinking we could maybe push the launch to next Friday");
});
