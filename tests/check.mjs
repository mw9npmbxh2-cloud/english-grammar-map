// Content and answer-checker checks for index.html.
// Run: node tests/check.mjs   (no dependencies; exits 1 on any failure)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const file = fileURLToPath(new URL('../index.html', import.meta.url));
const html = readFileSync(file, 'utf8');

const fails = [];
const fail = (group, msg) => fails.push(`[${group}] ${msg}`);
const section = (name, count, before) => {
  const n = fails.length - before;
  console.log(`${n ? 'FAIL' : 'ok  '}  ${name}: ${count} checked${n ? `, ${n} failed` : ''}`);
};

// ---- load the app's own data and checker code -------------------------------------------
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
if (!script) { console.error('No inline <script> found in index.html'); process.exit(1); }
try { new vm.Script(script, { filename: 'index.html <script>' }); }
catch (e) { console.error('index.html script does not parse: ' + e.message); process.exit(1); }

const between = (a, b) => {
  const i = script.indexOf(a), j = script.indexOf(b, i + 1);
  if (i < 0 || j < 0) { console.error(`Marker not found: ${i < 0 ? a : b}`); process.exit(1); }
  return script.slice(i, j);
};
const data = between('const BRANCHES=[', '/* ---------- أدوات');
const checker = between('/* check:start', '/* check:end */');
const app = new Function(
  `'use strict';${data}\n${checker}\nreturn {BRANCHES,TOPICS,WHY,TR,norm,accepts,fullSentence};`)();
const { BRANCHES, TOPICS, WHY, TR, norm, accepts, fullSentence } = app;
const rule = id => TOPICS.find(t => t.id === id);

// ---- 1. shape of every rule -------------------------------------------------------------
let mark = fails.length, fxTotal = 0, qzTotal = 0;
if (TOPICS.length !== 52) fail('shape', `expected 52 rules, found ${TOPICS.length}`);
if (new Set(TOPICS.map(t => t.id)).size !== TOPICS.length) fail('shape', 'duplicate rule ids');
for (const t of TOPICS) {
  const R = `rule ${t.id}`;
  fxTotal += t.fx.length; qzTotal += t.qz.length;
  if (!BRANCHES.some(b => b.id === t.b)) fail('shape', `${R}: unknown branch ${t.b}`);
  if (t.fx.length < 6) fail('shape', `${R}: ${t.fx.length} fx, need at least 6`);
  if (t.qz.length !== 2) fail('shape', `${R}: ${t.qz.length} qz, need exactly 2`);
  const why = WHY[t.id] || [], tr = TR[t.id] || [];
  if (why.length !== t.fx.length) fail('shape', `${R}: WHY has ${why.length} entries, fx has ${t.fx.length}`);
  if (tr.length !== t.fx.length) fail('shape', `${R}: TR has ${tr.length} entries, fx has ${t.fx.length}`);
  why.forEach((w, i) => { if (typeof w !== 'string' || !w.trim()) fail('shape', `${R} WHY[${i}] is empty`); });
  tr.forEach((w, i) => { if (typeof w !== 'string' || !w.trim()) fail('shape', `${R} TR[${i}] is empty`); });
  t.fx.forEach((p, i) => {
    const goods = [].concat(p[1]);
    if (typeof p[0] !== 'string' || !p[0].trim() || !goods.length || goods.some(g => typeof g !== 'string' || !g.trim()))
      fail('shape', `${R} fx[${i}] is malformed`);
  });
  t.qz.forEach((q, i) => {
    if (!Array.isArray(q[1]) || q[1].length !== 3 || new Set(q[1]).size !== 3 || !q[2])
      fail('shape', `${R} qz[${i}] needs 3 different options and a reason`);
  });
}
section('rule shape (fx >= 6, qz = 2, WHY/TR aligned with fx)', TOPICS.length, mark);

// ---- 2. no wrong sentence may pass its own accepted answers -------------------------------
mark = fails.length;
for (const t of TOPICS) {
  const strict = !!t.strict;
  t.fx.forEach((p, i) => {
    const goods = [].concat(p[1]);
    if (accepts(p[0], goods, strict))
      fail('wrong=accepted', `rule ${t.id} fx[${i}]: wrong sentence is accepted: "${p[0]}"`);
    goods.forEach(g => {
      if (!accepts(g, goods, strict)) fail('wrong=accepted', `rule ${t.id} fx[${i}]: accepted answer is rejected: "${g}"`);
      if (norm(g, strict) === norm(p[0], strict)) fail('wrong=accepted', `rule ${t.id} fx[${i}]: answer equals the wrong sentence: "${g}"`);
    });
  });
}
section('wrong sentences rejected by their own answer list', fxTotal, mark);

// ---- 3. answer-checker cases (v1.1, Part 1) ------------------------------------------------
mark = fails.length;
const goodsOf = (id, i) => [].concat(rule(id).fx[i][1]);
const pairFor = good => {
  for (const t of TOPICS) for (let i = 0; i < t.fx.length; i++)
    if ([].concat(t.fx[i][1]).includes(good)) return { t, i };
  return null;
};
const cases = [
  // [typed, accepted sentence it is checked against, expected]
  ["He's just arrived at the clinic.", 'He has just arrived at the clinic.', true],
  ["I could not log in because I'd forgotten my password.", 'I could not log in because I had forgotten my password.', true],
  ["She's worked here for three years.", 'She has worked here for three years.', true],
  ["I'd like to speak to the manager.", 'I would like to speak to the manager.', true],
  ['He is just arrived at the clinic.', 'He has just arrived at the clinic.', false],
  ["She's to finish the report today.", 'She has to finish the report today.', false],
  ["He's two phones.", 'He has two phones.', false],
  ["You don't have to pay, it has free.", "You don't have to pay, it's free.", false],
  // contractions that were already accepted must stay accepted
  ['You do not have to pay, it is free.', "You don't have to pay, it's free.", true],
  ["He can't come today.", 'He cannot come today.', true],
  ["I haven't finished the report yet.", 'I have not finished the report yet.', true],
  ["She'd finish the report today.", 'She has to finish the report today.', false],
];
for (const [typed, good, want] of cases) {
  const hit = pairFor(good);
  if (!hit) { fail('checker', `no fx entry has the accepted answer "${good}"`); continue; }
  const got = accepts(typed, goodsOf(hit.t.id, hit.i), !!hit.t.strict);
  if (got !== want) fail('checker', `"${typed}" should be ${want ? 'ACCEPTED' : 'REJECTED'} for "${good}" (rule ${hit.t.id} fx[${hit.i}])`);
}
// strict rule (22): spacing counts
const strictRules = TOPICS.filter(t => t.strict);
if (!strictRules.some(t => t.id === 22)) fail('checker', 'rule 22 is no longer strict');
const strictCases = [
  [22, 4, 'The system was down. We called IT.', true],
  [22, 4, 'The system was down.  We called IT.', false],   // two spaces after the full stop
  [22, 4, 'The system was down.We called IT.', false],
  [22, 4, 'The system was down. we called IT.', false],
  [22, 4, '  The system was down. We called IT. ', true],  // outer spaces are not part of the answer
  [22, 2, 'The meeting starts at 9 AM.', true],
  [22, 2, 'The meeting  starts at 9 AM.', false],
];
for (const [id, i, typed, want] of strictCases) {
  const got = accepts(typed, goodsOf(id, i), true);
  if (got !== want) fail('checker', `strict: "${typed}" should be ${want ? 'ACCEPTED' : 'REJECTED'} (rule ${id} fx[${i}])`);
}
section('answer-checker accept/reject cases', cases.length + strictCases.length, mark);

// ---- 4. model sentences shown and spoken after a quiz answer -------------------------------
mark = fails.length;
for (const t of TOPICS) t.qz.forEach((q, i) => {
  const s = fullSentence(q[0], q[1][0]);
  const where = `rule ${t.id} qz[${i}]: "${s}"`;
  if (/\s[.,?!;:]/.test(s)) fail('model sentence', `space before punctuation in ${where}`);
  if (/\s{2,}/.test(s)) fail('model sentence', `double space in ${where}`);
  if (s !== s.trim() || !s) fail('model sentence', `empty or untrimmed in ${where}`);
  if (s.includes('___')) fail('model sentence', `blank left in ${where}`);
});
section('quiz model sentences from fullSentence()', qzTotal, mark);

// ---- result -------------------------------------------------------------------------------
console.log(`\n${TOPICS.length} rules, ${fxTotal} correction sentences, ${qzTotal} quiz questions.`);
if (fails.length) {
  console.log(`\n${fails.length} failure(s):`);
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('All checks passed.');
