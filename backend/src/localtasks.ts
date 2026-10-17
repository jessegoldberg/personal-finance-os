import { z } from 'zod';
import { db } from './db';
import { getOverview, getSpending, detectRecurringCharges, promoInfo } from './analytics';
import { listPlanned } from './planner';
import { latestReport } from './advisor';
import { localChat, localConfig, LocalMessage } from './localllm';

const categoryLabelServer = (c: string) => c.toLowerCase().replace(/_/g, ' ');
const $ = (n: number | null | undefined) => (n == null ? 'unknown' : `$${Math.round(n).toLocaleString('en-US')}`);
// Rough token estimate; local prompts must stay small because the CPU-only server reads ~20 tokens/sec.
const approxTokens = (s: string) => Math.ceil(s.length / 3.6);

// Pre-computed facts only. The local model explains these; it never does the math.
export function compactFacts(): string {
  const o = getOverview();
  const debts = db.prepare(`SELECT d.* FROM debts d LEFT JOIN accounts a USING(account_id) WHERE COALESCE(a.hidden, 0) = 0 AND d.balance > 0
    ORDER BY COALESCE(d.apr, 0) DESC LIMIT 8`).all();
  const spending = getSpending(4).byCategory.filter(c => c.thisMonth > 0 || c.avgMonthly > 0).slice(0, 5);
  const recurring = detectRecurringCharges();
  const sum = (d: string) => recurring.filter(r => r.decision === d).reduce((s, r) => s + r.monthly, 0);
  const planned = listPlanned().items.filter(i => !i.past).slice(0, 4);
  const plan = latestReport();

  // Deterministic priorities so the small model reads conclusions instead of deriving them.
  const priorities: string[] = [];
  const highest = debts.find((d: any) => d.apr != null && !promoInfo(d));
  if (highest) priorities.push(`highest interest rate is ${highest.name} at ${highest.apr}%, so extra payments save the most there`);
  for (const d of debts) {
    const p = promoInfo(d);
    if (p?.deferred && (d.min_payment ?? 0) < p.pace) priorities.push(`${d.name} must get ${$(p.pace)}/mo (not the ${$(d.min_payment)} minimum) to avoid back-interest at ${p.regularApr}% after ${d.promo_end_date}`);
  }
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  for (const d of debts) if (d.next_due_date && d.next_due_date <= soon) priorities.push(`${d.name} payment due ${d.next_due_date}`);
  if (o.surplus < 0) priorities.push(`spending plus minimums exceed income by ${$(-o.surplus)}/mo`);

  const lines = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Key points (computed): ${priorities.join('; ') || 'none'}.`,
    `Monthly: income ${$(o.monthlyIncome)}${o.incomeSource === 'detected' ? ' (estimated from deposits)' : ''}; typical spending ${$(o.avgMonthlySpending)}; debt minimums ${$(o.minPayments)}; saving for planned events ${$(o.plannedMonthly)}; left over ${$(o.surplus)}.`,
    `Balances: cash ${$(o.cash)}; investments ${$(o.investments)}; home ${$(o.homeValue)}; total debt ${$(o.totalDebt)}; interest cost ${$(o.monthlyInterest)}/mo.`,
    'Debts (balance, APR, minimum, due):',
    ...debts.map((d: any) => {
      const p = promoInfo(d);
      return `- ${d.name}: ${$(d.balance)}, ${d.apr == null ? 'APR unknown' : d.apr + '%'}, min ${$(d.min_payment)}${d.next_due_date ? `, due ${d.next_due_date}` : ''}${p ? `, 0% promo ends ${d.promo_end_date}${p.deferred ? ` (deferred interest; needs ${$(p.pace)}/mo)` : ''}` : ''}`;
    }),
    `Top spending this month (typical): ${spending.map(c => `${categoryLabelServer(c.category)} ${$(c.thisMonth)} (${$(c.avgMonthly)})`).join('; ')}`,
    `Recurring charges: keep ${$(sum('keep'))}/mo, review ${$(sum('review'))}/mo [${recurring.filter(r => r.decision === 'review').slice(0, 6).map(r => `${r.name} ${$(r.monthly)}`).join(', ')}], cut ${$(sum('cut'))}/mo.`,
    `Upcoming planned: ${planned.map(p => `${p.name} ${p.next_event_date} ${p.amount ? $(p.amount) : 'no budget'}`).join('; ') || 'none'}`,
    plan ? `Latest AI plan (${String(plan.created_at).slice(0, 10)}): ${plan.headline} Strategy ${plan.strategy?.method}, debt-free ${plan.strategy?.debt_free_date ?? 'unknown'}. Next steps: ${(plan.action_plan ?? []).slice(0, 3).map((a: any) => `${a.when}: ${a.action}`).join(' | ')}` : 'No AI plan yet.',
  ];
  return lines.join('\n');
}

const ASK_SYSTEM = `You are a household finance assistant. Answer using ONLY the facts provided. Do not invent numbers and do not do new calculations beyond simple addition or subtraction of the given figures. If the question needs a detailed plan, forecasts, or numbers not in the facts, say "That needs the full AI Advisor" and stop. Answer in at most 120 words, plain text, no markdown.`;

export async function localAsk(history: { role: 'user' | 'assistant'; content: string }[]) {
  const question = history[history.length - 1]?.content ?? '';
  const facts = compactFacts();
  const budget = localConfig().numCtx - localConfig().maxTokens - 150;
  const messages: LocalMessage[] = [{ role: 'system', content: `${ASK_SYSTEM}\n\nFacts:\n${facts}` }];
  // Include the previous exchange only if it fits the small context window.
  const prev = history.slice(-3, -1);
  const used = approxTokens(messages[0].content) + approxTokens(question);
  if (prev.length === 2 && used + approxTokens(prev[0].content + prev[1].content) < budget) messages.push(...prev);
  if (used > budget) throw Object.assign(new Error('Your data summary is too large for the local model. Use the full advisor for this question.'), { status: 413 });
  messages.push({ role: 'user', content: question });
  const { content, truncated } = await localChat('chat', messages);
  return { reply: truncated ? `${content}…` : content, provider: 'local' as const };
}

// The model may only move a transaction between spending categories — never into transfers, income or debt payments,
// which would silently remove real spending from budgets and the plan.
const SPENDING_CATEGORIES = ['FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'GENERAL_SERVICES', 'HOME_IMPROVEMENT', 'RENT_AND_UTILITIES', 'TRANSPORTATION',
  'TRAVEL', 'ENTERTAINMENT', 'PERSONAL_CARE', 'MEDICAL', 'BANK_FEES', 'GOVERNMENT_AND_NON_PROFIT', 'OTHER'] as const;
const BatchSchema = z.object({ results: z.array(z.object({ i: z.number().int(), category: z.enum(SPENDING_CATEGORIES) })) });
const BATCH_FORMAT = {
  type: 'object',
  properties: { results: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, category: { type: 'string', enum: SPENDING_CATEGORIES } }, required: ['i', 'category'] } } },
  required: ['results'],
};
const BATCH = 10;

export function uncategorizedSummary() {
  return db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total FROM transactions t JOIN accounts a USING(account_id)
    WHERE t.category = 'OTHER' AND t.amount > 0 AND t.category_source IS NULL AND t.date >= date('now', '-180 days')`).get();
}

export async function categorizeUncategorized(limit = 40) {
  const rows = db.prepare(`SELECT t.transaction_id, t.name, t.merchant_name, t.amount FROM transactions t JOIN accounts a USING(account_id)
    WHERE t.category = 'OTHER' AND t.amount > 0 AND t.category_source IS NULL AND t.date >= date('now', '-180 days')
    ORDER BY t.amount DESC LIMIT ?`).all(Math.min(Math.max(limit, 1), 100));
  const update = db.prepare("UPDATE transactions SET category = ?, category_source = 'local_ai' WHERE transaction_id = ? AND category = 'OTHER'");
  const skip = db.prepare("UPDATE transactions SET category_source = 'local_ai_unsure' WHERE transaction_id = ? AND category = 'OTHER'");
  let updated = 0, processed = 0;
  const examples: { description: string; category: string }[] = [];

  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    // Only what's needed: description, merchant and amount. No account names or balances.
    const list = batch.map((r: any, i: number) => `${i}|${(r.merchant_name || r.name).slice(0, 60)}|${r.name.slice(0, 60)}|${r.amount.toFixed(2)}`).join('\n');
    let parsed: z.infer<typeof BatchSchema>;
    try {
      const { content } = await localChat('categorize', [
        { role: 'system', content: `Classify each card/bank purchase into one category: ${SPENDING_CATEGORIES.join(', ')}. Hints: gas stations and rideshare = TRANSPORTATION; grocery stores and restaurants = FOOD_AND_DRINK; gyms, salons = PERSONAL_CARE; pharmacies, doctors = MEDICAL; electric, water, internet, phone, insurance = RENT_AND_UTILITIES; streaming, movies, events = ENTERTAINMENT; airlines, hotels = TRAVEL; hardware stores = HOME_IMPROVEMENT. Use OTHER when unsure (person-to-person payments like Zelle/Venmo, checks, cash). Reply with JSON only.` },
        { role: 'user', content: `index|merchant|description|amount\n${list}` },
      ], { format: BATCH_FORMAT, maxTokens: 20 * batch.length + 40 });
      parsed = BatchSchema.parse(JSON.parse(content));
    } catch (e: any) {
      // Keep what was already saved; report how far we got.
      return { processed, updated, remaining: uncategorizedSummary().count, error: e.message || 'The local model failed', examples };
    }
    db.transaction(() => {
      for (const r of parsed.results) {
        const row = batch[r.i];
        if (!row) continue;
        if (r.category === 'OTHER') skip.run(row.transaction_id);
        else if (update.run(r.category, row.transaction_id).changes) {
          updated++;
          if (examples.length < 6) examples.push({ description: row.merchant_name || row.name, category: r.category });
        }
      }
    })();
    processed += batch.length;
  }
  return { processed, updated, remaining: uncategorizedSummary().count, error: null, examples };
}

export function undoLocalCategories() {
  return db.prepare("UPDATE transactions SET category = 'OTHER', category_source = NULL WHERE category_source IN ('local_ai', 'local_ai_unsure')").run().changes;
}

export async function localTest() {
  const { content } = await localChat('test', [{ role: 'user', content: 'Reply with one short greeting.' }], { maxTokens: 32 });
  return { reply: content };
}
