// NextWave V2 — AUTONOMOUS STORYBOARD BRAIN (deterministic, $0, no vendor calls).
//
// FULL SCRIPT -> meaning units -> per-mention semantic roles -> semantic
// grouping -> treatment planning -> evidence binding + verification ->
// storyboard spec (one object per scene, directly consumable by the existing
// Long-format renderer dispatcher `nextwave_v2_composite_long_segment`).
//
// Zero-dependency module (same pattern as nextwaveV2EvidenceBinding.mjs) so it
// is testable without importing api/ops.js. The existing production pieces
// are INJECTED, not copied:
//   deps.segmentMeaningUnits   = nextwaveSegmentMeaningUnits
//   deps.wordsToNumber         = _nextwaveWordsToNumber
//   deps.numberRegexSource     = NEXTWAVE_V2_DYNAMIC_NUMBER_RE.source
//   deps.classifyLongTreatment = nwv2ClassifyLongTreatment (used as an
//                                independent cross-check of the semantic pick)
//
// Design rules (from the order):
//  * A value's ROLE is decided by the linguistic context around its own
//    mention (clause-local cue scoring), never by its position in a regex
//    result array. Ties / no-cue => left UNBOUND and reported, never guessed.
//  * Every authoritative value carries provenance: `script` (verbatim span),
//    `derived` (formula + input value ids), or `assumed_illustrative`
//    (explicitly flagged; never presented as script fact).
//  * A stated value that contradicts a deterministic calculation from the
//    script's own inputs is a BLOCKING integrity issue (the spoken number is
//    kept — on-screen must match audio — but the storyboard is not clean).
//  * No topic/title-specific rules. Rules speak in general financial
//    semantics: recurring contribution, one-time transfer, principal/term,
//    rate, delay, process window, price change, scenario comparison, gap.

export const BRAIN_VERSION = '1.0';

// ── lexical data ────────────────────────────────────────────────────────────
const NUM_WORD = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const RANGE_RE = new RegExp(`\\b(\\d+(?:\\.\\d+)?|${NUM_WORD})\\s*(?:to|or|-|–)\\s*(\\d+(?:\\.\\d+)?|${NUM_WORD})\\s+(days?|weeks?|months?|years?)\\b`, 'gi');
const FREQ_RE = /\b(?:every|each|per|a|an)\s+(day|week|month|quarter|year)\b|\b(daily|weekly|monthly|quarterly|annually|yearly)\b/gi;
const FREQ_ADV = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', annually: 'year', yearly: 'year' };
export const CADENCE_ABBR = { day: 'DAY', week: 'WK', month: 'MO', quarter: 'QTR', year: 'YR' };
const CONTRAST_START_RE = /^\s*(but|however|instead|whereas|while|yet|otherwise|on the other hand)\b/i;
const ARM_SPLIT_RE = /\b(?:but if|but|while|whereas|however|instead|otherwise|compared (?:to|with)|versus)\b/gi;
const BASELINE_CUE_RE = /\b(today|right now|now|immediately|right away|from the start|this year)\b/i;
const DIFF_ROLES = ['delay_period', 'rate', 'fee_rate', 'principal', 'recurring_amount'];
const DATA_ROLES = new Set(['recurring_amount', 'transfer_amount', 'principal', 'outcome', 'gap', 'change_pct', 'process_window', 'rate', 'fee_rate', 'same_as']);
const YEARS_PER = { day: 1 / 365, week: 1 / 52, month: 1 / 12, year: 1 };

// ── small utilities ─────────────────────────────────────────────────────────
export const fmtMoney = (v) => '$' + Math.round(v).toLocaleString('en-US');
export const fmtPct = (v) => `${Number.isInteger(v) ? v : +v.toFixed(2)}%`;
export const unitWord = (unit, n) => unit.toUpperCase() + (n === 1 ? '' : 'S');
export const fmtDur = (v, unit) => (Array.isArray(v) ? `${v[0]}-${v[1]} ${unitWord(unit, v[1])}` : `${v} ${unitWord(unit, v)}`);
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
export const upperBound = (v) => (Array.isArray(v) ? v[1] : v);
export const toYears = (v, unit) => upperBound(v) * (YEARS_PER[unit] || 1);
const has = (re, s) => re.test(s || '');

export function meaningEventPattern(raw) {
  const t = String(raw).trim();
  if (/[\d$%]/.test(t)) return escapeRe(t);
  const toks = t.split(/[\s,-]+/).filter((w) => w && !/^(and|dollars?|percent|years?|months?|weeks?|days?)$/i.test(w));
  return toks.slice(0, 3).join('[\\s,-]+');
}

// ── deterministic calculators (general; each fires only when its input roles exist)
export function fvRecurring(pmt, annualRatePct, months) {
  if (months <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  return r === 0 ? pmt * months : pmt * ((Math.pow(1 + r, months) - 1) / r);
}
export function loanTotalPaid(principal, annualRatePct, years) {
  const r = annualRatePct / 100 / 12, n = years * 12;
  const m = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
  return m * n;
}
export const withinRounding = (stated, derived) => Math.abs(stated - derived) <= Math.max(1, 0.0005 * Math.abs(derived));

// ── stage 2: quantity mentions ──────────────────────────────────────────────
function parseNumeric(raw, deps) {
  const t = raw.trim();
  let m;
  if ((m = t.match(/^\$\s?([\d,]+(?:\.\d+)?)(?:\s?(k|m|b|thousand|million|billion))?$/i))) {
    const scale = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[(m[2] || '').toLowerCase()] || 1;
    return { kind: 'money', value: parseFloat(m[1].replace(/,/g, '')) * scale };
  }
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s?%$/))) return { kind: 'percent', value: parseFloat(m[1]) };
  const { value, suffix } = deps.wordsToNumber(t);
  if (!(value > 0)) return null;
  if (suffix === 'dollar') return { kind: 'money', value };
  if (suffix === 'percent') return { kind: 'percent', value };
  if (suffix && suffix.startsWith('duration:')) return { kind: 'duration', value, unit: suffix.slice(9) };
  if (suffix === 'times') return { kind: 'multiplier', value };
  return { kind: 'count', value };
}
const wordOrDigit = (tok, deps) => (/^\d/.test(tok) ? parseFloat(tok) : deps.wordsToNumber(tok).value);

function extractMentions(text, deps) {
  const mentions = [];
  const consumed = [];
  const overlaps = (s, e) => consumed.some((c) => s < c[1] && e > c[0]);
  for (const m of text.matchAll(RANGE_RE)) {
    const lo = wordOrDigit(m[1], deps), hi = wordOrDigit(m[2], deps);
    if (!(lo > 0 && hi > 0)) continue;
    const s = m.index, e = m.index + m[0].length;
    mentions.push({ raw: m[0], start: s, end: e, kind: 'duration', value: [lo, hi], unit: m[3].toLowerCase().replace(/s$/, '') });
    consumed.push([s, e]);
  }
  for (const m of text.matchAll(new RegExp(deps.numberRegexSource, 'gi'))) {
    const s = m.index, e = m.index + m[0].length;
    if (overlaps(s, e)) continue;
    const parsed = parseNumeric(m[0], deps);
    if (!parsed) continue;
    mentions.push({ raw: m[0].trim(), start: s, end: e, ...parsed });
  }
  mentions.sort((a, b) => a.start - b.start);
  const freqs = [];
  for (const m of text.matchAll(FREQ_RE)) {
    const before = text.slice(Math.max(0, m.index - 8), m.index).toLowerCase();
    if (/\b(for|in|after|within|over)\s$/.test(before)) continue; // a duration, not a cadence
    const cadence = m[1] ? m[1].toLowerCase() : FREQ_ADV[m[2].toLowerCase()];
    freqs.push({ raw: m[0], start: m.index, end: m.index + m[0].length, cadence });
  }
  return { mentions, freqs };
}

// ── stage 3: role scoring from local context ────────────────────────────────
function clauseCuts(text, mentions) {
  const inMention = (i) => mentions.some((m) => i >= m.start && i < m.end);
  const cuts = [-1];
  for (let i = 0; i < text.length; i++) if (',;—–:'.includes(text[i]) && !inMention(i)) cuts.push(i);
  cuts.push(text.length);
  return cuts;
}
function clauseAround(cuts, start, end) {
  for (let i = 0; i < cuts.length - 1; i++) if (start > cuts[i] && end <= cuts[i + 1] + 1) return [cuts[i] + 1, cuts[i + 1]];
  return [0, cuts[cuts.length - 1]];
}

function contextFor(text, m, cuts, freqs) {
  const [cs, ce] = clauseAround(cuts, m.start, m.end);
  const clause = text.slice(cs, ce).toLowerCase();
  const left = text.slice(cs, m.start).toLowerCase();
  const right = text.slice(m.end, ce).toLowerCase();
  const rightFreq = freqs.find((f) => f.start >= m.end && f.start - m.end <= 30 && f.start <= ce);
  const clauseFreq = freqs.find((f) => f.start >= cs && f.end <= ce);
  return {
    clause, left, right,
    nearLeft: left.slice(-48), nearRight: right.slice(0, 48),
    sentence: text.toLowerCase(),
    freqRight: rightFreq || null, freqClause: clauseFreq || null,
  };
}

function scoreRoles(m, c) {
  const S = [];
  const add = (role, score) => S.push({ role, score });
  if (m.kind === 'money') {
    let rec = 0;
    if (c.freqRight) rec += 4;
    if (c.freqClause) rec += 2;
    if (has(/\b(invest|contribut|deposit|sav(?:e|ing)|put|pay|paying|set aside|add)/, c.clause)) rec += 1;
    if (!c.freqRight && !c.freqClause) rec = 0;
    add('recurring_amount', rec);
    let out = 0;
    if (has(/(grows? to|grew to|end(?:s)? up with|ends? with|reach(?:es)?|becomes?|totals? of|balance of|left with|comes? to|amounts? to|adds? up to|pay(?:s)? back|paid back|repay|will have)/, c.nearLeft)) out += 2;
    // "worth $X" is ambiguous (a balance, or a summary of a gap): a weak cue
    // that can never bind a role on its own.
    if (has(/\bworth\b/, c.nearLeft)) out += 1;
    if (has(/\b(in total|altogether|in all|total)\b/, c.nearRight)) out += 3;
    if (has(/^\s*(after|by)\b/, c.nearRight)) out += 1.5;
    add('outcome', out);
    let gp = 0;
    if (has(/(difference|gap|shortfall|extra)/, c.nearRight)) gp += 4;
    if (has(/(extra|additional|shortfall|short by|saves?|saved|savings|advantage)/, c.nearLeft)) gp += 3;
    if (has(/(cost(?:s)? you|adds?\b)/, c.nearLeft)) gp += 2;
    add('gap', gp);
    let tr = 0;
    if (has(/(paid|pays|pay you|paying you|received?|sent|sends|deposited|withdr[ae]w|payout|distribution|dividend|transfer|earned|bonus|refund)/, c.clause)) tr += 2;
    add('transfer_amount', tr);
    let pr = 0;
    if (!c.freqRight && !c.freqClause && has(/(borrow(?:s|ed)?|owe[sd]?|loan of|mortgage of|invest(?:s|ed)?|put|start(?:s|ing)? with|principal|lump sum|deposit|balance of)/, c.nearLeft)) pr += 2;
    add('principal', pr);
    let same = 0;
    if (has(/\b(the|that|this)? ?same\b/, c.nearLeft)) same += 3;
    add('same_as', same);
  } else if (m.kind === 'percent') {
    let rate = 0;
    if (has(/(return|yield|interest|\brate\b|apr|apy|annual|annually|per year|growth)/, c.clause)) rate += 2;
    if (has(/annual|per year/, c.clause)) rate += 1;
    add('rate', rate);
    let chg = 0;
    if (has(/\b(rise|rises|rose|increase[sd]?|jump(?:s|ed)?|gain(?:s|ed)?|climb(?:s|ed)?|up)\b/, c.nearLeft)) chg += 3;
    if (has(/\b(fall|falls|fell|drop(?:s|ped)?|decline[sd]?|decrease[sd]?|down|lose[sd]?|dip(?:s|ped)?|slump)\b/, c.nearLeft)) chg += 3;
    add('change_pct', chg);
    let fee = 0;
    if (has(/(fee|fees|expense ratio|charges?|commission)/, c.clause)) fee += 3;
    add('fee_rate', fee);
  } else if (m.kind === 'duration') {
    let delay = 0;
    if (has(/(wait(?:s|ing|ed)?|delay(?:s|ing|ed)?|postpone|hold off|put off)\s*(?:for\s*)?(?:another\s*)?$/, c.nearLeft) || has(/(wait(?:s|ing|ed)?|delay(?:s|ing|ed)?|postpone)/, c.nearLeft)) delay += 3;
    if (has(/^\s*(?:of\s+)?(head start|before you (?:start|begin)|before starting|later)/, c.nearRight)) delay += 3;
    if (has(/(start(?:s|ing)? in|start(?:s|ing)? after)\s*$/, c.nearLeft)) delay += 3;
    add('delay_period', delay);
    let proc = 0;
    if (has(/(take(?:s|n)?|taking|needs?|requires?)/, c.nearLeft)) proc += 2;
    if (has(/^\s*to (?:process|settle|clear|complete|arrive|finish)/, c.nearRight)) proc += 3;
    if (proc > 0 && m.unit === 'day') proc += 1;
    add('process_window', proc);
    let rem = 0;
    if (has(/(remaining|rest of|left)/, c.nearLeft)) rem += 4;
    add('remaining_period', rem);
    let hor = 0;
    if (has(/(after|over|for|within|across|in)\s*(?:the\s+)?(?:next\s+)?$/, c.nearLeft)) hor += 2;
    if (hor > 0 && has(/(grow|worth|end up|pay back|borrow|loan|mortgage|term|balance)/, c.sentence)) hor += 1;
    add('horizon', hor);
  }
  return S.sort((a, b) => b.score - a.score);
}

const MIN_ROLE_EVIDENCE = 2; // a single weak cue is not enough to bind a financial role
function pickRole(scored) {
  const [best, second] = scored;
  if (!best || best.score <= 0) return { role: null, reason: 'no role cue in local context', candidates: scored.filter((s) => s.score > 0) };
  if (best.score < MIN_ROLE_EVIDENCE) return { role: null, reason: `insufficient evidence: ${best.role}=${best.score} < ${MIN_ROLE_EVIDENCE}`, candidates: scored.filter((s) => s.score > 0) };
  if (second && best.score - second.score < 1) return { role: null, reason: `ambiguous: ${best.role}=${best.score} vs ${second.role}=${second.score}`, candidates: scored.filter((s) => s.score > 0) };
  return { role: best.role, score: best.score };
}

function outcomeSubtype(ctx) {
  if (has(/(pay(?:s)? back|paid back|repay|in total|total cost|interest paid)/, ctx.nearLeft + ' ' + ctx.nearRight)) return 'total_paid';
  if (has(/(grows?|worth|end(?:s)? up|balance|reach|becomes?)/, ctx.nearLeft)) return 'balance';
  return 'value';
}

// Independent of the shared number regex: any digit run, or spelled-number run
// followed (within two words) by a unit word, that no extracted mention covers
// is a quantity the Brain did not account for. Reported, never dropped silently.
export function auditCoverage(units) {
  const uncovered = [];
  const wordRun = new RegExp(`\\b(?:(?:${NUM_WORD}|hundred|thousand|million|billion)[\\s,-]+)*(?:${NUM_WORD}|hundred|thousand|million|billion)\\b(?:\\s+[a-z]+){0,2}?\\s+(?:dollars?|percent|days?|weeks?|months?|years?|times)\\b`, 'gi');
  units.forEach((u) => {
    const spans = u.mentions.map((m) => [m.start, m.end]).concat((u.freqs || []).map((f) => [f.start, f.end]));
    const covered = (s, e) => spans.some(([a, b]) => s < b && e > a);
    const note = (s, e, token) => uncovered.push({ unit_id: u.unit, token, context: u.text.slice(Math.max(0, s - 24), e + 24) });
    for (const m of u.text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) if (!covered(m.index, m.index + m[0].length)) note(m.index, m.index + m[0].length, m[0]);
    for (const m of u.text.matchAll(wordRun)) if (!covered(m.index, m.index + m[0].length)) note(m.index, m.index + m[0].length, m[0]);
  });
  return uncovered;
}

// ── stage 4: unit analysis ──────────────────────────────────────────────────
export function analyzeUnit(u, deps) {
  const text = u.text;
  const { mentions, freqs } = extractMentions(text, deps);
  const cuts = clauseCuts(text, mentions);
  const bounds = [0];
  for (const m of text.matchAll(ARM_SPLIT_RE)) if (m.index > 0) bounds.push(m.index);
  bounds.push(text.length);
  const arms = [];
  for (let i = 0; i < bounds.length - 1; i++) arms.push({ index: i, start: bounds[i], end: bounds[i + 1] });
  const armOf = (pos) => (arms.find((a) => pos >= a.start && pos < a.end) || arms[0]).index;
  mentions.forEach((m, i) => {
    m.id = `${u.unit}.m${i}`;
    m.unit_id = u.unit;
    m.arm = armOf(m.start);
    const ctx = contextFor(text, m, cuts, freqs);
    m.ctx = ctx;
    const scored = scoreRoles(m, ctx);
    const pick = pickRole(scored);
    m.role = pick.role;
    m.role_reason = pick.reason || null;
    m.role_candidates = pick.candidates || [];
    if (m.role === 'outcome') m.subtype = outcomeSubtype(ctx);
    if (m.role === 'recurring_amount') m.cadence = (ctx.freqRight || ctx.freqClause).cadence;
    if (m.role === 'change_pct') m.direction = has(/\b(fall|falls|fell|drop|decline|decrease|down|lose|dip|slump)/, ctx.nearLeft) ? 'down' : 'up';
  });
  const roles = new Set(mentions.map((m) => m.role).filter(Boolean));
  const consequence = has(/\b(buys?|purchases?|gets?|can buy|will buy)\b/i, text) && text.match(/\b(fewer|less)\s+([a-z]+)/i)
    ? { kind: 'fewer_units', noun: text.match(/\b(fewer|less)\s+([a-z]+)/i)[2].toLowerCase() } : null;
  return {
    ...u,
    mentions, freqs, arms,
    startsWithContrast: CONTRAST_START_RE.test(text),
    dataBearing: [...roles].some((r) => DATA_ROLES.has(r)),
    roles,
    consequence,
    duringRef: /\b(during|while|over|within|throughout)\s+(that|this|the)\s+(wait|delay|window|period|process)\b/i.test(text),
  };
}

// ── stage 5: grouping ───────────────────────────────────────────────────────
function armParams(unit, armIdx) {
  const p = {};
  unit.mentions.filter((m) => m.arm === armIdx && m.role && (DIFF_ROLES.includes(m.role) || m.role === 'horizon' || m.role === 'remaining_period')).forEach((m) => { p[m.role] = m; });
  return p;
}
function outcomeArms(units) {
  const arms = [];
  units.forEach((u) => u.arms.forEach((a) => {
    const outs = u.mentions.filter((m) => m.arm === a.index && m.role === 'outcome');
    if (outs.length) arms.push({ unit: u, arm: a, outcomes: outs, params: armParams(u, a.index), text: u.text.slice(a.start, a.end) });
  }));
  return arms;
}
// Which parameter distinguishes two scenarios? Delay differs by mere presence
// (no delay = the baseline); other roles differ only when both arms state a
// different value (an unstated role is inherited from the shared setup).
function differentiator(a, b) {
  if (!!a.params.delay_period !== !!b.params.delay_period) return 'delay_period';
  for (const role of DIFF_ROLES) {
    if (role === 'delay_period') continue;
    const x = a.params[role], y = b.params[role];
    if (x && y && JSON.stringify(x.value) !== JSON.stringify(y.value)) return role;
  }
  return null;
}
function groupFeatures(units) {
  const all = units.flatMap((u) => u.mentions);
  const has_ = (r) => all.some((m) => m.role === r);
  const oa = outcomeArms(units);
  return {
    outcomeArms: oa, hasOutcome: oa.length > 0, hasGap: has_('gap'), hasTransfer: has_('transfer_amount'),
    hasRecurring: has_('recurring_amount'), hasPrincipal: has_('principal'), hasProcess: has_('process_window'),
    hasChange: has_('change_pct'), hasSame: has_('same_as'), consequence: units.find((u) => u.consequence) || null,
  };
}
function seriesDerivable(unitsUpTo, oa) {
  const all = unitsUpTo.flatMap((u) => u.mentions);
  const rec = all.find((m) => m.role === 'recurring_amount');
  if (!rec || rec.cadence !== 'month') return false;
  const rateOk = all.some((m) => m.role === 'rate') || oa.every((a) => a.params.rate);
  const horOk = all.some((m) => m.role === 'horizon') || oa.every((a) => a.params.horizon);
  return rateOk && horOk;
}
function planTreatment(f, unitsUpTo, isPresenter, priorComparison) {
  if (isPresenter) return 'avatar_panel';
  if (f.outcomeArms.length >= 2 && differentiator(f.outcomeArms[0], f.outcomeArms[f.outcomeArms.length - 1])) {
    return seriesDerivable(unitsUpTo, f.outcomeArms) ? 'stock_chart' : 'share_compare';
  }
  if (f.hasGap && priorComparison) return 'share_compare';
  if (f.hasSame || f.consequence) return 'share_compare';
  if (f.hasRecurring || f.hasTransfer || f.hasPrincipal) return 'money_flow';
  if (f.hasProcess) return 'day_cards';
  if (f.hasChange) return 'stock_chart';
  return 'calc_card';
}

function buildGroups(units) {
  const groups = [];
  const mk = (u) => ({ units: [u], presenter: !u.dataBearing });
  for (const u of units) {
    const cur = groups[groups.length - 1];
    if (!cur) { groups.push(mk(u)); continue; }
    let merge = false;
    if (cur.presenter && !u.dataBearing) merge = true; // adjacent presenter sentences
    if (!merge && !cur.presenter && u.dataBearing) {
      const cf = groupFeatures(cur.units);
      const uf = groupFeatures([u]);
      // M1/M5: a further scenario of an outcome already being compared
      if (cf.hasOutcome && uf.hasOutcome) {
        const last = cf.outcomeArms[cf.outcomeArms.length - 1];
        const first = uf.outcomeArms[0];
        const sameKind = (last.outcomes[0].subtype || 'value') === (first.outcomes[0].subtype || 'value') || last.outcomes[0].subtype === 'value' || first.outcomes[0].subtype === 'value';
        if (sameKind && (u.startsWithContrast || differentiator(last, first))) merge = true;
      }
      // M6: consequence (gap) of a comparison that renders as share_compare
      // belongs inside the same evolving scene; if the comparison renders as a
      // chart, the gap is a different visual purpose and stays its own scene.
      if (!merge && uf.hasGap && !uf.hasOutcome && cf.outcomeArms.length >= 2) {
        const idx = units.indexOf(cur.units[cur.units.length - 1]);
        if (planTreatment(cf, units.slice(0, idx + 1), false, false) === 'share_compare') merge = true;
      }
    }
    if (merge) cur.units.push(u); else groups.push(mk(u));
  }
  // Bridge pass: a non-data sentence sandwiched between data scenes is
  // elaboration of the scene before it, not a presenter scene of its own.
  for (let i = groups.length - 2; i >= 1; i--) {
    if (groups[i].presenter && !groups[i - 1].presenter && !groups[i + 1].presenter) {
      groups[i - 1].units.push(...groups[i].units);
      groups.splice(i, 1);
    }
  }
  return groups;
}

// ── stage 6: entities, scenarios, calculators, integrity ────────────────────
let _seq = 0;
function makeEntity(reg, o) {
  const key = `${o.role}|${JSON.stringify(o.value)}|${o.cadence || ''}|${o.direction || ''}`;
  const existing = reg.byKey.get(key);
  if (existing) {
    existing.provenance.also_stated_in = existing.provenance.also_stated_in || [];
    if (o.provenance.unit_id) existing.provenance.also_stated_in.push({ unit_id: o.provenance.unit_id, span_text: o.provenance.span_text });
    return existing;
  }
  const e = { id: `v${++_seq}`, ...o };
  reg.byKey.set(key, e);
  reg.list.push(e);
  return e;
}
function displayFor(m) {
  if (m.kind === 'money') return fmtMoney(m.value);
  if (m.kind === 'percent') return fmtPct(m.value);
  if (m.kind === 'duration') return fmtDur(m.value, m.unit);
  return String(m.value);
}
function entityFromMention(reg, m, extra = {}) {
  return makeEntity(reg, {
    role: m.role, kind: m.kind, value: m.value, unit: m.unit || (m.kind === 'money' ? 'USD' : m.kind === 'percent' ? 'PCT' : undefined),
    display: displayFor(m), cadence: m.cadence, direction: m.direction, subtype: m.subtype,
    provenance: { kind: 'script', unit_id: m.unit_id, span_text: m.raw, start: m.start, end: m.end },
    mention_ids: [m.id], ...extra,
  });
}

function armLabel(arm, diff, baselineWord) {
  if (diff === 'delay_period') {
    if (arm.params.delay_period) return `WAIT ${fmtDur(arm.params.delay_period.value, arm.params.delay_period.unit)}`;
    const w = (baselineWord || '').toLowerCase();
    return w === 'today' ? 'START TODAY' : w === 'now' || w === 'right now' ? 'START NOW' : w ? `START ${w.toUpperCase()}` : 'NO DELAY';
  }
  const m = arm.params[diff];
  if (!m) return null;
  if (diff === 'rate') return `${displayFor(m)} RATE`;
  if (diff === 'fee_rate') return `${displayFor(m)} FEE`;
  if (diff === 'principal') return displayFor(m);
  if (diff === 'recurring_amount') return `${displayFor(m)}/${CADENCE_ABBR[m.cadence] || 'PD'}`;
  return displayFor(m);
}

const TAGS = [
  ['delay', /\b(wait|waiting|delay|later|head start|postpone)\b/i],
  ['dividend', /\b(dividends?|payout|distribution)\b/i],
  ['loan', /\b(borrow|loan|mortgage|debt|lender)\b/i],
  ['invest', /\b(invest|investing|contribut\w*|portfolio)\b/i],
  ['cost', /\b(cost|costs|gap|lose|lost|loss|hidden)\b/i],
];
export const tagsOf = (text) => TAGS.filter(([, re]) => re.test(text)).map(([t]) => t);

// asset lexicon — general visual concepts keyed by semantic tags. Concept
// strings intentionally match previously generated/banked assets where the
// concept is the same, so the resolver's reuse-first lookup hits the cache.
export const ASSET = {
  icon: {
    hourglass: 'small hourglass with golden sand falling, time and money concept',
    coins: 'stack of gold coins with a dollar sign, dividend payment',
    certificate_loss: 'small stock certificate with a red downward arrow, representing lost investment shares',
    tower: 'modern glass and steel brokerage office tower, contemporary corporate architecture, no columns, no pediment, no engraved facade',
    cash: 'stack of cash with a dollar sign, income icon',
    house: 'small house with a key, home loan concept',
    bank: 'modern glass and steel bank office tower, contemporary corporate architecture, no columns, no pediment, no engraved facade',
  },
  bg: {
    flow_dividend: 'a portfolio releasing a dividend payment toward a brokerage building, money flowing between two financial environments, clean minimal composition, no ribbon, no banner, no connecting sash',
    flow_contribution: 'a monthly paycheck being invested into a growing investment portfolio, financial growth environment, contemporary office',
    flow_loan: 'a lender handing a home loan to a home buyer, clean modern financial environment, soft daylight, no signs, no banners',
    trajectory: 'a financial growth environment, coins and small plants growing on an investment desk, portfolio value increasing over time',
    process: 'a large desk calendar and clock inside a financial office, illustrating days passing while a transaction waits to complete',
    price_up: 'a rising stock price chart on a trading desk in a modern financial office',
    price_down: 'a falling stock price chart on a trading desk in a modern financial office',
  },
};

export function nextwaveV2BuildStoryboard(script, deps) {
  _seq = 0;
  if (!script || typeof script !== 'string' || !script.trim()) return { ok: false, error: 'script required' };
  const rawUnits = deps.segmentMeaningUnits(script);
  if (!rawUnits.length) return { ok: false, error: 'no meaning units' };
  const units = rawUnits.map((u) => analyzeUnit(u, deps));
  const groups = buildGroups(units);

  const reg = { byKey: new Map(), list: [] };
  const unbound = [];
  const warnings = [];
  const issues = [];
  const verifications = [];
  units.forEach((u) => u.mentions.filter((m) => !m.role).forEach((m) => unbound.push({ unit_id: u.unit, raw: m.raw, kind: m.kind, reason: m.role_reason, candidates: m.role_candidates })));

  // ── per-group entity binding + comparison structure ───────────────────────
  const scenes = groups.map((g, gi) => {
    const first = g.units[0].unit, last = g.units[g.units.length - 1].unit;
    const text = g.units.map((u) => u.text).join(' ');
    const f = groupFeatures(g.units);
    const scene = {
      scene_id: `S${gi + 1}`, group: g, unit_ids: g.units.map((u) => u.unit), narration: { text, first_unit: first, last_unit: last },
      entity_ids: [], relationships: [], labels: {}, reveal_steps: [], asset_requirements: [], _features: f,
    };
    // bind every role-resolved mention into the registry (scenario info added below)
    g.units.forEach((u) => u.mentions.filter((m) => m.role).forEach((m) => {
      const e = entityFromMention(reg, m);
      m.entity = e;
      if (!scene.entity_ids.includes(e.id)) scene.entity_ids.push(e.id);
    }));
    g.units.forEach((u) => (u.freqs || []).forEach((fq) => {
      const rec = u.mentions.find((m) => m.role === 'recurring_amount' && m.ctx && (m.ctx.freqRight === fq || m.ctx.freqClause === fq));
      if (!rec) return;
      const e = makeEntity(reg, { role: 'cadence', kind: 'cadence', value: fq.cadence, display: fq.raw, provenance: { kind: 'script', unit_id: u.unit, span_text: fq.raw, start: fq.start, end: fq.end } });
      if (!scene.entity_ids.includes(e.id)) scene.entity_ids.push(e.id);
    }));
    return scene;
  });

  const allMentions = units.flatMap((u) => u.mentions);
  const firstOf = (role) => allMentions.find((m) => m.role === role && m.entity);
  const glob = {
    recurring: firstOf('recurring_amount'), rate: allMentions.find((m) => m.role === 'rate' && m.entity && !m.armHasOutcome),
    horizon: firstOf('horizon'), delay: firstOf('delay_period'), principal: firstOf('principal'),
  };

  // ── comparison structure, scenario-tagging, treatment + renderer params ──
  let priorComparison = null; // { scene, arms }
  const lastIdx = scenes.length - 1;
  scenes.forEach((scene, gi) => {
    const g = scene.group;
    const f = scene._features;
    const unitsUpTo = units.slice(0, units.indexOf(g.units[g.units.length - 1]) + 1);
    const isFirst = gi === 0, isLast = gi === lastIdx;
    const treatment = planTreatment(f, unitsUpTo, g.presenter, !!priorComparison);
    scene.treatment = treatment;
    const text = scene.narration.text;
    const tags = tagsOf(text);
    let comparison = null;
    if (!g.presenter && f.outcomeArms.length >= 2) {
      const arms = f.outcomeArms;
      const diff = differentiator(arms[0], arms[arms.length - 1]) || null;
      const baselineWord = (arms.map((a) => (a.text.match(BASELINE_CUE_RE) || [])[0]).find(Boolean)) || '';
      comparison = { differentiator: diff ? (diff === 'delay_period' ? 'delay' : diff === 'rate' ? 'rate' : diff) : null, diff_role: diff, arms: [] };
      arms.forEach((a, ai) => {
        const label = (diff && armLabel(a, diff, ai === 0 || !a.params.delay_period ? baselineWord : '')) || `OPTION ${String.fromCharCode(65 + ai)}`;
        const outEnts = a.outcomes.map((m) => m.entity).filter(Boolean);
        const hasDelay = !!a.params.delay_period;
        outEnts.forEach((e) => { e.scenario_label = label; e.scenario_has_delay = hasDelay; });
        // scenario-scope non-outcome parameters stated inside this arm
        a.unit.mentions.filter((m) => m.arm === a.arm.index && m.role && m.role !== 'outcome' && m.role !== 'gap' && m.entity).forEach((m) => { if (m.entity.scenario_label === undefined && ['delay_period', 'rate', 'fee_rate', 'remaining_period', 'horizon'].includes(m.role)) m.entity.scenario_label = label; });
        comparison.arms.push({ label, has_delay: hasDelay, unit_id: a.unit.unit, outcome_ids: outEnts.map((e) => e.id), params: Object.fromEntries(Object.entries(a.params).map(([r, m]) => [r, m.entity && m.entity.id])), _arm: a });
      });
    }
    scene.comparison = comparison ? { differentiator: comparison.differentiator, arms: comparison.arms.map(({ _arm, ...rest }) => rest) } : null;
    scene._cmp = comparison;
    scene.purpose = purposeOf(scene, f, isFirst, isLast, comparison, priorComparison);
    if (comparison) priorComparison = { scene, cmp: comparison };
  });

  // globals resolved once (entity objects)
  const G = {
    rec: glob.recurring && glob.recurring.entity, cadence: glob.recurring && glob.recurring.cadence,
    horizon: glob.horizon && glob.horizon.entity, principal: glob.principal && glob.principal.entity,
  };
  const globalRate = (allMentions.find((m) => m.role === 'rate' && m.entity && !scenes.some((s) => s._cmp && s._cmp.arms.some((a) => a._arm.params.rate === m))) || {}).entity || null;

  // ── calculators + verification ────────────────────────────────────────────
  scenes.forEach((scene) => {
    const cmp = scene._cmp;
    if (!cmp) return;
    const recEnt = G.rec;
    cmp.arms.forEach((a) => {
      const arm = a._arm;
      const armRate = (arm.params.rate && arm.params.rate.entity) || globalRate;
      const armHor = (arm.params.horizon && arm.params.horizon.entity) || G.horizon;
      const delayM = arm.params.delay_period;
      const delayYears = delayM ? toYears(delayM.value, delayM.unit) : 0;
      const stated = arm.outcomes[0];
      const subtype = stated.subtype;
      a.calc = null;
      if (subtype === 'balance' && recEnt && G.cadence === 'month' && armRate && armHor) {
        const H = toYears(armHor.value, armHor.unit);
        const months = Math.max(0, (H - delayYears)) * 12;
        const derived = fvRecurring(recEnt.value, armRate.value, months);
        a.calc = { kind: 'fv_recurring', derived, H, delayYears, inputs: [recEnt.id, armRate.id, armHor.id, ...(delayM ? [delayM.entity.id] : [])] };
      } else if (subtype === 'total_paid' && G.principal && armRate && (armHor || G.horizon)) {
        const hor = armHor || G.horizon;
        const derived = loanTotalPaid(G.principal.value, armRate.value, toYears(hor.value, hor.unit));
        a.calc = { kind: 'loan_total_paid', derived, inputs: [G.principal.id, armRate.id, hor.id] };
      }
      if (a.calc) {
        const ok = withinRounding(stated.value, a.calc.derived);
        verifications.push({ check: 'outcome', ok, entity: stated.entity.id, stated: stated.value, derived: +a.calc.derived.toFixed(2), formula: a.calc.kind, inputs: a.calc.inputs });
        if (!ok) issues.push({ severity: 'blocking', kind: 'stated_value_inconsistent', entity: stated.entity.id, stated: stated.value, derived: +a.calc.derived.toFixed(2), formula: a.calc.kind });
      }
    });
    // remaining_period must equal horizon - delay
    cmp.arms.forEach((a) => {
      const arm = a._arm;
      const rem = arm.params.remaining_period, dl = arm.params.delay_period;
      const hor = (arm.params.horizon && arm.params.horizon.entity) || G.horizon;
      if (rem && dl && hor) {
        const expect = toYears(hor.value, hor.unit) - toYears(dl.value, dl.unit);
        const got = toYears(rem.value, rem.unit);
        const ok = Math.abs(expect - got) < 1e-9;
        verifications.push({ check: 'remaining_period', ok, entity: rem.entity.id, stated: got, derived: expect, formula: 'horizon - delay', inputs: [hor.id, dl.entity.id] });
        if (!ok) issues.push({ severity: 'blocking', kind: 'remaining_period_inconsistent', stated: got, derived: expect });
      }
    });
  });

  // gap: verify (or derive) against the compared outcomes
  const gapEnt = reg.list.find((e) => e.role === 'gap');
  const cmpScenes = scenes.filter((s) => s._cmp);
  if (cmpScenes.length) {
    const cs = cmpScenes[0];
    const vals = cs._cmp.arms.map((a) => a._arm.outcomes[0]);
    const diff = Math.abs(vals[0].value - vals[vals.length - 1].value);
    if (gapEnt) {
      const ok = Math.abs(gapEnt.value - diff) <= 1.5;
      verifications.push({ check: 'gap', ok, entity: gapEnt.id, stated: gapEnt.value, derived: diff, formula: 'abs(outcome_a - outcome_b)', inputs: cs._cmp.arms.map((a) => a._arm.outcomes[0].entity.id) });
      if (!ok) issues.push({ severity: 'blocking', kind: 'gap_inconsistent', stated: gapEnt.value, derived: diff });
    }
    cs._gapDerived = diff;
  }

  // consequence: units bought at a higher price (percent change applied to a referenced amount)
  scenes.forEach((scene) => {
    const f = scene._features;
    if (scene.group.presenter || !f.consequence) return;
    const sameM = allMentions.find((m) => m.unit_id === f.consequence.unit && m.role === 'same_as');
    let refEnt = null;
    if (sameM) {
      const target = allMentions.find((m) => m.entity && m.entity.kind === sameM.kind && m.entity.value === sameM.value && m !== sameM && ['transfer_amount', 'recurring_amount', 'principal'].includes(m.role));
      if (target) { refEnt = target.entity; sameM.entity.refers_to = refEnt.id; scene.relationships.push({ type: 'same_as', from: sameM.entity.id, to: refEnt.id }); }
    }
    const chgM = allMentions.filter((m) => m.role === 'change_pct' && m.entity).pop();
    if (chgM) {
      const p = chgM.value * (chgM.direction === 'down' ? -1 : 1);
      const before = makeEntity(reg, { role: 'units_before', kind: 'count', value: 100, unit: f.consequence.consequence.noun, display: `100 ${f.consequence.consequence.noun.toUpperCase()}`, provenance: { kind: 'assumed_illustrative', reason: 'script states no unit count; a normalized base of 100 units is used only to draw the proportional effect' } });
      const unrounded = 100 / (1 + p / 100);
      const after = makeEntity(reg, { role: 'units_after', kind: 'count', value: Math.round(unrounded), unit: before.unit, display: `${Math.round(unrounded)} ${before.unit.toUpperCase()}`, provenance: { kind: 'derived', formula: 'units_before / (1 + change_pct/100)', unrounded: +unrounded.toFixed(4), inputs: [before.id, chgM.entity.id] } });
      const lost = makeEntity(reg, { role: 'units_lost', kind: 'count', value: before.value - after.value, unit: before.unit, display: String(before.value - after.value), provenance: { kind: 'derived', formula: 'units_before - units_after', inputs: [before.id, after.id] } });
      [before, after, lost].forEach((e) => { if (!scene.entity_ids.includes(e.id)) scene.entity_ids.push(e.id); });
      scene.relationships.push({ type: 'caused_by', from: after.id, to: chgM.entity.id });
      scene._consequence = { before, after, lost, refEnt, noun: f.consequence.consequence.noun };
      verifications.push({ check: 'units_after', ok: true, entity: after.id, derived: +unrounded.toFixed(2), formula: after.provenance.formula, inputs: after.provenance.inputs });
    }
  });

  // 'during' relationship
  scenes.forEach((scene, si) => {
    scene.group.units.forEach((u) => {
      if (!u.duringRef) return;
      const chg = u.mentions.find((m) => m.role === 'change_pct' && m.entity);
      const prior = scenes.slice(0, si).flatMap((s) => s.group.units).flatMap((uu) => uu.mentions).filter((m) => m.role === 'process_window' && m.entity).pop();
      if (chg && prior) scene.relationships.push({ type: 'during', from: chg.entity.id, to: prior.entity.id });
    });
  });

  // ── renderer params per scene ─────────────────────────────────────────────
  const valuesById = new Map(reg.list.map((e) => [e.id, e]));
  const anchorFor = () => {
    const rec = G.rec, rate = globalRate, hor = G.horizon, pr = G.principal;
    if (rec && rate && hor) return `${fmtMoney(rec.value)}/${CADENCE_ABBR[G.cadence] || 'PD'} AT ${fmtPct(rate.value)} FOR ${fmtDur(hor.value, hor.unit)}`;
    if (pr && hor) return `${fmtMoney(pr.value)} OVER ${fmtDur(hor.value, hor.unit)}`;
    return 'SCENARIO COMPARISON';
  };
  const noun = (m) => {
    const t = m.ctx.right.match(/^\s*in\s+([a-z]+)/);
    if (t) return t[1].replace(/s$/, '').toUpperCase();
    return null;
  };
  const gapCanon = () => (gapEnt ? gapEnt : null);
  const lastComparison = () => scenes.filter((s) => s._cmp)[0] || null;

  scenes.forEach((scene, si) => {
    const g = scene.group;
    const f = scene._features;
    const text = scene.narration.text;
    const tags = tagsOf(text);
    const isFirst = si === 0, isLast = si === lastIdx;
    const p = { treatment: scene.treatment, text };
    let visual = '';
    if (scene.treatment === 'avatar_panel') {
      p.isCta = isLast;
      const cmpScene = lastComparison();
      const gap = gapCanon();
      const sign = cmpScene ? (cmpScene._cmp.arms[cmpScene._cmp.arms.length - 1]._arm.outcomes[0].value - cmpScene._cmp.arms[0]._arm.outcomes[0].value >= 0 ? '+' : '-') : '-';
      if (isFirst && !isLast) {
        p.contextIconConcept = tags.includes('delay') ? ASSET.icon.hourglass : tags.includes('dividend') ? ASSET.icon.coins : tags.includes('loan') ? ASSET.icon.house : null;
        if (gap && /\b(cost|lose|miss|hidden|risk)\b/i.test(text)) p.contextCaption = `${fmtMoney(gap.value)} AT STAKE`;
        else {
          const tm = allMentions.find((m) => (m.role === 'transfer_amount' || m.role === 'principal') && m.entity);
          if (tm) p.contextCaption = `${fmtMoney(tm.value)} ${noun(tm) || (tm.role === 'principal' && tags.includes('loan') ? 'LOAN' : tm.role === 'principal' ? 'PRINCIPAL' : 'PAYMENT')}`;
        }
      } else if (isLast) {
        p.contextIconConcept = tags.includes('cost') || gap ? ASSET.icon.certificate_loss : tags.includes('delay') ? ASSET.icon.hourglass : null;
        const cons = scenes.find((s) => s._consequence);
        if (gap) p.contextCaption = `${sign}${fmtMoney(gap.value)}`;
        else if (cons) p.contextCaption = `-${cons._consequence.lost.value} ${cons._consequence.noun.toUpperCase()}`;
      }
      visual = isFirst ? 'presenter opens the story with a single supporting icon and a teaser value' : 'presenter closes; icon + caption call back to the quantified outcome';
      if (!p.contextIconConcept) delete p.contextIconConcept;
      scene.asset_requirements = p.contextIconConcept ? [{ type: 'icon', concept: p.contextIconConcept, reuse_first: true }] : [];
    } else if (scene.treatment === 'money_flow') {
      const m = allMentions.find((mm) => mm.entity && scene.entity_ids.includes(mm.entity.id) && ['recurring_amount', 'transfer_amount', 'principal'].includes(mm.role));
      const role = m.role;
      let from, to, iconFrom, iconTo, bg;
      if (role === 'transfer_amount' && tags.includes('dividend')) { from = 'PORTFOLIO'; to = 'BROKERAGE'; iconFrom = ASSET.icon.coins; iconTo = ASSET.icon.tower; bg = ASSET.bg.flow_dividend; }
      else if (role === 'recurring_amount') { from = 'YOUR INCOME'; to = tags.includes('invest') ? 'PORTFOLIO' : 'ACCOUNT'; iconFrom = ASSET.icon.cash; iconTo = ASSET.icon.tower; bg = ASSET.bg.flow_contribution; }
      else if (role === 'principal' && tags.includes('loan')) { from = 'LENDER'; to = 'YOU'; iconFrom = ASSET.icon.bank; iconTo = ASSET.icon.cash; bg = ASSET.bg.flow_loan; }
      else { from = 'YOU'; to = 'ACCOUNT'; iconFrom = ASSET.icon.cash; iconTo = ASSET.icon.tower; bg = ASSET.bg.flow_contribution; warnings.push({ kind: 'flow_archetype_default', scene: scene.scene_id }); }
      Object.assign(p, { fromLabel: from, toLabel: to, amountText: role === 'recurring_amount' ? `${fmtMoney(m.value)}/${CADENCE_ABBR[m.cadence] || 'PD'}` : fmtMoney(m.value), fromIconConcept: iconFrom, toIconConcept: iconTo, bgConcept: bg, meaning_event_pattern: meaningEventPattern(m.raw) });
      visual = `${role === 'recurring_amount' ? 'recurring' : 'one-time'} money movement ${from} -> ${to}, amount pops on arrival`;
      scene.asset_requirements = [{ type: 'icon', concept: iconFrom, reuse_first: true }, { type: 'icon', concept: iconTo, reuse_first: true }, { type: 'scene_bg', concept: bg, reuse_first: true }];
      scene.labels = { from, to, amount: p.amountText };
    } else if (scene.treatment === 'day_cards') {
      const m = allMentions.find((mm) => mm.entity && scene.entity_ids.includes(mm.entity.id) && mm.role === 'process_window');
      const hi = upperBound(m.value);
      const objM = text.match(/(?:to\s+)?(?:process|settle|clear|complete|finish|arrive)\s+(?:the\s+|your\s+|a\s+)?([a-z]+)/i);
      const obj = objM ? titleCase(objM[1]) : null;
      const prevTransfer = allMentions.filter((mm) => mm.role === 'transfer_amount' && mm.entity && units.indexOf(units.find((u) => u.unit === mm.unit_id)) < units.indexOf(g.units[0])).pop();
      const startNoun = prevTransfer ? noun(prevTransfer) : null;
      const idxs = hi <= 3 ? Array.from({ length: hi + 1 }, (_, i) => i) : [0, Math.round(hi / 3), Math.round((2 * hi) / 3), hi];
      const u = m.unit.toUpperCase();
      const days = idxs.map((d, i) => ({ label: `${u === 'DAY' ? 'DAY' : u} ${d}`, sub: i === 0 ? (startNoun ? `${titleCase(startNoun.toLowerCase())} Received` : 'Start') : i === idxs.length - 1 ? (obj ? `${obj} Completes` : 'Complete') : 'In Progress' }));
      Object.assign(p, { heroText: fmtDur(m.value, m.unit).replace(/^(\d+)-(\d+) /, '$1-$2 '), heroSub: obj ? `Until ${obj}` : 'Until Complete', days, bgConcept: ASSET.bg.process, meaning_event_pattern: meaningEventPattern(m.raw) });
      visual = 'timeline of cards revealing day by day while the value waits';
      scene.labels = { hero: p.heroText };
      scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.process, reuse_first: true }];
    } else if (scene.treatment === 'stock_chart' && scene._cmp) {
      const cmp = scene._cmp;
      const colors = ['0xa67c2e', '0x1a2744', '0x6b7280'];
      const derivable = cmp.arms.every((a) => a.calc && a.calc.kind === 'fv_recurring');
      const H = derivable ? Math.round(cmp.arms[0].calc.H) : null;
      const series = cmp.arms.map((a, ai) => {
        const points = [];
        for (let y = 0; y <= H; y++) {
          const monthsActive = Math.max(0, y - a.calc.delayYears) * 12;
          points.push(y < a.calc.delayYears ? null : Math.round(fvRecurring(G.rec.value, (a._arm.params.rate && a._arm.params.rate.value) || globalRate.value, monthsActive)));
        }
        return { label: a.label, color: colors[ai] || colors[2], points, finalValueText: fmtMoney(a._arm.outcomes[0].value) };
      });
      const delayArm = cmp.arms.find((a) => a.calc.delayYears > 0);
      const subj = (text.match(/\b(?:that|the|your)\s+([a-z]+)\s+grows?/i) || [])[1];
      Object.assign(p, {
        label: subj ? `${subj.toUpperCase()} VALUE` : 'VALUE', series,
        axisStartLabel: `${G.horizon.unit.toUpperCase()} 0`, axisEndLabel: `${G.horizon.unit.toUpperCase()} ${H}`,
        bgConcept: ASSET.bg.trajectory,
        meaning_event_pattern: meaningEventPattern(cmp.arms[cmp.arms.length - 1]._arm.outcomes[0].raw),
      });
      if (delayArm) { p.markerIndex = Math.round(delayArm.calc.delayYears); p.markerLabel = `${p.markerIndex}-YEAR HEAD START`; }
      visual = `${cmp.arms.length} scenarios drawn on one ${G.horizon.unit} axis from derived trajectories; ${delayArm ? 'second path starts at the delay marker; ' : ''}outcomes diverge; end values labelled`;
      scene.labels = { series: cmp.arms.map((a) => a.label), axis: [p.axisStartLabel, p.axisEndLabel] };
      scene.asset_requirements = [{ type: 'scene_bg', concept: ASSET.bg.trajectory, reuse_first: true }];
      series.forEach((s, si2) => scene.relationships.push({ type: 'derived_trajectory', series: s.label, formula: 'fv_recurring', inputs: cmp.arms[si2].calc.inputs }));
    } else if (scene.treatment === 'stock_chart') {
      const m = allMentions.find((mm) => mm.entity && scene.entity_ids.includes(mm.entity.id) && mm.role === 'change_pct');
      const winM = scene.relationships.find((r) => r.type === 'during');
      const win = winM && valuesById.get(winM.to);
      const dir = m.direction;
      const sgn = dir === 'down' ? -1 : 1;
      const subj = (text.match(/(?:the\s+)?([a-z]+)\s+(?:can |could |may |will )?(?:rise|rises|rose|fall|falls|fell|drop|drops|climb|climbs|jump|jumps|gain|gains)/i) || [])[1];
      const label = subj && /^(stock|share|market|index|fund)$/i.test(subj) ? `${subj.toUpperCase()} PRICE` : 'PRICE INDEX';
      Object.assign(p, {
        label, direction: dir, changeText: `${dir === 'down' ? '-' : '+'}${fmtPct(m.value)}`,
        // Plotted as CHANGE FROM START, not an absolute index on a zero-based
        // axis: [100, 102] renders as a flat line (a 2% move is invisible
        // next to a zero baseline) and loses the concept. An up move rises
        // 0 -> p; a down move falls p -> 0 (the renderer's axis is zero-based
        // and positive-only). The label states what the axis is.
        series: [{ label: `${label} CHANGE`, color: dir === 'down' ? '0xb0413e' : '0xa67c2e', points: dir === 'down' ? [m.value, 0] : [0, m.value], finalValueText: `${dir === 'down' ? '-' : '+'}${fmtPct(m.value)}` }],
        axisStartLabel: win ? `${win.unit.toUpperCase()} 0` : 'START', axisEndLabel: win ? `${win.unit.toUpperCase()} ${upperBound(win.value)}` : 'END',
        bgConcept: dir === 'down' ? ASSET.bg.price_down : ASSET.bg.price_up, meaning_event_pattern: meaningEventPattern(m.raw),
      });
      visual = `price index moves ${dir} ${fmtPct(m.value)} across the window bound from the preceding process duration`;
      scene.labels = { label, change: p.changeText, axis: [p.axisStartLabel, p.axisEndLabel] };
      scene.asset_requirements = [{ type: 'scene_bg', concept: p.bgConcept, reuse_first: true }];
    } else if (scene.treatment === 'share_compare' && scene._consequence) {
      const c = scene._consequence;
      Object.assign(p, {
        displayMode: 'chips', beforeLabel: `YOUR ${c.noun.toUpperCase()}`, beforeCount: c.before.value, beforeValue: c.before.display,
        afterLabel: 'REMAIN', afterCount: c.after.value, afterValue: c.after.display,
        anchorText: c.refEnt ? `SAME ${c.refEnt.display}` : 'SAME AMOUNT', deltaSuffix: c.noun.toUpperCase(),
        meaning_event_pattern: meaningEventPattern(text.match(/\b(fewer|less)\b/i)[0]),
      });
      visual = 'same dollars now buy fewer units: unit chips vanish at the reveal, count swaps, loss badge shown';
      scene.labels = { before: p.beforeValue, after: p.afterValue, disclosure: 'unit count is an illustrative base of 100 (script states none)' };
    } else if (scene.treatment === 'share_compare') {
      // comparison (and/or gap) rendered as two proportional bars
      const cmpScene = scene._cmp ? scene : priorComparisonFor(scenes, si);
      const cmp = cmpScene._cmp;
      const arms = cmp.arms.map((a) => ({ label: a.label, ent: a._arm.outcomes[0].entity, value: a._arm.outcomes[0].value }));
      const ordered = [...arms].sort((a, b) => b.value - a.value);
      const big = ordered[0], small = ordered[ordered.length - 1];
      const gap = gapEnt || null;
      const gapVal = gap ? gap.value : Math.abs(arms[0].value - arms[arms.length - 1].value);
      const alt = arms[arms.length - 1], base = arms[0];
      const sign = alt.value - base.value >= 0 ? '+' : '-';
      // The renderer's panel header does not swap with the hero value, so a
      // scenario-specific header would contradict the number after the reveal
      // ("7% RATE" over the 6% loan's total). Use a neutral header that is
      // true for both states; the per-bar row labels carry the scenarios.
      const subtype = cmp.arms[0]._arm.outcomes[0].subtype;
      const headerLabel = subtype === 'total_paid' ? 'TOTAL PAID' : subtype === 'balance' ? 'FINAL VALUE' : 'OUTCOME';
      Object.assign(p, {
        headerLabel,
        displayMode: 'bar', beforeLabel: big.label, beforeCount: 100, beforeValue: fmtMoney(big.value),
        afterLabel: small.label, afterCount: Math.round((100 * small.value) / big.value), afterValue: fmtMoney(small.value),
        anchorText: anchorFor(), deltaTextOverride: `${sign}${fmtMoney(gapVal)}`,
        meaning_event_pattern: meaningEventPattern((allMentions.find((m) => m.role === 'gap' && m.entity && scene.entity_ids.includes(m.entity.id)) || cmp.arms[cmp.arms.length - 1]._arm.outcomes[0]).raw),
      });
      if (!gap) { scene.entity_ids.push(makeEntity(reg, { role: 'gap', kind: 'money', value: Math.round(gapVal), unit: 'USD', display: fmtMoney(gapVal), provenance: { kind: 'derived', formula: 'abs(outcome_a - outcome_b)', inputs: arms.map((a) => a.ent.id) } }).id); }
      visual = `two proportional bars (larger outcome is the reference); ${gap && scene.entity_ids.includes(gap.id) ? 'the stated gap is revealed in the same evolving scene' : 'gap badge summarizes the difference'}`;
      scene.labels = { before: p.beforeLabel, after: p.afterLabel, delta: p.deltaTextOverride, anchor: p.anchorText };
      scene.relationships.push({ type: 'summarizes', from: (gap || {}).id, to: arms.map((a) => a.ent.id) });
    } else {
      p.title = text.slice(0, 40);
      p.values = scene.entity_ids.map((id) => valuesById.get(id)).filter((e) => e && ['money', 'percent', 'duration'].includes(e.kind)).map((e) => e.display).slice(0, 4);
      visual = 'generic value card (no specialised mechanism matched)';
      warnings.push({ kind: 'fallback_calc_card', scene: scene.scene_id });
    }
    scene.visual_relationship = visual;
    scene.renderer_params = p;
    // reveal steps (progressive), keyed to the spoken phrase of each displayed value
    scene.reveal_steps = g.units.flatMap((u) => u.mentions).filter((m) => m.entity && ['recurring_amount', 'transfer_amount', 'principal', 'outcome', 'gap', 'change_pct', 'process_window', 'delay_period'].includes(m.role)).map((m) => ({ entity_id: m.entity.id, spoken_phrase: m.raw, meaning_event_pattern: meaningEventPattern(m.raw), reveal: `show ${m.role.replace(/_/g, ' ')} ${m.entity.display}` }));
    // independent text-classifier cross-check (existing production classifier)
    let xc = null;
    try { xc = deps.classifyLongTreatment(text, g.units[0].section); } catch (e) { xc = null; }
    scene.treatment_cross_check = { text_classifier: xc, agrees: xc === scene.treatment };
  });

  function priorComparisonFor(all, idx) {
    for (let i = idx - 1; i >= 0; i--) if (all[i]._cmp) return all[i];
    return all[idx];
  }

  // clean internal fields
  const outScenes = scenes.map((s) => {
    const { group, _features, _cmp, _consequence, _gapDerived, ...rest } = s;
    return rest;
  });
  const uncoveredTokens = auditCoverage(units);
  unbound.forEach((u) => issues.push({ severity: 'review', kind: 'unbound_value', unit_id: u.unit_id, raw: u.raw, reason: u.reason }));
  uncoveredTokens.forEach((t) => issues.push({ severity: 'review', kind: 'uncovered_numeric_token', unit_id: t.unit_id, token: t.token, context: t.context }));
  const status = issues.some((i) => i.severity === 'blocking') ? 'blocked' : issues.some((i) => i.severity === 'review') ? 'needs_review' : 'clean';
  const dis = outScenes.filter((s) => !s.treatment_cross_check.agrees).length;
  return {
    ok: true, version: BRAIN_VERSION,
    units: units.map((u) => ({ unit: u.unit, text: u.text, data_bearing: u.dataBearing })),
    scenes: outScenes,
    values: reg.list,
    unbound_mentions: unbound,
    uncovered_numeric_tokens: uncoveredTokens,
    integrity: { status, verifications, issues },
    warnings,
    cross_check_summary: { scenes: outScenes.length, text_classifier_disagreements: dis },
  };
}

function purposeOf(scene, f, isFirst, isLast, cmp, prior) {
  if (scene.group.presenter) return isFirst ? 'hook' : isLast ? 'conclusion' : 'presenter_bridge';
  if (cmp) return f.hasGap ? 'compare_scenario_outcomes_and_quantify_gap' : (cmp.diff_role === 'delay_period' ? 'compare_scenarios_over_time' : 'compare_scenario_outcomes');
  if (f.hasGap && prior) return 'quantify_gap_between_compared_scenarios';
  if (f.hasSame || f.consequence) return 'show_consequence_of_price_change';
  if (f.hasRecurring) return 'establish_recurring_contribution';
  if (f.hasTransfer) return 'establish_one_time_transfer';
  if (f.hasPrincipal) return 'establish_principal_and_term';
  if (f.hasProcess) return 'explain_process_delay';
  if (f.hasChange) return 'show_price_change';
  return 'present_values';
}
