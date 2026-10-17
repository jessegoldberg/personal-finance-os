import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { db } from './db';

export const MODEL = 'claude-opus-5-5';
export const client = new Anthropic();
export const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

export function requireKey() {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set on the server'), { status: 503 });
}

// Token counts only — never prompts or responses.
export function recordUsage(provider: 'claude' | 'local', feature: string, model: string, u: {
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number; searches?: number; seconds?: number; ok?: boolean;
}) {
  db.prepare(`INSERT INTO ai_usage (provider, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, seconds, ok)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(provider, feature, model, u.input ?? 0, u.output ?? 0, u.cacheRead ?? 0, u.cacheWrite ?? 0,
    u.searches ?? 0, u.seconds ?? null, u.ok === false ? 0 : 1);
}

export function recordClaude(feature: string, usage: any) {
  recordUsage('claude', feature, MODEL, {
    input: usage?.input_tokens, output: usage?.output_tokens, cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0, searches: usage?.server_tool_use?.web_search_requests ?? 0,
  });
}

// Compact JSON for prompts: long float tails ("4565.783333333334") cost tokens and add nothing.
export function compactJson(value: unknown) {
  return JSON.stringify(value, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100) : v));
}

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n');

// Free-form research with live web search; returns the model's written notes.
export async function webResearch(feature: string, system: string, prompt: string, opts: { searches?: number; fetches?: number } = {}): Promise<string> {
  requireKey();
  const assistant: Anthropic.Beta.BetaContentBlock[] = [];
  let message: Anthropic.Beta.BetaMessage | null = null;
  for (let i = 0; i < 5; i++) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
    if (assistant.length) messages.push({ role: 'assistant', content: assistant as Anthropic.Beta.BetaContentBlockParam[] });
    message = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: opts.searches ?? 10, user_location: { type: 'approximate', country: 'US' } },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: opts.fetches ?? 4 },
      ],
      messages,
    }).finalMessage();
    recordClaude(feature, message.usage);
    assistant.push(...message.content);
    // The server-side tool loop hit its iteration cap; resend everything so far and it resumes.
    if (message.stop_reason !== 'pause_turn') break;
  }
  if (!message || message.stop_reason === 'refusal') throw new Error('The research request was declined. Try again.');
  return textOf(assistant);
}

// Turns notes into schema-validated JSON. A mechanical step, so low effort. Keep schemas under the API's 16 nullable-field limit.
export async function structured<S extends z.ZodType>(feature: string, schema: S, system: string, content: string): Promise<z.infer<S>> {
  requireKey();
  const message = await client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content }],
  }).finalMessage();
  recordClaude(feature, message.usage);
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') throw new Error('Could not structure the research results. Try again.');
  return schema.parse(JSON.parse(textOf(message.content) || '{}'));
}
