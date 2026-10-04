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

export interface Overview {
  netWorth: number; cash: number; investments: number; totalDebt: number; minPayments: number; monthlyInterest: number;
  monthlyIncome: number; avgMonthlySpending: number; monthSpending: number; surplus: number;
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
}

export interface Transaction {
  transaction_id: string; account_id: string; account_name: string; mask: string | null; amount: number; date: string; name: string;
  merchant_name: string | null; category: string; detailed_category: string | null; pending: number; logo_url: string | null;
}

export interface Recurring {
  stream_id: string; direction: 'inflow' | 'outflow'; description: string; merchant_name: string | null; category: string | null;
  frequency: string; average_amount: number; last_amount: number; last_date: string | null; predicted_next_date: string | null;
  account_name: string | null; mask: string | null; monthly: number;
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
  created_at: string; headline: string; health_score: number; summary: string; monthly_surplus_estimate: number; recommended_extra_payment: number;
  strategy: { method: string; rationale: string; debt_free_date: string | null; interest_saved_vs_minimums: number };
  action_plan: { when: string; action: string; amount: number | null; from_account: string | null; to_account: string | null; why: string; estimated_monthly_savings: number | null }[];
  spending_cuts: { target: string; current_monthly: number; suggested_monthly: number; monthly_savings: number; reason: string }[];
  budget_suggestions: { category: string; monthly_limit: number; reason: string }[];
  warnings: string[];
  missing_data: string[];
}
