import { useState } from 'react';
import { Landmark, CreditCard, PiggyBank, LineChart, Eye, EyeOff, Trash2, RefreshCw, AlertCircle, Building2, Upload, Plus, Pencil, Check, X, FileText, Info } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, Account, Item, Debt, ImportSummary } from '../lib/api';
import { money, relativeTime, dateLabel, categoryLabel } from '../lib/format';
import { Card, CardHeader, Badge, Empty, PageHeader, Spinner, ErrorNote } from '../components/ui';
import { PlaidLinkButton } from '../components/PlaidLink';

const TYPE_ICON: Record<string, any> = { depository: PiggyBank, credit: CreditCard, loan: Landmark, investment: LineChart };

function StatusBadge({ item }: { item: Item }) {
  if (item.status === 'login_required') return <Badge tone="bad">Reconnect needed</Badge>;
  if (item.status === 'error') return <Badge tone="bad">Error</Badge>;
  if (item.status === 'partial') return <Badge tone="warn">Partial</Badge>;
  return <Badge tone="good">Connected</Badge>;
}

function ManualAccountForm({ debts, onDone }: { debts: Debt[]; onDone: (created: boolean) => void }) {
  const [f, setF] = useState({ name: '', type: 'credit', subtype: '', mask: '', balance: '', credit_limit: '', apr: '', min_payment: '', debtId: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const unlinked = debts.filter(d => d.source === 'manual' && !d.account_id);
  const adopting = unlinked.find(d => d.id === f.debtId);

  return (
    <form className="grid gap-3 p-5 sm:grid-cols-6" onSubmit={async e => {
      e.preventDefault();
      try { await api('/api/manual-accounts', { body: f }); onDone(true); } catch (err: any) { setError(err.message); }
    }}>
      <div className="sm:col-span-2"><label className="label">Account name</label><input className="input" required value={f.name} onChange={set('name')} placeholder="e.g. Apple Card" /></div>
      <div><label className="label">Type</label>
        <select className="input" value={f.type} onChange={set('type')}>
          <option value="credit">Credit card</option>
          <option value="loan">Loan / mortgage / HELOC</option>
          <option value="depository">Checking / savings</option>
        </select>
      </div>
      {f.type === 'loan' && (
        <div><label className="label">Loan type</label>
          <select className="input" value={f.subtype} onChange={set('subtype')}>
            <option value="">Other</option><option value="mortgage">Mortgage</option><option value="home equity">HELOC</option>
            <option value="auto">Auto</option><option value="student">Student</option><option value="personal">Personal</option>
          </select>
        </div>
      )}
      <div><label className="label">Last 4 (optional)</label><input className="input" maxLength={4} value={f.mask} onChange={set('mask')} /></div>
      <div><label className="label">{f.type === 'depository' ? 'Balance' : 'Amount owed'}</label>
        <input className="input" type="number" step="0.01" value={f.balance} onChange={set('balance')} placeholder={adopting ? String(adopting.balance) : ''} /></div>
      {f.type !== 'depository' && (
        <>
          {f.type === 'credit' && <div><label className="label">Credit limit</label><input className="input" type="number" value={f.credit_limit} onChange={set('credit_limit')} /></div>}
          {unlinked.length > 0 && (
            <div className="sm:col-span-2"><label className="label">Already entered as a debt?</label>
              <select className="input" value={f.debtId} onChange={set('debtId')}>
                <option value="">No — create a new debt</option>
                {unlinked.map(d => <option key={d.id} value={d.id}>Use “{d.name}” ({money(d.balance)})</option>)}
              </select>
            </div>
          )}
          {!adopting && (
            <>
              <div><label className="label">APR %</label><input className="input" type="number" step="0.01" value={f.apr} onChange={set('apr')} /></div>
              <div><label className="label">Min payment</label><input className="input" type="number" step="0.01" value={f.min_payment} onChange={set('min_payment')} /></div>
            </>
          )}
        </>
      )}
      <div className="flex items-center gap-2 sm:col-span-6">
        <button className="btn-primary"><Check className="h-4 w-4" /> Add account</button>
        <button type="button" className="btn-ghost" onClick={() => onDone(false)}><X className="h-4 w-4" /> Cancel</button>
        <ErrorNote error={error} />
      </div>
    </form>
  );
}

function ImportPanel({ account, onDone }: { account: Account; onDone: (imported: boolean) => void }) {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [flip, setFlip] = useState(false);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: { name: string; content: string }, flipSigns: boolean, dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ImportSummary>(`/api/import/${account.account_id}`, { body: { content: f.content, filename: f.name, flip: flipSigns, dryRun } });
      if (dryRun) setPreview(r); else setResult(r);
    } catch (e: any) {
      setError(e.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const loaded = { name: f.name, content: await f.text() };
    setFile(loaded);
    setFlip(false);
    setResult(null);
    run(loaded, false, true);
  };

  return (
    <div className="space-y-3 border-t border-white/[0.06] bg-white/[0.02] p-5">
      {result ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-emerald-300">
            Imported {result.inserted} new transactions{result.duplicates ? ` (${result.duplicates} already imported, skipped)` : ''}
            {result.balance != null && ` · balance updated to ${money(result.balance, true)}`}.
          </p>
          <button className="btn-secondary" onClick={() => onDone(true)}>Done</button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn-secondary cursor-pointer">
              <FileText className="h-4 w-4" /> {file ? file.name : 'Choose CSV, OFX or QFX file'}
              <input type="file" accept=".csv,.ofx,.qfx,.qbo,text/csv" className="hidden" onChange={pick} />
            </label>
            {busy && <Spinner />}
            <button className="btn-ghost ml-auto" onClick={() => onDone(false)}><X className="h-4 w-4" /> Cancel</button>
          </div>
          <ErrorNote error={error} />
          {preview && file && (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <div><p className="text-xs text-slate-500">Transactions</p><p className="font-semibold text-slate-100">{preview.count}</p></div>
                <div><p className="text-xs text-slate-500">Dates</p><p className="font-semibold text-slate-100">{dateLabel(preview.from)} – {dateLabel(preview.to)}</p></div>
                <div><p className="text-xs text-slate-500">Purchases</p><p className="font-semibold text-slate-100">{money(preview.spending, true)}</p></div>
                <div><p className="text-xs text-slate-500">Payments</p><p className="font-semibold text-slate-100">{money(preview.payments, true)}</p></div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
                <table className="w-full min-w-[520px] text-sm">
                  <tbody className="divide-y divide-white/[0.04]">
                    {preview.sample.map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 text-slate-500">{dateLabel(r.date)}</td>
                        <td className="px-3 py-1.5 text-slate-200">{r.merchant || r.name}</td>
                        <td className="px-3 py-1.5"><Badge>{categoryLabel(r.category)}</Badge></td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${r.amount < 0 ? 'text-emerald-400' : 'text-slate-200'}`}>{r.amount < 0 ? '+' : '−'}{money(Math.abs(r.amount), true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-xs text-slate-500">Purchases should show as <span className="text-slate-300">−</span> and payments/refunds as <span className="text-emerald-400">+</span>.</p>
                {preview.format === 'csv' && (
                  <button className="btn-ghost text-xs" onClick={() => { setFlip(!flip); run(file, !flip, true); }}>Signs look backwards? Flip them</button>
                )}
                <button className="btn-primary" disabled={busy} onClick={() => run(file, flip, false)}><Upload className="h-4 w-4" /> Import {preview.count}</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function BalanceEditor({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Math.abs(account.current_balance)));
  const isDebt = account.type !== 'depository';
  if (!editing) {
    return (
      <button className="group flex items-center gap-1" onClick={() => setEditing(true)} title="Update balance">
        <span className={`text-sm font-semibold tabular-nums ${isDebt ? 'text-rose-400' : 'text-slate-100'}`}>{isDebt ? '−' : ''}{money(Math.abs(account.current_balance), true)}</span>
        <Pencil className="h-3 w-3 text-slate-600 group-hover:text-slate-300" />
      </button>
    );
  }
  return (
    <form className="flex items-center gap-1" onSubmit={async e => {
      e.preventDefault();
      await api(`/api/accounts/${account.account_id}`, { method: 'PATCH', body: { current_balance: value } });
      setEditing(false);
      onSaved();
    }}>
      <input autoFocus className="input w-28 py-1" type="number" step="0.01" value={value} onChange={e => setValue(e.target.value)} />
      <button className="btn-ghost p-1.5"><Check className="h-3.5 w-3.5" /></button>
    </form>
  );
}

function ManualSection({ accounts, debts, onChanged }: { accounts: Account[]; debts: Debt[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={<span className="flex items-center gap-2"><Upload className="h-4 w-4 text-sky-400" /> Accounts Plaid can't connect</span>}
        subtitle="Apple Card, some mortgage/HELOC lenders and store cards — import their statements so spending still shows up"
        action={<div className="flex gap-1">
          <button className="btn-ghost p-2" onClick={() => setShowHelp(!showHelp)} aria-label="How to export"><Info className="h-4 w-4" /></button>
          <button className="btn-secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add account</button>
        </div>} />

      {showHelp && (
        <div className="mx-5 mt-3 space-y-2 rounded-xl bg-white/[0.03] p-4 text-sm text-slate-400">
          <p><span className="font-medium text-slate-200">Apple Card:</span> on your iPhone open Wallet → Apple Card → Card Balance → tap a monthly statement → Export Transactions. OFX includes the balance; CSV includes Apple's categories. Either works.</p>
          <p><span className="font-medium text-slate-200">Most banks and card issuers:</span> on their website, open the account's activity or statements page and look for Download / Export as CSV, OFX, QFX or "Quicken".</p>
          <p><span className="font-medium text-slate-200">Mortgage / HELOC:</span> no import needed — just keep the balance current (click it to edit). Your payments already show up in your linked checking account.</p>
          <p>Importing overlapping months is safe; transactions you've already imported are skipped.</p>
        </div>
      )}

      {adding && <div className="mt-3 border-y border-white/[0.06] bg-white/[0.02]"><ManualAccountForm debts={debts} onDone={created => { setAdding(false); if (created) onChanged(); }} /></div>}

      {accounts.length ? (
        <ul className="mt-3 divide-y divide-white/[0.04]">
          {accounts.map(a => {
            const Icon = TYPE_ICON[a.type] ?? Landmark;
            return (
              <li key={a.account_id}>
                <div className={`flex flex-wrap items-center gap-3 px-5 py-3 ${a.hidden ? 'opacity-40' : ''}`}>
                  <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-200">{a.name}{a.mask && <span className="text-slate-500"> ••{a.mask}</span>}</p>
                    <p className="text-xs capitalize text-slate-500">{a.subtype ?? a.type} · updated {relativeTime((a as any).updated_at)}</p>
                  </div>
                  <BalanceEditor account={a} onSaved={onChanged} />
                  <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setImporting(importing === a.account_id ? null : a.account_id)}>
                    <Upload className="h-3.5 w-3.5" /> Import statement
                  </button>
                  <button className="btn-ghost p-1.5 hover:text-rose-400" aria-label="Remove account" title="Remove account (keeps the debt entry)"
                    onClick={async () => { await api(`/api/accounts/${a.account_id}`, { method: 'DELETE' }); onChanged(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {importing === a.account_id && <ImportPanel account={a} onDone={imported => { setImporting(null); if (imported) onChanged(); }} />}
              </li>
            );
          })}
        </ul>
      ) : !adding && <Empty icon={Upload} title="No manual accounts" body="Add Apple Card or any account Plaid can't link, then import its statements." />}
    </Card>
  );
}

export default function Accounts({ onDataChanged }: PageProps) {
  const { data: items, reload: reloadItems } = useApi<Item[]>('/api/items');
  const { data: accounts, reload: reloadAccounts, setData: setAccounts } = useApi<Account[]>('/api/accounts');
  const { data: debts, reload: reloadDebts } = useApi<Debt[]>('/api/debts');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = () => { reloadItems(); reloadAccounts(); reloadDebts(); };
  const plaidItems = (items ?? []).filter(i => i.products !== 'manual');

  const toggleHidden = async (a: Account) => {
    setAccounts((accounts ?? []).map(x => x.account_id === a.account_id ? { ...x, hidden: a.hidden ? 0 : 1 } : x));
    await api(`/api/accounts/${a.account_id}`, { method: 'PATCH', body: { hidden: !a.hidden } });
  };

  const syncItem = async (id: string) => {
    setBusy(id);
    try { await api('/api/sync', { body: { itemId: id } }); } finally { setBusy(null); reload(); }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try { await api(`/api/items/${id}`, { method: 'DELETE' }); } finally { setBusy(null); setConfirming(null); onDataChanged(); }
  };

  return (
    <>
      <PageHeader title="Accounts" subtitle="Bank logins go straight to Plaid. This app only stores a revocable access token — never your passwords."
        actions={
          <>
            <PlaidLinkButton onLinked={onDataChanged}>Connect bank or card</PlaidLinkButton>
            <PlaidLinkButton mode="investments" className="btn-secondary" onLinked={onDataChanged}>Connect investments</PlaidLinkButton>
          </>
        } />

      <p className="-mt-3 mb-5 text-xs text-slate-500">
        Use <span className="text-slate-300">Connect investments</span> for 401(k), IRA and brokerage accounts (Fidelity, Edward Jones, etc.).
        Re-linking a bank you already connected replaces the old connection instead of duplicating it.
      </p>

      <div className="space-y-4">
        {!plaidItems.length && <Card><Empty icon={Building2} title="No institutions connected" body="Connect your bank to start pulling balances, transactions and debts." /></Card>}
        {plaidItems.map(item => {
          const accts = (accounts ?? []).filter(a => a.item_id === item.item_id);
          return (
            <Card key={item.item_id} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-5 py-4">
                <div className="rounded-lg bg-white/[0.05] p-2"><Building2 className="h-4 w-4 text-slate-300" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-100">{item.institution_name}</p>
                    <StatusBadge item={item} />
                    {item.products === 'investments' && <Badge tone="info">Investments</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">{item.account_count} accounts · synced {relativeTime(item.last_synced_at)}</p>
                </div>
                <div className="flex items-center gap-1">
                  {item.status === 'login_required' && (
                    <PlaidLinkButton itemId={item.item_id} className="btn-primary px-3 py-1.5 text-xs" onLinked={reload}>Reconnect</PlaidLinkButton>
                  )}
                  <button className="btn-ghost p-2" onClick={() => syncItem(item.item_id)} disabled={busy === item.item_id} aria-label="Sync">
                    {busy === item.item_id ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
                  </button>
                  {confirming === item.item_id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <span className="text-slate-400">Disconnect and delete its data?</span>
                      <button className="btn px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10" onClick={() => remove(item.item_id)}>Yes</button>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirming(null)}>No</button>
                    </span>
                  ) : (
                    <button className="btn-ghost p-2 hover:text-rose-400" onClick={() => setConfirming(item.item_id)} aria-label="Disconnect"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
              {item.error && item.status !== 'ok' && (
                <div className="flex items-start gap-2 border-b border-white/[0.06] bg-amber-500/[0.04] px-5 py-2 text-xs text-amber-200/80">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {item.error}
                </div>
              )}
              <ul className="divide-y divide-white/[0.04]">
                {accts.map(a => {
                  const Icon = TYPE_ICON[a.type] ?? Landmark;
                  const isDebt = a.type === 'credit' || a.type === 'loan';
                  return (
                    <li key={a.account_id} className={`flex items-center gap-3 px-5 py-3 ${a.hidden ? 'opacity-40' : ''}`}>
                      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-200">{a.name}{a.mask && <span className="text-slate-500"> ••{a.mask}</span>}</p>
                        <p className="text-xs capitalize text-slate-500">{a.subtype ?? a.type}{a.credit_limit ? ` · ${money(a.credit_limit)} limit` : ''}</p>
                      </div>
                      <p className={`text-sm font-semibold tabular-nums ${isDebt ? 'text-rose-400' : 'text-slate-100'}`}>{isDebt ? '−' : ''}{money(Math.abs(a.current_balance), true)}</p>
                      <button className="btn-ghost p-1.5" onClick={() => toggleHidden(a)} title={a.hidden ? 'Include in totals' : 'Exclude from totals'}>
                        {a.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}

        <ManualSection accounts={(accounts ?? []).filter(a => a.item_id === 'manual')} debts={debts ?? []} onChanged={reload} />
      </div>
    </>
  );
}
