import { db } from './db';

export interface PlannedRow {
  id: string; name: string; category: string; event_date: string; due_date: string | null; amount: number; saved: number;
  recurring_yearly: number; people: number | null; notes: string | null; estimate: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// Recurring events (birthdays, Christmas) roll forward to their next occurrence.
function rollForward(date: string, recurring: boolean, today: Date) {
  const d = parse(date);
  if (recurring) while (d < today) d.setFullYear(d.getFullYear() + 1);
  return d;
}

export function listPlanned() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows: PlannedRow[] = db.prepare('SELECT * FROM planned_expenses ORDER BY event_date').all();

  const items = rows.map(r => {
    const recurring = !!r.recurring_yearly;
    const event = rollForward(r.event_date, recurring, today);
    // Shift the due date by the same number of years the event rolled.
    const due = r.due_date ? parse(r.due_date) : new Date(event);
    if (r.due_date && recurring) due.setFullYear(due.getFullYear() + (event.getFullYear() - parse(r.event_date).getFullYear()));
    // Months of paychecks left to save, counting this one.
    const monthsToSave = Math.max(1, (due.getFullYear() - today.getFullYear()) * 12 + due.getMonth() - today.getMonth() + 1);
    const remaining = Math.max(0, r.amount - r.saved);
    return {
      ...r,
      estimate: r.estimate ? JSON.parse(r.estimate) : null,
      next_event_date: iso(event), next_due_date: iso(due),
      past: !recurring && event < today,
      months_to_save: monthsToSave, remaining,
      monthly_set_aside: event < today && !recurring ? 0 : remaining / monthsToSave,
      ongoing_monthly: recurring ? r.amount / 12 : 0,
    };
  }).sort((a, b) => a.next_due_date.localeCompare(b.next_due_date));

  const upcoming = items.filter(i => !i.past);
  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const due = upcoming.filter(x => x.next_due_date.startsWith(key));
    return { month: key, amount: due.reduce((s, x) => s + x.amount, 0), items: due.map(x => x.name) };
  });

  return {
    items,
    totals: {
      monthly_set_aside: upcoming.reduce((s, i) => s + i.monthly_set_aside, 0),
      next_12_months: byMonth.reduce((s, m) => s + m.amount, 0),
      still_to_save: upcoming.reduce((s, i) => s + i.remaining, 0),
      missing_amounts: upcoming.filter(i => !i.amount).map(i => i.name),
      by_month: byMonth,
    },
  };
}
