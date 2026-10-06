export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

// Long AI work runs as a server job; poll until it finishes (keeps each request under Cloudflare's ~100s limit).
export async function runJob<T = any>(path: string, body: unknown = {}): Promise<T> {
  const { jobId } = await api<{ jobId: string }>(path, { body });
  for (;;) {
    await new Promise(r => setTimeout(r, 2500));
    const job = await api<{ status: string; result?: T; error?: string }>(`/api/jobs/${jobId}`);
    if (job.status === 'done') return job.result as T;
    if (job.status === 'error') throw new Error(job.error || 'Failed');
  }
}

export interface Overview {
  netWorth: number; cash: number; investments: number; homeValue: number; homeEquity: number | null; totalDebt: number; minPayments: number; monthlyInterest: number;
  monthlyIncome: number; plannedMonthly: number; incomeSource: 'entered' | 'detected' | 'none'; detectedIncome: number; avgMonthlySpending: number; monthSpending: number; surplus: number;
  cashflow: { month: string; spending: number; income: number }[];
  upcoming: { name: string; date: string; amount: number; kind: 'debt' | 'bill' }[];
  lastSynced: string | null; hasData: boolean;
}

export interface Account {
  account_id: string; item_id: string; institution_name: string; name: string; official_name: string | null; mask: string | null;
  type: string; subtype: string | null; current_balance: number; available_balance: number | null; credit_limit: number | null; hidden: number;
}

export interface Item {
  item_id: string; institution_name: string; products: string; status: string; error: string | null; last_synced_at: string | null; account_count: number;
}

export interface Debt {
  id: string; account_id: string | null; source: 'plaid' | 'manual'; name: string; kind: string; balance: number; apr: number | null;
  min_payment: number | null; next_due_date: string | null; statement_balance: number | null; credit_limit: number | null; is_overdue: number; hidden: number;
  promo_end_date: string | null; promo_deferred: number | null; regular_apr: number | null;
}

export interface Transaction {
  transaction_id: string; account_id: string; account_name: string; mask: string | null; amount: number; date: string; name: string;
  merchant_name: string | null; category: string; detailed_category: string | null; pending: number; logo_url: string | null;
}

export interface RecurringCharge {
  key: string; name: string; category: string; frequency: string; count: number; average_amount: number; last_amount: number;
  last_date: string; next_date: string; monthly: number; annual: number; accounts: string; logo_url: string | null;
  decision: 'keep' | 'review' | 'cut'; note: string | null; related_count: number; related_total: number;
}

export interface IncomeSource { id: string; name: string; kind: string; monthly_amount: number; taxes_withheld: number; notes: string | null }

export interface Spending {
  months: string[];
  byMonth: ({ month: string; total: number } & Record<string, number | string>)[];
  byCategory: { category: string; thisMonth: number; avgMonthly: number; budget: number | null }[];
  categories: string[];
  topMerchants: { merchant: string; category: string; total: number; count: number; logo_url: string | null }[];
}

export interface PayoffResult {
  strategy: string; extra: number; monthlyBudget: number; months: number | null; debtFreeDate: string | null; totalInterest: number;
  series: { month: number; balance: number }[];
  order: { name: string; apr: number; paidOffMonth: number | null }[];
}

export interface AdvisorReport {
  created_at: string; headline: string; health_score: number; summary: string; monthly_surplus_estimate: number; recommended_extra_payment: number; monthly_set_aside_for_life_events?: number;
  strategy: { method: string; rationale: string; debt_free_date: string | null; interest_saved_vs_minimums: number };
  action_plan: { when: string; action: string; amount: number | null; from_account: string | null; to_account: string | null; why: string; estimated_monthly_savings: number | null }[];
  spending_cuts: { target: string; current_monthly: number; suggested_monthly: number; monthly_savings: number; reason: string }[];
  budget_suggestions: { category: string; monthly_limit: number; reason: string }[];
  home_options?: { option: string; monthly_outflow_change: number; cash_left_after: number; consumer_debt_after: number; summary: string;
    pros: string[]; cons: string[]; verdict: 'recommended' | 'worth_exploring' | 'not_now' | 'not_recommended'; next_step: string }[];
  warnings: string[];
  missing_data: string[];
}

export interface DetectedDeposit {
  key: string; name: string; account_name: string; mask: string | null; count: number; average_amount: number;
  last_amount: number; frequency: string; monthly: number; last_date: string; category: string;
}

export interface ImportSummary {
  format: 'csv' | 'ofx'; count: number; from: string; to: string; balance: number | null; flipped: boolean;
  spending: number; payments: number; inserted?: number; duplicates?: number;
  sample: { date: string; name: string; merchant: string | null; amount: number; category: string }[];
}

export interface HomeValuation {
  subject: { address: string; bedrooms: number | null; bathrooms: number | null; sqft: number | null; year_built: number | null; lot_sqft: number | null;
    last_sale_price: number | null; last_sale_date: string | null; county_appraised_value: number | null; county_appraisal_year: string | null };
  public_estimates: { source: string; value: number; as_of: string | null; url: string | null }[];
  comps: { address: string; price: number; date: string | null; status: 'sold' | 'pending' | 'active' | 'unknown'; sqft: number | null;
    bedrooms: number | null; bathrooms: number | null; distance_miles: number | null; source: string; url: string | null }[];
  market: { summary: string; yoy_price_change_pct: number | null; median_days_on_market: number | null; mortgage_rate_30yr: number | null;
    mortgage_rate_15yr: number | null; heloc_rate_typical: number | null; rate_source: string | null };
  estimate: { value: number; low: number; high: number; confidence: 'high' | 'medium' | 'low' };
  methodology: string;
  adjustments: { factor: string; impact: string }[];
  caveats: string[];
  rentcast: { price: number; low: number; high: number } | null;
  rentcast_error: string | null;
  ppsf_check: { median_ppsf: number; implied_value: number; comps_used: number } | null;
  created_at: string;
}

export interface HomeSummary {
  home: { address: string; property_type: string | null; bedrooms: number | null; bathrooms: number | null; sqft: number | null; year_built: number | null;
    purchase_price: number | null; purchase_date: string | null; condition: string | null; notes: string | null; manual_value: number | null;
    debt_ids: string; valued_at: string | null; escrow_monthly: number | null };
  valuation: HomeValuation | null;
  debts: { id: string; name: string; kind: string; balance: number; apr: number | null; min_payment: number | null }[];
  value: number | null; owed: number; equity: number | null; ltv: number | null; borrowable_at_80: number | null; borrowable_at_85: number | null;
}

export interface PlannedItem {
  id: string; name: string; category: string; event_date: string; due_date: string | null; amount: number; saved: number; recurring_yearly: number;
  people: number | null; notes: string | null; estimate: { typical_cost: number; best_time_to_buy: string; tips: string } | null;
  next_event_date: string; next_due_date: string; past: boolean; months_to_save: number; remaining: number; monthly_set_aside: number;
}
export interface PlannedData {
  items: PlannedItem[];
  totals: { monthly_set_aside: number; next_12_months: number; still_to_save: number; missing_amounts: string[]; by_month: { month: string; amount: number; items: string[] }[] };
}

export interface Outlook {
  created_at: string; headline: string;
  fed: { current_target_range: string; prime_rate: number; meetings: { date: string; expectation: string; market_odds: string }[]; path_summary: string };
  mortgage: { current_30yr: number; current_15yr: number; direction: 'falling' | 'flat' | 'rising' | 'uncertain'; forecasts: { source: string; period: string; rate_30yr: number }[]; summary: string };
  housing: { market: string; forecasts: { source: string; period: string; change_pct: number }[]; inventory_and_days_on_market: string; insurance_and_tax_trends: string; best_months_to_list: string; summary: string };
  impacts: { item: string; effect: string; monthly_dollars: number; when: string }[];
  timing: { decision: string; window: string; rationale: string; watch_for: string; confidence: 'high' | 'medium' | 'low' }[];
  purchase_estimates: { expense_id: string; typical_cost: number; best_time_to_buy: string; tips: string }[];
  sources: { title: string; url: string }[];
}
