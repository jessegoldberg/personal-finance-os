import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingDown, Percent, Flame, CalendarClock, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, Debt, Overview, PayoffResult } from '../lib/api';
import { money, moneyCompact, pct, dateLabel, monthLabel } from '../lib/format';
import { Card, CardHeader, Stat, Badge, Empty, PageHeader, ProgressBar, ErrorNote, chartTooltip, axisProps } from '../components/ui';

type Payoff = { minimum: PayoffResult; avalanche: PayoffResult; snowball: PayoffResult };

const STRATEGY_COLORS = { avalanche: '#10b981', snowball: '#38bdf8', minimum: '#64748b' };

function monthsToLabel(m: number | null) {
  if (m == null) return 'Never';
  const y = Math.floor(m / 12), r = m % 12;
  return [y && `${y} yr`, r && `${r} mo`].filter(Boolean).join(' ') || '0 mo';
}

function DebtForm({ debt, onSave, onCancel }: { debt?: Debt; onSave: (d: any) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({
    name: debt?.name ?? '', kind: debt?.kind ?? 'credit', balance: debt?.balance?.toString() ?? '', apr: debt?.apr?.toString() ?? '',
    min_payment: debt?.min_payment?.toString() ?? '', next_due_date: debt?.next_due_date ?? '',
    promo_end_date: debt?.promo_end_date ?? '', promo_deferred: debt?.promo_deferred ?? 1, regular_apr: debt?.regular_apr?.toString() ?? '',
  });
  const [hasPromo, setHasPromo] = useState(!!debt?.promo_end_date);
  const [error, setError] = useState<string | null>(null);
  const plaid = debt?.source === 'plaid';
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <form className="grid gap-3 p-5 sm:grid-cols-6" onSubmit={async e => {
      e.preventDefault();
      try { await onSave(hasPromo ? f : { ...f, promo_end_date: '', promo_deferred: 0, regular_apr: '' }); } catch (err: any) { setError(err.message); }
    }}>
      <div className="sm:col-span-2"><label className="label">Name</label><input className="input" required value={f.name} onChange={set('name')} placeholder="e.g. Car loan" /></div>
      <div><label className="label">Type</label>
        <select className="input" value={f.kind} onChange={set('kind')}>
          {['credit', 'auto', 'student', 'personal', 'mortgage', 'medical', 'other'].map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <div><label className="label">Balance</label><input className="input" type="number" step="0.01" value={f.balance} onChange={set('balance')} disabled={plaid} title={plaid ? 'Synced from your bank' : ''} /></div>
      <div><label className="label">APR %</label><input className="input" type="number" step="0.01" value={f.apr} onChange={set('apr')} placeholder="e.g. 24.99" /></div>
      <div><label className="label">Min payment</label><input className="input" type="number" step="0.01" value={f.min_payment} onChange={set('min_payment')} /></div>
      <div className="sm:col-span-2"><label className="label">Next due date</label><input className="input" type="date" value={f.next_due_date} onChange={set('next_due_date')} /></div>
      <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-6">
        <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={hasPromo}
          onChange={e => { setHasPromo(e.target.checked); setF({ ...f, apr: e.target.checked ? '0' : f.apr, promo_end_date: e.target.checked ? f.promo_end_date : '' }); }} />
        0% / promotional financing (furniture, electronics, balance transfer)
      </label>
      {hasPromo && (
        <>
          <div className="sm:col-span-2"><label className="label">Promo ends</label><input className="input" type="date" required value={f.promo_end_date} onChange={set('promo_end_date')} /></div>
          <div><label className="label">APR after promo %</label><input className="input" type="number" step="0.01" value={f.regular_apr} onChange={set('regular_apr')} placeholder="e.g. 29.99" /></div>
          <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-3">
            <input type="checkbox" className="h-4 w-4 accent-rose-500" checked={!!f.promo_deferred} onChange={e => setF({ ...f, promo_deferred: e.target.checked ? 1 : 0 })} />
            Deferred interest — all back-interest is charged if not paid in full by the end date (most store/furniture cards)
          </label>
        </>
      )}
      <div className="flex items-end gap-2 sm:col-span-4">
        <button className="btn-primary"><Check className="h-4 w-4" /> Save</button>
        <button type="button" className="btn-ghost" onClick={onCancel}><X className="h-4 w-4" /> Cancel</button>
        <ErrorNote error={error} />
      </div>
    </form>
  );
}

export default function Debts(_: PageProps) {
  const { data: debts, reload } = useApi<Debt[]>('/api/debts');
  const { data: overview, reload: reloadOverview } = useApi<Overview>('/api/overview');
  const [extra, setExtra] = useState<number | null>(null);
  const [payoff, setPayoff] = useState<Payoff | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (overview && extra === null) setExtra(Math.max(0, Math.round(overview.surplus / 25) * 25));
  }, [overview, extra]);

  useEffect(() => {
    if (extra === null) return;
    const t = setTimeout(() => api<Payoff>(`/api/payoff?extra=${extra}`).then(setPayoff), 150);
    return () => clearTimeout(t);
  }, [extra, debts]);

  const active = (debts ?? []).filter(d => !d.hidden && d.balance > 0);
  const total = active.reduce((s, d) => s + d.balance, 0);
  const weightedApr = total ? active.reduce((s, d) => s + d.balance * (d.apr ?? 0), 0) / total : 0;
  const missingApr = active.filter(d => d.apr == null).length;

  const chartData = useMemo(() => {
    if (!payoff) return [];
    const len = Math.min(Math.max(payoff.avalanche.series.length, payoff.snowball.series.length, Math.min(payoff.minimum.series.length, 240)), 241);
    const now = new Date();
    return Array.from({ length: len }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return {
        label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        avalanche: payoff.avalanche.series[i]?.balance ?? 0,
        snowball: payoff.snowball.series[i]?.balance ?? 0,
        minimum: payoff.minimum.series[i]?.balance ?? (payoff.minimum.months ? 0 : undefined),
      };
    });
  }, [payoff]);

  const save = async (id: string | null, f: any) => {
    if (id) await api(`/api/debts/${id}`, { method: 'PUT', body: f });
    else await api('/api/debts', { body: f });
    setEditing(null);
    reload();
    reloadOverview();
  };

  const best = payoff && (payoff.avalanche.totalInterest <= payoff.snowball.totalInterest ? payoff.avalanche : payoff.snowball);

  return (
    <>
      <PageHeader title="Debt Plan" subtitle="Every debt, what it costs you, and the fastest way out."
        actions={<button className="btn-secondary" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add debt</button>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total debt" value={money(total)} icon={TrendingDown} tone="bad" hint={`${active.length} accounts`} />
        <Stat label="Weighted APR" value={pct(weightedApr)} icon={Percent} hint={missingApr ? <span className="text-amber-400">{missingApr} missing APR</span> : 'Balance-weighted'} />
        <Stat label="Interest / month" value={money(overview?.monthlyInterest)} icon={Flame} tone="warn" hint={`${money((overview?.monthlyInterest ?? 0) * 12)} per year`} />
        <Stat label="Minimums / month" value={money(overview?.minPayments)} icon={CalendarClock} />
      </div>

      {missingApr > 0 && (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 text-sm text-amber-200/90">
          Some lenders don't share APRs through Plaid. Add them below (it's on your statement) — the plan can't prioritise correctly without them.
        </div>
      )}

      <Card className="mt-4">
        <CardHeader title="Payoff simulator" subtitle="Minimums on everything, plus your extra payment rolled into one target at a time" />
        <div className="grid gap-6 p-5 lg:grid-cols-3">
          <div className="space-y-5">
            <div>
              <div className="flex items-baseline justify-between">
                <label className="label">Extra per month toward debt</label>
                <span className="text-lg font-semibold text-white">{money(extra ?? 0)}</span>
              </div>
              <input type="range" min={0} max={Math.max(3000, (extra ?? 0))} step={25} value={extra ?? 0}
                onChange={e => setExtra(Number(e.target.value))} className="w-full accent-emerald-500" />
              <p className="mt-1 text-xs text-slate-500">Your estimated surplus is {money(overview?.surplus)}/mo.</p>
            </div>
            {payoff && (['avalanche', 'snowball', 'minimum'] as const).map(k => {
              const r = payoff[k];
              const saved = payoff.minimum.totalInterest - r.totalInterest;
              return (
                <div key={k} className={`rounded-xl border p-3 ${r === best ? 'border-emerald-500/40 bg-emerald-500/[0.05]' : 'border-white/[0.06]'}`}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium capitalize text-slate-200">
                      <span className="h-2 w-2 rounded-full" style={{ background: STRATEGY_COLORS[k] }} />
                      {k === 'minimum' ? 'Minimums only' : k}
                    </span>
                    {r === best && <Badge tone="good">Best</Badge>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-slate-500">Debt-free</p><p className="text-sm font-semibold text-slate-100">{r.debtFreeDate ? monthLabel(r.debtFreeDate, true) : 'Never'}</p><p className="text-slate-500">{monthsToLabel(r.months)}</p></div>
                    <div><p className="text-slate-500">Total interest</p><p className="text-sm font-semibold text-slate-100">{money(r.totalInterest)}</p>
                      {k !== 'minimum' && saved > 0 && <p className="text-emerald-400">saves {money(saved)}</p>}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="h-80 lg:col-span-2 lg:h-auto lg:min-h-[340px]">
            {chartData.length > 1 ? (
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis {...axisProps} tickFormatter={moneyCompact} width={60} />
                  <Tooltip {...chartTooltip} formatter={(v: any) => money(v)} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="minimum" name="Minimums only" stroke={STRATEGY_COLORS.minimum} strokeDasharray="4 4" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="snowball" name="Snowball" stroke={STRATEGY_COLORS.snowball} dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="avalanche" name="Avalanche" stroke={STRATEGY_COLORS.avalanche} dot={false} strokeWidth={2.5} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty icon={TrendingDown} title="Add debts to see your payoff timeline" />}
          </div>
        </div>
        {best && best.order.length > 0 && (
          <div className="border-t border-white/[0.06] px-5 py-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">Payoff order ({best.strategy})</p>
            <div className="flex flex-wrap gap-2">
              {best.order.map((o, i) => (
                <div key={o.name} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-300">{i + 1}</span>
                  <span className="text-slate-200">{o.name}</span>
                  <span className="text-slate-500">{o.paidOffMonth ? monthsToLabel(o.paidOffMonth) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="All debts" subtitle="Linked cards update automatically; add APRs and anything Plaid can't see" />
        {editing === 'new' && <div className="mt-2 border-y border-white/[0.06] bg-white/[0.02]"><DebtForm onSave={f => save(null, f)} onCancel={() => setEditing(null)} /></div>}
        {debts?.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-white/[0.06]">
                <tr><th className="th">Debt</th><th className="th text-right">Balance</th><th className="th text-right">APR</th><th className="th text-right">Min</th>
                  <th className="th">Due</th><th className="th w-48">Utilization</th><th className="th" /></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {debts.map(d => editing === d.id ? (
                  <tr key={d.id}><td colSpan={7} className="bg-white/[0.02]"><DebtForm debt={d} onSave={f => save(d.id, f)} onCancel={() => setEditing(null)} /></td></tr>
                ) : (
                  <tr key={d.id} className={`hover:bg-white/[0.02] ${d.hidden ? 'opacity-40' : ''}`}>
                    <td className="td min-w-[240px]">
                      <p className="font-medium text-slate-200">{d.name}</p>
                      <div className="mt-0.5 flex gap-1">
                        <Badge tone={d.source === 'plaid' ? 'info' : 'default'}>{d.source === 'plaid' ? 'Linked' : 'Manual'}</Badge>
                        <Badge>{d.kind}</Badge>
                        {d.promo_end_date && <Badge tone={d.promo_deferred ? 'warn' : 'info'}>0% until {dateLabel(d.promo_end_date)} '{d.promo_end_date.slice(2, 4)}</Badge>}
                        {d.is_overdue ? <Badge tone="bad">Overdue</Badge> : null}
                      </div>
                    </td>
                    <td className="td text-right font-semibold tabular-nums text-slate-100">{money(d.balance, true)}
                      {d.promo_end_date && d.promo_deferred ? (() => {
                        const [y, m] = d.promo_end_date.split('-').map(Number);
                        const n = Math.max(1, (y - new Date().getFullYear()) * 12 + (m - 1 - new Date().getMonth()));
                        return <p className="text-[11px] font-normal text-amber-400">Pay {money(d.balance / n, true)}/mo to beat the deadline</p>;
                      })() : null}
                    </td>
                    <td className="td text-right tabular-nums">{d.apr != null ? <span className={d.apr >= 20 ? 'text-rose-400' : 'text-slate-300'}>{pct(d.apr)}</span> : <button className="text-amber-400 hover:underline" onClick={() => setEditing(d.id)}>Add</button>}</td>
                    <td className="td text-right tabular-nums text-slate-300">{money(d.min_payment, true)}</td>
                    <td className="td text-slate-400">{dateLabel(d.next_due_date)}</td>
                    <td className="td">{d.credit_limit ? <div className="flex items-center gap-2"><ProgressBar value={d.balance} max={d.credit_limit} /><span className="w-10 text-right text-xs text-slate-500">{Math.round(d.balance / d.credit_limit * 100)}%</span></div> : <span className="text-xs text-slate-600">—</span>}</td>
                    <td className="td text-right">
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost p-1.5" onClick={() => setEditing(d.id)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                        {d.source === 'manual' && (
                          <button className="btn-ghost p-1.5 hover:text-rose-400" aria-label="Delete"
                            onClick={async () => { await api(`/api/debts/${d.id}`, { method: 'DELETE' }); reload(); reloadOverview(); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : editing !== 'new' && <Empty icon={TrendingDown} title="No debts yet" body="Link a credit card on the Accounts page or add a loan manually." />}
      </Card>
    </>
  );
}
