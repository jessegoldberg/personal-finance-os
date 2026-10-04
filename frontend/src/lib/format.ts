const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export const money = (n: number | null | undefined, cents = false) => (n == null ? '—' : (cents ? usd : usd0).format(n));
export const moneyCompact = (n: number) => compact.format(n);
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(2)}%`);

export function monthLabel(key: string, long = false) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
}

export function dateLabel(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function daysUntil(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 864e5);
}

export function relativeTime(sqlTimestamp: string | null) {
  if (!sqlTimestamp) return 'never';
  const t = new Date(sqlTimestamp.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

const CATEGORY_LABELS: Record<string, string> = {
  FOOD_AND_DRINK: 'Food & Drink', GENERAL_MERCHANDISE: 'Shopping', GENERAL_SERVICES: 'Services', HOME_IMPROVEMENT: 'Home Improvement',
  RENT_AND_UTILITIES: 'Rent & Utilities', TRANSPORTATION: 'Transportation', TRAVEL: 'Travel', ENTERTAINMENT: 'Entertainment',
  PERSONAL_CARE: 'Personal Care', MEDICAL: 'Medical', BANK_FEES: 'Bank Fees', GOVERNMENT_AND_NON_PROFIT: 'Gov & Non-profit',
  LOAN_PAYMENTS: 'Debt Payments', TRANSFER_IN: 'Transfer In', TRANSFER_OUT: 'Transfer Out', INCOME: 'Income', OTHER: 'Other',
};
export const categoryLabel = (c: string | null) => (c ? CATEGORY_LABELS[c] ?? c.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Uncategorized');

const PALETTE = ['#10b981', '#38bdf8', '#a78bfa', '#f59e0b', '#f472b6', '#22d3ee', '#fb7185', '#84cc16', '#e879f9', '#fbbf24', '#60a5fa', '#94a3b8'];
const FIXED: Record<string, string> = {
  FOOD_AND_DRINK: '#f59e0b', GENERAL_MERCHANDISE: '#a78bfa', RENT_AND_UTILITIES: '#38bdf8', TRANSPORTATION: '#22d3ee',
  ENTERTAINMENT: '#f472b6', TRAVEL: '#60a5fa', MEDICAL: '#fb7185', PERSONAL_CARE: '#e879f9', GENERAL_SERVICES: '#84cc16',
  HOME_IMPROVEMENT: '#fbbf24', BANK_FEES: '#ef4444', OTHER: '#94a3b8',
};
export const categoryColor = (c: string, i = 0) => FIXED[c] ?? PALETTE[i % PALETTE.length];
