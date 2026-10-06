import { z } from 'zod';
import { db } from './db';
import { webResearch, structured, requireKey } from './ai';

export interface Home {
  id: string; address: string; property_type: string | null; bedrooms: number | null; bathrooms: number | null; sqft: number | null;
  year_built: number | null; escrow_monthly: number | null; purchase_price: number | null; purchase_date: string | null; condition: string | null; notes: string | null;
  manual_value: number | null; debt_ids: string; valuation: string | null; valued_at: string | null;
}

export function getHome(): Home | null {
  return db.prepare("SELECT * FROM properties WHERE id = 'home'").get() ?? null;
}

// The API caps structured outputs at 16 nullable fields, so "unknown" is encoded as 0 / "" and mapped back to null below.
const n = (what: string) => z.number().describe(`${what}; 0 if unknown`);
const t = (what: string) => z.string().describe(`${what}; empty string if unknown`);

const ValuationSchema = z.object({
  subject: z.object({
    address: z.string(),
    bedrooms: n('bedrooms'), bathrooms: n('bathrooms'), sqft: n('finished square feet'),
    year_built: n('year built'), lot_sqft: n('lot size in square feet'),
    last_sale_price: n('last sale price'), last_sale_date: t('last sale date YYYY-MM-DD'),
    county_appraised_value: n('county assessor/auditor market value'), county_appraisal_year: t('tax year of that appraisal'),
  }),
  public_estimates: z.array(z.object({ source: z.string(), value: z.number(), as_of: t('as-of date'), url: t('source URL') })),
  comps: z.array(z.object({
    address: z.string(), price: z.number(), date: t('sale or list date YYYY-MM-DD'), status: z.enum(['sold', 'pending', 'active', 'unknown']),
    sqft: n('square feet'), bedrooms: n('bedrooms'), bathrooms: n('bathrooms'),
    distance_miles: n('distance from subject in miles'), source: z.string(), url: t('listing/record URL'),
  })),
  market: z.object({
    summary: z.string(),
    yoy_price_change_pct: z.number().nullable().describe('year-over-year local price change %, null if unknown'),
    median_days_on_market: n('median days on market'),
    mortgage_rate_30yr: n('average 30-year fixed rate %'), mortgage_rate_15yr: n('average 15-year fixed rate %'),
    heloc_rate_typical: n('typical HELOC rate %'), rate_source: t('where the rates came from'),
    typical_rent_similar_home: n('typical monthly rent for a home like the subject nearby'),
    typical_price_smaller_home: n('typical recent sale price of a smaller/cheaper home (about one bedroom fewer or ~25% less space) in the same area'),
  }),
  estimate: z.object({
    value: z.number(), low: z.number(), high: z.number(), confidence: z.enum(['high', 'medium', 'low']),
  }),
  methodology: z.string().describe('2-4 sentences: how sources were weighted and why'),
  adjustments: z.array(z.object({ factor: z.string(), impact: z.string() })),
  caveats: z.array(z.string()),
});

type Raw = z.infer<typeof ValuationSchema>;
type Nullish<T> = { [K in keyof T]: T[K] extends number ? number | null : T[K] extends string ? string | null : T[K] };
const nul = <T extends Record<string, any>>(o: T, keep: string[] = []): Nullish<T> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, keep.includes(k) ? v : (v === 0 || v === '' ? null : v)])) as Nullish<T>;

function denull(r: Raw) {
  return {
    ...r,
    subject: nul(r.subject, ['address']),
    public_estimates: r.public_estimates.map(p => nul(p, ['source', 'value'])),
    comps: r.comps.map(c => nul(c, ['address', 'price', 'status', 'source'])),
    market: nul(r.market, ['summary', 'yoy_price_change_pct']),
  };
}

export type Valuation = ReturnType<typeof denull> & {
  rentcast: { price: number; low: number; high: number } | null;
  rentcast_error: string | null;
  ppsf_check: { median_ppsf: number; implied_value: number; comps_used: number } | null;
  created_at: string;
};

async function fetchRentcast(home: Home) {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) return { data: null, error: 'RENTCAST_API_KEY not set — using web research only' };
  const params = new URLSearchParams({ address: home.address, compCount: '20', maxRadius: '1.5', daysOld: '365', lookupSubjectAttributes: 'true' });
  if (home.property_type) params.set('propertyType', home.property_type);
  if (home.bedrooms) params.set('bedrooms', String(home.bedrooms));
  if (home.bathrooms) params.set('bathrooms', String(home.bathrooms));
  if (home.sqft) params.set('squareFootage', String(home.sqft));
  try {
    const res = await fetch(`https://api.rentcast.io/v1/avm/value?${params}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
    if (!res.ok) return { data: null, error: `RentCast returned ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { data: await res.json() as any, error: null };
  } catch (e: any) {
    return { data: null, error: `RentCast request failed: ${e.message}` };
  }
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
}

function ppsfCheck(comps: { price: number; sqft: number | null; status: string }[], subjectSqft: number | null) {
  if (!subjectSqft) return null;
  const usable = comps.filter(c => c.sqft && c.sqft > 300 && c.price > 10000 && c.status !== 'active');
  const pool = usable.length >= 3 ? usable : comps.filter(c => c.sqft && c.sqft > 300 && c.price > 10000);
  if (pool.length < 3) return null;
  const m = median(pool.map(c => c.price / c.sqft!));
  return { median_ppsf: Math.round(m), implied_value: Math.round(m * subjectSqft), comps_used: pool.length };
}

const RESEARCH_SYSTEM = `You are a residential real-estate appraiser producing a careful, defensible market value for a homeowner's own house so they can plan debt payoff. Work like an appraiser doing a desktop valuation:

1. Confirm subject facts (beds, baths, finished sqft, lot, year built, last sale) from public records or listing history.
2. Find the county auditor/assessor appraised value for the parcel.
3. Collect public automated estimates (Zillow, Redfin, Realtor.com, etc.) where they appear in search results.
4. Find closed sales of similar homes nearby — ideally within ~1 mile, last 6-12 months, similar size, age and bed/bath. Prefer SOLD over active listings. Aim for 5+ solid comps.
5. Note the local market trend, today's average 30-year and 15-year fixed mortgage rates and typical HELOC rates, the typical monthly rent for a similar home nearby, and what a smaller/cheaper home in the same area typically sells for (the owners may consider downsizing).
6. Reconcile: weight closed comps most heavily (adjusted for size/condition/age), then automated estimates and the provided property-data API result, and treat assessed value as a floor-ish sanity check (assessments often lag the market). Explain the weighting.

Report every number with its source. Be explicit about uncertainty. Do not invent comps — only use sales you actually found.`;

async function research(home: Home, rentcast: any, ppsf: ReturnType<typeof ppsfCheck>) {
  const facts = {
    address: home.address, property_type: home.property_type, bedrooms: home.bedrooms, bathrooms: home.bathrooms, sqft: home.sqft,
    year_built: home.year_built, condition: home.condition, owner_notes: home.notes, purchase_price: home.purchase_price, purchase_date: home.purchase_date,
  };
  const rc = rentcast ? {
    estimate: rentcast.price, range: [rentcast.priceRangeLow, rentcast.priceRangeHigh], subject: rentcast.subjectProperty,
    comparables: (rentcast.comparables ?? []).map((c: any) => ({
      address: c.formattedAddress, price: c.price, status: c.status, listed: c.listedDate, removed: c.removedDate,
      sqft: c.squareFootage, beds: c.bedrooms, baths: c.bathrooms, year_built: c.yearBuilt, distance_mi: c.distance, correlation: c.correlation,
    })),
  } : null;

  return webResearch(RESEARCH_SYSTEM, `Value this home as of ${new Date().toISOString().slice(0, 10)}.

Owner-provided facts: ${JSON.stringify(facts)}

Property-data API result (RentCast AVM; comps are listing-based, "Inactive" usually means sold/removed): ${rc ? JSON.stringify(rc) : 'unavailable'}

Price-per-sqft check from those comps: ${ppsf ? JSON.stringify(ppsf) : 'unavailable'}

Research with web search, then write your full appraisal notes: subject facts, assessed value, each public estimate, each comp (address, price, date, status, sqft, beds/baths, distance, source URL), market trend, current mortgage/HELOC rates, typical rent for a similar home, typical price of a smaller home nearby, and your reconciled value with low/high range and confidence.`);
}

async function structure(notes: string, home: Home) {
  const raw = await structured(ValuationSchema,
    'Convert these appraisal notes into the required JSON exactly. Copy numbers and URLs as written; use 0 or an empty string where the notes have no value. Mortgage rates are percentages (e.g. 6.3).',
    `Subject: ${home.address}\n\nAppraisal notes:\n${notes}`);
  return denull(raw);
}

export async function valuateHome(): Promise<Valuation> {
  requireKey();
  const home = getHome();
  if (!home) throw Object.assign(new Error('Add your home address first'), { status: 400 });

  const { data: rc, error: rcError } = await fetchRentcast(home);
  const rcComps = (rc?.comparables ?? []).map((c: any) => ({ price: c.price, sqft: c.squareFootage ?? null, status: c.status === 'Active' ? 'active' : 'sold' }));
  const subjectSqft = home.sqft ?? rc?.subjectProperty?.squareFootage ?? null;

  const notes = await research(home, rc, ppsfCheck(rcComps, subjectSqft));
  const structured = await structure(notes, home);

  // Final $/sqft cross-check over every comp we have (API + web research).
  const allComps = [...rcComps, ...structured.comps];
  const valuation: Valuation = {
    ...structured,
    rentcast: rc ? { price: rc.price, low: rc.priceRangeLow, high: rc.priceRangeHigh } : null,
    rentcast_error: rcError,
    ppsf_check: ppsfCheck(allComps, subjectSqft ?? structured.subject.sqft),
    created_at: new Date().toISOString(),
  };

  // Fill in facts the owner left blank so later valuations and scenarios have them.
  db.prepare(`UPDATE properties SET valuation = ?, valued_at = datetime('now'),
      bedrooms = COALESCE(bedrooms, ?), bathrooms = COALESCE(bathrooms, ?), sqft = COALESCE(sqft, ?), year_built = COALESCE(year_built, ?)
    WHERE id = 'home'`)
    .run(JSON.stringify(valuation), structured.subject.bedrooms, structured.subject.bathrooms, structured.subject.sqft, structured.subject.year_built);
  return valuation;
}

export function homeSummary() {
  const home = getHome();
  if (!home) return null;
  const valuation: Valuation | null = home.valuation ? JSON.parse(home.valuation) : null;
  const ids: string[] = JSON.parse(home.debt_ids || '[]');
  const debts = ids.length
    ? db.prepare(`SELECT id, name, kind, balance, apr, min_payment FROM debts WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const value = home.manual_value ?? valuation?.estimate.value ?? null;
  const owed = debts.reduce((s: number, d: any) => s + d.balance, 0);
  return {
    home, valuation, debts, value, owed,
    equity: value != null ? value - owed : null,
    ltv: value ? owed / value : null,
    // What a lender would typically let you borrow against the house in total.
    borrowable_at_80: value ? Math.max(0, value * 0.8 - owed) : null,
    borrowable_at_85: value ? Math.max(0, value * 0.85 - owed) : null,
  };
}
