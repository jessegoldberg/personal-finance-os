import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { db } from './db';
import { buildSnapshot } from './analytics';

const MODEL = 'claude-opus-5-5';
const client = new Anthropic();

const ReportSchema = z.object({
  headline: z.string().describe('One sentence on where the household stands right now'),
  health_score: z.number().describe('0-100 overall financial health score'),
  summary: z.string().describe('3-5 sentence plain-English assessment'),
  monthly_surplus_estimate: z.number(),
  recommended_extra_payment: z.number().describe('Extra dollars per month to put toward debt beyond minimums'),
  strategy: z.object({
    method: z.enum(['avalanche', 'snowball', 'hybrid']),
    rationale: z.string(),
    debt_free_date: z.string().nullable().describe('YYYY-MM, or null if not reachable'),
    interest_saved_vs_minimums: z.number(),
  }),
  action_plan: z.array(z.object({
    when: z.string().describe('Specific date (YYYY-MM-DD) or timing such as "Every payday"'),
    action: z.string().describe('Imperative instruction, e.g. "Pay $450 to Chase Freedom ••1234"'),
    amount: z.number().nullable(),
    from_account: z.string().nullable(),
    to_account: z.string().nullable(),
    why: z.string(),
    estimated_monthly_savings: z.number().nullable(),
  })),
  spending_cuts: z.array(z.object({
    target: z.string().describe('Merchant, subscription, or category'),
    current_monthly: z.number(),
    suggested_monthly: z.number(),
    monthly_savings: z.number(),
    reason: z.string(),
  })),
  budget_suggestions: z.array(z.object({
    category: z.string().describe('Plaid primary category code exactly as given in the data, e.g. FOOD_AND_DRINK'),
    monthly_limit: z.number(),
    reason: z.string(),
  })),
  warnings: z.array(z.string()),
  missing_data: z.array(z.string()).describe('Information that would materially improve this plan'),
});

export type AdvisorReport = z.infer<typeof ReportSchema>;

const SYSTEM = `You are the household's financial planner inside their private finance dashboard. Their single goal is to get out of debt as fast as safely possible while keeping the family stable.

You receive a JSON snapshot of their linked accounts, debts (APR, minimums, due dates), income sources, Plaid-detected recurring deposits and bills, spending by category, and deterministic payoff simulations. Treat the simulation numbers as ground truth for payoff math; do not recompute them differently.

How to advise:
- Be specific and actionable. Name the exact account to pay from and the exact debt to pay, with dollar amounts and dates. Use account names and last-4 masks as they appear in the data.
- Card interest accrues on the average daily balance, so paying earlier in the cycle (e.g. right after each paycheck rather than on the due date) lowers interest. Recommend mid-cycle payments when they save money.
- Protect a starter emergency buffer (at least one month of essential spending, or $1,000 minimum) in checking/savings before throwing every spare dollar at debt. Never recommend draining retirement accounts.
- Account for taxes on income that has no withholding (e.g. side gigs or grants) — recommend setting a percentage aside if the household notes don't already cover it.
- Spending cuts must reference real merchants/categories in the data with realistic targets, prioritising subscriptions and discretionary categories over essentials.
- Budget suggestions must use the Plaid category codes exactly as provided.
- If data is thin (few transactions, missing APRs, no income entered), say so in missing_data and give the best plan possible with what exists.
- Order action_plan chronologically, starting from today's date in the snapshot.`;

function requireClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set on the server'), { status: 503 });
  return client;
}

export async function generateReport(): Promise<AdvisorReport & { created_at: string }> {
  const snapshot = buildSnapshot();
  const stream = requireClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: betaZodOutputFormat(ReportSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Here is our current financial snapshot. Build our plan.\n\n${JSON.stringify(snapshot)}` }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') throw new Error('The advisor declined this request. Try again.');
  if (message.stop_reason === 'max_tokens') throw new Error('The advisor response was cut off. Try again.');
  const text = message.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
  const report = ReportSchema.parse(JSON.parse(text ?? '{}'));

  const { lastInsertRowid } = db.prepare('INSERT INTO ai_reports (report) VALUES (?)').run(JSON.stringify(report));
  return { ...report, created_at: db.prepare('SELECT created_at FROM ai_reports WHERE id = ?').get(lastInsertRowid).created_at };
}

export function latestReport() {
  const row = db.prepare('SELECT * FROM ai_reports ORDER BY id DESC LIMIT 1').get();
  return row ? { ...JSON.parse(row.report), created_at: row.created_at } : null;
}

export async function chat(history: { role: 'user' | 'assistant'; content: string }[]): Promise<string> {
  const snapshot = buildSnapshot();
  const latest = latestReport();
  const stream = requireClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: `${SYSTEM}

You are now answering follow-up questions in a chat. Answer directly in a few short paragraphs or a tight list, with concrete numbers from the data. Plain text only — no markdown headers or tables.

Current snapshot:
${JSON.stringify(snapshot)}

Most recent plan you produced:
${latest ? JSON.stringify(latest) : 'None yet.'}`,
    messages: history.slice(-20),
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') return 'I can’t help with that one — try rephrasing the question.';
  return message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
}
