// Pure, read-only monthly planning math. No model, database or payment execution.
export interface PlanDebt {
  id: string; name: string; balance: number; apr: number | null; min_payment: number | null;
  is_overdue?: number; promo_end_date?: string | null; home_secured?: boolean;
}
export interface PlanInput {
  date: string; income: number; incomeSource: string; spending: number; planned: number;
  cash: number; historyMonths: number; debts: PlanDebt[]; unbudgetedEvents?: string[]; staleAccounts?: string[]; untaxedIncome?: number; taxReserve?: number | null; cashBufferTarget?: number | null;
}
const cents = (n: number) => Math.round(n * 100);
const dollars = (n: number) => n / 100;
const amount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function project(debts: PlanDebt[], extra: number, method: 'avalanche' | 'snowball', date: string) {
  if (!amount(extra) || debts.some(d => !amount(d.apr) || !amount(d.min_payment) || d.min_payment <= 0)) throw new Error('Verified APRs and minimums are required for projections.');
  const rows = debts.map(d => ({ ...d, left: cents(d.balance), minimum: cents(d.min_payment!) }));
  const budget = rows.reduce((s,d) => s+d.minimum,0)+cents(extra);
  let interest = 0, months = 0;
  while (rows.some(d => d.left > 0) && months < 600) {
    months++;
    for (const d of rows) {
      const charge = Math.round(d.left * d.apr! / 1200);
      d.left += charge; interest += charge;
    }
    let available = budget;
    for (const d of rows) {
      const pay = Math.min(d.left,d.minimum,available);
      d.left -= pay; available -= pay;
    }
    const order = rows.filter(d => d.left > 0).sort((a,b) =>
      (method === 'avalanche' ? b.apr!-a.apr! : a.left-b.left) || a.id.localeCompare(b.id));
    for (const d of order) {
      const pay = Math.min(d.left,available);d.left -= pay;available -= pay;
    }
  }
  const reachable = rows.every(d => d.left === 0);
  const [year,month] = date.split('-').map(Number);
  const end = new Date(Date.UTC(year,month-1+months,1));
  return { method, monthly_payment: dollars(budget), months: reachable ? months : null,
    debt_free_month: reachable ? end.toISOString().slice(0,7) : null,
    total_interest: reachable ? dollars(interest) : null };
}

export function debtActionPlan(input: PlanInput) {
  if (![input.income,input.spending,input.planned].every(amount) || !Number.isFinite(input.cash) ||
      (input.taxReserve != null && !amount(input.taxReserve)) ||
      (input.cashBufferTarget != null && !amount(input.cashBufferTarget)) ||
      !Number.isInteger(input.historyMonths) || input.historyMonths < 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.debts.some(d => !amount(d.balance) ||
        (d.apr != null && (!amount(d.apr) || d.apr > 1000)) ||
        (d.min_payment != null && !amount(d.min_payment)))) throw new Error('Invalid planning inputs. Review account data.');
  const active = input.debts.filter(d => d.balance > 0);
  const consumer = active.filter(d => !d.home_secured);
  const gaps: string[] = [], warnings: string[] = [];
  if (input.incomeSource !== 'entered') gaps.push('Confirm monthly take-home income in Income. Detected deposits can include transfers or irregular money.');
  if (input.income <= 0) gaps.push('Enter reliable monthly take-home income.');
  if (input.historyMonths < 3 || input.spending <= 0) gaps.push('Confirm living costs: fewer than three complete spending months or no recorded living costs.');
  for (const d of active) {
    if (d.min_payment == null || d.min_payment <= 0) gaps.push(`${d.name}: enter the current statement minimum payment.`);
    if (d.is_overdue) gaps.push(`${d.name}: verify the past-due amount and catch-up arrangement before extra payments.`);
  }
  for (const d of consumer) {
    if (d.apr == null) gaps.push(`${d.name}: enter the APR; an unknown rate is not treated as 0%.`);
    if (d.promo_end_date) gaps.push(`${d.name}: review promotional/deferred-interest terms before using fixed-rate projections.`);
  }
  for (const name of input.unbudgetedEvents ?? []) gaps.push(`${name}: enter a planned-expense budget before committing extra cash.`);
  for (const name of input.staleAccounts ?? []) gaps.push(`${name}: refresh or confirm the account balance; its update is missing, invalid or older than 35 days.`);
  if ((input.untaxedIncome ?? 0)>0 && input.taxReserve == null) gaps.push('Confirm the additional monthly tax set-aside for income without withholding. Enter 0 only if already covered elsewhere.');
  const taxReserve = input.taxReserve ?? 0;
  const minimums = active.reduce((s,d) => s+(d.min_payment ?? 0),0);
  const surplus = dollars(cents(input.income)-cents(input.spending)-cents(input.planned)-cents(minimums)-cents(taxReserve));
  // Explicit provisional assumption: one month of observed living costs, at least $1,000.
  const reserveTarget = input.cashBufferTarget ?? Math.max(1000,input.spending);
  const reserveGap = Math.max(0,dollars(cents(reserveTarget)-cents(input.cash)));
  const bufferContribution = Math.min(Math.max(0,surplus),reserveGap);
  const extra = gaps.length ? 0 : Math.max(0,dollars(cents(surplus)-cents(bufferContribution)));
  if (surplus < 0) warnings.push('The current monthly budget has a shortfall. A faster payoff date requires a verified spending reduction, additional income or revised lender terms.');
  if (reserveGap > 0) warnings.push('Part of positive monthly cash flow is reserved to rebuild the cash buffer before extra debt payments.');
  warnings.push('Monthly estimates assume fixed APRs, no new borrowing or fees, fixed statement minimums and on-time payments. They are not a payment schedule or guarantee.');
  const ready = consumer.length > 0 && gaps.length === 0 && surplus >= 0;
  const priority = [...consumer].sort((a,b) => (b.apr ?? -1)-(a.apr ?? -1) || a.id.localeCompare(b.id));
  return { generated_on:input.date, source:'calculated' as const, paid_credits_required:false,
    status:consumer.length === 0 ? 'no_consumer_debt' : gaps.length ? 'needs_data' : surplus < 0 ? 'cashflow_shortfall' : 'ready',
    monthly_tax_reserve:taxReserve, tax_reserve_setting:input.taxReserve ?? null, cash_buffer_setting:input.cashBufferTarget ?? null,
    monthly_income:input.income, living_costs:input.spending, planned_expenses:input.planned,
    minimum_payments:minimums, monthly_surplus:surplus, monthly_shortfall:Math.max(0,-surplus),
    reserve_target:reserveTarget, reserve_gap:reserveGap, reserve_contribution:bufferContribution,
    extra_payment:extra, consumer_balance:consumer.reduce((s,d) => s+d.balance,0),
    priorities:priority.map(d => ({ id:d.id,name:d.name,balance:d.balance,apr:d.apr,minimum:d.min_payment })),
    scenarios:ready ? [project(consumer,extra,'avalanche',input.date),project(consumer,extra,'snowball',input.date)] : [],
    missing_data:gaps,warnings,
    assumptions:[input.cashBufferTarget == null ? 'Cash buffer target defaults to one month of observed living costs, at least $1,000; confirm it suits the household.' : 'Cash buffer target is the amount you explicitly entered; verify it covers household needs.',
      'All housing/other debt minimums remain in the cash-flow budget. Payoff comparisons cover only non-home-secured debts.',
      'No lump sum, retirement withdrawal, home sale or new secured borrowing is assumed.',
      'The first modeled monthly payment is one month after the plan date; review actual due dates separately.',
      'Minimum payments released by payoff remain in the monthly debt budget. Extra payment capacity is held constant; future buffer contributions are not automatically redirected.'] };
}
