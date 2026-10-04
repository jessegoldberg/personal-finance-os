import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import { db } from './db';

const plaid = new PlaidApi(new Configuration({
  basePath: process.env.PLAID_ENV === 'production' ? PlaidEnvironments.Production : PlaidEnvironments.Sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
}));

export function plaidErrorMessage(err: any): string {
  return err?.response?.data?.error_message || err?.message || 'Unknown Plaid error';
}

// "banking" covers checking, savings, credit cards and loans; "investments" covers brokerage/retirement,
// which Plaid filters out when Transactions is a required product.
export async function createLinkToken(mode: 'banking' | 'investments', itemId?: string) {
  const base: any = {
    user: { client_user_id: 'household' },
    client_name: 'Goldberg Family Finance',
    language: 'en',
    country_codes: [CountryCode.Us],
    redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
  };

  if (itemId) {
    const item = db.prepare('SELECT access_token FROM items WHERE item_id = ?').get(itemId);
    if (!item) throw new Error('Unknown item');
    base.access_token = item.access_token;
  } else if (mode === 'investments') {
    base.products = [Products.Investments];
  } else {
    base.products = [Products.Transactions];
    base.required_if_supported_products = [Products.Liabilities];
    base.transactions = { days_requested: 730 };
  }

  const res = await plaid.linkTokenCreate(base);
  return res.data.link_token;
}

export async function exchangePublicToken(publicToken: string, institution: { id?: string; name?: string } | undefined, mode: string) {
  const { data } = await plaid.itemPublicTokenExchange({ public_token: publicToken });

  // Re-linking the same bank replaces the old connection instead of duplicating its accounts.
  if (institution?.id) {
    const stale = db.prepare('SELECT item_id, access_token FROM items WHERE institution_id = ? AND products = ? AND item_id != ?')
      .all(institution.id, mode, data.item_id);
    for (const old of stale) await removeItem(old.item_id, old.access_token);
  }

  db.prepare(`INSERT INTO items (item_id, access_token, institution_id, institution_name, products)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(item_id) DO UPDATE SET access_token = excluded.access_token, status = 'ok', error = NULL`)
    .run(data.item_id, data.access_token, institution?.id ?? null, institution?.name ?? 'Unknown institution', mode);

  await syncItem(data.item_id);
  return data.item_id;
}

export async function removeItem(itemId: string, accessToken?: string) {
  const token = accessToken ?? db.prepare('SELECT access_token FROM items WHERE item_id = ?').get(itemId)?.access_token;
  if (token) {
    try { await plaid.itemRemove({ access_token: token }); } catch (e) { console.warn('itemRemove failed:', plaidErrorMessage(e)); }
  }
  db.prepare('DELETE FROM items WHERE item_id = ?').run(itemId);
}

async function syncAccounts(itemId: string, token: string) {
  const { data } = await plaid.accountsGet({ access_token: token });
  const upsert = db.prepare(`
    INSERT INTO accounts (account_id, item_id, name, official_name, mask, type, subtype, current_balance, available_balance, credit_limit, updated_at)
    VALUES (@account_id, @item_id, @name, @official_name, @mask, @type, @subtype, @current, @available, @limit, CURRENT_TIMESTAMP)
    ON CONFLICT(account_id) DO UPDATE SET name = excluded.name, official_name = excluded.official_name, mask = excluded.mask,
      type = excluded.type, subtype = excluded.subtype, current_balance = excluded.current_balance,
      available_balance = excluded.available_balance, credit_limit = excluded.credit_limit, updated_at = CURRENT_TIMESTAMP`);
  const upsertDebt = db.prepare(`
    INSERT INTO debts (id, account_id, source, name, kind, balance, credit_limit, updated_at)
    VALUES (@id, @account_id, 'plaid', @name, @kind, @balance, @limit, CURRENT_TIMESTAMP)
    ON CONFLICT(account_id) DO UPDATE SET balance = excluded.balance, credit_limit = excluded.credit_limit, updated_at = CURRENT_TIMESTAMP`);

  const institution = db.prepare('SELECT institution_name FROM items WHERE item_id = ?').get(itemId)?.institution_name;
  db.transaction(() => {
    for (const a of data.accounts) {
      const row = {
        account_id: a.account_id, item_id: itemId, name: a.name, official_name: a.official_name ?? null,
        mask: a.mask ?? null, type: a.type, subtype: a.subtype ?? null,
        current: a.balances.current ?? 0, available: a.balances.available ?? null, limit: a.balances.limit ?? null,
      };
      upsert.run(row);
      if (a.type === 'credit' || a.type === 'loan') {
        upsertDebt.run({
          id: 'plaid_' + a.account_id, account_id: a.account_id,
          name: `${institution ?? ''} ${a.name}${a.mask ? ' ••' + a.mask : ''}`.trim(),
          kind: a.type === 'credit' ? 'credit' : (a.subtype || 'loan'),
          balance: Math.abs(a.balances.current ?? 0), limit: a.balances.limit ?? null,
        });
      }
    }
  })();
}

async function syncLiabilities(token: string) {
  const { data } = await plaid.liabilitiesGet({ access_token: token });
  const l: any = data.liabilities;
  const update = db.prepare(`
    UPDATE debts SET
      apr = COALESCE(@apr, apr), min_payment = COALESCE(@min, min_payment), next_due_date = COALESCE(@due, next_due_date),
      statement_balance = COALESCE(@stmt, statement_balance), is_overdue = COALESCE(@overdue, is_overdue)
    WHERE account_id = @account_id`);

  for (const c of l.credit ?? []) {
    const purchase = (c.aprs ?? []).find((a: any) => a.apr_type === 'purchase_apr') ?? (c.aprs ?? [])[0];
    update.run({ account_id: c.account_id, apr: purchase?.apr_percentage ?? null, min: c.minimum_payment_amount ?? null,
      due: c.next_payment_due_date ?? null, stmt: c.last_statement_balance ?? null, overdue: c.is_overdue == null ? null : Number(c.is_overdue) });
  }
  for (const s of l.student ?? []) {
    update.run({ account_id: s.account_id, apr: s.interest_rate_percentage ?? null, min: s.minimum_payment_amount ?? null,
      due: s.next_payment_due_date ?? null, stmt: s.last_statement_balance ?? null, overdue: s.is_overdue == null ? null : Number(s.is_overdue) });
  }
  for (const m of l.mortgage ?? []) {
    update.run({ account_id: m.account_id, apr: m.interest_rate?.percentage ?? null, min: m.next_monthly_payment ?? null,
      due: m.next_payment_due_date ?? null, stmt: null, overdue: null });
  }
}

async function syncTransactions(itemId: string, token: string, cursor: string | null) {
  const upsert = db.prepare(`
    INSERT INTO transactions (transaction_id, account_id, item_id, amount, date, name, merchant_name, category, detailed_category, pending, logo_url, payment_channel)
    VALUES (@transaction_id, @account_id, @item_id, @amount, @date, @name, @merchant_name, @category, @detailed_category, @pending, @logo_url, @payment_channel)
    ON CONFLICT(transaction_id) DO UPDATE SET amount = excluded.amount, date = excluded.date, name = excluded.name,
      merchant_name = excluded.merchant_name, category = excluded.category, detailed_category = excluded.detailed_category,
      pending = excluded.pending, logo_url = excluded.logo_url`);
  const remove = db.prepare('DELETE FROM transactions WHERE transaction_id = ?');
  const knownAccount = db.prepare('SELECT 1 FROM accounts WHERE account_id = ?');

  let hasMore = true;
  while (hasMore) {
    const { data } = await plaid.transactionsSync({ access_token: token, cursor: cursor ?? undefined, count: 500 });
    db.transaction(() => {
      for (const t of [...data.added, ...data.modified]) {
        if (!knownAccount.get(t.account_id)) continue;
        upsert.run({
          transaction_id: t.transaction_id, account_id: t.account_id, item_id: itemId, amount: t.amount,
          date: t.authorized_date ?? t.date, name: t.name, merchant_name: t.merchant_name ?? null,
          category: t.personal_finance_category?.primary ?? 'OTHER', detailed_category: t.personal_finance_category?.detailed ?? null,
          pending: t.pending ? 1 : 0, logo_url: t.logo_url ?? null, payment_channel: t.payment_channel ?? null,
        });
      }
      for (const r of data.removed) remove.run(r.transaction_id);
    })();
    cursor = data.next_cursor;
    hasMore = data.has_more;
  }
  db.prepare('UPDATE items SET tx_cursor = ? WHERE item_id = ?').run(cursor, itemId);
}

async function syncRecurring(itemId: string, token: string) {
  const { data } = await plaid.transactionsRecurringGet({ access_token: token });
  const insert = db.prepare(`
    INSERT OR REPLACE INTO recurring_streams (stream_id, item_id, account_id, direction, description, merchant_name, category, frequency,
      average_amount, last_amount, last_date, predicted_next_date, is_active, status)
    VALUES (@stream_id, @item_id, @account_id, @direction, @description, @merchant_name, @category, @frequency,
      @average_amount, @last_amount, @last_date, @predicted_next_date, @is_active, @status)`);
  const map = (s: any, direction: string) => ({
    stream_id: s.stream_id, item_id: itemId, account_id: s.account_id, direction,
    description: s.description, merchant_name: s.merchant_name ?? null, category: s.personal_finance_category?.primary ?? null,
    frequency: s.frequency, average_amount: Math.abs(s.average_amount?.amount ?? 0), last_amount: Math.abs(s.last_amount?.amount ?? 0),
    last_date: s.last_date ?? null, predicted_next_date: s.predicted_next_date ?? null, is_active: s.is_active ? 1 : 0, status: s.status,
  });
  db.transaction(() => {
    db.prepare('DELETE FROM recurring_streams WHERE item_id = ?').run(itemId);
    for (const s of data.inflow_streams) insert.run(map(s, 'inflow'));
    for (const s of data.outflow_streams) insert.run(map(s, 'outflow'));
  })();
}

export async function syncItem(itemId: string) {
  const item = db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
  if (!item) throw new Error('Unknown item');
  const errors: string[] = [];

  try {
    await syncAccounts(itemId, item.access_token);
  } catch (e: any) {
    const code = e?.response?.data?.error_code;
    db.prepare('UPDATE items SET status = ?, error = ? WHERE item_id = ?')
      .run(code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error', plaidErrorMessage(e), itemId);
    return;
  }

  if (item.products !== 'investments') {
    const steps: [string, () => Promise<void>][] = [
      ['liabilities', () => syncLiabilities(item.access_token)],
      ['transactions', () => syncTransactions(itemId, item.access_token, item.tx_cursor)],
      ['recurring', () => syncRecurring(itemId, item.access_token)],
    ];
    for (const [name, step] of steps) {
      try { await step(); } catch (e: any) {
        const code = e?.response?.data?.error_code;
        // Products the institution doesn't support are expected, not failures.
        if (!['PRODUCTS_NOT_SUPPORTED', 'NO_LIABILITY_ACCOUNTS', 'PRODUCT_NOT_READY', 'NO_ACCOUNTS'].includes(code)) {
          errors.push(`${name}: ${plaidErrorMessage(e)}`);
        }
      }
    }
  }

  db.prepare("UPDATE items SET status = ?, error = ?, last_synced_at = datetime('now') WHERE item_id = ?")
    .run(errors.length ? 'partial' : 'ok', errors.join('; ') || null, itemId);
}

let syncing: Promise<void> | null = null;
export function syncAll(): Promise<void> {
  if (!syncing) {
    syncing = (async () => {
      for (const { item_id } of db.prepare('SELECT item_id FROM items').all()) {
        try { await syncItem(item_id); } catch (e) { console.error('Sync failed for', item_id, plaidErrorMessage(e)); }
      }
    })().finally(() => { syncing = null; });
  }
  return syncing;
}
