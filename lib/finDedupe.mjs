// Finance V2 duplicate and transfer handling (phase 2A design, unwired). PURE.
//  - the same provider transaction is stored once (provider + account + provider transaction id); a pending transaction is replaced by its posted version;
//  - the same real transaction seen by TWO DIFFERENT providers (same account fingerprint, date within a day, same amount, similar merchant) is kept once — the higher-priority provider wins;
//  - two identical purchases inside ONE provider (different ids) are NOT duplicates;
//  - transfers between OWNED accounts (equal and opposite amounts within 3 days) are paired and marked transfer, so they never count as income or expense.
export const normalizeMerchant = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(pos|debit|purchase|payment|card|ach|inc|llc|co)\b/g, ' ').replace(/\s+/g, ' ').trim();
const cents = (a) => Math.round(Number(a) * 100);
const dayNum = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 86400000);
export const providerKey = (t) => `${t.provider}|${t.account_id}|${t.provider_txn_id}`;
export const fuzzyKey = (t) => `${t.account_fingerprint}|${cents(t.amount)}`;
export function dedupe(txns, { priority = ['plaid', 'snaptrade', 'manual'] } = {}) {
  const rank = (p) => { const i = priority.indexOf(p); return i < 0 ? 99 : i; };
  const dropped = []; let rows = [];
  // 1. same provider id: keep the last seen; a posted row replaces the pending row it points to
  const byKey = new Map();
  for (const t of txns) { const k = providerKey(t); if (byKey.has(k)) dropped.push({ dropped: byKey.get(k), kept: t, reason: 'same_provider_id' }); byKey.set(k, t); }
  rows = [...byKey.values()];
  const pendingIds = new Set(rows.filter((t) => !t.pending && t.pending_txn_id).map((t) => `${t.provider}|${t.account_id}|${t.pending_txn_id}`));
  rows = rows.filter((t) => { if (t.pending && pendingIds.has(providerKey(t))) { dropped.push({ dropped: t, kept: null, reason: 'pending_replaced_by_posted' }); return false; } return true; });
  // 2. cross-provider fuzzy duplicates (different providers only)
  const out = []; const groups = new Map();
  for (const t of rows) { const k = fuzzyKey(t); (groups.get(k) || groups.set(k, []).get(k)).push(t); }
  for (const g of groups.values()) {
    const kept = [];
    for (const t of g) {
      const twin = kept.find((x) => x.provider !== t.provider && Math.abs(dayNum(x.date) - dayNum(t.date)) <= 1 && (normalizeMerchant(x.merchant) === normalizeMerchant(t.merchant) || normalizeMerchant(x.merchant).includes(normalizeMerchant(t.merchant)) || normalizeMerchant(t.merchant).includes(normalizeMerchant(x.merchant))));
      if (!twin) { kept.push(t); continue; }
      if (rank(t.provider) < rank(twin.provider)) { dropped.push({ dropped: twin, kept: t, reason: 'cross_provider_duplicate' }); kept[kept.indexOf(twin)] = t; } else dropped.push({ dropped: t, kept: twin, reason: 'cross_provider_duplicate' });
    }
    out.push(...kept);
  }
  return { kept: out, dropped };
}
// owned: Set of account fingerprints the CEO owns. Equal-and-opposite amounts on two different owned accounts within 3 days → both rows kind 'transfer' with the same pair id. Each row pairs once.
export function pairTransfers(txns, owned) {
  const rows = txns.map((t) => ({ ...t })); const used = new Set(); let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (used.has(i) || !owned.has(rows[i].account_fingerprint)) continue;
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(j) || !owned.has(rows[j].account_fingerprint) || rows[j].account_fingerprint === rows[i].account_fingerprint) continue;
      if (cents(rows[i].amount) === -cents(rows[j].amount) && cents(rows[i].amount) !== 0 && Math.abs(dayNum(rows[i].date) - dayNum(rows[j].date)) <= 3) { const id = 'pair-' + (++n); rows[i].kind = rows[j].kind = 'transfer'; rows[i].transfer_pair_id = rows[j].transfer_pair_id = id; used.add(i); used.add(j); break; }
    }
  }
  return rows;
}
