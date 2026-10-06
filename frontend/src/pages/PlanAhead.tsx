import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarHeart, Plus, Pencil, Trash2, Check, X, RefreshCw, Sparkles, Landmark, Home as HomeIcon, TrendingDown, TrendingUp, Minus, Clock, ExternalLink, Gift, Plane, Ship, Cake } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, runJob, PlannedData, PlannedItem, Outlook } from '../lib/api';
import { money, moneyCompact, monthLabel, dateLabel, pct, relativeTime } from '../lib/format';
import { Card, CardHeader, Badge, Empty, PageHeader, Spinner, ErrorNote, ProgressBar, Stat, chartTooltip, axisProps } from '../components/ui';

const CATEGORY_ICON: Record<string, any> = { holiday: Gift, birthday: Cake, travel: Plane, cruise: Ship, other: CalendarHeart };

function nextDate(month: number, day: number) {
  const now = new Date();
  let y = now.getFullYear();
  if (new Date(y, month - 1, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) y++;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const QUICK = [
  { label: 'Christmas', name: 'Christmas', category: 'holiday', event_date: nextDate(12, 25), recurring_yearly: 1 },
  { label: 'Birthday', name: '’s birthday', category: 'birthday', event_date: '', recurring_yearly: 1 },
  { label: 'Trip / flights', name: 'Flights', category: 'travel', event_date: '', recurring_yearly: 0 },
  { label: 'Cruise', name: 'Cruise', category: 'cruise', event_date: '', recurring_yearly: 0 },
];

type Form = { id?: string; name: string; category: string; event_date: string; due_date: string; amount: string; saved: string; recurring_yearly: number; people: string; notes: string };
const blank: Form = { name: '', category: 'other', event_date: '', due_date: '', amount: '', saved: '', recurring_yearly: 0, people: '', notes: '' };

function PlannedForm({ initial, onSaved, onCancel }: { initial: Form; onSaved: (d: PlannedData) => void; onCancel: () => void }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  return (
    <form className="grid gap-3 p-5 sm:grid-cols-6" onSubmit={async e => {
      e.preventDefault();
      try { onSaved(await api<PlannedData>('/api/planned', { body: f })); } catch (err: any) { setError(err.message); }
    }}>
      <div className="sm:col-span-2"><label className="label">What</label><input className="input" required autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Liam’s birthday" /></div>
      <div><label className="label">Type</label>
        <select className="input" value={f.category} onChange={set('category')}>
          <option value="holiday">Holiday</option><option value="birthday">Birthday</option><option value="travel">Trip / flights</option>
          <option value="cruise">Cruise</option><option value="other">Other</option>
        </select>
      </div>
      <div><label className="label">Date</label><input className="input" type="date" required value={f.event_date} onChange={set('event_date')} /></div>
      <div><label className="label">Money needed by</label><input className="input" type="date" value={f.due_date} onChange={set('due_date')} title="e.g. final cruise payment or when you'll book flights" /></div>
      <label className="flex items-end gap-2 pb-2 text-sm text-slate-300"><input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={!!f.recurring_yearly} onChange={set('recurring_yearly')} />Every year</label>
      <div><label className="label">Budget</label><input className="input" type="number" step="1" value={f.amount} onChange={set('amount')} placeholder="0 = AI estimate" /></div>
      <div><label className="label">Already saved/paid</label><input className="input" type="number" step="1" value={f.saved} onChange={set('saved')} /></div>
      <div><label className="label">People</label><input className="input" type="number" min={1} value={f.people} onChange={set('people')} placeholder="for trips" /></div>
      <div className="sm:col-span-3"><label className="label">Notes</label><input className="input" value={f.notes} onChange={set('notes')} placeholder="e.g. TPA → GCM round trip, 2 adults 3 kids" /></div>
      <div className="flex items-center gap-2 sm:col-span-6">
        <button className="btn-primary"><Check className="h-4 w-4" /> Save</button>
        <button type="button" className="btn-ghost" onClick={onCancel}><X className="h-4 w-4" /> Cancel</button>
        <ErrorNote error={error} />
      </div>
    </form>
  );
}

function toForm(i: PlannedItem): Form {
  return { id: i.id, name: i.name, category: i.category, event_date: i.event_date, due_date: i.due_date ?? '', amount: i.amount ? String(i.amount) : '',
    saved: i.saved ? String(i.saved) : '', recurring_yearly: i.recurring_yearly, people: i.people ? String(i.people) : '', notes: i.notes ?? '' };
}

function LifeCalendar() {
  const { data, setData } = useApi<PlannedData>('/api/planned');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Form>(blank);
  const items = (data?.items ?? []).filter(i => !i.past);
  const t = data?.totals;

  const saved = (d: PlannedData) => { setData(d); setEditing(null); };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Set aside each month" value={money(t?.monthly_set_aside)} icon={CalendarHeart} tone="good" hint="Comes out before extra debt payments" />
        <Stat label="Next 12 months" value={money(t?.next_12_months)} hint={`${items.length} planned events`} />
        <Stat label="Still to save" value={money(t?.still_to_save)} hint={t?.missing_amounts.length ? <span className="text-amber-400">{t.missing_amounts.length} need a budget</span> : 'All budgets entered'} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader title="When the money is needed" subtitle="Plan big debt lump sums around the tall bars" />
          <div className="h-64 px-2 pb-4 pt-4">
            <ResponsiveContainer>
              <BarChart data={(t?.by_month ?? []).map(m => ({ ...m, label: monthLabel(m.month) }))}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={moneyCompact} width={55} />
                <Tooltip {...chartTooltip} formatter={(v: any, _n: any, p: any) => [money(v), p.payload.items.join(', ') || 'Nothing planned']} />
                <Bar dataKey="amount" fill="#f472b6" radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-3">
          <CardHeader title="Life calendar" subtitle="Holidays, birthdays and trips you've committed to"
            action={<button className="btn-secondary" onClick={() => { setDraft(blank); setEditing('new'); }}><Plus className="h-4 w-4" /> Add</button>} />
          <div className="flex flex-wrap gap-2 px-5 pt-3">
            {QUICK.map(q => (
              <button key={q.label} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300 hover:bg-white/[0.07]"
                onClick={() => { setDraft({ ...blank, name: q.name, category: q.category, event_date: q.event_date, recurring_yearly: q.recurring_yearly }); setEditing('new'); }}>
                + {q.label}
              </button>
            ))}
          </div>
          {editing === 'new' && <div className="mt-3 border-y border-white/[0.06] bg-white/[0.02]"><PlannedForm key={draft.name + draft.category} initial={draft} onSaved={saved} onCancel={() => setEditing(null)} /></div>}
          {items.length ? (
            <ul className="mt-2 divide-y divide-white/[0.04]">
              {items.map(i => {
                const Icon = CATEGORY_ICON[i.category] ?? CalendarHeart;
                if (editing === i.id) return <li key={i.id} className="bg-white/[0.02]"><PlannedForm initial={toForm(i)} onSaved={saved} onCancel={() => setEditing(null)} /></li>;
                return (
                  <li key={i.id} className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-pink-500/10 p-2"><Icon className="h-4 w-4 text-pink-300" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200">{i.name}{i.recurring_yearly ? <span className="ml-2 text-[11px] text-slate-500">yearly</span> : null}</p>
                        <p className="text-xs text-slate-500">{dateLabel(i.next_event_date)} '{i.next_event_date.slice(2, 4)}
                          {i.next_due_date !== i.next_event_date && ` · money needed by ${dateLabel(i.next_due_date)}`}{i.notes && ` · ${i.notes}`}</p>
                      </div>
                      <div className="text-right">
                        {i.amount ? <p className="text-sm font-semibold tabular-nums text-slate-100">{money(i.amount)}</p> : <Badge tone="warn">Needs budget</Badge>}
                        {i.monthly_set_aside > 0 && <p className="text-xs text-pink-300">{money(i.monthly_set_aside)}/mo × {i.months_to_save}</p>}
                      </div>
                      <div className="flex gap-1">
                        <button className="btn-ghost p-1.5" onClick={() => setEditing(i.id)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                        <button className="btn-ghost p-1.5 hover:text-rose-400" aria-label="Delete" onClick={async () => setData(await api<PlannedData>(`/api/planned/${i.id}`, { method: 'DELETE' }))}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                    {i.amount > 0 && <div className="ml-11 mt-2"><ProgressBar value={i.saved} max={i.amount} tone="good" /></div>}
                    {i.estimate && (
                      <div className="ml-11 mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-sky-500/[0.06] px-3 py-2 text-xs text-sky-100/80">
                        <Sparkles className="h-3.5 w-3.5 text-sky-400" />
                        <span>AI estimate <span className="font-semibold text-sky-200">{money(i.estimate.typical_cost)}</span> · best time: {i.estimate.best_time_to_buy}. {i.estimate.tips}</span>
                        {!i.amount && <button className="btn-secondary ml-auto px-2 py-1 text-xs" onClick={async () => setData(await api<PlannedData>('/api/planned', { body: { ...toForm(i), amount: Math.round(i.estimate!.typical_cost) } }))}>Use estimate</button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : editing !== 'new' && <Empty icon={CalendarHeart} title="Nothing planned yet" body="Add Christmas, birthdays and trips so the plan saves for them instead of treating them as surprises." />}
        </Card>
      </div>
    </>
  );
}

const DIRECTION = { falling: { icon: TrendingDown, tone: 'good' as const }, rising: { icon: TrendingUp, tone: 'bad' as const }, flat: { icon: Minus, tone: 'default' as const }, uncertain: { icon: Minus, tone: 'warn' as const } };

function MarketOutlook() {
  const { data, setData } = useApi<{ outlook: Outlook | null }>('/api/outlook');
  const { data: health } = useApi<{ ai: boolean }>('/api/health');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = data?.outlook;

  const refresh = async () => {
    setRunning(true);
    setError(null);
    try { setData(await runJob('/api/outlook/refresh')); } catch (e: any) { setError(e.message); } finally { setRunning(false); }
  };

  const dir = o ? DIRECTION[o.mortgage.direction] : null;

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-50">Rates & market timing</h2>
          <p className="text-sm text-slate-400">{o ? `Researched ${relativeTime(o.created_at.replace('T', ' ').slice(0, 19))} · refreshes automatically each week when you rebuild your plan` : 'Fed, mortgage and local housing outlook — translated into your dollars'}</p>
        </div>
        <button className="btn-primary" onClick={refresh} disabled={running || health?.ai === false}>
          {running ? <Spinner /> : o ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {running ? 'Researching (1–3 min)…' : o ? 'Refresh outlook' : 'Research outlook'}
        </button>
      </div>
      <div className="mb-4"><ErrorNote error={error} /></div>

      {!o ? (
        <Card><Empty icon={Landmark} title={running ? 'Reading the Fed calendar, futures pricing and forecasts…' : 'No outlook yet'} body="Pulls FOMC dates and market odds, mortgage-rate forecasts, your local housing forecast and the best listing season, then works out what each means for your HELOC, cards and a possible move." /></Card>
      ) : (
        <div className="space-y-4">
          <Card className="border-sky-500/20 bg-gradient-to-r from-sky-500/[0.07] to-ink-900 p-5"><p className="text-base font-medium text-slate-100">{o.headline}</p></Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Landmark className="h-4 w-4 text-sky-400" /> Federal Reserve</p>
              <p className="mt-2 text-xs text-slate-500">Target {o.fed.current_target_range} · Prime {pct(o.fed.prime_rate)}</p>
              <p className="mt-2 text-sm text-slate-400">{o.fed.path_summary}</p>
              <ul className="mt-3 space-y-2">
                {o.fed.meetings.map((m, i) => (
                  <li key={i} className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <div className="flex justify-between gap-2"><span className="font-medium text-slate-200">{m.date}</span><span className="text-sky-300">{m.expectation}</span></div>
                    <p className="text-slate-500">{m.market_odds}</p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Landmark className="h-4 w-4 text-emerald-400" /> Mortgage rates</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="text-2xl font-semibold text-white">{pct(o.mortgage.current_30yr)}</span><span className="text-xs text-slate-500">30-yr · {pct(o.mortgage.current_15yr)} 15-yr</span>
                {dir && <Badge tone={dir.tone}><dir.icon className="h-3 w-3" /> {o.mortgage.direction}</Badge>}
              </div>
              <p className="mt-2 text-sm text-slate-400">{o.mortgage.summary}</p>
              <ul className="mt-3 space-y-1 text-xs">
                {o.mortgage.forecasts.map((f, i) => (
                  <li key={i} className="flex justify-between gap-2"><span className="text-slate-500">{f.source} · {f.period}</span><span className="tabular-nums text-slate-200">{pct(f.rate_30yr)}</span></li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-200"><HomeIcon className="h-4 w-4 text-violet-400" /> {o.housing.market}</p>
              <p className="mt-2 text-sm text-slate-400">{o.housing.summary}</p>
              <ul className="mt-3 space-y-1 text-xs">
                {o.housing.forecasts.map((f, i) => (
                  <li key={i} className="flex justify-between gap-2"><span className="text-slate-500">{f.source} · {f.period}</span>
                    <span className={`tabular-nums ${f.change_pct < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{f.change_pct > 0 ? '+' : ''}{f.change_pct}%</span></li>
                ))}
              </ul>
              <dl className="mt-3 space-y-1.5 text-xs">
                <div><dt className="text-slate-500">Best months to list</dt><dd className="text-slate-200">{o.housing.best_months_to_list}</dd></div>
                <div><dt className="text-slate-500">Inventory</dt><dd className="text-slate-300">{o.housing.inventory_and_days_on_market}</dd></div>
                <div><dt className="text-slate-500">Insurance & taxes</dt><dd className="text-slate-300">{o.housing.insurance_and_tax_trends}</dd></div>
              </dl>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={<span className="flex items-center gap-2"><Clock className="h-4 w-4 text-amber-400" /> Timing windows</span>} subtitle="When rate-sensitive moves make the most sense for your family" />
              <ul className="space-y-3 p-5">
                {o.timing.map((t, i) => (
                  <li key={i} className="rounded-xl border border-white/[0.06] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-100">{t.decision}</p>
                      <Badge tone={t.confidence === 'high' ? 'good' : t.confidence === 'medium' ? 'warn' : 'default'}>{t.confidence}</Badge>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-amber-300">{t.window}</p>
                    <p className="mt-1 text-sm text-slate-400">{t.rationale}</p>
                    <p className="mt-2 text-xs text-slate-500"><span className="text-slate-400">Watch for:</span> {t.watch_for}</p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="What it means in dollars" subtitle="Estimated change to your monthly costs" />
              <ul className="divide-y divide-white/[0.04] px-5 pb-3 pt-2">
                {o.impacts.map((m, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-200">{m.item}</p>
                      <p className="text-xs text-slate-400">{m.effect}</p>
                      <p className="text-[11px] text-slate-500">{m.when}</p>
                    </div>
                    <p className={`shrink-0 text-sm font-semibold tabular-nums ${m.monthly_dollars < 0 ? 'text-emerald-400' : m.monthly_dollars > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                      {m.monthly_dollars < 0 ? '−' : m.monthly_dollars > 0 ? '+' : ''}{money(Math.abs(m.monthly_dollars))}/mo
                    </p>
                  </li>
                ))}
              </ul>
              {o.sources.length > 0 && (
                <div className="border-t border-white/[0.06] px-5 py-3">
                  <p className="mb-1 text-xs font-medium text-slate-500">Sources</p>
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {o.sources.slice(0, 12).map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-400 hover:underline">{s.title}<ExternalLink className="h-3 w-3" /></a></li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>
          <p className="text-center text-xs text-slate-600">Forecasts and futures pricing change often and are frequently wrong. Use them to plan, not to bet.</p>
        </div>
      )}
    </div>
  );
}

export default function PlanAhead(_: PageProps) {
  return (
    <>
      <PageHeader title="Plan Ahead" subtitle="Life happens on a calendar. Save for it on purpose, and time the big money moves around it." />
      <LifeCalendar />
      <MarketOutlook />
    </>
  );
}
