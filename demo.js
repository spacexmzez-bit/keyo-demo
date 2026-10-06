// Calculator and teaching UI only. All Keyo calls live in keyo/license-service.js.
import { createLicenseService } from './keyo/license-service.js';
const $ = id => document.getElementById(id);
const histories = new Map();
let result = { expression: '12 + 4', value: 16 }, busy = false;
const proTiers = new Set(['PRO', 'ENTERPRISE']); // Your product chooses which tiers unlock which features.
function feedback(text, error = false) { $('feedback').textContent = text; $('feedback').classList.toggle('error', error); }
function event(text) { const li = document.createElement('li'); li.textContent = new Date().toLocaleTimeString() + ' · ' + text; $('events').prepend(li); while ($('events').children.length > 30) $('events').lastChild.remove(); }
const license = createLicenseService({ onChange: render, onEvent: event });
function render() {
  const { accountId, tier, license: entitlement } = license.snapshot();
  const isPro = !!accountId && proTiers.has(tier.toUpperCase());
  $('plan').textContent = accountId ? tier : 'Signed out';
  $('account').textContent = accountId ? 'Current demo account: ' + accountId : 'Choose an account to begin.';
  $('tier').textContent = tier;
  $('expires').textContent = entitlement ? (entitlement.expiresAt ? new Date(entitlement.expiresAt).toLocaleString() : 'Lifetime') : 'No license';
  $('cache').textContent = entitlement ? new Date(entitlement.validUntil).toLocaleString() : 'No cache';
  $('save').disabled = $('export').disabled = !isPro;
  $('activate').disabled = $('restore').disabled = !accountId || busy;
  $('logout').disabled = !accountId || busy;
  document.querySelectorAll('[data-account]').forEach(b => { b.disabled = busy; b.setAttribute('aria-pressed', String(b.dataset.account === accountId)); });
  $('gate').textContent = isPro ? 'Pro unlocked for this account.' : 'A PRO or ENTERPRISE license unlocks history and export.';
  $('history').replaceChildren();
  // Histories are deliberately memory-only and separate per demo account.
  if (isPro) for (const row of histories.get(accountId) || []) { const li = document.createElement('li'); li.textContent = row.expression + ' = ' + row.value; $('history').append(li); }
}
const explanations = {
  KEY_UNAVAILABLE: 'This key cannot activate. Check its project, status, expiration, and account limit. If User A already claimed a one-account key, User B cannot use it.',
  ORIGIN_FORBIDDEN: 'Add ' + location.origin + ' to this project’s allowed origins in your Keyo dashboard.',
  INVALID_PROJECT: 'The client publishing ID is invalid or rotated. Download a fresh SDK from the correct project.',
  SUSPENDED: 'The owner paused this key. The cached license was cleared.',
  REVOKED: 'The key was revoked. The cached license was cleared.',
  DELETED: 'The key was archived or deleted. The cached license was cleared.',
  EXPIRED: 'This license expired. The cached license was cleared.',
  RATE_LIMITED: 'Too many requests. Wait a minute and retry.'
};
async function action(fn) {
  if (busy) return;
  busy = true; render();
  try { await fn(); }
  catch (error) { const text = explanations[error.code] || error.message; feedback(text, true); event('Action failed: ' + (error.code || error.message)); }
  finally { busy = false; render(); }
}
document.querySelectorAll('[data-account]').forEach(b => b.onclick = () => action(async () => {
  await license.signIn(b.dataset.account); feedback('Account selected. Activate a key below, or use its valid cached license.');
}));
$('logout').onclick = () => { license.signOut(); feedback('Logged out. Signing back in requires re-entering the key if the cache was cleared.'); };
$('activation').onsubmit = e => { e.preventDefault(); action(async () => {
  const entitlement = await license.activate($('key').value.trim());
  $('key').value = '';
  feedback(entitlement ? 'License activated. Its tier is ' + entitlement.tier + '.' : 'Account changed before activation finished. Try again.');
}); };
$('restore').onclick = () => action(async () => { await license.refresh(); feedback('License refreshed from Keyo.'); });
$('calculator').onsubmit = e => {
  e.preventDefault(); const a = Number($('a').value), b = Number($('b').value), op = $('operation').value;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return feedback('Enter finite numbers.', true);
  if (op === 'divide' && b === 0) return feedback('Division by zero is undefined.', true);
  const value = ({ add: () => a + b, subtract: () => a - b, multiply: () => a * b, divide: () => a / b })[op]();
  if (!Number.isFinite(value)) return feedback('Result is too large.', true);
  result = { expression: a + ' ' + ({add:'+',subtract:'−',multiply:'×',divide:'÷'})[op] + ' ' + b, value };
  $('answer').textContent = String(value);
};
function requirePro() {
  const value = license.snapshot();
  if (!value.accountId || !proTiers.has(value.tier.toUpperCase())) throw Error('Activate a Pro license first.');
  return value.accountId;
}
$('save').onclick = () => action(async () => { const id = requirePro(), rows = histories.get(id) || []; rows.unshift({...result}); histories.set(id, rows.slice(0,100)); feedback('Result saved for this demo account.'); });
$('export').onclick = () => action(async () => {
  const rows = histories.get(requirePro()) || [];
  if (!rows.length) throw Error('Save a result first.');
  const csv = 'first_number,operation,second_number,result\r\n' + rows.map(r => { const [a,op,b] = r.expression.split(' '); return [a,op,b,r.value].join(','); }).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'})), a = document.createElement('a'); a.href = url; a.download = 'calculator-history.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
$('origin').textContent = location.origin;
$('copyOrigin').onclick = () => action(async () => { await navigator.clipboard.writeText(location.origin); feedback('Origin copied. Paste it into your Keyo project’s allowed origins.'); });
// Check cache deadlines locally. This timer does not make network requests.
setInterval(render,1000);
render(); event('Ready. Connect the project using the guide, then choose a demo account.');
