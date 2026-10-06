import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export const MODEL = 'claude-opus-5-5';
export const client = new Anthropic();
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

export function requireKey() {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set on the server'), { status: 503 });
}

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n');

// Free-form research with live web search; returns the model's written notes.
export async function webResearch(system: string, prompt: string, opts: { searches?: number; fetches?: number } = {}): Promise<string> {
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
        { type: 'web_search_20260209', name: 'web_search', max_uses: opts.searches ?? 15, user_location: { type: 'approximate', country: 'US' } },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: opts.fetches ?? 8 },
      ],
      messages,
    }).finalMessage();
    assistant.push(...message.content);
    // The server-side tool loop hit its iteration cap; resend everything so far and it resumes.
    if (message.stop_reason !== 'pause_turn') break;
  }
  if (!message || message.stop_reason === 'refusal') throw new Error('The research request was declined. Try again.');
  return textOf(assistant);
}

// Turns notes into schema-validated JSON. Keep schemas under the API's 16 nullable-field limit.
export async function structured<S extends z.ZodType>(schema: S, system: string, content: string): Promise<z.infer<S>> {
  requireKey();
  const message = await client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content }],
  }).finalMessage();
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') throw new Error('Could not structure the research results. Try again.');
  return schema.parse(JSON.parse(textOf(message.content) || '{}'));
}
