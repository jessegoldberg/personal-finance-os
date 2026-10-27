const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfo-gateway-'));
function certificate(name) {
  if (process.env.LOCAL_GATEWAY_TEST_TLS_DIR) {
    const root = process.env.LOCAL_GATEWAY_TEST_TLS_DIR;
    return { key: fs.readFileSync(path.join(root, name + '.key')), cert: fs.readFileSync(path.join(root, name + '.crt')), path: path.join(root, name + '.crt') };
  }
  const key = path.join(dir, name + '.key'), cert = path.join(dir, name + '.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=synthetic-local-test', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert), path: cert };
}
const tls = certificate('server'), untrusted = certificate('untrusted');
const key = crypto.randomBytes(32).toString('hex');
const credential = path.join(dir, 'credential.json');
fs.writeFileSync(credential, JSON.stringify({ api_key: key }), { mode: 0o600 });
process.env.LOCAL_LLM_PROVIDER = 'gateway';
process.env.LOCAL_LLM_MODEL = 'local-pc';
process.env.LOCAL_LLM_CREDENTIAL_FILE = credential;
process.env.LOCAL_LLM_CA_CERT_FILE = tls.path;
const usage = [];
require.cache[require.resolve('../backend/dist/ai')] = { exports: { recordUsage: (...args) => usage.push(args) } };
const { localStatus, localChat, localEnabled } = require('../backend/dist/localllm');
let server, mode = 'ok', calls = [], lastBody;
const messages = [{ role: 'user', content: 'Synthetic greeting only' }];
test.before(async () => {
  server = https.createServer(tls, (req, res) => {
    calls.push(req.url);
    assert.equal(req.headers.authorization, 'Bearer ' + key);
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'auth') { res.writeHead(401); res.end(JSON.stringify({ error: key + ' private provider details' })); return; }
      if (mode === 'redirect') { res.writeHead(307, { Location: `https://127.0.0.1:${server.address().port}/redirect-target` }); res.end('{}'); return; }
      if (mode === 'slow') return; // client must enforce an absolute deadline
      if (mode === 'huge') { res.end('x'.repeat(270000)); return; }
      if (mode === 'invalid') { res.end('not-json'); return; }
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'local-pc' }] })); return; }
      assert.equal(req.url, '/v1/chat/completions');
      lastBody = JSON.parse(raw);
      res.end(JSON.stringify({ choices: [{ message: { content: mode === 'empty' ? '' : 'Synthetic answer' }, finish_reason: mode === 'truncated' ? 'length' : 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.LOCAL_LLM_BASE_URL = `https://127.0.0.1:${server.address().port}/v1`;
});
test.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true }); });
test.afterEach(() => { mode = 'ok'; process.env.LOCAL_LLM_CA_CERT_FILE = tls.path; delete process.env.LOCAL_LLM_TIMEOUT_MS; });
test('authenticated model discovery exposes no credential or file contents', async () => {
  const status = await localStatus();
  assert.equal(status.enabled, true); assert.equal(status.reachable, true); assert.equal(status.modelInstalled, true);
  assert.equal(status.maxPromptBytes, 2048); assert.equal(JSON.stringify(status).includes(key), false);
  process.env.LOCAL_LLM_CREDENTIAL_FILE = '';
  assert.equal(localEnabled(), false); assert.equal((await localStatus()).reachable, false);
  process.env.LOCAL_LLM_CREDENTIAL_FILE = credential;
});
test('completion preserves structured schema, limits and local token accounting', async () => {
  const format = { type: 'object', properties: { results: { type: 'array' } } };
  const result = await localChat('categorize', messages, { format, maxTokens: 240 });
  assert.equal(result.content, 'Synthetic answer'); assert.equal(result.truncated, false);
  assert.equal(lastBody.model, 'local-pc'); assert.equal(lastBody.stream, false); assert.equal(lastBody.max_tokens, 240);
  assert.deepEqual(lastBody.response_format.json_schema.schema, format);
  assert.equal(lastBody.options, undefined); assert.equal(lastBody.tools, undefined);
  const row = usage.at(-1); assert.deepEqual(row.slice(0, 3), ['local', 'categorize', 'local-pc']);
  assert.equal(row[3].input, 12); assert.equal(row[3].output, 3);
  mode = 'truncated'; assert.equal((await localChat('test', messages)).truncated, true);
});
test('invalid auth and provider failures are sanitized and never retried or sent to Claude', async () => {
  for (const failure of ['auth', 'empty', 'invalid', 'huge', 'redirect']) {
    mode = failure; const before = calls.length;
    await assert.rejects(() => localChat('test', messages), error => !error.message.includes(key) && !error.message.includes('private provider details'));
    assert.equal(calls.length, before + 1); assert.equal(usage.at(-1)[0], 'local'); assert.equal(usage.at(-1)[3].ok, false);
  }
});
test('untrusted TLS and unsafe URLs fail closed without hitting an HTTP handler', async () => {
  process.env.LOCAL_LLM_CA_CERT_FILE = untrusted.path;
  let before = calls.length;
  await assert.rejects(() => localChat('test', messages), /verified TLS/); assert.equal(calls.length, before);
  process.env.LOCAL_LLM_CA_CERT_FILE = tls.path;
  const valid = process.env.LOCAL_LLM_BASE_URL;
  for (const url of ['http://127.0.0.1/v1', 'https://user:pass@127.0.0.1/v1', valid + '?key=bad']) {
    process.env.LOCAL_LLM_BASE_URL = url;
    await assert.rejects(() => localChat('test', messages), /not configured correctly/);
  }
  process.env.LOCAL_LLM_BASE_URL = valid;
});
test('byte and output bounds fail before any network request; timeouts release the queue', async () => {
  const before = calls.length;
  await assert.rejects(() => localChat('test', [{ role: 'user', content: 'é'.repeat(1200) }]), /prompt limit/);
  await assert.rejects(() => localChat('test', messages, { maxTokens: 1025 }), /output limit/);
  assert.equal(calls.length, before);
  mode = 'slow'; process.env.LOCAL_LLM_TIMEOUT_MS = '100';
  await assert.rejects(() => localChat('test', messages), /timed out/);
  mode = 'ok'; delete process.env.LOCAL_LLM_TIMEOUT_MS;
  assert.equal((await localChat('test', messages)).content, 'Synthetic answer');
});
test('native Ollama remains compatible', async () => {
  const oldFetch = global.fetch;
  process.env.LOCAL_LLM_PROVIDER = 'ollama';
  global.fetch = async url => ({ ok: true, json: async () => url.endsWith('/api/tags')
    ? { models: [{ name: 'local-pc' }] } : { message: { content: 'Native synthetic answer' }, prompt_eval_count: 7, eval_count: 2 } });
  try { assert.equal((await localChat('test', messages)).content, 'Native synthetic answer'); }
  finally { global.fetch = oldFetch; process.env.LOCAL_LLM_PROVIDER = 'gateway'; }
});
