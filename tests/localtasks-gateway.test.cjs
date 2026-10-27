const test = require('node:test');
const assert = require('node:assert/strict');
const { gatewayPromptBytes } = require('../backend/dist/localgateway');
let writes = 0, mode = 'valid', requests = [];
const rows = Array.from({ length: 10 }, (_, i) => ({ transaction_id: 'synthetic-' + i,
  name: 'é'.repeat(60), merchant_name: 'é'.repeat(60), amount: 123.45 }));
const db = { prepare: sql => ({
  all: () => rows,
  get: () => ({ count: rows.length - writes, total: 0 }),
  run: () => { if (sql.startsWith('UPDATE')) writes++; return { changes: 1 }; },
}), transaction: fn => fn };
require.cache[require.resolve('../backend/dist/db')] = { exports: { db } };
require.cache[require.resolve('../backend/dist/analytics')] = { exports: { getOverview: () => { throw Error('Full account facts must not be read'); } } };
require.cache[require.resolve('../backend/dist/planner')] = { exports: {} };
require.cache[require.resolve('../backend/dist/advisor')] = { exports: {} };
require.cache[require.resolve('../backend/dist/debtplan-data')] = { exports: { currentDebtPlan: () => ({
  generated_on: '2026-10-26', status: 'needs_data', monthly_income: 4000, living_costs: 3000, minimum_payments: 100,
  planned_expenses: 200, monthly_tax_reserve: 0, reserve_contribution: 100, monthly_surplus: 700, extra_payment: 0,
  missing_data: ['Synthetic missing APR'], priorities: [{ name: 'Private account details must stay out' }],
}) } };
require.cache[require.resolve('../backend/dist/localllm')] = { exports: {
  localConfig: () => ({ provider: 'gateway', maxPromptBytes: 2048 }),
  localChat: async (feature, messages, opts = {}) => {
    assert.ok(gatewayPromptBytes(messages, opts.format) <= 2048);
    requests.push({ feature, messages, opts });
    if (feature === 'chat') return { content: 'Synthetic explanation', truncated: false };
    const count = messages[1].content.split('\n').length - 1;
    const results = Array.from({ length: count }, (_, i) => ({ i: mode === 'duplicate' ? 0 : i, category: 'FOOD_AND_DRINK' }));
    if (mode === 'outOfRange') results[0].i = -1;
    return { content: JSON.stringify({ results }), truncated: mode === 'truncated' };
  },
} };
const { localAsk, categorizeUncategorized } = require('../backend/dist/localtasks');
test.beforeEach(() => { writes = 0; requests = []; mode = 'valid'; });
test('gateway chat uses bounded calculated facts and omits detailed accounts and prior history', async () => {
  const result = await localAsk([{ role: 'user', content: 'Private prior message' }, { role: 'assistant', content: 'Old answer' }, { role: 'user', content: 'Explain the summary' }]);
  assert.equal(result.reply, 'Synthetic explanation');
  assert.equal(requests[0].messages.length, 2);
  const text = JSON.stringify(requests[0].messages);
  assert.equal(text.includes('Private prior message'), false); assert.equal(text.includes('Private account'), false);
  assert.match(text, /needs_data/); assert.match(text, /extra_payment\\":0/);
});
test('categorization fits schema plus Unicode descriptions into each bounded request', async () => {
  const result = await categorizeUncategorized();
  assert.equal(result.error, null); assert.equal(result.processed, 10); assert.equal(result.updated, 10);
  assert.ok(requests.length > 1); assert.equal(writes, 10);
});
test('invalid indexes and truncated structured output cannot modify even synthetic categories', async () => {
  for (const bad of ['outOfRange', 'truncated']) {
    mode = bad; const result = await categorizeUncategorized();
    assert.ok(result.error); assert.equal(result.updated, 0); assert.equal(writes, 0);
  }
});
