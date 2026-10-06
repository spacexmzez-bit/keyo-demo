// This module contains only licensing logic. It knows nothing about calculators,
// buttons, or Taskitator. Reuse it in another site with its own UI callbacks.
import { createKeyoClient } from './keyo-client.js';

export function createLicenseService({ onChange = () => {}, onEvent = () => {} } = {}) {
  let client = null, unsubscribe = null, accountId = null, generation = 0;
  const snapshot = () => {
    const license = client?.getLicense() || null;
    return { accountId, license, tier: license?.tier || 'FREE' };
  };
  const publish = () => onChange(snapshot());
  return {
    snapshot,
    async signIn(id) {
      // On a real site, id comes from an authenticated session, not a textbox.
      const current = ++generation;
      if (!client) {
        client = createKeyoClient(id);
        // Instrument the SDK's existing fetch function without logging payloads.
        const fetchImpl = client.fetchImpl;
        client.fetchImpl = async (url, options) => {
          const operation = new URL(url).pathname.endsWith('/activate') ? 'Activation' : 'Verification';
          onEvent(operation + ' request sent to Keyo.');
          try {
            const response = await fetchImpl(url, options);
            onEvent(operation + ' response: HTTP ' + response.status + '.');
            return response;
          } catch (error) { onEvent(operation + ' could not reach the server.'); throw error; }
        };
        accountId = id;
        unsubscribe = client.subscribe(publish);
        await client.load(); // Reads and verifies this account's signed cache.
      } else {
        accountId = id;
        await client.setAccount(id); // Isolates caches when accounts change.
      }
      if (current !== generation) return;
      onEvent('Signed in as ' + id + '. Valid cached licenses can load without an activation request.');
      publish();
    },
    async activate(key) {
      if (!client || !accountId) throw Error('Sign in first.');
      const value = await client.activate(key); // Claim a key; verify and cache its signed entitlement.
      if (value) onEvent('Signed entitlement accepted. Tier: ' + value.tier + '.');
      return value;
    },
    async refresh() {
      if (!client?.token) throw Error('No cached license to refresh. Enter your activation key first.');
      return client.restore(); // Ask Keyo for current status/tier/expiry.
    },
    signOut() {
      generation++;
      unsubscribe?.(); unsubscribe = null;
      client?.logout(); // Clears this account's local cache, not its server binding.
      client = null; accountId = null;
      publish(); onEvent('Logged out. This account’s local license cache was removed.');
    }
  };
}
