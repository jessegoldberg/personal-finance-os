import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Landmark, TrendingDown, Wallet, ShoppingBag, PiggyBank, CalendarClock, Sparkles, ArrowRight, Link2 } from 'lucide-react';
import type { PageProps } from '../App';
import { navigate } from '../App';
import { useApi } from '../hooks/useApi';
import type { Overview, Spending, Debt, AdvisorReport } from '../lib/api';
import { money, moneyCompact, monthLabel, categoryLabel, categoryColor, dateLabel, daysUntil, pct } from '../lib/format';
import { Card, CardHeader, Stat, Badge, Empty, PageHeader, ProgressBar, Spinner, chartTooltip, axisProps } from '../components/ui';
import { PlaidLinkButton } from '../components/PlaidLink';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard({ onDataChanged }: PageProps) {
  const { data: o, loading } = useApi<Overview>('/api/overview');
  const { data: spending } = useApi<Spending>('/api/spending?months=4');
  const { data: debts } = useApi<Debt[]>('/api/debts');
  const { data: advisor } = useApi<{ report: AdvisorReport | null }>('/api/advisor/latest');

  if (loading && !o) return <div className="flex justify-center py-24"><Spinner className="h-6 w-6 text-slate-500" /></div>;
  if (!o) return null;

  if (!o.hasData) {
    return (
      <>
        <PageHeader title="Welcome" subtitle="Connect your accounts to build your debt-free plan." />
        <Card>
          <Empty icon={Link2} title="Connect your first account"
            body="Link checking, savings and credit cards through Plaid. Your bank credentials go directly to Plaid — this app never sees them."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <PlaidLinkButton onLinked={onDataChanged}>Connect bank or card</PlaidLinkButton>
                <PlaidLinkButton mode="investments" className="btn-secondary" onLinked={onDataChanged}>Connect investments</PlaidLinkButton>
              </div>
            } />
        </Card>
      </>
    );
  }

  const month = new Date().toISOString().slice(0, 7);
  const categoryData = (spending?.byCategory ?? []).filter(c => c.thisMonth > 0).slice(0, 8);
  const topDebts = (debts ?? []).filter(d => d.balance > 0 && !d.hidden).slice(0, 5);
  const report = advisor?.report;

  return (
    <>
      <PageHeader title={greeting()} subtitle={`Here's where the household stands for ${monthLabel(month, true)}.`} />

      {report && (
        <button onClick={() => navigate('advisor')}
          className="card mb-6 flex w-full items-center gap-4 border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 via-ink-900 to-ink-900 p-4 text-left transition hover:border-emerald-500/40">
          <div className="rounded-xl bg-emerald-500/15 p-2.5"><Sparkles className="h-5 w-5 text-emerald-400" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-400/80">AI advisor · health score {Math.round(report.health_score)}</p>
            <p className="mt-0.5 truncate text-sm text-slate-200">{report.headline}</p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Net worth" value={money(o.netWorth)} icon={Landmark} tone={o.netWorth >= 0 ? 'default' : 'bad'}
          hint={`${money(o.cash)} cash · ${money(o.investments)} invested${o.homeValue ? ` · ${money(o.homeValue)} home` : ''}`} />
        <Stat label="Total debt" value={money(o.totalDebt)} icon={TrendingDown} tone="bad" hint={`~${money(o.monthlyInterest)}/mo in interest`} />
        <Stat label="Monthly income" value={money(o.monthlyIncome)} icon={Wallet}
          hint={o.incomeSource === 'entered' ? 'From your income sources' : o.incomeSource === 'detected' ? <a href="#/income" className="text-amber-400">Estimated from deposits — confirm →</a> : <a href="#/income" className="text-emerald-400">Add income →</a>} />
        <Stat label="Avg spending" value={money(o.avgMonthlySpending)} icon={ShoppingBag} hint={`${money(o.monthSpending)} so far this month`} />
        <Stat label="Monthly surplus" value={money(o.surplus)} icon={PiggyBank} tone={o.surplus >= 0 ? 'good' : 'bad'}
          hint={`After ${money(o.minPayments)} minimums${o.plannedMonthly ? ` + ${money(o.plannedMonthly)} saved for plans` : ''}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Cash flow" subtitle="Income deposits vs. spending (transfers and card payments excluded)" />
          <div className="h-72 px-2 pb-4 pt-4">
            <ResponsiveContainer>
              <BarChart data={o.cashflow.map(c => ({ ...c, label: monthLabel(c.month) }))} barGap={4}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={moneyCompact} width={60} />
                <Tooltip {...chartTooltip} formatter={(v: any) => money(v)} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                <Bar dataKey="income" name="Income" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="spending" name="Spending" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="This month by category" subtitle={money(o.monthSpending) + ' spent'}
            action={<a href="#/spending" className="text-xs text-emerald-400 hover:underline">Details</a>} />
          {categoryData.length ? (
            <div className="px-5 pb-5">
              <div className="h-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={categoryData} dataKey="thisMonth" nameKey="category" innerRadius="62%" outerRadius="95%" paddingAngle={2} stroke="none">
                      {categoryData.map((c, i) => <Cell key={c.category} fill={categoryColor(c.category, i)} />)}
                    </Pie>
                    <Tooltip {...chartTooltip} formatter={(v: any, n: any) => [money(v), categoryLabel(n)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 space-y-1.5">
                {categoryData.slice(0, 5).map((c, i) => (
                  <li key={c.category} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-300">
                      <span className="h-2 w-2 rounded-full" style={{ background: categoryColor(c.category, i) }} />
                      {categoryLabel(c.category)}
                    </span>
                    <span className="tabular-nums text-slate-400">{money(c.thisMonth)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <Empty icon={ShoppingBag} title="No spending yet this month" />}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Debts by interest rate" subtitle="Highest APR costs you the most — it's usually first in line"
            action={<a href="#/debt" className="text-xs text-emerald-400 hover:underline">Payoff plan</a>} />
          {topDebts.length ? (
            <ul className="divide-y divide-white/[0.05] px-5 pb-2 pt-2">
              {topDebts.map(d => (
                <li key={d.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{d.name}</p>
                      <p className="text-xs text-slate-500">
                        {d.apr != null ? `${pct(d.apr)} APR` : <span className="text-amber-400">APR unknown — add it</span>}
                        {d.next_due_date && ` · due ${dateLabel(d.next_due_date)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-100">{money(d.balance)}</p>
                      {d.credit_limit ? <p className="text-xs text-slate-500">{Math.round((d.balance / d.credit_limit) * 100)}% of {money(d.credit_limit)}</p> : null}
                    </div>
                  </div>
                  {d.credit_limit ? <div className="mt-2"><ProgressBar value={d.balance} max={d.credit_limit} /></div> : null}
                </li>
              ))}
            </ul>
          ) : <Empty icon={TrendingDown} title="No debts found" body="Link credit cards or add loans manually on the Debt Plan page." />}
        </Card>

        <Card>
          <CardHeader title="Coming up" subtitle="Next 14 days" />
          {o.upcoming.length ? (
            <ul className="space-y-1 px-3 pb-4 pt-3">
              {o.upcoming.map((u, i) => {
                const days = daysUntil(u.date);
                return (
                  <li key={i} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
                    <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-white/[0.04] text-[10px] leading-tight text-slate-400">
                      <span className="font-semibold text-slate-200">{dateLabel(u.date).split(' ')[1]}</span>
                      {dateLabel(u.date).split(' ')[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-200">{u.name}</p>
                      <p className="text-xs text-slate-500">{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm tabular-nums text-slate-300">{money(u.amount)}</p>
                      <Badge tone={u.kind === 'debt' ? 'warn' : 'default'}>{u.kind === 'debt' ? 'Payment' : 'Bill'}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon={CalendarClock} title="Nothing due soon" />}
        </Card>
      </div>
    </>
  );
}
