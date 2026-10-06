import { db, getSetting } from './db';
import { homeSummary } from './valuation';
import { listPlanned } from './planner';

export function amortPayment(principal: number, apr: number, months: number) {
  if (principal <= 0) return 0;
  const r = apr / 1200;
  return r === 0 ? principal / months : principal * r / (1 - Math.pow(1 + r, -months));
}

// Plaid amounts: positive = money leaving the account, negative = money coming in.
// Transfers and debt payments are excluded from "spending" so a card payment isn't counted twice.
const NON_SPENDING = ['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'INCOME'];
// Card interest is excluded too: it's already counted through minimum payments and monthly interest cost.
const SPENDING_WHERE = `t.amount > 0 AND a.hidden = 0 AND t.category NOT IN (${NON_SPENDING.map(c => `'${c}'`).join(',')})
  AND COALESCE(t.detailed_category, '') != 'BANK_FEES_INTEREST_CHARGE'
  AND NOT (t.category = 'BANK_FEES' AND lower(t.name) LIKE '%interest%')`;

// Money arriving in checking/savings that isn't just shuffling between the household's own accounts.
const DEPOSIT_WHERE = `t.amount < 0 AND a.type = 'depository' AND a.hidden = 0 AND t.category != 'LOAN_PAYMENTS'
  AND COALESCE(t.detailed_category, '') != 'TRANSFER_IN_ACCOUNT_TRANSFER'`;

function frequencyFromGaps(gaps: number[], median: number) {
  if (median <= 9) return 'WEEKLY';
  if (gaps.every(g => g >= 13 && g <= 15)) return 'BIWEEKLY';
  if (median <= 19) return 'SEMI_MONTHLY';
  return median <= 45 ? 'MONTHLY' : median <= 100 ? 'QUARTERLY' : 'IRREGULAR';
}

function depositKey(name: string) {
  return name.toLowerCase().replace(/\d+/g, ' ').replace(/[^a-z& ]/g, ' ').replace(/\b(ppd|ccd|id|des|indn|co|web|ach|dep|deposit|direct|payroll|trn|ref)\b/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}

export interface DetectedDeposit {
  key: string; name: string; account_name: string; mask: string | null; count: number; average_amount: number;
  last_amount: number; frequency: string; monthly: number; last_date: string; category: string;
}

// Our own repeat-deposit detection; doesn't depend on Plaid's recurring add-on being enabled.
export function detectDeposits(): DetectedDeposit[] {
  const rows = db.prepare(`SELECT t.date, -t.amount AS amount, COALESCE(t.merchant_name, t.name) AS name, t.category, a.name AS account_name, a.mask
    FROM transactions t JOIN accounts a USING(account_id) WHERE ${DEPOSIT_WHERE} AND t.date >= date('now', '-180 days') ORDER BY t.date`).all();

  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const key = depositKey(r.name) || r.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const out: DetectedDeposit[] = [];
  const cutoff = new Date(Date.now() - 50 * 864e5).toISOString().slice(0, 10);
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const last = list[list.length - 1];
    if (last.date < cutoff) continue;
    const gaps = list.slice(1).map((r, i) => (Date.parse(r.date) - Date.parse(list[i].date)) / 864e5).filter(g => g > 2).sort((a, b) => a - b);
    if (!gaps.length) continue;
    const gap = gaps[Math.floor(gaps.length / 2)];
    const avg = list.reduce((s, r) => s + r.amount, 0) / list.length;
    if (avg < 50) continue;
    // With 3+ deposits, measured dollars-per-day beats gap math for twice-monthly or uneven schedules.
    const spanDays = (Date.parse(last.date) - Date.parse(list[0].date)) / 864e5;
    const monthly = list.length >= 3 && spanDays > 20
      ? list.slice(1).reduce((s, r) => s + r.amount, 0) / spanDays * 30.44
      : avg * Math.min(30.44 / gap, 4.35);
    out.push({
      key, name: last.name, account_name: last.account_name, mask: last.mask, count: list.length,
      average_amount: avg, last_amount: last.amount, frequency: frequencyFromGaps(gaps, gap),
      monthly, last_date: last.date, category: last.category,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function lastMonths(n: number, includeCurrent = true): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = includeCurrent ? n - 1 : n; i >= (includeCurrent ? 0 : 1); i--) {
    out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return out;
}

export function monthlyIncomeTotal(): number {
  return db.prepare('SELECT COALESCE(SUM(monthly_amount), 0) AS s FROM income_sources').get().s;
}

// Median of the last 3 complete months, so one unusual month (a trip, a big repair) doesn't skew the baseline.
function avgMonthlySpending(): number {
  const months = lastMonths(3, false);
  const totals = db.prepare(`SELECT SUM(t.amount) AS s FROM transactions t JOIN accounts a USING(account_id)
    WHERE ${SPENDING_WHERE} AND substr(t.date, 1, 7) IN (${months.map(() => '?').join(',')})
    GROUP BY substr(t.date, 1, 7)`).all(...months).map((r: any) => r.s).sort((a: number, b: number) => a - b);
  if (!totals.length) return 0;
  const mid = Math.floor(totals.length / 2);
  return totals.length % 2 ? totals[mid] : (totals[mid - 1] + totals[mid]) / 2;
}

export function getOverview() {
  const accounts = db.prepare('SELECT * FROM accounts WHERE hidden = 0').all();
  const sum = (types: string[]) => accounts.filter((a: any) => types.includes(a.type))
    .reduce((s: number, a: any) => s + (a.current_balance || 0), 0);
  const debts = db.prepare('SELECT d.* FROM debts d LEFT JOIN accounts a USING(account_id) WHERE COALESCE(a.hidden, 0) = 0').all();

  const cash = sum(['depository']);
  const investments = sum(['investment', 'brokerage']);
  const totalDebt = debts.reduce((s: number, d: any) => s + d.balance, 0);
  const minPayments = debts.reduce((s: number, d: any) => s + (d.balance > 0 ? estimatedMinPayment(d) : 0), 0);
  const monthlyInterest = debts.reduce((s: number, d: any) => s + d.balance * (d.apr ?? 0) / 1200, 0);
  const entered = monthlyIncomeTotal();
  const detected = detectDeposits().reduce((s, d) => s + d.monthly, 0);
  const income = entered > 0 ? entered : detected;
  const planned = listPlanned().totals;
  const avgSpending = avgMonthlySpending();

  const thisMonth = monthKey(new Date());
  const monthSpending = db.prepare(`SELECT COALESCE(SUM(t.amount), 0) AS s FROM transactions t JOIN accounts a USING(account_id)
    WHERE ${SPENDING_WHERE} AND substr(t.date, 1, 7) = ?`).get(thisMonth).s;

  const months = lastMonths(6);
  const flow = db.prepare(`SELECT substr(t.date, 1, 7) AS month,
      SUM(CASE WHEN ${SPENDING_WHERE} THEN t.amount ELSE 0 END) AS spending,
      SUM(CASE WHEN ${DEPOSIT_WHERE} THEN -t.amount ELSE 0 END) AS income
    FROM transactions t JOIN accounts a USING(account_id)
    WHERE substr(t.date, 1, 7) >= ? GROUP BY month`).all(months[0]);
  const cashflow = months.map(m => {
    const r = flow.find((f: any) => f.month === m);
    return { month: m, spending: r?.spending ?? 0, income: r?.income ?? 0 };
  });

  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = [
    ...debts.filter((d: any) => d.next_due_date && d.next_due_date >= today && d.next_due_date <= in14)
      .map((d: any) => ({ name: d.name, date: d.next_due_date, amount: estimatedMinPayment(d), kind: 'debt' })),
    ...db.prepare(`SELECT COALESCE(merchant_name, description) AS name, predicted_next_date AS date, last_amount AS amount
      FROM recurring_streams WHERE direction = 'outflow' AND is_active = 1 AND predicted_next_date BETWEEN ? AND ?`)
      .all(today, in14).map((r: any) => ({ ...r, kind: 'bill' })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const home = homeSummary();
  const homeValue = home?.value ?? 0;
  return {
    netWorth: cash + investments + homeValue - totalDebt,
    cash, investments, homeValue, homeEquity: home?.equity ?? null, totalDebt, minPayments, monthlyInterest,
    monthlyIncome: income,
    incomeSource: entered > 0 ? 'entered' : detected > 0 ? 'detected' : 'none',
    detectedIncome: detected,
    avgMonthlySpending: avgSpending,
    monthSpending,
    plannedMonthly: planned.monthly_set_aside,
    // What's genuinely free for extra debt payments after living costs, minimums and saving for planned events.
    surplus: income - avgSpending - minPayments - planned.monthly_set_aside,
    cashflow,
    upcoming,
    lastSynced: db.prepare('SELECT MAX(last_synced_at) AS t FROM items').get().t,
    hasData: accounts.length > 0,
  };
}

export function getSpending(monthsBack: number) {
  const months = lastMonths(monthsBack);
  const rows = db.prepare(`SELECT substr(t.date, 1, 7) AS month, t.category, SUM(t.amount) AS total
    FROM transactions t JOIN accounts a USING(account_id)
    WHERE ${SPENDING_WHERE} AND substr(t.date, 1, 7) >= ? GROUP BY month, t.category`).all(months[0]);

  const categories = [...new Set(rows.map((r: any) => r.category))] as string[];
  const byMonth = months.map(m => {
    const entry: any = { month: m, total: 0 };
    for (const r of rows.filter((r: any) => r.month === m)) { entry[r.category] = r.total; entry.total += r.total; }
    return entry;
  });

  const current = months[months.length - 1];
  const completed = months.slice(0, -1).slice(-3);
  const budgets = Object.fromEntries(db.prepare('SELECT * FROM budgets').all().map((b: any) => [b.category, b.monthly_limit]));
  const byCategory = categories.map(c => {
    const avg = completed.length ? completed.reduce((s, m) => s + (byMonth.find(b => b.month === m)?.[c] ?? 0), 0) / completed.length : 0;
    return { category: c, thisMonth: byMonth.find(b => b.month === current)?.[c] ?? 0, avgMonthly: avg, budget: budgets[c] ?? null };
  }).sort((a, b) => b.avgMonthly + b.thisMonth - (a.avgMonthly + a.thisMonth));

  for (const c of Object.keys(budgets)) {
    if (!byCategory.find(b => b.category === c)) byCategory.push({ category: c, thisMonth: 0, avgMonthly: 0, budget: budgets[c] });
  }

  const topMerchants = db.prepare(`SELECT COALESCE(t.merchant_name, t.name) AS merchant, t.category, SUM(t.amount) AS total, COUNT(*) AS count,
      MAX(t.logo_url) AS logo_url
    FROM transactions t JOIN accounts a USING(account_id)
    WHERE ${SPENDING_WHERE} AND t.date >= date('now', '-90 days')
    GROUP BY merchant ORDER BY total DESC LIMIT 15`).all();

  return { months, byMonth, byCategory, categories, topMerchants };
}

const FREQ_DAYS: [string, number, number][] = [['WEEKLY', 5, 9], ['BIWEEKLY', 12, 17], ['MONTHLY', 25, 36], ['QUARTERLY', 80, 100], ['ANNUALLY', 345, 385]];
const PER_MONTH: Record<string, number> = { WEEKLY: 52 / 12, BIWEEKLY: 26 / 12, MONTHLY: 1, QUARTERLY: 1 / 3, ANNUALLY: 1 / 12 };

export interface RecurringCharge {
  key: string; name: string; category: string; frequency: string; count: number; average_amount: number; last_amount: number;
  last_date: string; next_date: string; monthly: number; annual: number; accounts: string; logo_url: string | null;
  decision: 'keep' | 'review' | 'cut'; note: string | null; related_count: number; related_total: number;
}

// Repeat charges at a steady cadence and roughly steady amount, across every account including imported cards.
export function detectRecurringCharges(): RecurringCharge[] {
  const rows = db.prepare(`SELECT t.date, t.amount, COALESCE(t.merchant_name, t.name) AS name, t.category, t.logo_url,
      a.name AS account_name, a.mask
    FROM transactions t JOIN accounts a USING(account_id)
    WHERE t.amount > 0 AND a.hidden = 0 AND t.category NOT IN ('TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'INCOME')
      AND COALESCE(t.detailed_category, '') != 'BANK_FEES_INTEREST_CHARGE'
      AND t.date >= date('now', '-400 days') ORDER BY t.date`).all();
  const decisions = new Map<string, any>(db.prepare('SELECT * FROM recurring_decisions').all().map((d: any) => [d.key, d]));

  const byMerchant = new Map<string, any[]>();
  for (const r of rows) {
    const key = depositKey(r.name) || r.name.toLowerCase();
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push(r);
  }

  const today = new Date().toISOString().slice(0, 10);
  const evaluate = (key: string, list: any[], utility: boolean, mixed: boolean): RecurringCharge | null => {
    const gaps = list.slice(1).map((r, i) => (Date.parse(r.date) - Date.parse(list[i].date)) / 864e5).filter(g => g > 3).sort((a, b) => a - b);
    if (!gaps.length) return null;
    const gap = gaps[Math.floor(gaps.length / 2)];
    const freq = FREQ_DAYS.find(([, lo, hi]) => gap >= lo && gap <= hi);
    if (!freq) return null;
    // Coincidences happen: require repeats, more for frequent cadences and for stores you also shop at normally.
    const minCount = { ANNUALLY: 2, QUARTERLY: 3, MONTHLY: 3, BIWEEKLY: 4, WEEKLY: 5 }[freq[0]]! + (mixed ? 1 : 0);
    if (list.length < minCount) return null;
    // Most gaps must match the cadence, or it's just a store you visit often.
    if (gaps.filter(g => g >= freq[1] * 0.85 && g <= freq[2] * 1.15).length < gaps.length * 0.75) return null;
    const amounts = list.slice(-6).map(r => r.amount);
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((s, a) => s + (a - avg) ** 2, 0) / amounts.length);
    // Subscriptions bill a near-identical amount; utilities vary with usage.
    if (sd / avg > (utility ? 0.45 : mixed ? 0.01 : 0.06)) return null;
    const last = list[list.length - 1];
    if ((Date.parse(today) - Date.parse(last.date)) / 864e5 > freq[2] * 1.5 + 7) return null;
    const decision = decisions.get(key);
    return {
      key, name: last.name, category: last.category, frequency: freq[0], count: list.length,
      average_amount: avg, last_amount: last.amount, last_date: last.date,
      next_date: new Date(Date.parse(last.date) + gap * 864e5).toISOString().slice(0, 10),
      monthly: avg * PER_MONTH[freq[0]], annual: avg * PER_MONTH[freq[0]] * 12,
      accounts: [...new Set(list.map(r => `${r.account_name}${r.mask ? ' ••' + r.mask : ''}`))].join(', '),
      logo_url: list.map(r => r.logo_url).find(Boolean) ?? null,
      // Housing and utilities are essentials: default them to keep so what-ifs only weigh optional charges.
      decision: decision?.decision ?? (last.category === 'RENT_AND_UTILITIES' ? 'keep' : 'review'), note: decision?.note ?? null, related_count: 0, related_total: 0,
    };
  };

  const out: RecurringCharge[] = [];
  for (const [key, list] of byMerchant) {
    const utility = list[list.length - 1].category === 'RENT_AND_UTILITIES';
    const whole = evaluate(key, list, utility, false);
    if (whole) { out.push(whole); continue; }
    if (utility) continue;
    // A subscription can hide among normal purchases at the same brand (a $79.88 pass among park food), so look for exact-price repeats.
    const clusters: any[][] = [];
    for (const r of [...list].sort((x, y) => x.amount - y.amount)) {
      const c = clusters[clusters.length - 1];
      if (c && r.amount <= c[0].amount * 1.01 + 0.01) c.push(r); else clusters.push([r]);
    }
    const found = clusters.map(c => c.sort((x, y) => x.date.localeCompare(y.date)))
      .map(c => evaluate(`${key} ${Math.round(c[0].amount)}`, c, false, true)).filter(Boolean) as RecurringCharge[];
    out.push(...found.map(f => (found.length === 1 ? { ...f, key, decision: decisions.get(key)?.decision ?? f.decision, note: decisions.get(key)?.note ?? null } : f)));
  }

  // Usage evidence: other (non-recurring) spending at the same brand in the last 90 days, e.g. Amazon orders for Prime, park food for Disney.
  const recentRows = rows.filter((r: any) => r.date >= new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10));
  for (const c of out) {
    const brand = c.key.split(' ')[0];
    if (brand.length < 3) continue;
    const related = recentRows.filter((r: any) => (depositKey(r.name) || '').split(' ')[0] === brand && Math.abs(r.amount - c.average_amount) > 0.5);
    c.related_count = related.length;
    c.related_total = related.reduce((s: number, r: any) => s + r.amount, 0);
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

export function estimatedMinPayment(d: any): number {
  if (d.min_payment) return d.min_payment;
  // Typical card formula when the issuer doesn't report one: 1% of balance + interest, floor $25.
  return Math.min(d.balance, Math.max(25, d.balance * 0.01 + d.balance * (d.apr ?? 0) / 1200));
}

type Strategy = 'avalanche' | 'snowball' | 'minimum';

// 0% promos: months left at 0%, the rate after, and the monthly payment that clears the balance in time.
export function promoInfo(d: any, now = new Date()) {
  if (!d.promo_end_date) return null;
  const [y, m] = d.promo_end_date.split('-').map(Number);
  const monthsLeft = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
  if (monthsLeft < 0) return null;
  return { monthsLeft, regularApr: d.regular_apr ?? 29.99, deferred: !!d.promo_deferred, pace: d.balance / Math.max(1, monthsLeft) };
}

export function simulatePayoff(strategy: Strategy, extra: number) {
  const now = new Date();
  const debts = db.prepare('SELECT d.* FROM debts d LEFT JOIN accounts a USING(account_id) WHERE COALESCE(a.hidden, 0) = 0 AND d.balance > 0').all()
    .map((d: any) => {
      const promo = promoInfo(d, now);
      // Deferred-interest promos must be cleared before they expire, so they get a payment that finishes on time.
      const min = promo && promo.deferred ? Math.max(estimatedMinPayment(d), promo.pace) : estimatedMinPayment(d);
      return { id: d.id, name: d.name, balance: d.balance, apr: d.apr ?? 0, min, paidOffMonth: null as number | null,
        promoMonths: promo?.monthsLeft ?? 0, regularApr: promo?.regularApr ?? d.apr ?? 0, deferred: !!promo?.deferred, shadow: 0 };
    });
  const aprAt = (d: any, month: number) => (month <= d.promoMonths ? 0 : d.regularApr);

  const budget = debts.reduce((s: number, d: any) => s + d.min, 0) + (strategy === 'minimum' ? 0 : extra);
  const series: { month: number; balance: number }[] = [{ month: 0, balance: debts.reduce((s: number, d: any) => s + d.balance, 0) }];
  let totalInterest = 0;
  let month = 0;

  while (debts.some((d: any) => d.balance > 0.005) && month < 600) {
    month++;
    for (const d of debts) {
      if (d.balance <= 0) continue;
      if (d.deferred && month <= d.promoMonths) d.shadow += d.balance * d.regularApr / 1200;
      if (d.deferred && month === d.promoMonths + 1 && d.balance > 0.005) { d.balance += d.shadow; totalInterest += d.shadow; }
      const interest = d.balance * aprAt(d, month) / 1200;
      d.balance += interest;
      totalInterest += interest;
    }
    let available = strategy === 'minimum' ? Infinity : budget;
    for (const d of debts) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.min, d.balance, available);
      d.balance -= pay;
      if (strategy !== 'minimum') available -= pay;
    }
    if (strategy !== 'minimum') {
      const order = debts.filter((d: any) => d.balance > 0)
        .sort((a: any, b: any) => strategy === 'avalanche' ? aprAt(b, month + 1) - aprAt(a, month + 1) : a.balance - b.balance);
      for (const d of order) {
        if (available <= 0) break;
        const pay = Math.min(d.balance, available);
        d.balance -= pay;
        available -= pay;
      }
    }
    for (const d of debts) if (d.balance <= 0.005 && d.paidOffMonth === null) { d.balance = 0; d.paidOffMonth = month; }
    series.push({ month, balance: debts.reduce((s: number, d: any) => s + Math.max(0, d.balance), 0) });
  }

  const done = !debts.some((d: any) => d.balance > 0.005);
  const debtFree = new Date();
  debtFree.setMonth(debtFree.getMonth() + month);
  return {
    strategy, extra, monthlyBudget: budget,
    months: done ? month : null,
    debtFreeDate: done ? monthKey(debtFree) : null,
    totalInterest,
    series,
    order: debts.map((d: any) => ({ name: d.name, apr: d.apr, paidOffMonth: d.paidOffMonth }))
      .sort((a: any, b: any) => (a.paidOffMonth ?? 9999) - (b.paidOffMonth ?? 9999)),
  };
}

// Deterministic sell/downsize/rent math so the advisor reasons from real numbers instead of dismissing a move on rates alone.
export function homeScenarios() {
  const h = homeSummary();
  if (!h || h.value == null) return null;
  const m = h.valuation?.market;
  const rate = m?.mortgage_rate_30yr || 6.75;
  const escrow = h.home.escrow_monthly ?? 0;
  const securedIds = new Set(h.debts.map((d: any) => d.id));
  const other = db.prepare(`SELECT d.* FROM debts d LEFT JOIN accounts a USING(account_id) WHERE COALESCE(a.hidden, 0) = 0 AND d.balance > 0`).all()
    .filter((d: any) => !securedIds.has(d.id));
  const otherBalance = other.reduce((s: number, d: any) => s + d.balance, 0);
  const otherMins = other.reduce((s: number, d: any) => s + estimatedMinPayment(d), 0);
  const housingNow = h.debts.reduce((s: number, d: any) => s + estimatedMinPayment(d), 0) + escrow;
  const outflowNow = housingNow + otherMins;

  const SELL = 0.08, BUY_CLOSING = 0.03, TAX_INS = 0.02, RESERVE = 10000;
  const net = h.value * (1 - SELL) - h.owed;
  const afterDebts = net - otherBalance;
  const round = (n: number) => Math.round(n);

  const buy = (price: number) => {
    const closing = price * BUY_CLOSING;
    const down = Math.max(0, Math.min(afterDebts - closing - RESERVE, price));
    const loan = price - down;
    const pi = amortPayment(loan, rate, 360);
    const taxIns = price * TAX_INS / 12;
    return {
      price: round(price), down_payment: round(down), down_pct: round(down / price * 100), new_loan: round(loan),
      monthly_principal_interest: round(pi), monthly_tax_insurance_est: round(taxIns), monthly_housing: round(pi + taxIns),
      monthly_change_vs_today: round(pi + taxIns - outflowNow), cash_left_after: round(Math.max(0, afterDebts - closing - down)),
      pmi_likely: down / price < 0.2 && loan > 0,
    };
  };
  const targets = [...new Set([m?.typical_price_smaller_home || 0, h.value * 0.75, h.value * 0.6]
    .filter(p => p > 0).map(p => Math.round(p / 5000) * 5000))].sort((a, b) => b - a);

  return {
    assumptions: {
      selling_costs_pct: SELL * 100, buyer_closing_pct: BUY_CLOSING * 100, cash_kept_in_reserve: RESERVE, new_mortgage_rate_30yr: rate, new_home_tax_insurance_pct_per_year: TAX_INS * 100,
      moving_costs_not_included: true,
      ...(escrow ? {} : { warning: 'Current escrow (taxes+insurance) not entered, so today\'s housing cost is understated vs. the new-home estimates.' }),
      ...(/,\s*FL\b/i.test(h.home.address) ? { florida_note: 'A Florida purchase resets the assessed value (homestead Save Our Homes cap is lost), so property tax on a new home is based on its full price.' } : {}),
    },
    today: { housing_monthly: round(housingNow), escrow_monthly: round(escrow), other_debt_minimums_monthly: round(otherMins),
      total_monthly_debt_and_housing: round(outflowNow), other_debt_balance: round(otherBalance) },
    sale: { sale_price: round(h.value), selling_costs: round(h.value * SELL), payoff_mortgage_and_heloc: round(h.owed),
      net_proceeds: round(net), left_after_paying_off_all_other_debts: round(afterDebts) },
    sell_and_buy: targets.map(buy),
    sell_and_rent: m?.typical_rent_similar_home ? {
      monthly_rent: round(m.typical_rent_similar_home), monthly_change_vs_today: round(m.typical_rent_similar_home - outflowNow),
      cash_left_after: round(Math.max(0, afterDebts)),
    } : null,
  };
}

// Everything the advisor sees. Contains balances and names only — never access tokens or full account numbers.
export function buildSnapshot() {
  const overview = getOverview();
  const spending = getSpending(4);
  const extra = Math.max(0, Math.round(overview.surplus));
  return {
    today: new Date().toISOString().slice(0, 10),
    household_notes: getSetting('household_notes') ?? '',
    totals: {
      net_worth: overview.netWorth, cash: overview.cash, investments: overview.investments, total_debt: overview.totalDebt,
      monthly_income: overview.monthlyIncome, income_basis: overview.incomeSource, typical_monthly_spending_median_of_last_3_months: overview.avgMonthlySpending,
      total_minimum_payments: overview.minPayments, monthly_interest_cost: overview.monthlyInterest, estimated_monthly_surplus: overview.surplus,
    },
    accounts: db.prepare('SELECT name, mask, type, subtype, current_balance, available_balance, credit_limit FROM accounts WHERE hidden = 0').all(),
    debts: db.prepare('SELECT name, kind, balance, apr, min_payment, next_due_date, statement_balance, credit_limit, is_overdue, source, promo_end_date, promo_deferred AS deferred_interest_if_not_paid_by_promo_end, regular_apr AS apr_after_promo FROM debts WHERE balance > 0').all(),
    income_sources: db.prepare('SELECT name, kind, monthly_amount, taxes_withheld, notes FROM income_sources').all(),
    income_note: overview.incomeSource === 'detected'
      ? 'No income sources were entered; monthly income is estimated from the repeat deposits below. Treat them as household income.'
      : overview.incomeSource === 'none' ? 'No income entered or detected yet.' : 'Income sources were entered by the household; repeat deposits are shown for cross-checking.',
    repeat_deposits_last_180_days: detectDeposits().map(d => ({ name: d.name, into: `${d.account_name}${d.mask ? ' ••' + d.mask : ''}`,
      count: d.count, average_amount: Math.round(d.average_amount), frequency: d.frequency, est_monthly: Math.round(d.monthly), last_date: d.last_date })),
    monthly_deposits_by_month: overview.cashflow.map(c => ({ month: c.month, deposits: Math.round(c.income) })),
    manually_tracked_accounts: db.prepare(`SELECT name, type, current_balance, updated_at AS last_updated FROM accounts WHERE item_id = 'manual'`).all(),
    recurring_charges: {
      policy: 'decision "keep" = household chose to keep it: never suggest cutting. "review" = evaluate whether it is justified, using related_count/related_total as usage evidence. "cut" = household is cancelling: count the savings from the next billing date.',
      items: detectRecurringCharges().map(c => ({ name: c.name, category: c.category, frequency: c.frequency, amount: Math.round(c.average_amount * 100) / 100,
        monthly: Math.round(c.monthly), annual: Math.round(c.annual), next: c.next_date, on: c.accounts, decision: c.decision, note: c.note,
        other_purchases_same_brand_90d: c.related_count, other_spend_same_brand_90d: Math.round(c.related_total) })),
    },
    spending_by_category: spending.byCategory,
    monthly_spending_trend: spending.byMonth.map(m => ({ month: m.month, total: m.total })),
    top_merchants_last_90_days: spending.topMerchants.map((m: any) => ({ merchant: m.merchant, category: m.category, total: m.total, count: m.count })),
    cashflow_from_transactions: overview.cashflow,
    home: (() => {
      const h = homeSummary();
      if (!h) return null;
      return {
        estimated_value: h.value, value_basis: h.home.manual_value != null ? 'owner override' : 'valuation',
        valuation_range: h.valuation ? [h.valuation.estimate.low, h.valuation.estimate.high] : null, valuation_confidence: h.valuation?.estimate.confidence ?? null,
        valued_at: h.home.valued_at, secured_debts: h.debts, total_secured_debt: h.owed, equity: h.equity,
        loan_to_value_pct: h.ltv != null ? Math.round(h.ltv * 1000) / 10 : null, borrowable_up_to_80_pct_ltv: h.borrowable_at_80,
        market: h.valuation?.market ?? null, purchase_price: h.home.purchase_price, purchase_date: h.home.purchase_date,
        escrow_monthly: h.home.escrow_monthly, scenarios: homeScenarios(),
      };
    })(),
    planned_life_expenses: (() => {
      const p = listPlanned();
      return {
        policy: 'Household has committed to these. Fund them; do not cut them. Already subtracted from estimated_monthly_surplus.',
        monthly_set_aside_total: Math.round(p.totals.monthly_set_aside), still_to_save: Math.round(p.totals.still_to_save),
        amounts_not_entered_yet: p.totals.missing_amounts,
        items: p.items.filter(i => !i.past).map(i => ({ name: i.name, event: i.next_event_date, money_needed_by: i.next_due_date, amount: i.amount,
          already_saved: i.saved, monthly_set_aside: Math.round(i.monthly_set_aside), recurring_yearly: !!i.recurring_yearly, people: i.people, notes: i.notes,
          ai_cost_estimate: i.estimate })),
        cash_needed_by_month: p.totals.by_month.filter(m => m.amount > 0),
      };
    })(),
    market_outlook: (() => {
      const raw = getSetting('market_outlook');
      if (!raw) return null;
      const o = JSON.parse(raw);
      return { as_of: o.created_at, headline: o.headline, fed: o.fed, mortgage: o.mortgage, housing: o.housing, impacts: o.impacts, timing: o.timing };
    })(),
    payoff_simulations: (['minimum', 'snowball', 'avalanche'] as Strategy[]).map(s => {
      const r = simulatePayoff(s, extra);
      return { strategy: s, extra_per_month: s === 'minimum' ? 0 : extra, months: r.months, debt_free: r.debtFreeDate, total_interest: Math.round(r.totalInterest), payoff_order: r.order };
    }),
  };
}
