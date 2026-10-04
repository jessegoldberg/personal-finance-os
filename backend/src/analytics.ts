import { db, getSetting } from './db';

// Plaid amounts: positive = money leaving the account, negative = money coming in.
// Transfers and debt payments are excluded from "spending" so a card payment isn't counted twice.
const NON_SPENDING = ['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'INCOME'];
const SPENDING_WHERE = `t.amount > 0 AND a.hidden = 0 AND t.category NOT IN (${NON_SPENDING.map(c => `'${c}'`).join(',')})`;

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

function avgMonthlySpending(): number {
  const months = lastMonths(3, false);
  const row = db.prepare(`SELECT COALESCE(SUM(t.amount), 0) AS s, COUNT(DISTINCT substr(t.date, 1, 7)) AS m
    FROM transactions t JOIN accounts a USING(account_id)
    WHERE ${SPENDING_WHERE} AND substr(t.date, 1, 7) IN (${months.map(() => '?').join(',')})`).get(...months);
  return row.m ? row.s / row.m : 0;
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
  const income = monthlyIncomeTotal();
  const avgSpending = avgMonthlySpending();

  const thisMonth = monthKey(new Date());
  const monthSpending = db.prepare(`SELECT COALESCE(SUM(t.amount), 0) AS s FROM transactions t JOIN accounts a USING(account_id)
    WHERE ${SPENDING_WHERE} AND substr(t.date, 1, 7) = ?`).get(thisMonth).s;

  const months = lastMonths(6);
  const flow = db.prepare(`SELECT substr(t.date, 1, 7) AS month,
      SUM(CASE WHEN ${SPENDING_WHERE} THEN t.amount ELSE 0 END) AS spending,
      SUM(CASE WHEN t.amount < 0 AND t.category = 'INCOME' THEN -t.amount ELSE 0 END) AS income
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

  return {
    netWorth: cash + investments - totalDebt,
    cash, investments, totalDebt, minPayments, monthlyInterest,
    monthlyIncome: income,
    avgMonthlySpending: avgSpending,
    monthSpending,
    surplus: income - avgSpending - minPayments,
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

export function getRecurring() {
  return db.prepare(`SELECT r.*, a.name AS account_name, a.mask FROM recurring_streams r LEFT JOIN accounts a USING(account_id)
    WHERE r.is_active = 1 ORDER BY r.direction, r.average_amount DESC`).all();
}

const FREQ_PER_MONTH: Record<string, number> = { WEEKLY: 52 / 12, BIWEEKLY: 26 / 12, SEMI_MONTHLY: 2, MONTHLY: 1, ANNUALLY: 1 / 12 };
export function monthlyEquivalent(amount: number, frequency: string) {
  return amount * (FREQ_PER_MONTH[frequency] ?? 1);
}

export function estimatedMinPayment(d: any): number {
  if (d.min_payment) return d.min_payment;
  // Typical card formula when the issuer doesn't report one: 1% of balance + interest, floor $25.
  return Math.min(d.balance, Math.max(25, d.balance * 0.01 + d.balance * (d.apr ?? 0) / 1200));
}

type Strategy = 'avalanche' | 'snowball' | 'minimum';

export function simulatePayoff(strategy: Strategy, extra: number) {
  const debts = db.prepare('SELECT d.* FROM debts d LEFT JOIN accounts a USING(account_id) WHERE COALESCE(a.hidden, 0) = 0 AND d.balance > 0').all()
    .map((d: any) => ({ id: d.id, name: d.name, balance: d.balance, apr: d.apr ?? 0, min: estimatedMinPayment(d), paidOffMonth: null as number | null }));

  const budget = debts.reduce((s: number, d: any) => s + d.min, 0) + (strategy === 'minimum' ? 0 : extra);
  const series: { month: number; balance: number }[] = [{ month: 0, balance: debts.reduce((s: number, d: any) => s + d.balance, 0) }];
  let totalInterest = 0;
  let month = 0;

  while (debts.some((d: any) => d.balance > 0.005) && month < 600) {
    month++;
    for (const d of debts) {
      if (d.balance <= 0) continue;
      const interest = d.balance * d.apr / 1200;
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
        .sort((a: any, b: any) => strategy === 'avalanche' ? b.apr - a.apr : a.balance - b.balance);
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
      monthly_income_entered: overview.monthlyIncome, avg_monthly_spending_last_3_months: overview.avgMonthlySpending,
      total_minimum_payments: overview.minPayments, monthly_interest_cost: overview.monthlyInterest, estimated_monthly_surplus: overview.surplus,
    },
    accounts: db.prepare('SELECT name, mask, type, subtype, current_balance, available_balance, credit_limit FROM accounts WHERE hidden = 0').all(),
    debts: db.prepare('SELECT name, kind, balance, apr, min_payment, next_due_date, statement_balance, credit_limit, is_overdue, source FROM debts WHERE balance > 0').all(),
    income_sources: db.prepare('SELECT name, kind, monthly_amount, taxes_withheld, notes FROM income_sources').all(),
    detected_recurring_deposits: db.prepare(`SELECT COALESCE(merchant_name, description) AS name, frequency, average_amount, last_date
      FROM recurring_streams WHERE direction = 'inflow' AND is_active = 1`).all(),
    recurring_bills_and_subscriptions: db.prepare(`SELECT COALESCE(merchant_name, description) AS name, category, frequency, average_amount, predicted_next_date
      FROM recurring_streams WHERE direction = 'outflow' AND is_active = 1`).all(),
    spending_by_category: spending.byCategory,
    monthly_spending_trend: spending.byMonth.map(m => ({ month: m.month, total: m.total })),
    top_merchants_last_90_days: spending.topMerchants.map((m: any) => ({ merchant: m.merchant, category: m.category, total: m.total, count: m.count })),
    cashflow_from_transactions: overview.cashflow,
    payoff_simulations: (['minimum', 'snowball', 'avalanche'] as Strategy[]).map(s => {
      const r = simulatePayoff(s, extra);
      return { strategy: s, extra_per_month: s === 'minimum' ? 0 : extra, months: r.months, debt_free: r.debtFreeDate, total_interest: Math.round(r.totalInterest), payoff_order: r.order };
    }),
  };
}
