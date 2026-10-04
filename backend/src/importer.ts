import crypto = require('crypto');
import { db } from './db';

export interface ParsedTxn {
  date: string;
  name: string;
  merchant: string | null;
  amount: number; // Plaid convention: positive = money out
  category: string;
}

export interface ParseResult {
  format: 'csv' | 'ofx';
  rows: ParsedTxn[];
  balance: number | null;
  flipped: boolean;
}

// Keyword fallback when the file has no category (OFX) or an unfamiliar one.
const KEYWORDS: [RegExp, string][] = [
  [/payment|thank you|autopay|ach deposit|online transfer from/i, 'LOAN_PAYMENTS'],
  [/interest charge|finance charge|late fee|annual fee|foreign transaction fee/i, 'BANK_FEES'],
  [/doordash|uber\s*eats|grubhub|restaurant|cafe|coffee|starbucks|dunkin|mcdonald|chipotle|pizza|taco|burger|chick-fil|panera|wendy|subway|kitchen|grill|bar\b|kroger|aldi|publix|whole foods|trader joe|safeway|giant eagle|heinz|grocery|market|food/i, 'FOOD_AND_DRINK'],
  [/shell|exxon|mobil|\bbp\b|speedway|sunoco|marathon|chevron|circle k|sheetz|wawa|fuel|\bgas\b|uber|lyft|parking|toll|transit|auto|jiffy|\btires?\b/i, 'TRANSPORTATION'],
  [/netflix|spotify|hulu|disney|youtube|hbo|\bmax\b|paramount|peacock|apple\.com\/bill|steam|playstation|xbox|nintendo|cinema|theat|ticket/i, 'ENTERTAINMENT'],
  [/verizon|at&t|t-mobile|comcast|xfinity|spectrum|electric|edison|water|sewer|utility|energy|insurance|geico|progressive|state farm|allstate|\brent\b/i, 'RENT_AND_UTILITIES'],
  [/cvs|walgreens|pharmacy|rx|doctor|medical|dental|clinic|hospital|health|vision/i, 'MEDICAL'],
  [/salon|barber|spa|gym|fitness|beauty|sephora|ulta/i, 'PERSONAL_CARE'],
  [/airline|airlines|delta|united|southwest|hotel|marriott|hilton|airbnb|expedia/i, 'TRAVEL'],
  [/home depot|lowe'?s|menards|ace hardware/i, 'HOME_IMPROVEMENT'],
  [/amazon|amzn|target|walmart|costco|best buy|ebay|etsy|apple store|store|shop/i, 'GENERAL_MERCHANDISE'],
];

// Category names used by Apple Card, Chase, Capital One, Citi, Discover and most bank CSVs.
const CATEGORY_MAP: [RegExp, string][] = [
  [/payment|credit card payment/i, 'LOAN_PAYMENTS'],
  [/interest|fee/i, 'BANK_FEES'],
  [/restaurant|dining|food|grocer|supermarket/i, 'FOOD_AND_DRINK'],
  [/gas|fuel|auto|transport|travel.*transport|parking/i, 'TRANSPORTATION'],
  [/airline|hotel|travel|lodging/i, 'TRAVEL'],
  [/entertain|subscription|streaming/i, 'ENTERTAINMENT'],
  [/utilit|bill|phone|internet|insurance/i, 'RENT_AND_UTILITIES'],
  [/medical|health|pharm/i, 'MEDICAL'],
  [/personal|beauty|fitness/i, 'PERSONAL_CARE'],
  [/home/i, 'HOME_IMPROVEMENT'],
  [/shopping|merchandise|retail|clothing|electronics/i, 'GENERAL_MERCHANDISE'],
];

export function categorize(name: string, fileCategory?: string | null, type?: string | null): string {
  if (type && /payment/i.test(type)) return 'LOAN_PAYMENTS';
  if (type && /interest|fee/i.test(type)) return 'BANK_FEES';
  if (fileCategory) {
    for (const [re, cat] of CATEGORY_MAP) if (re.test(fileCategory)) return cat;
  }
  for (const [re, cat] of KEYWORDS) if (re.test(name)) return cat;
  return 'OTHER';
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim())) rows.push(row);
  return rows;
}

function toIsoDate(s: string): string | null {
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const toNum = (s: string | undefined) => {
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s.trim());
  const n = parseFloat(s.replace(/[$,()\s]/g, ''));
  return neg ? -n : n;
};

function parseCsv(text: string): { rows: ParsedTxn[]; signKnown: boolean } {
  const all = parseCsvText(text.replace(/^﻿/, ''));
  const headerIdx = all.findIndex(r => r.some(c => /date/i.test(c)) && r.some(c => /amount|debit|credit/i.test(c)));
  if (headerIdx < 0) throw Object.assign(new Error('Could not find a header row with Date and Amount columns'), { status: 400 });
  const header = all[headerIdx].map(h => h.trim().toLowerCase());
  const find = (...res: RegExp[]) => { for (const re of res) { const i = header.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };

  const iDate = find(/^transaction date$/, /^trans\.? date$/, /^date$/, /posted|posting/, /date/);
  const iDesc = find(/^description$/, /payee/, /^name$/, /memo/, /merchant/);
  const iMerchant = find(/^merchant$/);
  const iAmount = find(/^amount/, /amount/);
  const iDebit = find(/debit|withdrawal/);
  const iCredit = find(/credit|deposit/);
  const iCategory = find(/category/);
  const iType = find(/^type$/, /transaction type/);
  if (iDate < 0 || (iAmount < 0 && iDebit < 0)) throw Object.assign(new Error('Missing a date or amount column'), { status: 400 });

  const rows: ParsedTxn[] = [];
  for (const r of all.slice(headerIdx + 1)) {
    const date = toIsoDate(r[iDate] ?? '');
    if (!date) continue;
    let amount: number;
    if (iAmount >= 0 && !isNaN(toNum(r[iAmount]))) amount = toNum(r[iAmount]);
    else amount = (toNum(r[iDebit]) || 0) - (toNum(r[iCredit]) || 0);
    if (isNaN(amount) || amount === 0) continue;
    const name = (r[iDesc] ?? r[iMerchant] ?? '').trim();
    const merchant = iMerchant >= 0 ? (r[iMerchant] ?? '').trim() || null : null;
    rows.push({ date, name, merchant, amount, category: categorize(`${merchant ?? ''} ${name}`, iCategory >= 0 ? r[iCategory] : null, iType >= 0 ? r[iType] : null) });
  }
  // Separate debit/credit columns already encode direction (debit = money out).
  return { rows, signKnown: iAmount < 0 };
}

function ofxTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}

function parseOfx(text: string): { rows: ParsedTxn[]; balance: number | null } {
  const rows: ParsedTxn[] = [];
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const date = toIsoDate(ofxTag(block, 'DTPOSTED') ?? '');
    const amt = parseFloat(ofxTag(block, 'TRNAMT') ?? '');
    if (!date || isNaN(amt) || amt === 0) continue;
    const name = ofxTag(block, 'NAME') || ofxTag(block, 'MEMO') || '';
    const type = ofxTag(block, 'TRNTYPE');
    // OFX: negative TRNAMT = money out, for bank and card accounts alike.
    rows.push({ date, name, merchant: null, amount: -amt, category: categorize(name, null, type === 'PAYMENT' ? 'payment' : null) });
  }
  const bal = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i);
  return { rows, balance: bal ? parseFloat(bal[1]) : null };
}

export function parseStatement(content: string, filename: string, accountType: string, flip?: boolean): ParseResult {
  const isOfx = /\.(ofx|qfx|qbo)$/i.test(filename) || /<OFX>/i.test(content);
  let rows: ParsedTxn[];
  let balance: number | null = null;
  let flipped = false;

  if (isOfx) {
    ({ rows, balance } = parseOfx(content));
    if (balance != null && (accountType === 'credit' || accountType === 'loan')) balance = Math.abs(balance);
  } else {
    const parsed = parseCsv(content);
    rows = parsed.rows;
    if (!parsed.signKnown) {
      // Most rows on a statement are purchases; make the majority sign "money out".
      const purchases = rows.filter(r => r.category !== 'LOAN_PAYMENTS');
      const negatives = purchases.filter(r => r.amount < 0).length;
      flipped = negatives > purchases.length / 2;
    }
  }
  if (flip) flipped = !flipped;
  if (flipped) rows = rows.map(r => ({ ...r, amount: -r.amount }));
  if (!rows.length) throw Object.assign(new Error('No transactions found in that file'), { status: 400 });
  return { format: isOfx ? 'ofx' : 'csv', rows, balance, flipped };
}

export function importStatement(accountId: string, parsed: ParseResult) {
  const insert = db.prepare(`INSERT OR IGNORE INTO transactions (transaction_id, account_id, item_id, amount, date, name, merchant_name, category, pending)
    VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, 0)`);
  const seen = new Map<string, number>();
  let inserted = 0;

  db.transaction(() => {
    for (const r of parsed.rows) {
      // Keyed on date+amount (not description) so CSV and OFX exports of the same month dedupe against each other;
      // the occurrence counter keeps genuinely repeated same-day charges distinct.
      const base = `${r.date}|${r.amount.toFixed(2)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const id = 'imp_' + crypto.createHash('sha1').update(`${accountId}|${base}|${n}`).digest('hex').slice(0, 24);
      inserted += insert.run(id, accountId, r.amount, r.date, r.name, r.merchant, r.category).changes;
    }
    if (parsed.balance != null) setManualBalance(accountId, parsed.balance);
    db.prepare("UPDATE accounts SET updated_at = datetime('now') WHERE account_id = ?").run(accountId);
  })();

  return { inserted, duplicates: parsed.rows.length - inserted };
}

export function setManualBalance(accountId: string, balance: number) {
  db.prepare('UPDATE accounts SET current_balance = ? WHERE account_id = ?').run(balance, accountId);
  db.prepare("UPDATE debts SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?").run(Math.abs(balance), accountId);
}
