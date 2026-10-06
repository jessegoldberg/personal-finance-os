import { useEffect, useMemo, useState } from 'react';
import { Home as HomeIcon, Sparkles, RefreshCw, Pencil, Check, X, ExternalLink, AlertTriangle, TrendingUp, Scale } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, runJob, Debt, HomeSummary } from '../lib/api';
import { money, moneyCompact, pct, dateLabel, relativeTime } from '../lib/format';
import { Card, CardHeader, Badge, Empty, PageHeader, Spinner, ErrorNote } from '../components/ui';

// ---------- amortization helpers ----------
function payment(principal: number, apr: number, months: number) {
  if (principal <= 0) return 0;
  const r = apr / 1200;
  return r === 0 ? principal / months : principal * r / (1 - Math.pow(1 + r, -months));
}

function payoff(balance: number, apr: number, pmt: number): { months: number; interest: number } | null {
  if (balance <= 0) return { months: 0, interest: 0 };
  const r = apr / 1200;
  if (pmt <= balance * r) return null;
  const months = r === 0 ? balance / pmt : -Math.log(1 - balance * r / pmt) / Math.log(1 + r);
  return { months: Math.ceil(months), interest: Math.max(0, pmt * months - balance) };
}

const yrs = (m: number | null) => (m == null ? 'Never at this payment' : m < 12 ? `${m} mo` : `${(m / 12).toFixed(1)} yrs`);

// ---------- setup form ----------
function HomeForm({ summary, debts, onSaved, onCancel }: { summary: HomeSummary | null; debts: Debt[]; onSaved: () => void; onCancel?: () => void }) {
  const h = summary?.home;
  const securedDefault = debts.filter(d => /mortgage|home|heloc/i.test(`${d.kind} ${d.name}`)).map(d => d.id);
  const [f, setF] = useState({
    address: h?.address ?? '', property_type: h?.property_type ?? 'Single Family', bedrooms: h?.bedrooms?.toString() ?? '', bathrooms: h?.bathrooms?.toString() ?? '',
    sqft: h?.sqft?.toString() ?? '', year_built: h?.year_built?.toString() ?? '', purchase_price: h?.purchase_price?.toString() ?? '',
    purchase_date: h?.purchase_date ?? '', condition: h?.condition ?? 'good', notes: h?.notes ?? '', manual_value: h?.manual_value?.toString() ?? '',
  });
  const [secured, setSecured] = useState<string[]>(h ? JSON.parse(h.debt_ids || '[]') : securedDefault);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <form className="grid gap-3 p-5 sm:grid-cols-6" onSubmit={async e => {
      e.preventDefault();
      try { await api('/api/home', { method: 'PUT', body: { ...f, debt_ids: secured } }); onSaved(); } catch (err: any) { setError(err.message); }
    }}>
      <div className="sm:col-span-4"><label className="label">Address</label><input className="input" required value={f.address} onChange={set('address')} placeholder="123 Main St, Columbus, OH 43215" /></div>
      <div className="sm:col-span-2"><label className="label">Type</label>
        <select className="input" value={f.property_type} onChange={set('property_type')}>
          {['Single Family', 'Condo', 'Townhouse', 'Multi-Family', 'Manufactured'].map(t => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div><label className="label">Beds</label><input className="input" type="number" step="1" value={f.bedrooms} onChange={set('bedrooms')} placeholder="auto" /></div>
      <div><label className="label">Baths</label><input className="input" type="number" step="0.5" value={f.bathrooms} onChange={set('bathrooms')} placeholder="auto" /></div>
      <div><label className="label">Finished sq ft</label><input className="input" type="number" value={f.sqft} onChange={set('sqft')} placeholder="auto" /></div>
      <div><label className="label">Year built</label><input className="input" type="number" value={f.year_built} onChange={set('year_built')} placeholder="auto" /></div>
      <div><label className="label">Purchase price</label><input className="input" type="number" value={f.purchase_price} onChange={set('purchase_price')} /></div>
      <div><label className="label">Purchase date</label><input className="input" type="date" value={f.purchase_date} onChange={set('purchase_date')} /></div>
      <div className="sm:col-span-2"><label className="label">Condition</label>
        <select className="input" value={f.condition} onChange={set('condition')}>
          <option value="excellent">Excellent — updated, move-in ready</option>
          <option value="good">Good — well kept, some dated areas</option>
          <option value="fair">Fair — needs cosmetic work</option>
          <option value="needs work">Needs work — repairs required</option>
        </select>
      </div>
      <div className="sm:col-span-4"><label className="label">Upgrades or issues an appraiser should know</label>
        <input className="input" value={f.notes} onChange={set('notes')} placeholder="e.g. New roof 2023, finished basement, kitchen remodel; original windows" /></div>
      <div className="sm:col-span-6">
        <label className="label">Debts secured by this home</label>
        <div className="flex flex-wrap gap-2">
          {debts.filter(d => d.balance > 0).map(d => (
            <label key={d.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${secured.includes(d.id) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-white/10 text-slate-400'}`}>
              <input type="checkbox" className="accent-emerald-500" checked={secured.includes(d.id)}
                onChange={e => setSecured(e.target.checked ? [...secured, d.id] : secured.filter(x => x !== d.id))} />
              {d.name} · {money(d.balance)}
            </label>
          ))}
          {!debts.length && <p className="text-xs text-slate-500">Add your mortgage and HELOC on the Accounts page (Accounts Plaid can't connect) first.</p>}
        </div>
      </div>
      <div className="sm:col-span-2"><label className="label">Override value (optional)</label><input className="input" type="number" value={f.manual_value} onChange={set('manual_value')} placeholder="Use the estimate" /></div>
      <div className="flex items-end gap-2 sm:col-span-4">
        <button className="btn-primary"><Check className="h-4 w-4" /> Save home</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}><X className="h-4 w-4" /> Cancel</button>}
        <ErrorNote error={error} />
      </div>
    </form>
  );
}

// ---------- valuation range strip ----------
function SourceStrip({ s }: { s: HomeSummary }) {
  const v = s.valuation!;
  const points = [
    ...(v.rentcast ? [{ label: 'RentCast AVM', value: v.rentcast.price }] : []),
    ...v.public_estimates.map(p => ({ label: p.source, value: p.value })),
    ...(v.subject.county_appraised_value ? [{ label: `County appraisal${v.subject.county_appraisal_year ? ` (${v.subject.county_appraisal_year})` : ''}`, value: v.subject.county_appraised_value }] : []),
    ...(v.ppsf_check ? [{ label: `$/sq ft of ${v.ppsf_check.comps_used} comps`, value: v.ppsf_check.implied_value }] : []),
  ];
  const all = [...points.map(p => p.value), v.estimate.low, v.estimate.high];
  const lo = Math.min(...all) * 0.97, hi = Math.max(...all) * 1.03;
  const x = (n: number) => `${((n - lo) / (hi - lo)) * 100}%`;

  return (
    <div className="px-5 pb-5">
      <div className="relative mt-8 h-2 rounded-full bg-white/[0.06]">
        <div className="absolute h-2 rounded-full bg-emerald-500/30" style={{ left: x(v.estimate.low), width: `calc(${x(v.estimate.high)} - ${x(v.estimate.low)})` }} />
        <div className="absolute -top-1.5 h-5 w-1 rounded bg-emerald-400" style={{ left: x(v.estimate.value) }} />
        {points.map((p, i) => (
          <div key={i} className="group absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-ink-900 bg-sky-400" style={{ left: x(p.value) }}>
            <div className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-800 px-2 py-1 text-xs text-slate-200 shadow group-hover:block">
              {p.label}: {money(p.value)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-slate-500"><span>{moneyCompact(lo)}</span><span>{moneyCompact(hi)}</span></div>
      <ul className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {points.map((p, i) => (
          <li key={i} className="flex justify-between gap-3"><span className="flex items-center gap-2 text-slate-400"><span className="h-2 w-2 rounded-full bg-sky-400" />{p.label}</span><span className="tabular-nums text-slate-200">{money(p.value)}</span></li>
        ))}
        <li className="flex justify-between gap-3 font-medium"><span className="flex items-center gap-2 text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />Reconciled estimate</span><span className="tabular-nums text-emerald-300">{money(v.estimate.value)}</span></li>
      </ul>
    </div>
  );
}

// ---------- scenarios ----------
function Scenarios({ s, debts }: { s: HomeSummary; debts: Debt[] }) {
  const m = s.valuation?.market;
  const otherDebts = debts.filter(d => d.balance > 0 && !d.hidden && !s.debts.some(x => x.id === d.id));
  const [a, setA] = useState({
    refiRate: m?.mortgage_rate_30yr ?? 6.5, refiTerm: 30, refiClosing: 2.5, includeCards: true,
    sellCost: 8, newPrice: Math.round((s.value ?? 300000) / 5000) * 5000, newRate: m?.mortgage_rate_30yr ?? 6.5, buyClosing: 3,
    taxIns: 2.0, reserve: 5000, payCards: true,
  });
  const set = (k: keyof typeof a) => (e: any) => setA({ ...a, [k]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value) });

  const r = useMemo(() => {
    const value = s.value ?? 0;
    const secured = s.debts;
    const cardsTotal = otherDebts.reduce((t, d) => t + d.balance, 0);
    const cardsMin = otherDebts.reduce((t, d) => t + (d.min_payment ?? Math.max(25, d.balance * 0.02)), 0);
    const cardsInterest = otherDebts.reduce((t, d) => t + (payoff(d.balance, d.apr ?? 0, d.min_payment ?? Math.max(25, d.balance * 0.02))?.interest ?? d.balance), 0);
    const missingPayment = secured.filter(d => !d.min_payment);

    // Stay: keep paying what you pay today.
    const stayParts = secured.map(d => ({ d, p: payoff(d.balance, d.apr ?? 0, d.min_payment ?? 0) }));
    const stay = {
      monthly: secured.reduce((t, d) => t + (d.min_payment ?? 0), 0) + (a.includeCards ? cardsMin : 0),
      interest: stayParts.reduce((t, x) => t + (x.p?.interest ?? 0), 0) + (a.includeCards ? cardsInterest : 0),
      months: stayParts.some(x => !x.p) ? null : Math.max(0, ...stayParts.map(x => x.p!.months)),
      cash: 0,
      notes: [
        ...stayParts.filter(x => !x.p).map(x => `${x.d.name}: payment doesn't cover interest (interest-only?) — balance never falls.`),
        ...missingPayment.map(d => `${d.name} has no payment entered.`),
      ],
    };

    // Refinance everything secured (+ optionally cards) into one fixed loan.
    const base = s.owed + (a.includeCards ? cardsTotal : 0);
    const refiPrincipal = base * (1 + a.refiClosing / 100);
    const refiPmt = payment(refiPrincipal, a.refiRate, a.refiTerm * 12);
    const ltv = value ? refiPrincipal / value : 1;
    const refi = {
      monthly: refiPmt,
      interest: refiPmt * a.refiTerm * 12 - refiPrincipal,
      months: a.refiTerm * 12,
      cash: -(refiPrincipal - base),
      notes: [
        `New loan ${money(refiPrincipal)} = ${pct(ltv * 100).replace('%', '')}% of value.`,
        ...(ltv > 0.8 ? ['Above 80% LTV — most cash-out refinances cap here; expect a higher rate or PMI, or it may not be approved.'] : []),
        ...(a.includeCards ? ['Card debt becomes secured by the house — only worth it if the cards stay at $0.'] : []),
      ],
    };

    // Sell, clear secured debt (and optionally cards), buy the new place.
    const proceeds = value * (1 - a.sellCost / 100) - s.owed;
    const afterCards = proceeds - (a.payCards ? cardsTotal : 0);
    const buyerClosing = a.newPrice * a.buyClosing / 100;
    const down = Math.max(0, afterCards - a.reserve - buyerClosing);
    const loan = Math.max(0, a.newPrice - down);
    const newPmt = payment(loan, a.newRate, 360);
    const taxIns = a.newPrice * a.taxIns / 100 / 12;
    const sell = {
      monthly: newPmt + taxIns + (a.payCards ? 0 : cardsMin),
      interest: newPmt * 360 - loan + (a.payCards ? 0 : cardsInterest),
      months: loan > 0 ? 360 : 0,
      cash: Math.max(0, afterCards - buyerClosing - down),
      notes: [
        `Net from sale after ~${a.sellCost}% costs: ${money(proceeds)}.`,
        `Down payment ${money(down)} (${a.newPrice ? Math.round(down / a.newPrice * 100) : 0}%), new loan ${money(loan)}.`,
        ...(down / a.newPrice < 0.2 && loan > 0 ? ['Under 20% down usually means PMI on top of this payment.'] : []),
        ...(proceeds < 0 ? ['Sale would not cover what you owe on the house.'] : []),
        `Includes ~${money(taxIns)}/mo estimated taxes & insurance.`,
      ],
    };
    return { stay, refi, sell, cardsTotal };
  }, [a, s, otherDebts]);

  const cols = [
    { key: 'stay', title: 'Stay & keep paying', data: r.stay },
    { key: 'refi', title: 'Refinance & consolidate', data: r.refi },
    { key: 'sell', title: 'Sell & buy another', data: r.sell },
  ] as const;
  const bestInterest = Math.min(...cols.map(c => c.data.interest));
  const Num = ({ k, label, step = 0.125, suffix = '' }: { k: keyof typeof a; label: string; step?: number; suffix?: string }) => (
    <div><label className="label">{label}{suffix && <span className="text-slate-600"> {suffix}</span>}</label><input className="input py-1.5" type="number" step={step} value={a[k] as number} onChange={set(k)} /></div>
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader title={<span className="flex items-center gap-2"><Scale className="h-4 w-4 text-violet-400" /> Stay, refinance, or move?</span>}
        subtitle={m?.mortgage_rate_30yr ? `Rates pre-filled from today's market (${pct(m.mortgage_rate_30yr)} 30-yr${m.rate_source ? `, ${m.rate_source}` : ''}). Adjust anything.` : 'Adjust any assumption.'} />
      <div className="grid gap-4 p-5 xl:grid-cols-5">
        <div className="space-y-3 rounded-xl bg-white/[0.02] p-4 xl:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Refinance</p>
          <div className="grid grid-cols-3 gap-2"><Num k="refiRate" label="Rate" suffix="%" /><Num k="refiTerm" label="Years" step={5} /><Num k="refiClosing" label="Costs" suffix="%" step={0.5} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-emerald-500" checked={a.includeCards} onChange={set('includeCards')} />Roll in other debts ({money(r.cardsTotal)})</label>
        </div>
        <div className="space-y-3 rounded-xl bg-white/[0.02] p-4 xl:col-span-3">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Sell & buy</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <div className="col-span-2"><Num k="newPrice" label="New home price" step={5000} /></div>
            <Num k="newRate" label="Rate" suffix="%" /><Num k="sellCost" label="Sell costs" suffix="%" step={0.5} />
            <Num k="buyClosing" label="Buy costs" suffix="%" step={0.5} /><Num k="taxIns" label="Tax+ins/yr" suffix="%" step={0.1} />
            <div className="col-span-2"><Num k="reserve" label="Keep in savings" step={1000} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" className="accent-emerald-500" checked={a.payCards} onChange={set('payCards')} />Pay off other debts from the sale</label>
        </div>
      </div>
      <div className="grid gap-px border-t border-white/[0.06] bg-white/[0.06] md:grid-cols-3">
        {cols.map(c => (
          <div key={c.key} className="bg-ink-900 p-5">
            <div className="flex items-center justify-between"><p className="text-sm font-semibold text-slate-100">{c.title}</p>
              {c.data.interest === bestInterest && <Badge tone="good">Least interest</Badge>}</div>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Monthly payments</dt><dd className="font-semibold tabular-nums text-slate-100">{money(c.data.monthly)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Interest from here</dt><dd className="tabular-nums text-slate-200">{money(c.data.interest)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Housing debt-free in</dt><dd className="tabular-nums text-slate-200">{yrs(c.data.months)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">{c.key === 'refi' ? 'Closing costs' : 'Cash left over'}</dt><dd className="tabular-nums text-slate-200">{money(Math.abs(c.data.cash))}</dd></div>
            </dl>
            <ul className="mt-3 space-y-1 text-xs text-slate-500">{c.data.notes.map((n, i) => <li key={i}>• {n}</li>)}</ul>
          </div>
        ))}
      </div>
      <p className="border-t border-white/[0.06] px-5 py-3 text-xs text-slate-600">
        "Stay" uses the payments you entered, which may include escrow. Estimates only — get a lender quote before refinancing or listing.
      </p>
    </Card>
  );
}

export default function Home(_: PageProps) {
  const { data: s, reload, setData, loading } = useApi<HomeSummary | null>('/api/home');
  const { data: debts } = useApi<Debt[]>('/api/debts');
  const { data: health } = useApi<{ ai: boolean }>('/api/health');
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valuate = async () => {
    setRunning(true);
    setError(null);
    try { setData(await runJob<HomeSummary>('/api/home/valuate')); } catch (e: any) { setError(e.message); } finally { setRunning(false); }
  };

  useEffect(() => { if (s && !s.valuation && !running && health?.ai) valuate(); }, [s?.home.address, health?.ai]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !s) return <div className="flex justify-center py-24"><Spinner className="h-6 w-6 text-slate-500" /></div>;
  if (s === null && debts) {
    return (
      <>
        <PageHeader title="Home" subtitle="Value your home from live comps, see your equity, and compare staying, refinancing or moving." />
        <Card><CardHeader title="Add your home" subtitle="Only the address is required — beds, baths and square footage are looked up automatically." />
          <HomeForm summary={null} debts={debts} onSaved={reload} /></Card>
      </>
    );
  }
  if (!s || !debts) return <div className="flex justify-center py-24"><Spinner className="h-6 w-6 text-slate-500" /></div>;

  const v = s.valuation;
  const conf = v?.estimate.confidence;

  return (
    <>
      <PageHeader title="Home" subtitle={s.home.address}
        actions={<>
          <button className="btn-secondary" onClick={() => setEditing(!editing)}><Pencil className="h-4 w-4" /> Edit details</button>
          <button className="btn-primary" onClick={valuate} disabled={running || health?.ai === false}>
            {running ? <Spinner /> : v ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {running ? 'Pulling comps (1–3 min)…' : v ? 'Revalue' : 'Value my home'}
          </button>
        </>} />

      {editing && <Card className="mb-4"><HomeForm summary={s} debts={debts} onSaved={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} /></Card>}
      <div className="mb-4 space-y-2">
        <ErrorNote error={error} />
        {health?.ai === false && <ErrorNote error="ANTHROPIC_API_KEY isn't set on the server — valuation research needs it." />}
        {v?.rentcast_error && <p className="text-xs text-slate-500">Note: {v.rentcast_error}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Estimated value" subtitle={v ? `Updated ${relativeTime(v.created_at.replace('T', ' ').slice(0, 19))} from ${v.comps.length} comps and ${v.public_estimates.length + (v.rentcast ? 1 : 0)} estimates` : 'Not valued yet'}
            action={conf && <Badge tone={conf === 'high' ? 'good' : conf === 'medium' ? 'warn' : 'bad'}>{conf} confidence</Badge>} />
          {v ? (
            <>
              <div className="px-5 pt-3">
                <p className="text-4xl font-semibold tracking-tight text-white">{money(s.home.manual_value ?? v.estimate.value)}</p>
                <p className="mt-1 text-sm text-slate-400">
                  Likely range {money(v.estimate.low)} – {money(v.estimate.high)}
                  {s.home.manual_value != null && <span className="text-amber-400"> · using your override (estimate {money(v.estimate.value)})</span>}
                  {s.home.purchase_price ? <span> · bought for {money(s.home.purchase_price)}{s.home.purchase_date && ` in ${s.home.purchase_date.slice(0, 4)}`}</span> : null}
                </p>
              </div>
              <SourceStrip s={s} />
              <div className="border-t border-white/[0.06] px-5 py-4 text-sm text-slate-400">
                <p>{v.methodology}</p>
                {v.adjustments.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">{v.adjustments.map((a, i) => <li key={i}><Badge>{a.factor}: {a.impact}</Badge></li>)}</ul>
                )}
              </div>
            </>
          ) : running
            ? <Empty icon={Sparkles} title="Researching your home…" body="Pulling public records, automated estimates and recent nearby sales, then reconciling them like an appraiser would." />
            : <Empty icon={HomeIcon} title="Not valued yet" body='Click "Value my home" to pull comps.' />}
        </Card>

        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Equity</p>
          <p className={`mt-2 text-3xl font-semibold ${(s.equity ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{money(s.equity)}</p>
          <p className="text-xs text-slate-500">{money(s.value)} value − {money(s.owed)} owed</p>
          {s.ltv != null && (
            <div className="mt-5">
              <div className="flex justify-between text-xs text-slate-500"><span>Loan-to-value</span><span className="text-slate-300">{(s.ltv * 100).toFixed(1)}%</span></div>
              <div className="relative mt-1.5 h-2 rounded-full bg-white/[0.06]">
                <div className={`h-2 rounded-full ${s.ltv > 0.8 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, s.ltv * 100)}%` }} />
                <div className="absolute -top-1 h-4 w-px bg-slate-300" style={{ left: '80%' }} title="80% — typical refinance limit" />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">White line = 80%, the usual limit for a cash-out refinance</p>
            </div>
          )}
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Borrowable to 80% LTV</dt><dd className="tabular-nums text-slate-200">{money(s.borrowable_at_80)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Borrowable to 85% LTV</dt><dd className="tabular-nums text-slate-200">{money(s.borrowable_at_85)}</dd></div>
          </dl>
          <div className="mt-5 space-y-2 border-t border-white/[0.06] pt-4">
            {s.debts.map(d => (
              <div key={d.id} className="flex justify-between text-sm"><span className="truncate text-slate-400">{d.name}{d.apr != null && ` · ${pct(d.apr)}`}</span><span className="tabular-nums text-slate-200">{money(d.balance)}</span></div>
            ))}
            {!s.debts.length && <p className="text-xs text-amber-400">No mortgage/HELOC linked — click Edit details.</p>}
          </div>
        </Card>
      </div>

      {v && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <CardHeader title="Comparable sales" subtitle="What similar nearby homes sold or listed for" />
            {v.comps.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="border-b border-white/[0.06]">
                    <tr><th className="th">Address</th><th className="th text-right">Price</th><th className="th text-right">$/sq ft</th><th className="th">Beds/Baths</th><th className="th text-right">Sq ft</th><th className="th">When</th><th className="th text-right">Dist.</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {[...v.comps].sort((a, b) => (a.distance_miles ?? 9) - (b.distance_miles ?? 9)).map((c, i) => (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        <td className="td">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-200">{c.address}</span>
                            {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-200"><ExternalLink className="h-3 w-3" /></a>}
                          </div>
                          <div className="mt-0.5 flex gap-1"><Badge tone={c.status === 'sold' ? 'good' : c.status === 'active' ? 'info' : 'default'}>{c.status}</Badge><span className="text-[11px] text-slate-600">{c.source}</span></div>
                        </td>
                        <td className="td text-right font-medium tabular-nums text-slate-100">{money(c.price)}</td>
                        <td className="td text-right tabular-nums text-slate-400">{c.sqft ? money(c.price / c.sqft) : '—'}</td>
                        <td className="td text-slate-400">{c.bedrooms ?? '—'} / {c.bathrooms ?? '—'}</td>
                        <td className="td text-right tabular-nums text-slate-400">{c.sqft?.toLocaleString() ?? '—'}</td>
                        <td className="td text-slate-400">{c.date ? dateLabel(c.date) + ` '${c.date.slice(2, 4)}` : '—'}</td>
                        <td className="td text-right tabular-nums text-slate-400">{c.distance_miles != null ? `${c.distance_miles.toFixed(1)} mi` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty icon={HomeIcon} title="No comps found" />}
            {v.subject.sqft && v.ppsf_check && (
              <p className="border-t border-white/[0.06] px-5 py-3 text-xs text-slate-500">
                Median {money(v.ppsf_check.median_ppsf)}/sq ft × your {v.subject.sqft.toLocaleString()} sq ft = {money(v.ppsf_check.implied_value)}
              </p>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-200"><TrendingUp className="h-4 w-4 text-sky-400" /> Market</p>
              <p className="mt-2 text-sm text-slate-400">{v.market.summary}</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                {v.market.yoy_price_change_pct != null && <div className="flex justify-between"><dt className="text-slate-500">Prices vs. last year</dt><dd className="text-slate-200">{v.market.yoy_price_change_pct > 0 ? '+' : ''}{v.market.yoy_price_change_pct}%</dd></div>}
                {v.market.median_days_on_market != null && <div className="flex justify-between"><dt className="text-slate-500">Median days on market</dt><dd className="text-slate-200">{v.market.median_days_on_market}</dd></div>}
                {v.market.mortgage_rate_30yr != null && <div className="flex justify-between"><dt className="text-slate-500">30-yr fixed</dt><dd className="text-slate-200">{pct(v.market.mortgage_rate_30yr)}</dd></div>}
                {v.market.mortgage_rate_15yr != null && <div className="flex justify-between"><dt className="text-slate-500">15-yr fixed</dt><dd className="text-slate-200">{pct(v.market.mortgage_rate_15yr)}</dd></div>}
                {v.market.heloc_rate_typical != null && <div className="flex justify-between"><dt className="text-slate-500">Typical HELOC</dt><dd className="text-slate-200">{pct(v.market.heloc_rate_typical)}</dd></div>}
              </dl>
            </Card>
            <Card className="p-5">
              <p className="text-sm font-semibold text-slate-200">Public record</p>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Beds / baths</dt><dd className="text-slate-200">{v.subject.bedrooms ?? '—'} / {v.subject.bathrooms ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Finished sq ft</dt><dd className="text-slate-200">{v.subject.sqft?.toLocaleString() ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Year built</dt><dd className="text-slate-200">{v.subject.year_built ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Last sale</dt><dd className="text-slate-200">{v.subject.last_sale_price ? `${money(v.subject.last_sale_price)}${v.subject.last_sale_date ? ` (${v.subject.last_sale_date.slice(0, 4)})` : ''}` : '—'}</dd></div>
              </dl>
            </Card>
            {v.caveats.length > 0 && (
              <Card className="p-5">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Caveats</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-400">{v.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {s.value != null && <div className="mt-4"><Scenarios s={s} debts={debts} /></div>}
    </>
  );
}
