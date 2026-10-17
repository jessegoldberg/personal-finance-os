import { db } from './db';

// Some lenders' payments arrive from Plaid labeled as ordinary spending (e.g. "WEB Grow Financial Grow OLB" as Services).
// Those dollars are already counted in debt minimums, so leaving them in spending double-counts them.

const ALIASES: [RegExp, string[]][] = [
  [/synchrony/i, ['synchrony', 'syncb']],
  [/apple/i, ['apple card', 'gs bank']],
  [/edward jones|elan/i, ['edward jones', 'elan financial']],
  [/third federal/i, ['third federal']],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// Distinctive lender phrases: the first two words of the institution or debt name ("grow financial", "third federal",
// "bank of america"). Single words are too loose (a lender "Edward Jones" vs an "Edward's" restaurant), so the only
// single-word matches come from the alias list above.
function phrasesFor(name: string): string[] {
  const words = norm(name).split(' ').filter(Boolean);
  if (words.length < 2) return [];
  return [words[1] === 'of' && words[2] ? words.slice(0, 3).join(' ') : words.slice(0, 2).join(' ')];
}

export function lenderPhrases(): string[] {
  const debts = db.prepare(`SELECT d.name, i.institution_name FROM debts d
    LEFT JOIN accounts a USING(account_id) LEFT JOIN items i ON i.item_id = a.item_id AND i.products != 'manual'
    WHERE d.balance > 0`).all();
  const phrases = new Set<string>();
  for (const d of debts) {
    for (const p of [...phrasesFor(d.institution_name ?? ''), ...phrasesFor(d.name)]) phrases.add(p);
    for (const [re, aliases] of ALIASES) if (re.test(`${d.name} ${d.institution_name ?? ''}`)) aliases.forEach(a => phrases.add(a));
  }
  // Too short to be specific (e.g. "the bank").
  return [...phrases].filter(p => p.replace(/ /g, '').length >= 6);
}

// Payments out of checking/savings to a known lender become debt payments. Only touches rows labeled Services/Other
// that nobody has categorized by hand, so purchases and the household's own choices are never overridden.
export function reclassifyDebtPayments(): number {
  const phrases = lenderPhrases();
  if (!phrases.length) return 0;
  const rows = db.prepare(`SELECT t.transaction_id, t.name, t.merchant_name FROM transactions t JOIN accounts a USING(account_id)
    WHERE a.type = 'depository' AND t.amount > 0 AND t.category IN ('GENERAL_SERVICES', 'OTHER') AND t.category_source IS NULL`).all();
  const update = db.prepare("UPDATE transactions SET category = 'LOAN_PAYMENTS', category_source = 'debt_match' WHERE transaction_id = ?");
  let changed = 0;
  db.transaction(() => {
    for (const r of rows) {
      const text = ` ${norm(`${r.merchant_name ?? ''} ${r.name ?? ''}`)} `;
      if (phrases.some(p => text.includes(` ${p} `))) changed += update.run(r.transaction_id).changes;
    }
  })();
  if (changed) console.log(`Reclassified ${changed} lender payments as debt payments`);
  return changed;
}
