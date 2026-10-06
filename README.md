# Keyo Lab: calculator demo for GitHub Pages

This is a small real integration with your existing Keyo API, not a fake key checker. Basic calculations are free. A signed PRO or ENTERPRISE entitlement unlocks per-account, memory-only history and CSV export.

## 1. Deploy this repository on GitHub Pages

Unzip the package and upload the contents into a GitHub repository, keeping `index.html` at its root and the `keyo` folder intact. No build tools are needed.

In GitHub, open Settings → Pages → Build and deployment → Deploy from a branch. Choose `main` and `/ (root)`, then Save. Wait for the Pages deployment. Open the URL GitHub shows, normally `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

The free calculator and instructions work immediately. Key activation requires step 2.

## 2. Connect it to Keyo

1. Open your owner dashboard at https://keyo-api.spacexmzez.workers.dev/ and log in there with ADMIN_SECRET.
2. Create a separate project named Calculator demo. Separating projects prevents licenses for this demo from also unlocking Taskitator.
3. In project settings, allow your exact Pages origin, such as `https://YOUR-USERNAME.github.io`. Do not include the repository path or a trailing slash. The demo displays the exact origin to copy. If using a custom domain, use its origin instead.
4. For this selected project, open Client SDK → Get configured SDK → Download SDK.
5. Replace the file `keyo/keyo-client.js` in your GitHub repository with the downloaded `keyo-client.js`. The downloaded file includes the real SDK and a `createKeyoClient(accountId)` function configured for this project. Commit the replacement and wait for Pages to redeploy.
6. Create one key in Keyo: tier PRO, lifetime enabled, max distinct accounts 1. Copy it from the one-time reveal.
7. In the demo, choose User A and activate that key. History and export unlock.

Do not enter your admin secret into the demo. GitHub receives only the SDK's public configuration. Never upload ADMIN_SECRET, HMAC_PEPPER, SIGNING_PRIVATE_JWK, or an admin session token. A public verification key verifies signatures; it cannot create valid entitlements.

## 3. Try the lesson

- Calculate before signing in: basic arithmetic is free and needs no key.
- Activate a PRO key as User A: history/export unlock.
- Activate it again as A: this still uses one distinct account.
- Switch to B: B is Free. The same one-account key should fail for B.
- Switch back to A: its valid signed cache restores Pro.
- Pause the key in Keyo. Back in the demo, press Refresh license: Pro is removed. Pausing on the server does not push an instant message to browsers.
- Reactivate the key in Keyo and enter it again as A. Refresh alone cannot recover a token that was cleared after rejection.
- Change the tier to FREE and refresh: the entitlement can still be valid but the demo's Pro feature gate closes. Tier and duration are independent.
- Log out: the current account's cached token is cleared. Its Keyo account binding remains. Entering the same key as that same account works again.
- A fresh browser/device with no cached token needs the key again. This prototype does not have automatic account-based license discovery.

## How the code is separated

| File | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Calculator screen and explanations |
| `demo.js` | Calculator math, history, rendering, and this product's Pro feature rule |
| `keyo/license-service.js` | App-independent adapter for account selection, activation, refresh, and logout |
| `keyo/keyo-client.js` | Official SDK downloaded from the dashboard; contains public project configuration |

The adapter does not import calculator code or access its HTML. Another application can import `createLicenseService` and supply its own callbacks. Only `keyo-client.js` changes when configuring another Keyo project.

```js
import { createLicenseService } from './keyo/license-service.js';

const licensing = createLicenseService({
  onChange: ({ accountId, tier, license }) => {
    // Update your application's interface from verified license state.
    // license is null for a Free user without an active entitlement.
  },
  onEvent: message => console.log(message)
});

// After your app authenticates the user:
await licensing.signIn(authenticatedUser.id);

// When the user submits the upgrade form:
await licensing.activate(enteredKey);

// On an explicit license refresh:
await licensing.refresh();

// When your app logs out:
licensing.signOut();
```

The example variables `authenticatedUser` and `enteredKey` come from your own application. Keyo does not supply a login screen for your customers.

## What happens on the network

Activation sends `POST /api/v1/activate?projectId=PUBLIC_CLIENT_ID` with `{accountId, key}`. Keyo looks up the project's hashed key, checks state/expiry/capacity, and binds the account idempotently. It returns an ECDSA-signed entitlement.

The SDK checks its signature using the public verification key, checks account and project identity, and saves the signed token in the account-specific localStorage entry. It does not store the raw activation key.

Refresh sends `POST /api/v1/verify?projectId=PUBLIC_CLIENT_ID` with `{accountId, entitlement}`. Keyo rechecks the database and issues a fresh entitlement, or rejects it. Explicit suspension, revocation, deletion, or expiration clears the cached entitlement.

On load, a valid signed cache can unlock features without a new activation. The SDK may refresh caches older than one hour in the background. Cache validity is at most 24 hours and cannot exceed license expiration. Temporary network failure can leave an otherwise valid cache usable until its deadline. The demo's one-second timer only checks local expiry; it does not poll Keyo.

## Applying this to Taskitator

Taskitator owns user registration, passwords, sessions, AI endpoints, and usage counters. Keyo owns which project/account has which license tier and expiration.

1. Create a separate Taskitator project in Keyo and allow Taskitator's frontend origin.
2. Configure its own SDK. After Taskitator's real login, use the stable authenticated account ID.
3. Give every registered account its Free allowance without requiring a license key.
4. Add an Upgrade form using `activate()`. Display the tier from the verified entitlement.
5. Enforce the actual daily AI allowance inside Taskitator's backend, using authenticated identity and a verified license. Its server should independently verify the signature, project, account, and expiration, or use Keyo's verification endpoint for a current database check. It must compare the entitlement account with the authenticated caller.
6. Count requests server-side; selecting a Pro-looking interface must never grant a larger allowance by itself. Keep AI provider secrets on the backend.

The existing Keyo prototype accepts account IDs supplied by the caller; its origin whitelist is not authentication. Before selling account-bound access, integrate trusted application authentication into the activation/verification path (for example, route through your backend and have Keyo require project-scoped server authentication or validated identity assertions). Merely adding a proxy while leaving the public endpoint accepting arbitrary account IDs does not establish trusted identity. This demo deliberately uses mock account buttons to teach the license lifecycle, not to prove account ownership.

Client-side feature gates can always be modified by a browser user. That is fine for this educational calculator. For paid server resources such as AI calls, the server must enforce access. An offline signed cache also means owner changes are not guaranteed to take effect instantly; choose server verification/freshness rules for paid actions.

## Troubleshooting

- “Configure Keyo first”: replace the placeholder `keyo/keyo-client.js` with the configured SDK downloaded from your dashboard.
- ORIGIN_FORBIDDEN: allow the displayed origin in the selected project's settings.
- KEY_UNAVAILABLE: confirm the key is in that same project, active, unexpired, and has capacity for this account.
- INVALID_PROJECT: download a fresh configured SDK after rotating the client ID.
- Network/CORS error: check the API address inside the downloaded SDK and the project's origins.
- No cache to refresh: enter the activation key again. Refresh needs an existing token.
- Pro not unlocked despite successful activation: use tier PRO or ENTERPRISE; other tiers do not unlock this demo's history feature.

No changes to the Keyo Worker or D1 schema are required for this demo.
