// Splits a live speech-recognition stream into chunks to translate.
//
// Safari's recognizer often keeps one result "interim" for a long time and
// rarely marks it final, so waiting for isFinal is too slow. Instead we commit
// words as soon as a sentence (or a long clause) is complete, or when the
// speaker pauses. Committed words are tracked per result index by word count,
// so later revisions of the same result only send the new words.

const SENTENCE_END = /[.?!…]["')\]]*$/;
const CLAUSE_END = /[,;:]["')\]]*$/;
// A long unpunctuated run is split *before* one of these words.
const BREAK_BEFORE = new Set([
  "and", "but", "so", "because", "cause", "which", "who", "when", "while", "if", "then",
  "although", "though", "since", "or", "until", "unless", "whereas", "where", "after", "before",
]);

export function splitWords(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

export class Segmenter {
  /**
   * @param {object} opts
   * @param {(text: string) => void} opts.onCommit - called with each chunk to translate
   * @param {(text: string) => void} [opts.onPending] - current uncommitted words (for display)
   * @param {number} [opts.silenceMs] - commit everything after this much silence
   * @param {number} [opts.softMaxWords] - commit at a clause boundary beyond this length
   * @param {number} [opts.hardMaxWords] - force a commit beyond this length
   * @param {number} [opts.holdBackWords] - newest words left uncommitted (they may still be revised)
   */
  constructor({
    onCommit,
    onPending = () => {},
    silenceMs = 900,
    softMaxWords = 12,
    hardMaxWords = 20,
    holdBackWords = 2,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
  }) {
    Object.assign(this, { onCommit, onPending, silenceMs, softMaxWords, hardMaxWords, holdBackWords, setTimer, clearTimer });
    this.reset();
  }

  /** Call when the recognizer restarts (its result list starts from 0 again). */
  reset() {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
    this.committed = []; // words committed per result index
    this.finalized = []; // result index -> true once final was handled
    this.latest = []; // latest results snapshot
  }

  /** @param {{text: string, isFinal: boolean}[]} results - full result list from the recognizer */
  update(results) {
    this.latest = results;
    for (let i = 0; i < results.length; i++) {
      if (this.finalized[i]) continue;
      const words = splitWords(results[i].text);
      const done = this.committed[i] || 0;
      if (results[i].isFinal) {
        this.#commit(i, words, words.length);
        this.finalized[i] = true;
        continue;
      }
      const cut = this.#findCut(words, done);
      if (cut > done) this.#commit(i, words, cut);
    }
    this.onPending(this.pendingText());
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = this.pendingText() ? this.setTimer(() => this.flush(), this.silenceMs) : null;
  }

  /** Commit all uncommitted words (pause detected or recognition stopped). */
  flush() {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
    this.latest.forEach((r, i) => {
      if (this.finalized[i]) return;
      const words = splitWords(r.text);
      this.#commit(i, words, words.length);
    });
    this.onPending("");
  }

  pendingText() {
    return this.latest
      .map((r, i) => (this.finalized[i] ? "" : splitWords(r.text).slice(this.committed[i] || 0).join(" ")))
      .filter(Boolean)
      .join(" ");
  }

  #findCut(words, done) {
    // Only consider words that are unlikely to be revised.
    const stableEnd = words.length - this.holdBackWords;
    let sentenceCut = -1;
    let clauseCut = -1;
    let breakCut = -1;
    for (let k = done; k < stableEnd; k++) {
      if (SENTENCE_END.test(words[k])) sentenceCut = k + 1;
      else if (CLAUSE_END.test(words[k])) clauseCut = k + 1;
      else if (k - done >= 5 && BREAK_BEFORE.has(words[k].toLowerCase())) breakCut = k;
    }
    if (sentenceCut > done) return sentenceCut;
    const pending = words.length - done;
    if (pending >= this.softMaxWords) {
      if (clauseCut - done >= 4) return clauseCut;
      if (breakCut > done) return breakCut;
    }
    if (pending >= this.hardMaxWords) return Math.max(done, stableEnd);
    return done;
  }

  #commit(i, words, upTo) {
    const done = this.committed[i] || 0;
    if (upTo <= done) return;
    this.committed[i] = upTo;
    const text = words.slice(done, upTo).join(" ");
    if (text) this.onCommit(text);
  }
}
