import https from 'node:https';
import { readFileSync, statSync } from 'node:fs';

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const MAX_RESPONSE_BYTES = 262_144;

function smallFile(path: string) {
  if (!path || statSync(path).size > 16_384) throw new Error('Invalid local credential file');
  return readFileSync(path, 'utf8');
}

// Per-request trust and bearer auth. No global TLS overrides, redirects, retries,
// paid-provider fallback, prompt logging, or secret material in public status.
export async function gatewayRequest(baseUrl: string, route: string, timeoutMs: number, body?: object): Promise<any> {
  let base: URL, key: string, ca: string;
  try {
    base = new URL(baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/v1') throw new Error();
    key = JSON.parse(smallFile(process.env.LOCAL_LLM_CREDENTIAL_FILE || '')).api_key;
    ca = smallFile(process.env.LOCAL_LLM_CA_CERT_FILE || '');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(key) || !ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error();
  } catch {
    throw fail(503, 'The local gateway URL, credential, or trusted CA is not configured correctly.');
  }
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(`${base.pathname}${route}`, base.origin), {
      method: payload ? 'POST' : 'GET', ca, rejectUnauthorized: true, agent: false,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) { req.destroy(fail(502, 'The local gateway response exceeded its size limit.')); return; }
        chunks.push(chunk);
      });
      response.on('error', () => reject(fail(503, 'Lost connection to the local gateway.')));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          const status = response.statusCode;
          reject(fail(status === 413 ? 413 : 503, status === 401 || status === 403
            ? 'The local gateway credential is expired, invalid, or does not permit this model.'
            : status === 429 ? 'The local gateway is busy or its request allowance is reached. Try again later.'
            : status === 413 ? 'This request exceeds the local gateway prompt limit. Ask a shorter question.'
            : `The local gateway could not serve this request (HTTP ${status}).`));
          return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(fail(502, 'The local gateway returned an invalid response.')); }
      });
    });
    const deadline = setTimeout(() => req.destroy(fail(504, 'The local gateway request timed out.')), timeoutMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', (error: any) => reject(error.status ? error : fail(503, 'Cannot reach the local gateway with verified TLS.')));
    req.end(payload);
  });
}

export function gatewayFormat(format?: object) {
  return format ? { type: 'json_schema', json_schema: { name: 'local_result', schema: format } } : undefined;
}

export function gatewayPromptBytes(messages: object[], format?: object) {
  return Buffer.byteLength(JSON.stringify({ messages, ...(format ? { response_format: gatewayFormat(format) } : {}) }));
}
