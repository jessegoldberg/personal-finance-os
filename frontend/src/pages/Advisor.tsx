import { useEffect, useRef, useState } from 'react';
import { Sparkles, AlertTriangle, Scissors, Target, CalendarCheck, Send, HelpCircle, Check, RefreshCw, Home as HomeIcon, Cpu } from 'lucide-react';
import { DebtActionPlan } from '../components/DebtActionPlan';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, runJob, AdvisorReport, LocalStatus, localReady } from '../lib/api';
import { money, categoryLabel, monthLabel, relativeTime } from '../lib/format';
import { Card, CardHeader, Badge, Empty, PageHeader, Spinner, ErrorNote } from '../components/ui';

function ScoreRing({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score));
  const color = s >= 70 ? '#10b981' : s >= 45 ? '#f59e0b' : '#f43f5e';
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - s / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold text-white">{Math.round(s)}</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">health</span>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'Where should my next paycheck go?',
  'Should I pay a card mid-month this cycle?',
  'How much should I set aside for taxes on the side gig?',
  'What happens if I put an extra $300/month toward debt?',
];

type ChatMessage = { role: 'user' | 'assistant'; content: string; provider?: 'local' | 'claude' };

function Chat() {
  const { data: budget } = useApi<{enabled:boolean;reason:string}>('/api/ai/budget');
  const { data: local } = useApi<LocalStatus>('/api/ai/local/status');
  const [mode, setMode] = useState<'local' | 'claude' | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'local' | 'claude' | null>(null);
  const [error, setError] = useState<{ message: string; text: string; provider: 'local' | 'claude' } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const canLocal = localReady(local);
  const active = mode ?? 'local';

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy]);

  // The user picks the provider; a local failure never silently falls through to the paid API.
  const send = async (text: string, provider = active) => {
    if (!text.trim() || busy) return;
    if (provider === 'claude' && !budget?.enabled) { setError({message:budget?.reason ?? 'Paid analysis is paused.',text,provider}); return; }
    const next = [...messages, { role: 'user' as const, content: text.trim() }];
    setMessages(next);
    setInput('');
    setBusy(provider);
    setError(null);
    try {
      const path = provider === 'local' ? '/api/ai/local/chat' : '/api/advisor/chat';
      const { reply } = await runJob<{ reply: string }>(path, { messages: next.map(({ role, content }) => ({ role, content })) });
      setMessages([...next, { role: 'assistant', content: reply, provider }]);
    } catch (e: any) {
      // Preserve the user's question so nothing is lost.
      setMessages(messages);
      setInput(text);
      setError({ message: e.message, text, provider });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader title="Ask your advisor" subtitle="Answers use your live balances, debts, income and spending"
        action={
          <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
            <button disabled={!canLocal} onClick={() => setMode('local')} title={canLocal ? 'Runs on your own server — no API cost' : (local?.error ?? 'Local model not configured')}
              className={`rounded-md px-2.5 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-40 ${active === 'local' ? 'bg-white/10 text-white' : 'text-slate-400'}`}>
              <Cpu className="mr-1 inline h-3 w-3" />Quick · local
            </button>
            <button disabled={!budget?.enabled} onClick={() => setMode('claude')} title="Full analysis with Claude (uses API credits)"
              className={`rounded-md px-2.5 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-40 ${active === 'claude' ? 'bg-white/10 text-white' : 'text-slate-400'}`}>
              <Sparkles className="mr-1 inline h-3 w-3" />Deep · Claude
            </button>
          </div>
        } />
      <div className="max-h-[480px] min-h-[180px] flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {!messages.length && (
          <>
            <p className="text-xs text-slate-500">
              {active === 'local'
                ? 'Quick answers from a summary of your numbers, on your own server — free, ~30–60 seconds. Use Deep for planning questions.'
                : 'Full analysis of every account and your latest plan, using Claude API credits.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.07]">{s}</button>
              ))}
            </div>
          </>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === 'user' ? 'bg-emerald-500/15 text-emerald-50' : 'bg-white/[0.04] text-slate-200'}`}>{m.content}</div>
            {m.provider && <span className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{m.provider === 'local' ? `local · ${local?.model ?? ''}` : 'claude'}</span>}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner />
            {busy === 'local' ? 'Local model is working — usually 30–60 seconds…' : 'Thinking through your numbers…'}
          </div>
        )}
        {error && (
          <div className="space-y-2">
            <ErrorNote error={error.message} />
            {error.provider === 'local' && budget?.enabled && (
              <button className="btn-secondary text-xs" onClick={() => { setMode('claude'); send(error.text, 'claude'); }}>
                <Sparkles className="h-3.5 w-3.5" /> Ask Claude instead (uses API credits)
              </button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form className="flex gap-2 border-t border-white/[0.06] p-3" onSubmit={e => { e.preventDefault(); send(input); }}>
        <input className="input" placeholder={active === 'local' ? 'Quick question about your money…' : 'Ask anything about your money…'} value={input} onChange={e => setInput(e.target.value)} />
        <button className="btn-primary" disabled={!!busy || !input.trim() || (active==='local' ? !canLocal : !budget?.enabled)} aria-label="Send"><Send className="h-4 w-4" /></button>
      </form>
    </Card>
  );
}

export default function Advisor({version}: PageProps) {
  const { data, reload, setData } = useApi<{ report: AdvisorReport | null }>('/api/advisor/latest');
  const { data: budget } = useApi<{enabled:boolean;reason:string;monthly_limit:number;remaining:number}>('/api/ai/budget');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const report = data?.report;

  const analyze = async () => {
    setRunning(true);
    setError(null);
    try {
      setData(await runJob('/api/advisor/analyze'));
    } catch (e: any) {
      setError(e.message);
      reload();
    } finally {
      setRunning(false);
    }
  };

  const applyBudget = async (category: string, limit: number) => {
    await api(`/api/budgets/${encodeURIComponent(category)}`, { method: 'PUT', body: { monthly_limit: limit } });
    setApplied(s => new Set(s).add(category));
  };

  const totalCuts = report?.spending_cuts.reduce((s, c) => s + c.monthly_savings, 0) ?? 0;

  return (
    <>
      <PageHeader title="Debt strategy & advisor" subtitle="A calculated plan first, with optional paid reasoning under a fixed allowance."
        actions={
          <button className="btn-primary disabled:cursor-not-allowed disabled:opacity-40" onClick={analyze} disabled={running || !budget?.enabled}>
            {running ? <Spinner /> : report ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {running ? 'Analyzing (about a minute)…' : report ? 'Update paid analysis' : 'Optional paid analysis'}
          </button>
        } />

      <DebtActionPlan version={version}/>
      {!budget?.enabled && <p className="mb-4 rounded-lg border border-white/10 p-3 text-sm text-slate-400">{budget?.reason ?? 'Checking paid-analysis allowance…'} Existing AI reports below are saved historical analysis; use the calculated plan above for current numbers.</p>}
      <div className="mb-4"><ErrorNote error={error} /></div>

      {!report ? (
        budget?.enabled || running ? <Card>
          <Empty icon={Sparkles} title={running ? 'Reviewing your calculated debt brief…' : 'No paid analysis yet'}
            body="The calculated debt action plan above works without credits. Optional paid analysis is available only when the app has an allowance and the planning data checks pass." />
        </Card> : null
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {report.health_score != null && <ScoreRing score={report.health_score} />}
              <div className="flex-1">
                <p className="text-lg font-semibold text-white">{report.headline}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{report.summary}</p>
                <p className="mt-2 text-xs text-slate-600">Generated {relativeTime(report.created_at)}</p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500">Strategy</p>
              <p className="mt-2 text-xl font-semibold capitalize text-white">{report.strategy.method}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500">Debt-free by</p>
              <p className="mt-2 text-xl font-semibold text-emerald-400">{report.strategy.debt_free_date ? monthLabel(report.strategy.debt_free_date, true) : '—'}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500">Extra toward debt</p>
              <p className="mt-2 text-xl font-semibold text-white">{money(report.recommended_extra_payment)}<span className="text-sm text-slate-500">/mo</span></p>
              {report.monthly_set_aside_for_life_events ? <p className="mt-1 text-xs text-slate-500">plus {money(report.monthly_set_aside_for_life_events)}/mo saved for life events</p> : null}
            </Card>
            <Card className="p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500">Interest saved</p>
              <p className="mt-2 text-xl font-semibold text-emerald-400">{report.health_score===null?'Not calculated':money(report.strategy.interest_saved_vs_minimums)}</p>
            </Card>
          </div>
          <p className="px-1 text-sm text-slate-400">{report.strategy.rationale}</p>

          {report.home_options && report.home_options.length > 0 && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-2"><HomeIcon className="h-4 w-4 text-violet-400" /> Home options</span>}
                subtitle="Stay, borrow against the house, or sell — compared on total monthly payments, not just interest rates" />
              <div className="grid gap-px overflow-hidden rounded-b-2xl bg-white/[0.06] mt-4 md:grid-cols-2 xl:grid-cols-3">
                {report.home_options.map((h, i) => {
                  const tone = h.verdict === 'recommended' ? 'good' : h.verdict === 'worth_exploring' ? 'info' : h.verdict === 'not_now' ? 'warn' : 'bad';
                  return (
                    <div key={i} className="bg-ink-900 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-100">{h.option}</p>
                        <Badge tone={tone}>{h.verdict.replace('_', ' ')}</Badge>
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div><dt className="text-slate-500">Monthly</dt><dd className={`text-sm font-semibold ${h.monthly_outflow_change < 0 ? 'text-emerald-400' : h.monthly_outflow_change > 0 ? 'text-rose-400' : 'text-slate-200'}`}>
                          {h.monthly_outflow_change < 0 ? '−' : h.monthly_outflow_change > 0 ? '+' : ''}{money(Math.abs(h.monthly_outflow_change))}</dd></div>
                        <div><dt className="text-slate-500">Cash left</dt><dd className="text-sm font-semibold text-slate-200">{money(h.cash_left_after)}</dd></div>
                        <div><dt className="text-slate-500">Other debt</dt><dd className="text-sm font-semibold text-slate-200">{money(h.consumer_debt_after)}</dd></div>
                      </dl>
                      <p className="mt-3 text-sm text-slate-400">{h.summary}</p>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                        <ul className="space-y-1 text-emerald-200/80">{h.pros.map((p, j) => <li key={j}>+ {p}</li>)}</ul>
                        <ul className="space-y-1 text-rose-200/80">{h.cons.map((c, j) => <li key={j}>− {c}</li>)}</ul>
                      </div>
                      <p className="mt-3 border-t border-white/[0.06] pt-2 text-xs text-slate-300"><span className="text-slate-500">Next step:</span> {h.next_step}</p>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {report.warnings.length > 0 && (
            <Card className="border-amber-500/20 bg-amber-500/[0.04] p-5">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Watch out</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100/80">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader title={<span className="flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-emerald-400" /> Action plan</span>}
                subtitle="Do these in order" />
              <ol className="relative mx-5 my-4 border-l border-white/[0.08]">
                {report.action_plan.map((a, i) => (
                  <li key={i} className="mb-5 ml-5 last:mb-1">
                    <span className="absolute -left-[9px] mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-ink-950">{i + 1}</span>
                    <p className="text-xs font-medium text-emerald-400/90">{a.when}</p>
                    <p className="mt-0.5 text-sm font-medium text-slate-100">{a.action}</p>
                    {(a.from_account || a.to_account) && (
                      <p className="mt-1 text-xs text-slate-500">{a.from_account ?? '—'} → {a.to_account ?? '—'}{a.amount != null && ` · ${money(a.amount, true)}`}</p>
                    )}
                    <p className="mt-1 text-sm text-slate-400">{a.why}</p>
                    {a.estimated_monthly_savings ? <div className="mt-1.5"><Badge tone="good">Saves ~{money(a.estimated_monthly_savings)}/mo</Badge></div> : null}
                  </li>
                ))}
              </ol>
            </Card>

            <div className="space-y-4 xl:col-span-2">
              <Card>
                <CardHeader title={<span className="flex items-center gap-2"><Scissors className="h-4 w-4 text-rose-400" /> What to cut</span>}
                  subtitle={`Frees up about ${money(totalCuts)}/month`} />
                <ul className="divide-y divide-white/[0.05] px-5 pb-3 pt-2">
                  {report.spending_cuts.map((c, i) => (
                    <li key={i} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium text-slate-200">{c.target}</p>
                        <p className="shrink-0 text-sm font-semibold text-emerald-400">+{money(c.monthly_savings)}</p>
                      </div>
                      <p className="text-xs text-slate-500">{money(c.current_monthly)} → {money(c.suggested_monthly)} / month</p>
                      <p className="mt-1 text-xs text-slate-400">{c.reason}</p>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader title={<span className="flex items-center gap-2"><Target className="h-4 w-4 text-sky-400" /> Suggested budgets</span>}
                  subtitle="Apply to track them on the Spending page" />
                <ul className="divide-y divide-white/[0.05] px-5 pb-3 pt-2">
                  {report.budget_suggestions.map(b => (
                    <li key={b.category} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-200">{categoryLabel(b.category)} · <span className="font-semibold">{money(b.monthly_limit)}</span></p>
                        <p className="text-xs text-slate-500">{b.reason}</p>
                      </div>
                      <button className="btn-secondary px-2.5 py-1.5 text-xs" disabled={applied.has(b.category)}
                        onClick={() => applyBudget(b.category, b.monthly_limit)}>
                        {applied.has(b.category) ? <><Check className="h-3.5 w-3.5" /> Set</> : 'Apply'}
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>

              {report.missing_data.length > 0 && (
                <Card className="p-5">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200"><HelpCircle className="h-4 w-4 text-slate-400" /> Would sharpen the plan</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-400">{report.missing_data.map((m, i) => <li key={i}>{m}</li>)}</ul>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4"><Chat /></div>
      <p className="mt-4 text-center text-xs text-slate-600">AI-generated guidance based on your data — not a licensed financial advisor. Double-check amounts before moving money.</p>
    </>
  );
}
