import { z } from 'zod';
import { db, getSetting, setSetting } from './db';
import { webResearch, structured } from './ai';
import { homeSummary } from './valuation';
import { homeScenarios, amortPayment } from './analytics';
import { listPlanned } from './planner';

const OutlookSchema = z.object({
  headline: z.string().describe('One sentence: what the rate/market outlook means for this household'),
  fed: z.object({
    current_target_range: z.string(),
    prime_rate: z.number().describe('current WSJ prime rate %'),
    meetings: z.array(z.object({ date: z.string(), expectation: z.string(), market_odds: z.string() })),
    path_summary: z.string(),
  }),
  mortgage: z.object({
    current_30yr: z.number(), current_15yr: z.number(),
    direction: z.enum(['falling', 'flat', 'rising', 'uncertain']),
    forecasts: z.array(z.object({ source: z.string(), period: z.string(), rate_30yr: z.number() })),
    summary: z.string(),
  }),
  housing: z.object({
    market: z.string().describe('metro/area name'),
    forecasts: z.array(z.object({ source: z.string(), period: z.string(), change_pct: z.number() })),
    inventory_and_days_on_market: z.string(),
    insurance_and_tax_trends: z.string(),
    best_months_to_list: z.string(),
    summary: z.string(),
  }),
  impacts: z.array(z.object({
    item: z.string().describe('e.g. HELOC, credit cards, a future purchase mortgage'),
    effect: z.string(), monthly_dollars: z.number().describe('estimated monthly $ change; negative = saves money'), when: z.string(),
  })),
  timing: z.array(z.object({
    decision: z.string(), window: z.string(), rationale: z.string(), watch_for: z.string(), confidence: z.enum(['high', 'medium', 'low']),
  })),
  purchase_estimates: z.array(z.object({
    expense_id: z.string(), typical_cost: z.number().describe('total for the whole party'), best_time_to_buy: z.string(), tips: z.string(),
  })),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type Outlook = z.infer<typeof OutlookSchema> & { created_at: string };

const SYSTEM = `You are a household financial strategist tracking interest rates and the housing market for a family paying down debt. Use web search to gather CURRENT information and real forecasts — never rely on memory for rates, dates or forecasts. Distinguish clearly between scheduled facts (meeting dates), market-implied expectations (futures pricing), and published forecasts (MBA, Fannie Mae, NAR, Realtor.com, Zillow, etc.). Cite sources. Forecasts are often wrong; say how confident each one is.

Translate everything into this household's dollars using the rate-sensitivity numbers provided, and recommend timing windows for their decisions that also respect the family calendar (holidays, birthdays, trips) they give you — e.g. don't schedule a move or listing in the middle of the holidays or a planned vacation unless the numbers strongly favor it.`;

function rateSensitivity() {
  const debts = db.prepare(`SELECT d.name, d.kind, d.balance, d.apr FROM debts d LEFT JOIN accounts a USING(account_id)
    WHERE COALESCE(a.hidden, 0) = 0 AND d.balance > 0`).all();
  const variable = debts.filter((d: any) => d.kind === 'credit' || /home equity|heloc/i.test(`${d.kind} ${d.name}`));
  const scen = homeScenarios();
  const buy = scen?.sell_and_buy?.[0];
  const rate = scen?.assumptions.new_mortgage_rate_30yr ?? 6.75;
  return {
    variable_rate_debts: variable.map((d: any) => ({ name: d.name, balance: Math.round(d.balance), apr: d.apr, monthly_interest_change_per_quarter_point: +(d.balance * 0.0025 / 12).toFixed(2) })),
    fixed_rate_debts: debts.filter((d: any) => !variable.includes(d)).map((d: any) => ({ name: d.name, balance: Math.round(d.balance), apr: d.apr })),
    hypothetical_new_mortgage: buy ? { loan: buy.new_loan, rate_assumed: rate, payment_change_per_quarter_point: Math.round(amortPayment(buy.new_loan, rate + 0.25, 360) - amortPayment(buy.new_loan, rate, 360)) } : null,
  };
}

export async function refreshOutlook(): Promise<Outlook> {
  const home = homeSummary();
  const planned = listPlanned();
  const needsEstimate = planned.items.filter(i => !i.past && !i.amount);
  const today = new Date().toISOString().slice(0, 10);

  const notes = await webResearch(SYSTEM, `Today is ${today}. Build a rate and market timing outlook for the next 12-18 months.

Location: ${home?.home.address ?? 'unknown (US)'}
Home: ${home ? JSON.stringify({ value: home.value, owed: home.owed, equity: home.equity, considering: 'stay vs refinance vs sell and downsize/rent' }) : 'none entered'}
Rate sensitivity (computed from their accounts): ${JSON.stringify(rateSensitivity())}
Family calendar (planned expenses, next 12 months): ${JSON.stringify(planned.items.filter(i => !i.past).map(i => ({ id: i.id, name: i.name, date: i.next_event_date, amount: i.amount, people: i.people, notes: i.notes })))}
Household notes: ${getSetting('household_notes') ?? ''}

Research and report:
1. Federal Reserve: current target range, prime rate, every FOMC meeting date in the next 12 months, and what fed funds futures/CME FedWatch imply for each; recent Fed guidance.
2. Mortgage rates: current 30-yr and 15-yr averages and published forecasts by quarter (MBA, Fannie Mae, NAR, others).
3. Local housing market for their metro: price forecasts, inventory, days on market, the best months to list, and property-insurance and tax trends.
4. Dollar impact on their variable-rate debts and on a possible new mortgage, using the sensitivity numbers.
5. Timing windows for: listing/selling the home, refinancing (what rate would make it worthwhile), prioritizing HELOC vs card payoff under the expected rate path, and any other rate-driven decision.
6. For these planned purchases with no amount yet, find typical current costs for the stated party and the best time to buy/book: ${needsEstimate.length ? JSON.stringify(needsEstimate.map(i => ({ id: i.id, name: i.name, date: i.next_event_date, people: i.people, notes: i.notes }))) : 'none'}.`, { searches: 20, fetches: 8 });

  const result = await structured(OutlookSchema,
    'Convert these research notes into the required JSON. Copy numbers, dates and URLs exactly as written. Rates are percentages (e.g. 6.25). For purchase_estimates use the exact expense ids given in the notes.',
    notes);
  const outlook: Outlook = { ...result, created_at: new Date().toISOString() };
  setSetting('market_outlook', JSON.stringify(outlook));

  const save = db.prepare('UPDATE planned_expenses SET estimate = ? WHERE id = ?');
  for (const e of outlook.purchase_estimates) save.run(JSON.stringify(e), e.expense_id);
  return outlook;
}

export function latestOutlook(): Outlook | null {
  const raw = getSetting('market_outlook');
  return raw ? JSON.parse(raw) : null;
}

export function outlookAgeDays() {
  const o = latestOutlook();
  return o ? (Date.now() - Date.parse(o.created_at)) / 864e5 : Infinity;
}
