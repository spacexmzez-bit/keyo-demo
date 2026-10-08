// Keyo browser SDK. Use from a module script or bundle as an ES module.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REFRESH_MS = 60 * 60 * 1000;
const DENIED = new Set(['SUSPENDED', 'REVOKED', 'DELETED', 'EXPIRED', 'INVALID_ENTITLEMENT', 'INVALID_PROJECT']);

function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Bad token encoding');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

function safeAccountId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:@-]{1,128}$/.test(value);
}

export class KeyoClient {
  constructor({ endpoint, projectId, accountId, publicKey, storage = globalThis.localStorage,
    fetchImpl = globalThis.fetch, now = () => Date.now(), refreshIntervalMs = DEFAULT_REFRESH_MS }) {
    if (!endpoint || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId ?? '') || !safeAccountId(accountId) || !publicKey)
      throw new Error('Keyo endpoint, projectId, accountId, and publicKey are required');
    if (typeof fetchImpl !== 'function' || !storage || !Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0)
      throw new Error('Invalid Keyo client options');
    this.endpoint = endpoint;
    this.projectId = projectId;
    this.accountId = accountId;
    this.publicKey = typeof publicKey === 'string' ? JSON.parse(publicKey) : publicKey;
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.refreshIntervalMs = refreshIntervalMs;
    this.listeners = new Set();
    this.entitlement = null;
    this.token = null;
    this.generation = 0;
    this.pending = null;
    this.verificationKey = null;
  }

  get storageKey() { return `keyo_${this.projectId}_${this.accountId}`; }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.entitlement);
    return () => this.listeners.delete(listener);
  }

  publish(entitlement) {
    this.entitlement = entitlement;
    for (const listener of this.listeners) listener(entitlement);
  }

  getLicense() {
    if (this.entitlement && this.entitlement.validUntil <= this.now()) {
      this.publish(null);
    }
    return this.entitlement;
  }

  async parse(token, accountId = this.accountId, allowExpired = false) {
    if (typeof token !== 'string' || token.length > 4096) throw new Error('Invalid entitlement');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid entitlement');
    const header = JSON.parse(decoder.decode(decode(parts[0])));
    if (header.alg !== 'ES256' || header.typ !== 'KEYO') throw new Error('Invalid entitlement');
    this.verificationKey ||= await crypto.subtle.importKey('jwk', this.publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, this.verificationKey,
      decode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) throw new Error('Invalid entitlement signature');
    const data = JSON.parse(decoder.decode(decode(parts[1])));
    const now = this.now();
    if (data.v !== 1 || data.projectId !== this.projectId || data.accountId !== accountId ||
      typeof data.tier !== 'string' || !data.tier || typeof data.bindingId !== 'string' ||
      typeof data.keyId !== 'string' || !Number.isSafeInteger(data.issuedAt) ||
      !Number.isSafeInteger(data.validUntil) || data.issuedAt > now + 60000 ||
      (!allowExpired && data.validUntil <= now) || data.validUntil <= data.issuedAt ||
      data.validUntil > data.issuedAt + DAY_MS ||
      !(data.expiresAt === null || Number.isSafeInteger(data.expiresAt)) ||
      (data.expiresAt !== null && ((!allowExpired && data.expiresAt <= now) || data.validUntil > data.expiresAt))) {
      throw new Error('Entitlement expired or mismatched');
    }
    return data;
  }

  async load() {
    const generation = this.generation;
    const accountId = this.accountId;
    const storageKey = this.storageKey;
    let cached;
    try { cached = JSON.parse(this.storage.getItem(storageKey)); } catch { /* ignore invalid cache */ }
    if (!cached?.token) return null;
    try {
      const data = await this.parse(cached.token, accountId, true);
      if (generation !== this.generation) return null;
      this.token = cached.token;
      const activeCache = data.validUntil > this.now() && (data.expiresAt === null || data.expiresAt > this.now());
      this.publish(activeCache ? data : null);
      if (!activeCache || this.now() - data.issuedAt >= this.refreshIntervalMs) {
        // Keep the signed cache during a temporary network failure.
        void this.refresh().catch(() => {});
      }
      return activeCache ? data : null;
    } catch {
      if (generation === this.generation) this.clear();
      return null;
    }
  }

  async request(path, body) {
    const url = new URL(`/api/v1/${path}`, this.endpoint);
    url.searchParams.set('projectId', this.projectId);
    const response = await this.fetchImpl(url.toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) {
      const issue = new Error(result.error || 'KEYO_REQUEST_FAILED');
      issue.code = result.error || 'KEYO_REQUEST_FAILED';
      throw issue;
    }
    if (typeof result.entitlement !== 'string') throw new Error('Missing entitlement');
    return result.entitlement;
  }

  async accept(token, generation, accountId) {
    const data = await this.parse(token, accountId);
    if (generation !== this.generation || accountId !== this.accountId) return null;
    this.storage.setItem(this.storageKey, JSON.stringify({ token }));
    this.token = token;
    this.publish(data);
    return data;
  }

  async activate(key) {
    const generation = this.generation;
    const accountId = this.accountId;
    const token = await this.request('activate', { accountId, key });
    return this.accept(token, generation, accountId);
  }

  async refresh() {
    if (!this.token) return null;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const accountId = this.accountId;
    const originalToken = this.token;
    const promise = (async () => {
      try {
        const token = await this.request('verify', { accountId, entitlement: originalToken });
        return this.accept(token, generation, accountId);
      } catch (issue) {
        if (generation === this.generation && DENIED.has(issue.code)) this.clear();
        throw issue;
      }
    })();
    this.pending = promise;
    try { return await promise; }
    finally { if (this.pending === promise) this.pending = null; }
  }

  // 'Restore License' refreshes an existing token. If all cached information
  // has been removed, the user must re-enter the activation key.
  async restore() { return this.refresh(); }

  clear() {
    this.storage.removeItem(this.storageKey);
    this.token = null;
    this.publish(null);
  }

  async setAccount(accountId) {
    if (!safeAccountId(accountId)) throw new Error('Invalid accountId');
    this.generation++;
    this.accountId = accountId;
    this.token = null;
    this.pending = null;
    this.publish(null);
    return this.load();
  }

  logout() {
    this.generation++;
    this.clear();
  }
}

export default KeyoClient;


// Call createKeyoClient with the signed-in account ID from your app.
export function createKeyoClient(accountId) {
  return new KeyoClient({ ...{
  "endpoint": "https://keyo.mazendev.com",
  "projectId": "prj_4edf906e4bcd4d00aba3b95af35435bd",
  "publicKey": {
    "key_ops": [
      "verify"
    ],
    "ext": true,
    "kty": "EC",
    "x": "12kmFYFug4HYBs-ZTpRleElP9Q8kpQaI5aVyG9CqVOc",
    "y": "Up7x4X65FL-LaRweIptSkCZsXN4A3mZM7XIIHRzNndY",
    "crv": "P-256"
  }
}, accountId });
}
