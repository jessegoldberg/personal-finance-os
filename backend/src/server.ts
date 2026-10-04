import express = require('express');
import path = require('path');
import dotenv = require('dotenv');
dotenv.config();

import { db, getSetting, setSetting } from './db';
import { createLinkToken, exchangePublicToken, removeItem, syncAll, syncItem, plaidErrorMessage } from './plaid';
import { getOverview, getSpending, getRecurring, simulatePayoff, monthlyEquivalent } from './analytics';
import { generateReport, latestReport, chat } from './advisor';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '1mb' }));

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

app.patch('/api/accounts/:id', route(req => {
  db.prepare('UPDATE accounts SET hidden = ? WHERE account_id = ?').run(req.body?.hidden ? 1 : 0, req.params.id);
  return { ok: true };
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
  return db.prepare('SELECT * FROM debts WHERE id = ?').get(req.params.id);
}));

app.delete('/api/debts/:id', route(req => { db.prepare("DELETE FROM debts WHERE id = ? AND source = 'manual'").run(req.params.id); return { ok: true }; }));

// ---- Income ----
app.get('/api/income', route(() => ({
  sources: db.prepare('SELECT * FROM income_sources ORDER BY monthly_amount DESC').all(),
  detected: db.prepare(`SELECT r.*, a.name AS account_name, a.mask FROM recurring_streams r LEFT JOIN accounts a USING(account_id)
    WHERE r.direction = 'inflow' AND r.is_active = 1 ORDER BY r.average_amount DESC`).all()
    .map((r: any) => ({ ...r, monthly: monthlyEquivalent(r.average_amount, r.frequency) })),
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
app.post('/api/advisor/analyze', route(async () => ({ report: await generateReport() })));
app.post('/api/advisor/chat', route(async req => {
  const history = (req.body?.messages ?? []).filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  if (!history.length || history[history.length - 1].role !== 'user') throw Object.assign(new Error('Last message must be from the user'), { status: 400 });
  return { reply: await chat(history) };
}));

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
