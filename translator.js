// English -> Korean live subtitle translation with Claude (streaming).
import Anthropic from "@anthropic-ai/sdk";

export const SYSTEM_PROMPT = `You are a professional English-to-Korean simultaneous interpreter producing live subtitles.

The English text comes from real-time speech recognition of audio playing on the user's iPad (lectures, videos, meetings, podcasts, games). Speech recognition output can contain:
- missing or wrong punctuation and capitalization,
- misheard words (homophones, split or merged words, wrong proper nouns),
- sentence fragments, because the live stream is cut into short chunks,
- fillers and false starts ("um", "uh", "you know", "I mean", repeated words).

How to translate:
- Translate the text inside <translate> into natural, fluent Korean that a native speaker would say. Translate the meaning, not word by word.
- Use the earlier conversation in <context> to keep terminology, names, speaker tone and politeness level consistent, and to resolve pronouns and fragments. Do not translate the context again.
- If a word was clearly misheard, translate what the speaker most likely said given the context.
- If the chunk is an incomplete sentence, translate it as a natural Korean fragment that flows on from the previous subtitle; do not invent the missing part.
- Drop fillers, stutters and false starts. If the chunk contains nothing but fillers or noise, output nothing.
- Style: concise subtitle Korean. Default to a polite spoken register (~요 / ~습니다) unless the context clearly calls for casual speech (banmal) between friends or characters.
- Keep proper nouns natural for Korean readers: use the established Korean name when one exists (e.g. 뉴욕, 아인슈타인); otherwise transliterate, or keep brand/product names and code identifiers in English. Keep numbers, units and money accurate.
- Follow the user's glossary exactly when given.

Output only the Korean translation of the <translate> text: no quotes, labels, romanization, notes or explanations.`;

const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

function escapeXml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
}

/**
 * Build the user turn.
 * @param {string} text - English chunk to translate
 * @param {{en: string, ko?: string}[]} context - previous chunks, oldest first
 * @param {string} [notes] - user's topic / glossary notes
 */
export function buildUserMessage(text, context = [], notes = "") {
  const parts = [];
  if (notes && notes.trim()) {
    parts.push(`<glossary_and_topic>\n${escapeXml(notes.trim())}\n</glossary_and_topic>`);
  }
  if (context.length) {
    const lines = context
      .map((c) => `EN: ${escapeXml(c.en)}\nKO: ${c.ko ? escapeXml(c.ko) : "(translating...)"}`)
      .join("\n");
    parts.push(`<context>\n${lines}\n</context>`);
  }
  parts.push(`<translate>\n${escapeXml(text)}\n</translate>`);
  return parts.join("\n\n");
}

export class Translator {
  constructor({
    model = process.env.TRANSLATOR_MODEL || "claude-opus-5-5",
    effort = process.env.TRANSLATOR_EFFORT || "low",
    client,
  } = {}) {
    this.model = model;
    this.effort = effort;
    this.client = client || new Anthropic({ maxRetries: 2, timeout: 30_000 });
  }

  /**
   * Stream a translation. Calls onDelta(textChunk) for each piece of Korean text.
   * Resolves with { text, stopReason, model }.
   */
  async translate({ text, context = [], notes = "", onDelta = () => {}, signal }) {
    const useFallback = FALLBACK_MODELS.has(this.model);
    const params = {
      model: this.model,
      max_tokens: 2048,
      output_config: { effort: this.effort },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(text, context.slice(-8), notes) }],
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    };

    const stream = this.client.beta.messages.stream(params, { signal });
    let out = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        out += event.delta.text;
        onDelta(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    return { text: out.trim(), stopReason: final.stop_reason, model: final.model };
  }
}
