import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { db } from './db';
import { requirePaidAllowance, reservePaid, finishPaid } from './paid-budget';

export const MODEL = 'claude-opus-5-5';
let client: Anthropic | undefined;
const paidClient = () => client ??= new Anthropic({ maxRetries: 0, timeout: 120_000 });
// Explicitly no automatic model fallback: price and call limits must remain pinned.

export function requireKey() {
  requirePaidAllowance();
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

// Research tools can add unbounded intermediate context. Keep them disabled until
// a separately cost-bounded research profile has been reviewed.
export async function webResearch(_feature: string, _system: string, _prompt: string, _opts: { searches?: number; fetches?: number } = {}): Promise<string> {
  requireKey();
  throw Object.assign(new Error('Live paid research is paused. Use saved market data and its date; it is not refreshed during debt planning.'), { status: 402 });
}

export async function paidMessage(feature: string, params: any): Promise<Anthropic.Beta.BetaMessage> {
  requireKey();
  const reservation = reservePaid(feature, params);
  try {
    const message = await paidClient().beta.messages.stream(params).finalMessage();
    recordClaude(feature, message.usage);
    finishPaid(reservation, 'completed');
    return message;
  } catch (error) {
    recordUsage('claude', feature, MODEL, {ok:false});
    finishPaid(reservation, 'unknown');
    throw error;
  }
}

// Turns notes into schema-validated JSON. A mechanical step, so low effort. Keep schemas under the API's 16 nullable-field limit.
export async function structured<S extends z.ZodType>(feature: string, schema: S, system: string, content: string): Promise<z.infer<S>> {
  requireKey();
  const message = await paidMessage(feature, {
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content }],
  });
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') throw new Error('Could not structure the research results. Try again.');
  return schema.parse(JSON.parse(textOf(message.content) || '{}'));
}
