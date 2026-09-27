// NextWave V2 production — REUSABLE ASSET VOCABULARY and its deterministic selection rules.
// Families available (Ideogram art is text-free and carries no numbers; every label/figure is drawn programmatically):
//   CARRIERS (heap-capable, value = height of the coin heap in the open bed): wagon, sacks cart, chest cart
//   CARRIERS/SUBJECTS (not heap-capable): piggy cart, home cart (kept in the library; used as subjects/anchors)
//   TERRAIN: day road, dusk road, coast, neighbourhood street, finance plaza (+ tall variants for Short) + kitchen (pre-existing)
//   PROPS: illustrated house, toll booth (fee object), piggy bank; vector metaphors: hourglass, jar, coins, tree (pre-existing)
// SELECTION IS FROM SEMANTICS ONLY (no random rotation, no per-video choice):
//   carrier  : subject role decides. principal (lump sum)  -> chest cart;  recurring amount with weekly/yearly cadence -> sacks cart;
//              recurring amount monthly (the default contribution story) -> wagon.
//   terrain  : race -> principal: dusk road, recurring: day road (a time-of-day tint then advances with the journey in both).
//              bars  -> loan/rate/mortgage: neighbourhood + illustrated house anchor; fee/invest/return: finance plaza (+ toll booth when the
//              trailing subject is a fee/charge); prices: kitchen; otherwise the city set.
//              orchard -> finance plaza (a money tree grows in the financial district).
//              narrative bridges -> by topic: loan: neighbourhood, time: road, invest: finance plaza, prices: kitchen, hook/close: studio.
//   metaphor : house -> illustrated house; savings/deposit/account wording -> piggy bank; hourglass/jar/tree/coins as before.
export const ASSET_FAMILIES = ['wagon', 'sacks_cart', 'chest_cart', 'piggy_cart', 'home_cart', 'road_day', 'road_dusk', 'coast', 'neighbourhood', 'finance_plaza', 'kitchen', 'house', 'toll_booth', 'piggy_bank', 'hourglass', 'jar', 'tree', 'coins', 'studio', 'office', 'city'];
export const CARRIERS = { wagon: { key: 'wagon', rim: 0.56, heapW: 0.66, w: 1.0 }, sacks: { key: 'cartSacks', rim: 0.6, heapW: 0.42, w: 1.15 }, chest: { key: 'cartChest', rim: 0.44, heapW: 0.36, w: 0.85 } };
export function carrierFor(subj) { if (subj && subj.role === 'principal') return 'chest'; if (subj && subj.role === 'recurring_amount' && /week|year|day/i.test(subj.cadence || '')) return 'sacks'; return 'wagon'; }
export function raceTerrain(subj) { return subj && subj.role === 'principal' ? 'nightWide' : 'roadWide'; }
export function barEnv(topic, labels) { const t = String(labels || ''); if (topic === 'loan') return 'neighbourhood'; if (topic === 'price') return 'kitchen'; if (topic === 'invest' || /fee|charg|return|fund/i.test(t)) return 'finance'; return 'city'; }
export const usedFamily = (sel) => sel;
