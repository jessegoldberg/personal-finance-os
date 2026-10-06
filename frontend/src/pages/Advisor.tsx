import { useEffect, useRef, useState } from 'react';
import { Sparkles, AlertTriangle, Scissors, Target, CalendarCheck, Send, HelpCircle, Check, RefreshCw } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, runJob, AdvisorReport } from '../lib/api';
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

function Chat() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next = [...messages, { role: 'user' as const, content: text.trim() }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const { reply } = await runJob<{ reply: string }>('/api/advisor/chat', { messages: next });
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader title="Ask your advisor" subtitle="Answers use your live balances, debts, income and spending" />
      <div className="max-h-[480px] min-h-[180px] flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {!messages.length && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.07]">{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === 'user' ? 'bg-emerald-500/15 text-emerald-50' : 'bg-white/[0.04] text-slate-200'}`}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Thinking through your numbers…</div>}
        <ErrorNote error={error} />
        <div ref={endRef} />
      </div>
      <form className="flex gap-2 border-t border-white/[0.06] p-3" onSubmit={e => { e.preventDefault(); send(input); }}>
        <input className="input" placeholder="Ask anything about your money…" value={input} onChange={e => setInput(e.target.value)} />
        <button className="btn-primary" disabled={busy || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
      </form>
    </Card>
  );
}

export default function Advisor(_: PageProps) {
  const { data, reload, setData } = useApi<{ report: AdvisorReport | null }>('/api/advisor/latest');
  const { data: health } = useApi<{ ai: boolean }>('/api/health');
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
      <PageHeader title="AI Advisor" subtitle="A plan built from your real accounts — exactly where each dollar should go."
        actions={
          <button className="btn-primary" onClick={analyze} disabled={running || health?.ai === false}>
            {running ? <Spinner /> : report ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {running ? 'Analyzing (about a minute)…' : report ? 'Rebuild plan' : 'Build my plan'}
          </button>
        } />

      {health?.ai === false && (
        <div className="mb-4"><ErrorNote error="ANTHROPIC_API_KEY isn't set on the server. Add it to .env on hermes and restart the container." /></div>
      )}
      <div className="mb-4"><ErrorNote error={error} /></div>

      {!report ? (
        <Card>
          <Empty icon={Sparkles} title={running ? 'Reviewing every account, debt and transaction…' : 'No plan yet'}
            body="The advisor reviews balances, APRs, due dates, income and 4 months of spending, then produces a dated action plan, spending cuts and budgets." />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <ScoreRing score={report.health_score} />
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
            </Card>
            <Card className="p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500">Interest saved</p>
              <p className="mt-2 text-xl font-semibold text-emerald-400">{money(report.strategy.interest_saved_vs_minimums)}</p>
            </Card>
          </div>
          <p className="px-1 text-sm text-slate-400">{report.strategy.rationale}</p>

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
