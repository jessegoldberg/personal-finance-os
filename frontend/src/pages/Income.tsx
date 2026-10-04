import { useEffect, useState } from 'react';
import { Wallet, Plus, Trash2, Pencil, Check, X, ArrowDownLeft, StickyNote } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, IncomeSource, DetectedDeposit } from '../lib/api';
import { money, dateLabel } from '../lib/format';
import { Card, CardHeader, Badge, Empty, PageHeader, Stat, ErrorNote } from '../components/ui';

const KINDS = [
  { id: 'salary', label: 'Salary / wages' },
  { id: 'side', label: 'Side gig / 1099' },
  { id: 'grant', label: 'Grant / stipend' },
  { id: 'benefit', label: 'Benefits' },
  { id: 'other', label: 'Other' },
];
const kindLabel = (k: string) => KINDS.find(x => x.id === k)?.label ?? k;
const FREQ: Record<string, string> = { WEEKLY: 'weekly', BIWEEKLY: 'every 2 weeks', SEMI_MONTHLY: 'twice a month', MONTHLY: 'monthly', QUARTERLY: 'quarterly', IRREGULAR: 'irregularly' };

type IncomeData = { sources: IncomeSource[]; detected: DetectedDeposit[]; notes: string };

function SourceForm({ source, prefill, onDone }: { source?: IncomeSource; prefill?: Partial<IncomeSource>; onDone: () => void }) {
  const init = source ?? prefill;
  const [f, setF] = useState({
    name: init?.name ?? '', kind: init?.kind ?? 'salary', monthly_amount: init?.monthly_amount ? String(Math.round(init.monthly_amount * 100) / 100) : '',
    taxes_withheld: init?.taxes_withheld ?? 1, notes: init?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  return (
    <form className="grid gap-3 p-5 sm:grid-cols-6" onSubmit={async e => {
      e.preventDefault();
      try { await api('/api/income', { body: { ...f, id: source?.id } }); onDone(); } catch (err: any) { setError(err.message); }
    }}>
      <div className="sm:col-span-2"><label className="label">Name</label><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Jesse — salary" /></div>
      <div className="sm:col-span-2"><label className="label">Type</label>
        <select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value, taxes_withheld: ['side', 'grant'].includes(e.target.value) ? 0 : 1 })}>
          {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2"><label className="label">Monthly take-home</label><input className="input" type="number" step="0.01" required value={f.monthly_amount} onChange={e => setF({ ...f, monthly_amount: e.target.value })} placeholder="After taxes" /></div>
      <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
        <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={!!f.taxes_withheld} onChange={e => setF({ ...f, taxes_withheld: e.target.checked ? 1 : 0 })} />
        Taxes already withheld
      </label>
      <div className="sm:col-span-4"><label className="label">Notes (optional)</label><input className="input" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="e.g. Paid on the 1st and 15th" /></div>
      <div className="flex items-center gap-2 sm:col-span-6">
        <button className="btn-primary"><Check className="h-4 w-4" /> Save</button>
        <button type="button" className="btn-ghost" onClick={onDone}><X className="h-4 w-4" /> Cancel</button>
        <ErrorNote error={error} />
      </div>
    </form>
  );
}

export default function Income(_: PageProps) {
  const { data, reload } = useApi<IncomeData>('/api/income');
  const [editing, setEditing] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Partial<IncomeSource> | undefined>();
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(true);

  useEffect(() => { if (data) setNotes(data.notes); }, [data?.notes]);

  const sources = data?.sources ?? [];
  const total = sources.reduce((s, x) => s + x.monthly_amount, 0);
  const untaxed = sources.filter(s => !s.taxes_withheld).reduce((s, x) => s + x.monthly_amount, 0);
  const detectedTotal = (data?.detected ?? []).reduce((s, d) => s + d.monthly, 0);

  const done = () => { setEditing(null); setPrefill(undefined); reload(); };

  return (
    <>
      <PageHeader title="Income" subtitle="Every dollar coming into the household — entered by you and detected from deposits."
        actions={<button className="btn-secondary" onClick={() => { setPrefill(undefined); setEditing('new'); }}><Plus className="h-4 w-4" /> Add income</button>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Monthly household income" value={money(sources.length ? total : detectedTotal)} icon={Wallet} tone="good"
          hint={sources.length ? `${money(total * 12)} per year` : detectedTotal ? 'Estimated from repeat deposits' : 'Nothing entered or detected yet'} />
        <Stat label="Without tax withholding" value={money(untaxed)} hint={untaxed ? `Set aside ~${money(untaxed * 0.25)}/mo for taxes unless covered` : 'All income has withholding'} tone={untaxed ? 'warn' : 'default'} />
        <Stat label="Detected repeat deposits" value={money(detectedTotal)} icon={ArrowDownLeft} hint={sources.length ? "Monthly equivalent, for cross-checking" : "Being used as your income until you add sources"} />
      </div>

      {!sources.length && (data?.detected.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3">
          <p className="flex-1 text-sm text-amber-100/90">
            No income entered yet, so the dashboard and AI are using the {data!.detected.length} repeat deposits below (~{money(detectedTotal)}/mo).
            Add them as named sources so you can mark which ones have no tax withheld.
          </p>
          <button className="btn-secondary" onClick={async () => {
            for (const d of data!.detected) {
              await api('/api/income', { body: { name: d.name, kind: d.category === 'INCOME' ? 'salary' : 'other', monthly_amount: Math.round(d.monthly * 100) / 100, taxes_withheld: 1, notes: `Detected: ${d.count} deposits into ${d.account_name}` } });
            }
            reload();
          }}><Plus className="h-4 w-4" /> Add all as income</button>
        </div>
      )}

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Income sources" subtitle="This is what the plan budgets against — use take-home amounts" />
        {editing === 'new' && <div className="mt-2 border-y border-white/[0.06] bg-white/[0.02]"><SourceForm key={prefill?.name ?? "new"} prefill={prefill} onDone={done} /></div>}
        {sources.length ? (
          <ul className="mt-2 divide-y divide-white/[0.04]">
            {sources.map(s => editing === s.id ? (
              <li key={s.id} className="bg-white/[0.02]"><SourceForm source={s} onDone={done} /></li>
            ) : (
              <li key={s.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02]">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-200">{s.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge>{kindLabel(s.kind)}</Badge>
                    {s.taxes_withheld ? <Badge tone="good">Taxes withheld</Badge> : <Badge tone="warn">No withholding</Badge>}
                    {s.notes && <span className="text-xs text-slate-500">{s.notes}</span>}
                  </div>
                </div>
                <p className="text-base font-semibold tabular-nums text-slate-100">{money(s.monthly_amount)}<span className="text-xs font-normal text-slate-500">/mo</span></p>
                <div className="flex gap-1">
                  <button className="btn-ghost p-1.5" onClick={() => setEditing(s.id)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button className="btn-ghost p-1.5 hover:text-rose-400" aria-label="Delete" onClick={async () => { await api(`/api/income/${s.id}`, { method: 'DELETE' }); reload(); }}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </li>
            ))}
          </ul>
        ) : editing !== 'new' && <Empty icon={Wallet} title="No income added yet" body="Add each paycheck, side gig and grant so the plan knows what you have to work with." />}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Repeat deposits detected" subtitle="Money that landed in checking/savings 2+ times in the last 6 months (transfers between your own accounts excluded). Click to add as income." />
          {data?.detected.length ? (
            <ul className="divide-y divide-white/[0.04] px-2 pb-2 pt-2">
              {data.detected.map(d => (
                <li key={d.key}>
                  <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-white/[0.03]"
                    onClick={() => { setPrefill({ name: d.name, monthly_amount: d.monthly, kind: d.category === 'INCOME' ? 'salary' : 'other' }); setEditing('new'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    <div className="rounded-lg bg-emerald-500/10 p-1.5"><ArrowDownLeft className="h-4 w-4 text-emerald-400" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-200">{d.name}</p>
                      <p className="text-xs text-slate-500">{d.count}× · avg {money(d.average_amount, true)} {FREQ[d.frequency] ?? ''} · into {d.account_name}{d.mask && ` ••${d.mask}`} · last {dateLabel(d.last_date)}</p>
                    </div>
                    <p className="text-sm tabular-nums text-emerald-400">≈{money(d.monthly)}/mo</p>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty icon={ArrowDownLeft} title="No repeat deposits found yet" body="Once checking accounts are linked and synced, paychecks and grants show up here." />}
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><StickyNote className="h-4 w-4 text-slate-400" /> Notes for the advisor</span>}
            subtitle="Context the numbers can't show — the AI reads this every time" />
          <div className="p-5">
            <textarea className="input min-h-[180px] resize-y leading-relaxed" value={notes}
              onChange={e => { setNotes(e.target.value); setNotesSaved(false); }}
              placeholder={'e.g.\n• Side gig pays $1,000/mo with no taxes withheld; I over-withhold on my W-2 job to partly cover it.\n• Wife\'s grant arrives quarterly.\n• We want to keep $2,000 in savings as an emergency buffer.\n• Car needs replacing in ~2 years.'} />
            <div className="mt-2 flex items-center gap-2">
              <button className="btn-secondary" disabled={notesSaved} onClick={async () => { await api('/api/notes', { method: 'PUT', body: { notes } }); setNotesSaved(true); }}>
                {notesSaved ? <><Check className="h-4 w-4" /> Saved</> : 'Save notes'}
              </button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
