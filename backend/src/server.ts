import express = require('express');
import path = require('path');
import dotenv = require('dotenv');
dotenv.config();

import { db, getSetting, setSetting } from './db';
import { createLinkToken, exchangePublicToken, removeItem, syncAll, syncItem, plaidErrorMessage } from './plaid';
import { getOverview, getSpending, getRecurring, simulatePayoff, monthlyEquivalent, detectDeposits } from './analytics';
import { parseStatement, importStatement, setManualBalance } from './importer';
import { generateReport, latestReport, chat } from './advisor';
import { valuateHome, homeSummary } from './valuation';
import { startJob, getJob } from './jobs';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '15mb' }));

type Handler = (req: express.Request, res: express.Response) => any;
const route = (fn: Handler): express.RequestHandler => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err: any) {
    console.error(`${req.method} ${req.path}:`, plaidErrorMessage(err));
    res.status(err?.status && err.status < 600 ? err.status : 500).json({ error: plaidErrorMessage(err) });
  }
};
const num = (v: any) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

app.get(['/health', '/api/health'], (_req, res) => res.json({ status: 'ok', ai: !!process.env.ANTHROPIC_API_KEY, plaidEnv: process.env.PLAID_ENV || 'sandbox' }));

// ---- Plaid ----
app.post('/api/plaid/link-token', route(async req => ({
  linkToken: await createLinkToken(req.body?.mode === 'investments' ? 'investments' : 'banking', req.body?.itemId),
})));

app.post('/api/plaid/exchange', route(async req => {
  const { publicToken, institution, mode } = req.body ?? {};
  if (!publicToken) throw Object.assign(new Error('publicToken required'), { status: 400 });
  return { itemId: await exchangePublicToken(publicToken, institution, mode === 'investments' ? 'investments' : 'banking') };
}));

app.post('/api/sync', route(async req => {
  if (req.body?.itemId) await syncItem(req.body.itemId);
  else await syncAll();
  return { ok: true };
}));

app.get('/api/items', route(() => db.prepare(`SELECT i.item_id, i.institution_name, i.products, i.status, i.error, i.last_synced_at,
  COUNT(a.account_id) AS account_count FROM items i LEFT JOIN accounts a USING(item_id) GROUP BY i.item_id ORDER BY i.institution_name`).all()));

app.delete('/api/items/:id', route(async req => { await removeItem(req.params.id); return { ok: true }; }));

// ---- Accounts & transactions ----
app.get('/api/accounts', route(() => db.prepare(`SELECT a.*, i.institution_name FROM accounts a JOIN items i USING(item_id)
  ORDER BY CASE a.type WHEN 'depository' THEN 0 WHEN 'credit' THEN 1 WHEN 'loan' THEN 2 ELSE 3 END, a.name`).all()));

const manualAccount = (id: string) => {
  const a = db.prepare("SELECT * FROM accounts WHERE account_id = ? AND item_id = 'manual'").get(id);
  if (!a) throw Object.assign(new Error('Only manually tracked accounts can be changed this way'), { status: 400 });
  return a;
};

app.patch('/api/accounts/:id', route(req => {
  const b = req.body ?? {};
  if (b.hidden !== undefined) db.prepare('UPDATE accounts SET hidden = ? WHERE account_id = ?').run(b.hidden ? 1 : 0, req.params.id);
  if (b.name !== undefined || b.current_balance !== undefined || b.credit_limit !== undefined) {
    const a = manualAccount(req.params.id);
    db.prepare("UPDATE accounts SET name = ?, credit_limit = ?, updated_at = datetime('now') WHERE account_id = ?")
      .run(b.name || a.name, b.credit_limit !== undefined ? num(b.credit_limit) : a.credit_limit, a.account_id);
    db.prepare('UPDATE debts SET credit_limit = ? WHERE account_id = ?').run(b.credit_limit !== undefined ? num(b.credit_limit) : a.credit_limit, a.account_id);
    if (num(b.current_balance) !== null) setManualBalance(a.account_id, num(b.current_balance)!);
  }
  return { ok: true };
}));

// Accounts Plaid can't reach (Apple Card, some lenders). Credit/loan accounts get a debt row, or adopt an existing manual one.
app.post('/api/manual-accounts', route(req => {
  const b = req.body ?? {};
  if (!b.name || !['depository', 'credit', 'loan'].includes(b.type)) throw Object.assign(new Error('name and type (depository, credit, loan) required'), { status: 400 });
  const id = newId('man');
  const existingDebt = b.debtId ? db.prepare("SELECT * FROM debts WHERE id = ? AND account_id IS NULL").get(b.debtId) : null;
  const balance = num(b.balance) ?? existingDebt?.balance ?? 0;
  db.transaction(() => {
    db.prepare(`INSERT INTO accounts (account_id, item_id, name, mask, type, subtype, current_balance, credit_limit) VALUES (?, 'manual', ?, ?, ?, ?, ?, ?)`)
      .run(id, b.name, b.mask || null, b.type, b.subtype || (b.type === 'credit' ? 'credit card' : null), balance, num(b.credit_limit));
    if (b.type !== 'depository') {
      if (existingDebt) {
        db.prepare('UPDATE debts SET account_id = ?, balance = ?, credit_limit = COALESCE(?, credit_limit) WHERE id = ?').run(id, Math.abs(balance), num(b.credit_limit), existingDebt.id);
      } else {
        db.prepare(`INSERT INTO debts (id, account_id, source, name, kind, balance, apr, min_payment, credit_limit) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?)`)
          .run(newId('debt'), id, b.name, b.type === 'credit' ? 'credit' : (b.subtype || 'loan'), Math.abs(balance), num(b.apr), num(b.min_payment), num(b.credit_limit));
      }
    }
  })();
  return db.prepare('SELECT * FROM accounts WHERE account_id = ?').get(id);
}));

app.delete('/api/accounts/:id', route(req => {
  const a = manualAccount(req.params.id);
  db.transaction(() => {
    db.prepare('UPDATE debts SET account_id = NULL WHERE account_id = ?').run(a.account_id);
    db.prepare('DELETE FROM accounts WHERE account_id = ?').run(a.account_id);
  })();
  return { ok: true };
}));

app.post('/api/import/:accountId', route(req => {
  const a = manualAccount(req.params.accountId);
  const { content, filename, flip, dryRun } = req.body ?? {};
  if (!content) throw Object.assign(new Error('File content required'), { status: 400 });
  const parsed = parseStatement(String(content), String(filename || ''), a.type, !!flip);
  const dates = parsed.rows.map(r => r.date).sort();
  const summary = {
    format: parsed.format, count: parsed.rows.length, from: dates[0], to: dates[dates.length - 1], balance: parsed.balance, flipped: parsed.flipped,
    spending: parsed.rows.filter(r => r.amount > 0 && r.category !== 'LOAN_PAYMENTS').reduce((s, r) => s + r.amount, 0),
    payments: parsed.rows.filter(r => r.category === 'LOAN_PAYMENTS').reduce((s, r) => s + Math.abs(r.amount), 0),
    sample: parsed.rows.slice(0, 8),
  };
  return dryRun ? summary : { ...summary, ...importStatement(a.account_id, parsed) };
}));

app.get('/api/transactions', route(req => {
  const q = req.query as Record<string, string>;
  const where: string[] = [];
  const params: any[] = [];
  if (q.search) { where.push('(t.name LIKE ? OR t.merchant_name LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`); }
  if (q.category) { where.push('t.category = ?'); params.push(q.category); }
  if (q.account) { where.push('t.account_id = ?'); params.push(q.account); }
  if (q.month) { where.push('substr(t.date, 1, 7) = ?'); params.push(q.month); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(q.limit) || 100, 500);
  const offset = Number(q.offset) || 0;
  const rows = db.prepare(`SELECT t.*, a.name AS account_name, a.mask FROM transactions t JOIN accounts a USING(account_id)
    ${clause} ORDER BY t.date DESC, t.transaction_id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions t ${clause}`).get(...params).c;
  return { rows, total };
}));

app.get('/api/categories', route(() => db.prepare('SELECT DISTINCT category FROM transactions ORDER BY category').all().map((r: any) => r.category)));

// ---- Analytics ----
app.get('/api/overview', route(() => getOverview()));
app.get('/api/spending', route(req => getSpending(Math.min(Math.max(Number(req.query.months) || 6, 2), 24))));
app.get('/api/recurring', route(() => getRecurring().map((r: any) => ({ ...r, monthly: monthlyEquivalent(r.average_amount, r.frequency) }))));
app.get('/api/payoff', route(req => {
  const extra = Math.max(0, Number(req.query.extra) || 0);
  return { minimum: simulatePayoff('minimum', 0), avalanche: simulatePayoff('avalanche', extra), snowball: simulatePayoff('snowball', extra) };
}));

// ---- Debts ----
app.get('/api/debts', route(() => db.prepare(`SELECT d.*, COALESCE(a.hidden, 0) AS hidden FROM debts d LEFT JOIN accounts a USING(account_id)
  ORDER BY d.apr IS NULL, d.apr DESC`).all()));

app.post('/api/debts', route(req => {
  const b = req.body ?? {};
  if (!b.name) throw Object.assign(new Error('name required'), { status: 400 });
  const id = newId('debt');
  db.prepare(`INSERT INTO debts (id, source, name, kind, balance, apr, min_payment, next_due_date) VALUES (?, 'manual', ?, ?, ?, ?, ?, ?)`)
    .run(id, b.name, b.kind || 'other', num(b.balance) ?? 0, num(b.apr), num(b.min_payment), b.next_due_date || null);
  return db.prepare('SELECT * FROM debts WHERE id = ?').get(id);
}));

// Plaid-sourced debts keep syncing balances; APR/min/due edits stick until Plaid reports a value.
app.put('/api/debts/:id', route(req => {
  const b = req.body ?? {};
  const existing = db.prepare('SELECT * FROM debts WHERE id = ?').get(req.params.id);
  if (!existing) throw Object.assign(new Error('Not found'), { status: 404 });
  db.prepare(`UPDATE debts SET name = ?, kind = ?, balance = ?, apr = ?, min_payment = ?, next_due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(b.name ?? existing.name, b.kind ?? existing.kind, existing.source === 'plaid' ? existing.balance : (num(b.balance) ?? existing.balance),
      num(b.apr), num(b.min_payment), b.next_due_date || null, req.params.id);
  if (existing.source === 'manual' && existing.account_id && num(b.balance) !== null) setManualBalance(existing.account_id, num(b.balance)!);
  return db.prepare('SELECT * FROM debts WHERE id = ?').get(req.params.id);
}));

app.delete('/api/debts/:id', route(req => { db.prepare("DELETE FROM debts WHERE id = ? AND source = 'manual'").run(req.params.id); return { ok: true }; }));

// ---- Income ----
app.get('/api/income', route(() => ({
  sources: db.prepare('SELECT * FROM income_sources ORDER BY monthly_amount DESC').all(),
  detected: detectDeposits(),
  notes: getSetting('household_notes') ?? '',
})));

app.post('/api/income', route(req => {
  const b = req.body ?? {};
  if (!b.name) throw Object.assign(new Error('name required'), { status: 400 });
  const id = b.id || newId('inc');
  db.prepare(`INSERT INTO income_sources (id, name, kind, monthly_amount, taxes_withheld, notes) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, monthly_amount = excluded.monthly_amount,
    taxes_withheld = excluded.taxes_withheld, notes = excluded.notes`)
    .run(id, b.name, b.kind || 'other', num(b.monthly_amount) ?? 0, b.taxes_withheld ? 1 : 0, b.notes || null);
  return db.prepare('SELECT * FROM income_sources WHERE id = ?').get(id);
}));

app.delete('/api/income/:id', route(req => { db.prepare('DELETE FROM income_sources WHERE id = ?').run(req.params.id); return { ok: true }; }));

app.put('/api/notes', route(req => { setSetting('household_notes', String(req.body?.notes ?? '').slice(0, 4000)); return { ok: true }; }));

// ---- Budgets ----
app.get('/api/budgets', route(() => db.prepare('SELECT * FROM budgets').all()));
app.put('/api/budgets/:category', route(req => {
  const limit = num(req.body?.monthly_limit);
  if (limit === null || limit <= 0) db.prepare('DELETE FROM budgets WHERE category = ?').run(req.params.category);
  else db.prepare('INSERT INTO budgets (category, monthly_limit) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit')
    .run(req.params.category, limit);
  return { ok: true };
}));

// ---- AI advisor ----
app.get('/api/advisor/latest', route(() => ({ report: latestReport() })));
app.post('/api/advisor/analyze', route(() => ({ jobId: startJob('analyze', async () => ({ report: await generateReport() })) })));
app.post('/api/advisor/chat', route(req => {
  const history = (req.body?.messages ?? []).filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  if (!history.length || history[history.length - 1].role !== 'user') throw Object.assign(new Error('Last message must be from the user'), { status: 400 });
  return { jobId: startJob('chat', async () => ({ reply: await chat(history) }), false) };
}));

app.get('/api/jobs/:id', route(req => {
  const job = getJob(req.params.id);
  if (!job) throw Object.assign(new Error('Job not found (the server may have restarted)'), { status: 404 });
  return job;
}));

// ---- Home ----
app.get('/api/home', route(() => homeSummary()));

app.put('/api/home', route(req => {
  const b = req.body ?? {};
  if (!b.address || String(b.address).trim().length < 8) throw Object.assign(new Error('Full street address, city, state and ZIP required'), { status: 400 });
  const existing = db.prepare("SELECT address FROM properties WHERE id = 'home'").get();
  db.prepare(`INSERT INTO properties (id, address, property_type, bedrooms, bathrooms, sqft, year_built, purchase_price, purchase_date, condition, notes, manual_value, debt_ids, escrow_monthly)
    VALUES ('home', @address, @property_type, @bedrooms, @bathrooms, @sqft, @year_built, @purchase_price, @purchase_date, @condition, @notes, @manual_value, @debt_ids, @escrow_monthly)
    ON CONFLICT(id) DO UPDATE SET address = excluded.address, property_type = excluded.property_type, bedrooms = excluded.bedrooms,
      bathrooms = excluded.bathrooms, sqft = excluded.sqft, year_built = excluded.year_built, purchase_price = excluded.purchase_price,
      purchase_date = excluded.purchase_date, condition = excluded.condition, notes = excluded.notes, manual_value = excluded.manual_value,
      debt_ids = excluded.debt_ids, escrow_monthly = excluded.escrow_monthly`).run({
    address: String(b.address).trim(), property_type: b.property_type || 'Single Family', bedrooms: num(b.bedrooms), bathrooms: num(b.bathrooms),
    sqft: num(b.sqft), year_built: num(b.year_built), purchase_price: num(b.purchase_price), purchase_date: b.purchase_date || null,
    condition: b.condition || 'good', notes: b.notes || null, manual_value: num(b.manual_value),
    debt_ids: JSON.stringify(Array.isArray(b.debt_ids) ? b.debt_ids.map(String) : []), escrow_monthly: num(b.escrow_monthly),
  });
  // A different address invalidates the old valuation.
  if (existing && existing.address !== String(b.address).trim()) db.prepare("UPDATE properties SET valuation = NULL, valued_at = NULL WHERE id = 'home'").run();
  return homeSummary();
}));

app.post('/api/home/valuate', route(() => ({ jobId: startJob('valuate', async () => { await valuateHome(); return homeSummary(); }) })));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Frontend ----
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.get('*', (_req, res) => res.sendFile(path.join(publicPath, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  syncAll().catch(() => {});
  setInterval(() => syncAll().catch(() => {}), 6 * 60 * 60 * 1000);
});
