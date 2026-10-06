import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PieChart as PieIcon, Store, Target, Pencil } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, Spending as SpendingData } from '../lib/api';
import { RecurringReview } from '../components/RecurringReview';
import { money, moneyCompact, monthLabel, categoryLabel, categoryColor, dateLabel } from '../lib/format';
import { Card, CardHeader, Badge, Empty, PageHeader, ProgressBar, Spinner, chartTooltip, axisProps } from '../components/ui';

const RANGES = [3, 6, 12];

function BudgetCell({ category, budget, onSaved }: { category: string; budget: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(budget?.toString() ?? '');
  if (!editing) {
    return (
      <button className="group inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200" onClick={() => setEditing(true)}>
        {budget ? money(budget) : <span className="text-slate-600">Set budget</span>}
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100" />
      </button>
    );
  }
  const save = async () => {
    await api(`/api/budgets/${encodeURIComponent(category)}`, { method: 'PUT', body: { monthly_limit: value } });
    setEditing(false);
    onSaved();
  };
  return (
    <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); save(); }}>
      <input autoFocus className="input w-24 py-1" type="number" min={0} value={value} onChange={e => setValue(e.target.value)} onBlur={save} placeholder="0 = none" />
    </form>
  );
}

export default function Spending(_: PageProps) {
  const [range, setRange] = useState(6);
  const { data, reload, loading } = useApi<SpendingData>(`/api/spending?months=${range}`);


  const topCats = (data?.byCategory ?? []).filter(c => c.avgMonthly + c.thisMonth > 0).slice(0, 7).map(c => c.category);
  const chartData = (data?.byMonth ?? []).map(m => {
    const row: Record<string, number | string> = { label: monthLabel(m.month) };
    let other = 0;
    for (const c of data!.categories) {
      const v = Number(m[c] ?? 0);
      if (topCats.includes(c)) row[c] = v; else other += v;
    }
    row.OTHER_REST = other;
    return row;
  });

  const thisMonthTotal = data?.byCategory.reduce((s, c) => s + c.thisMonth, 0) ?? 0;
  const budgetTotal = data?.byCategory.reduce((s, c) => s + (c.budget ?? 0), 0) ?? 0;
  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

  return (
    <>
      <PageHeader title="Spending & Budgets" subtitle="Where the money goes — and where it can stop going."
        actions={
          <div className="flex rounded-lg border border-white/10 p-0.5">
            {RANGES.map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${range === r ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{r}M</button>
            ))}
          </div>
        } />

      <Card>
        <CardHeader title="Monthly spending by category" subtitle="Excludes transfers between your accounts and credit card payments" />
        <div className="h-80 px-2 pb-4 pt-4">
          {loading && !data ? <div className="flex h-full items-center justify-center"><Spinner className="h-5 w-5 text-slate-500" /></div> : (
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={moneyCompact} width={60} />
                <Tooltip {...chartTooltip} formatter={(v: any, n: any) => [money(v), n === 'OTHER_REST' ? 'Everything else' : categoryLabel(n)]} />
                {topCats.map((c, i) => <Bar key={c} dataKey={c} stackId="s" fill={categoryColor(c, i)} maxBarSize={44} />)}
                <Bar dataKey="OTHER_REST" stackId="s" fill="#334155" radius={[6, 6, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-5">
          {topCats.map((c, i) => (
            <span key={c} className="flex items-center gap-1.5 text-xs text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: categoryColor(c, i) }} />{categoryLabel(c)}</span>
          ))}
        </div>
      </Card>

      <div className="mt-4"><RecurringReview /></div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="overflow-hidden xl:col-span-3">
          <CardHeader title={<span className="flex items-center gap-2"><Target className="h-4 w-4 text-sky-400" /> Budgets</span>}
            subtitle={budgetTotal ? `${money(thisMonthTotal)} of ${money(budgetTotal)} budgeted · day ${dayOfMonth} of ${daysInMonth}` : 'Click a budget cell to set a monthly limit'} />
          {data?.byCategory.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead className="border-b border-white/[0.06]">
                  <tr><th className="th">Category</th><th className="th text-right">This month</th><th className="th text-right">3-mo avg</th><th className="th">Budget</th><th className="th w-40" /></tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {data.byCategory.map((c, i) => {
                    const pace = c.budget ? c.budget * dayOfMonth / daysInMonth : 0;
                    return (
                      <tr key={c.category} className="hover:bg-white/[0.02]">
                        <td className="td"><span className="flex items-center gap-2 text-slate-200"><span className="h-2 w-2 rounded-full" style={{ background: categoryColor(c.category, i) }} />{categoryLabel(c.category)}</span></td>
                        <td className="td text-right tabular-nums text-slate-100">{money(c.thisMonth)}</td>
                        <td className="td text-right tabular-nums text-slate-400">{money(c.avgMonthly)}</td>
                        <td className="td"><BudgetCell category={c.category} budget={c.budget} onSaved={reload} /></td>
                        <td className="td">
                          {c.budget ? (
                            <div>
                              <ProgressBar value={c.thisMonth} max={c.budget} />
                              <p className={`mt-1 text-[11px] ${c.thisMonth > c.budget ? 'text-rose-400' : c.thisMonth > pace ? 'text-amber-400' : 'text-slate-500'}`}>
                                {c.thisMonth > c.budget ? `${money(c.thisMonth - c.budget)} over` : c.thisMonth > pace ? 'Ahead of pace' : `${money(c.budget - c.thisMonth)} left`}
                              </p>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty icon={PieIcon} title="No spending data yet" body="Transactions appear after your first sync. Plaid can take a few minutes to pull history for a new connection." />}
        </Card>

        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Store className="h-4 w-4 text-amber-400" /> Top merchants</span>} subtitle="Last 90 days" />
            {data?.topMerchants.length ? (
              <ul className="divide-y divide-white/[0.04] px-5 pb-3 pt-2">
                {data.topMerchants.slice(0, 10).map(m => (
                  <li key={m.merchant} className="flex items-center gap-3 py-2.5">
                    {m.logo_url ? <img src={m.logo_url} alt="" className="h-7 w-7 rounded-md bg-white object-contain" />
                      : <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-xs font-semibold text-slate-400">{m.merchant.slice(0, 1)}</div>}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-200">{m.merchant}</p>
                      <p className="text-xs text-slate-500">{m.count} purchases · {categoryLabel(m.category)}</p>
                    </div>
                    <p className="text-sm tabular-nums text-slate-200">{money(m.total)}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={Store} title="No merchants yet" />}
          </Card>
        </div>
      </div>
    </>
  );
}
