// Parity test: the JS port (js/model.js, js/health.js) must match the Python reference
// (test/reference/model.py, health.py) on the same data. Run: node test/parity.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as M from '../js/model.js';
import * as H from '../js/health.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(path.join(here, 'fixture.json'), 'utf8'));

// ---------- scenarios ----------
const clone = o => JSON.parse(JSON.stringify(o));
const scenarios = [];
scenarios.push({ name: 'full fixture (26 runs, 10 weeks, 5k tests + 10k race)', today: fx.today, data: fx.data, planned: fx.plannedRuns, tmax: fx.tempMax });
{ // easy runs only, no height in profile -> 1.08 correction + assumed height
  const d = clone(fx.data);
  d.runs = d.runs.filter(r => r.type === 'easy' || r.type === 'long').map(r => ({ ...r, rpe: Math.min(r.rpe, 6) }));
  delete d.profile.heightCm; delete d.days['2026-02-24'].weightKg; delete d.days['2026-02-27'].weightKg;
  d.goal = { ...d.goal, raceDate: '2026-09-13', goalMinutes: 100, halfMinutes: 100 };
  scenarios.push({ name: 'easy runs only, no height, later race', today: '2026-03-05', data: d, planned: { '2026-03-05': { km: 10 } }, tmax: {} });
}
{ // no runs at all
  const d = clone(fx.data); d.runs = []; d.goal = { ...d.goal, goalMinutes: 110, halfMinutes: 110 };
  scenarios.push({ name: 'no runs logged', today: fx.today, data: d, planned: { '2026-03-02': null }, tmax: {} });
}
{ // load spike: big recent week
  const d = clone(fx.data);
  for (let i = 0; i < 5; i++) d.runs.push({ id: 'x' + i, date: M.addDays('2026-02-25', i), km: 14, minutes: 70, type: 'tempo', rpe: 8 });
  scenarios.push({ name: 'acute load spike', today: fx.today, data: d, planned: fx.plannedRuns, tmax: fx.tempMax });
}

// ---------- run the Python reference ----------
const py = `
import json, sys
from datetime import date
sys.path.insert(0, ${JSON.stringify(path.join(here, 'reference'))})
import model, health
inp = json.load(sys.stdin)
out = []
for sc in inp["scenarios"]:
    t = date.fromisoformat(sc["today"])
    res = {"model": model.analyse(sc["data"], today=t), "days": {}}
    for day, run in sc["planned"].items():
        tg = health.targets(sc["data"], day, run, sc["tmax"].get(day))
        res["days"][day] = {"targets": tg, "score": health.score(sc["data"], day, tg, run)}
    out.append(res)
fns = {}
for dist in [5000, 10000, 21097.5, 42195]:
    for vd in [30, 38.5, 45, 52.3, 60, 70]:
        fns[f"{dist}|{vd}"] = {"raceTime": model.race_time(vd, dist), "paces": model.paces(vd)}
    for tmin in [14.5, 21.4, 43.6, 89.9, 125, 200, 330]:
        fns[f"vdot|{dist}|{tmin}"] = model.vdot(dist, tmin)
json.dump({"scenarios": out, "fns": fns}, sys.stdout)
`;
const PY = JSON.parse(execFileSync('python3', ['-c', py], { input: JSON.stringify({ scenarios }), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));

// ---------- comparison helpers ----------
let checks = 0; const fails = [];
const timeToSec = s => { const m = /^(?:(\d+):)?(\d+):(\d\d)(?:\/km)?$/.exec(s); if (!m) return null; return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3]; };
const paceToSec = s => { const m = /^(\d+):(\d\d)\/km$/.exec(s); return m ? +m[1] * 60 + +m[2] : null; };
function eq(label, js, ref) {
  checks++;
  if (typeof ref === 'number' && typeof js === 'number') {
    const ok = Math.abs(js - ref) <= Math.max(Math.abs(ref) * 0.005, 0.051); // 0.5% (or rounding of a 1-dp value)
    if (!ok) fails.push(`${label}: js=${js} py=${ref}`);
    return;
  }
  if (typeof ref === 'string' && typeof js === 'string') {
    const a = paceToSec(ref) ?? timeToSec(ref), b = paceToSec(js) ?? timeToSec(js);
    if (a !== null && b !== null) { if (Math.abs(a - b) > 1) fails.push(`${label}: js=${js} py=${ref}`); return; }
  }
  if (JSON.stringify(js) !== JSON.stringify(ref)) fails.push(`${label}: js=${JSON.stringify(js)} py=${JSON.stringify(ref)}`);
}
const rename = { 'Half race pace': 'Race pace' };
function eqPaces(label, js, ref) { for (const [k, v] of Object.entries(ref)) eq(`${label}.${k}`, js[rename[k] || k], v); }

// ---------- compare ----------
scenarios.forEach((sc, i) => {
  const ref = PY.scenarios[i], tag = `[${sc.name}]`;
  const js = M.analyse(sc.data, sc.today), rm = ref.model;
  for (const k of ['time', 'vdot', 'pace', 'raceDate', 'daysLeft', 'weeksLeft']) eq(`${tag} goal.${k}`, js.goal[k], rm.goal[k]);
  eqPaces(`${tag} goalPaces`, js.goalPaces, rm.goalPaces);
  eq(`${tag} runs`, js.runs, rm.runs);
  eq(`${tag} has current`, !!js.current, !!rm.current);
  if (rm.current) {
    eq(`${tag} current.vdot`, js.current.vdot, rm.current.vdot);
    eq(`${tag} current.predicted`, js.current.predicted, rm.current.predictedHalf);
    eq(`${tag} current.basis`, js.current.basis, rm.current.basis);
    eqPaces(`${tag} current.paces`, js.current.paces, rm.current.paces);
    for (const k of ['vdot', 'perWeekNeeded', 'verdict']) eq(`${tag} gap.${k}`, js.gap[k], rm.gap[k]);
  }
  eq(`${tag} has personal`, !!js.personal, !!rm.personal);
  if (rm.personal) {
    eq(`${tag} personal.exponent`, js.personal.exponent, rm.personal.exponent);
    eq(`${tag} personal.predicted`, js.personal.predicted, rm.personal.predictedHalf);
  }
  eq(`${tag} has load`, !!js.load, !!rm.load);
  if (rm.load) for (const k of ['fitness', 'fatigue', 'form', 'acwr', 'flag', 'km7']) eq(`${tag} load.${k}`, js.load[k], rm.load[k]);
  eq(`${tag} plan.length`, js.plan.length, rm.plan.length);
  // the reference hard-codes the original goal's race pace (4:16/km) in the race-pace focus label;
  // the port uses the configured goal pace, so normalise that one label before comparing.
  const focusNorm = f => String(f).replace(/race-pace \(\d+:\d\d\/km blocks\)/, 'race-pace (goal-pace blocks)');
  rm.plan.forEach((w, j) => {
    for (const k of ['week', 'start', 'km', 'longRun']) eq(`${tag} plan[${j}].${k}`, js.plan[j] && js.plan[j][k], w[k]);
    eq(`${tag} plan[${j}].focus`, focusNorm(js.plan[j] && js.plan[j].focus), focusNorm(w.focus));
  });
  for (const [day, r] of Object.entries(ref.days)) {
    const run = sc.planned[day];
    const tg = H.targets(sc.data, day, run, sc.tmax[day] ?? null);
    for (const k of ['dayType', 'weightKg', 'kcal', 'proteinG', 'carbsG', 'fatG', 'waterL', 'sleepH', 'meals']) eq(`${tag} ${day} targets.${k}`, tg[k], r.targets[k]);
    eq(`${tag} ${day} targets.assumed`, tg.assumed, r.targets.assumed);
    // score using the *reference* targets too, so a score mismatch isn't just a propagated target difference
    const s = H.score(sc.data, day, tg, run), rs = r.score;
    for (const k of ['score', 'partial', 'coverage', 'grade', 'notes']) eq(`${tag} ${day} score.${k}`, s[k], rs[k]);
    for (const [pk, pv] of Object.entries(rs.parts)) { eq(`${tag} ${day} parts.${pk}.got`, (s.parts[pk] || [])[0], pv[0]); eq(`${tag} ${day} parts.${pk}.max`, (s.parts[pk] || [])[1], pv[1]); }
    eq(`${tag} ${day} parts.keys`, Object.keys(s.parts).sort(), Object.keys(rs.parts).sort());
  }
});
// raw formula parity across all supported distances
for (const [key, v] of Object.entries(PY.fns)) {
  const p = key.split('|');
  if (p[0] === 'vdot') { eq(`vdot(${p[1]}, ${p[2]})`, M.vdot(+p[1], +p[2]), v); continue; }
  const [dist, vd] = p.map(Number);
  checks++; const rt = M.raceTime(vd, dist);
  if (Math.abs(rt - v.raceTime) * 60 > 1 || Math.abs(rt - v.raceTime) / v.raceTime > 0.005) fails.push(`raceTime(${vd}, ${dist}): js=${rt} py=${v.raceTime}`);
  eqPaces(`paces(${vd})`, M.paces(vd), v.paces);
}

// the sex term / goal adjustment the JS adds: male + gain must equal the reference (+5, +300); check other cases arithmetic
{
  const d = clone(fx.data), base = H.targets(d, fx.today, null, null).kcal;
  d.profile.sex = 'female'; d.profile.goal = 'maintain';
  const fem = H.targets(d, fx.today, null, null).kcal;
  checks++; if (Math.abs((base - fem) - Math.round((166 * 1.4 + 300) / 10) * 10) > 10) fails.push(`female/maintain kcal delta: ${base - fem}`);
}

// generalised distances (no Python equivalent): goal VDOT must be distance-consistent and plans valid
for (const dist of Object.keys(M.DISTANCES)) {
  const d = clone(fx.data);
  const goalMin = M.raceTime(50, M.DISTANCES[dist].m); // same VDOT-50 goal at every distance
  d.goal = { name: 'Test', distance: dist, raceDate: '2026-06-28', goalMinutes: goalMin };
  const r = M.analyse(d, fx.today);
  checks++; if (Math.abs(r.goal.vdot - 50) > 0.05) fails.push(`${dist}: goal vdot ${r.goal.vdot} != 50`);
  checks++; if (!r.plan.length || r.plan.some(w => w.longRun > M.DISTANCES[dist].longCap)) fails.push(`${dist}: plan invalid`);
  checks++; if (Math.abs(M.paceToSec(r.goalPaces['Race pace']) - goalMin * 60 / (M.DISTANCES[dist].m / 1000)) > 1) fails.push(`${dist}: race pace mismatch`);
  checks++; if (r.current.predicted !== r.current.equivalents[dist]) fails.push(`${dist}: predicted != equivalent`);
  for (let i = 0; i < 7; i++) { const s = M.suggestSession(r, M.addDays(fx.today, i)); checks++; if (s && !(s.km > 0 && s.minutes > 0 && s.title)) fails.push(`${dist}: bad session ${JSON.stringify(s)}`); }
}

if (fails.length) {
  console.error(`PARITY FAIL: ${fails.length}/${checks} checks failed`);
  for (const f of fails.slice(0, 40)) console.error('  ✗ ' + f);
  process.exit(1);
}
const s0 = M.analyse(fx.data, fx.today);
console.log(`PARITY OK: ${checks} checks, ${scenarios.length} scenarios, JS matches Python reference (tol 0.5% / 1 s)`);
console.log(`  fixture: ${fx.data.runs.length} runs, VDOT ${s0.current.vdot}, predicted half ${s0.current.predicted}, personal exponent ${s0.personal.exponent}, ACWR ${s0.load.acwr}, ${s0.plan.length}-week plan`);
