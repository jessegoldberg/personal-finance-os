import { useEffect, useState } from 'react';
import { Repeat, StickyNote, ShieldCheck, HelpCircle, Scissors } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, Overview, PayoffResult, RecurringCharge } from '../lib/api';
import { money, monthLabel, dateLabel, categoryLabel } from '../lib/format';
import { Card, CardHeader, Empty, Spinner } from './ui';

const FREQ: Record<string, string> = { WEEKLY: 'Weekly', BIWEEKLY: 'Every 2 weeks', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUALLY: 'Yearly' };
const DECISIONS = [
  { id: 'keep', label: 'Keep', icon: ShieldCheck, on: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  { id: 'review', label: 'Review', icon: HelpCircle, on: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  { id: 'cut', label: 'Cut', icon: Scissors, on: 'bg-rose-500/15 text-rose-300 ring-rose-500/30' },
] as const;

type Scenario = { label: string; extra: number; result: PayoffResult | null };

export function RecurringReview() {
  const { data: items, setData } = useApi<RecurringCharge[]>('/api/recurring');
  const { data: overview } = useApi<Overview>('/api/overview');
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);

  const total = (d: string) => (items ?? []).filter(i => i.decision === d).reduce((s, i) => s + i.monthly, 0);
  const keep = total('keep'), review = total('review'), cut = total('cut');

  useEffect(() => {
    if (!overview || !items) return;
    const base = Math.max(0, Math.round(overview.surplus));
    const list = [
      { label: 'As things are', extra: base },
      { label: 'Cancel what’s marked Cut', extra: base + Math.round(cut) },
      { label: 'Also cancel everything in Review', extra: base + Math.round(cut + review) },
    ];
    const t = setTimeout(async () => {
      const results = await Promise.all(list.map(s => api<{ avalanche: PayoffResult }>(`/api/payoff?extra=${s.extra}`).then(r => r.avalanche)));
      setScenarios(list.map((s, i) => ({ ...s, result: results[i] })));
    }, 200);
    return () => clearTimeout(t);
  }, [overview, cut, review, items]);

  const decide = async (item: RecurringCharge, decision: string, note = item.note) => {
    setData((items ?? []).map(i => i.key === item.key ? { ...i, decision: decision as RecurringCharge['decision'], note } : i));
    await api(`/api/recurring/${encodeURIComponent(item.key)}`, { method: 'PUT', body: { decision, note } });
  };

  const base = scenarios?.[0]?.result;

  return (
    <Card className="overflow-hidden">
      <CardHeader title={<span className="flex items-center gap-2"><Repeat className="h-4 w-4 text-violet-400" /> Recurring charges</span>}
        subtitle="Found across every account and imported card. Mark each one — the AI advisor never suggests cutting what you Keep." />

      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="grid grid-cols-3 gap-2">
          {DECISIONS.map(d => (
            <div key={d.id} className="rounded-xl bg-white/[0.03] p-3">
              <p className="flex items-center gap-1.5 text-xs text-slate-500"><d.icon className="h-3.5 w-3.5" /> {d.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{money({ keep, review, cut }[d.id])}<span className="text-xs font-normal text-slate-500">/mo</span></p>
              <p className="text-[11px] text-slate-500">{money({ keep, review, cut }[d.id] * 12)}/yr</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <p className="mb-2 text-xs text-slate-500">If that money went to debt instead (highest-interest first)</p>
          {scenarios ? (
            <ul className="space-y-1.5 text-sm">
              {scenarios.map((s, i) => {
                const r = s.result;
                const months = r?.months != null && base?.months != null ? base.months - r.months : 0;
                const saved = r && base ? base.totalInterest - r.totalInterest : 0;
                return (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-slate-300">{s.label}</span>
                    <span className="tabular-nums text-slate-400">
                      debt-free {r?.debtFreeDate ? monthLabel(r.debtFreeDate, true) : '—'}
                      {i > 0 && months > 0 && <span className="text-emerald-400"> · {months} mo sooner, {money(saved)} less interest</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : <Spinner className="h-4 w-4 text-slate-500" />}
        </div>
      </div>

      {items?.length ? (
        <ul className="divide-y divide-white/[0.04] border-t border-white/[0.06]">
          {items.map(i => (
            <li key={i.key} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                {i.logo_url ? <img src={i.logo_url} alt="" className="h-8 w-8 rounded-md bg-white object-contain" />
                  : <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.06] text-xs font-semibold text-slate-400">{i.name.slice(0, 1)}</div>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200">{i.name}</p>
                  <p className="text-xs text-slate-500">
                    {FREQ[i.frequency] ?? i.frequency} · {categoryLabel(i.category)} · {i.accounts} · next ~{dateLabel(i.next_date)}
                  </p>
                  {i.related_count > 0 && (
                    <p className="text-xs text-sky-300/80">Usage: {i.related_count} other purchases at this brand, {money(i.related_total)} in the last 90 days</p>
                  )}
                  {i.note && noteFor !== i.key && <p className="text-xs italic text-slate-400">“{i.note}”</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-100">{money(i.average_amount, true)}</p>
                  <p className="text-[11px] text-slate-500">{money(i.annual)}/yr</p>
                </div>
                <div className="flex items-center gap-1">
                  {DECISIONS.map(d => (
                    <button key={d.id} onClick={() => decide(i, d.id)}
                      className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition ${i.decision === d.id ? d.on : 'text-slate-500 ring-white/10 hover:text-slate-300'}`}>
                      {d.label}
                    </button>
                  ))}
                  <button className="btn-ghost p-1.5" title="Why keep / why cut" onClick={() => setNoteFor(noteFor === i.key ? null : i.key)}><StickyNote className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {noteFor === i.key && (
                <form className="mt-2 flex gap-2 pl-11" onSubmit={e => { e.preventDefault(); decide(i, i.decision, (e.currentTarget.elements.namedItem('note') as HTMLInputElement).value); setNoteFor(null); }}>
                  <input name="note" autoFocus defaultValue={i.note ?? ''} className="input py-1.5" placeholder="e.g. Use it weekly for work / 12-month pass contract ends in May" />
                  <button className="btn-secondary px-3 py-1.5 text-xs">Save</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : items ? <Empty icon={Repeat} title="No recurring charges found yet" body="Needs at least two charges at a steady interval. Import Apple Card and Edward Jones statements to include those cards." /> : null}
    </Card>
  );
}
