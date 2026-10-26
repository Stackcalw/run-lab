// Daily health targets + health score (0-100). Runs in the browser.
//
// Targets are standard sports-nutrition rules of thumb, NOT medical advice:
// - Energy: Mifflin-St Jeor BMR x 1.4 (active) + ~1 kcal/kg/km running + goal adjustment
//   (gain +300 kcal, maintain 0, lose -300 kcal).
// - Protein 1.8 g/kg; carbs scale with training load (4 / 5 / 6.5 g/kg); fat = remainder (min 0.8 g/kg).
// - Water: 35 ml/kg/day + 600 ml per hour of running (+500 ml if > 20 C).
// - Sleep: 8.5 h target (athletes in training); bedtime from the profile.
//
// Faithful port of test/reference/health.py (checked by test/parity.mjs). Generalised:
// sex term in Mifflin-St Jeor and a goal-dependent energy adjustment.

import { pyRound } from './model.js';

export const DEFAULTS = { age: 30, weightKg: 70, heightCm: 175, targetBedtime: '22:30' };
const GOAL_KCAL = { gain: 300, maintain: 0, lose: -300 };
// Mifflin-St Jeor sex constant: +5 male, -161 female; unspecified uses the midpoint.
const SEX_K = { male: 5, female: -161, other: -78 };

function f(x) {
  if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

export const SLEEP_H = 8.5;

export function latestWeight(data) {
  const days = Object.entries(data.days || {}).filter(([, v]) => f(v.weightKg)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (days.length) return f(days[days.length - 1][1].weightKg);
  return f((data.profile || {}).weightKg) || DEFAULTS.weightKg;
}

export function targets(data, day, plannedRun = null, tempMax = null) {
  const p = data.profile || {};
  const w = latestWeight(data);
  let h = f(p.heightCm);
  const age = Math.trunc(Number(p.age) || DEFAULTS.age);
  const assumed = [];
  if (!h) { h = DEFAULTS.heightCm; assumed.push(`height ${DEFAULTS.heightCm} cm (set yours in Profile)`); }
  if (!SEX_K[p.sex]) assumed.push('sex not set: using the midpoint of the male/female formulas');
  const bmr = 10 * w + 6.25 * h - 5 * age + (SEX_K[p.sex] ?? SEX_K.other);
  const pr = plannedRun || {};
  const km = pr.km || 0;
  const runMin = pr.minutes || (km ? km * 6.5 : 0);
  const kind = !km ? 'rest' : (km >= 12 || pr.hard ? 'long/hard' : 'easy');
  const kcal = bmr * 1.4 + 1.0 * w * km + (GOAL_KCAL[p.goal] ?? 0);
  const protein = 1.8 * w;
  const carbs = { rest: 4, easy: 5, 'long/hard': 6.5 }[kind] * w;
  const fat = Math.max((kcal - protein * 4 - carbs * 4) / 9, 0.8 * w);
  const water = 35 * w + 600 * runMin / 60 + ((tempMax || 0) > 20 ? 500 : 0);
  return {
    dayType: kind, weightKg: pyRound(w, 1), assumed,
    kcal: pyRound(kcal / 10) * 10, proteinG: pyRound(protein), carbsG: pyRound(carbs),
    fatG: pyRound(fat), waterL: pyRound(water / 1000, 1), sleepH: SLEEP_H,
    bedtime: p.targetBedtime || DEFAULTS.targetBedtime,
    meals: meals(kind, w),
  };
}

export function meals(kind, w) {
  const p = pyRound(1.8 * w / 4); // protein per meal, 4 feeds
  const base = [
    `Breakfast: porridge (80 g oats + milk) + banana + 2 eggs or Greek yogurt (~${p} g protein)`,
    `Lunch: rice/pasta + chicken, tuna or tofu + veg (~${p} g protein)`,
    `Dinner: big carb portion + salmon/beef/chicken or lentils + veg (~${p} g protein)`,
    'Snack before bed: Greek yogurt or milk + handful of nuts (casein, helps overnight recovery)',
  ];
  if (kind === 'rest') return [...base, 'Rest day: normal portions, still hit protein — this is when muscle is built.'];
  const pre = '60-90 min before the run: toast + honey or a banana (easy carbs, low fibre).';
  const post = 'Within 60 min after: 20-30 g protein + carbs (chocolate milk, or a rice + chicken meal).';
  const extra = kind === 'long/hard' ? ['Long/hard day: +1 extra carb portion at lunch and dinner; take a gel/snack every ~40 min on runs >75 min.'] : [];
  return [base[0], pre, post, ...base.slice(1), ...extra];
}

function hhmm(s) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s || '');
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] + +m[2] / 60;
}
export function hours(a, b) {
  const t1 = hhmm(a), t2 = hhmm(b);
  if (t1 === null || t2 === null) return null;
  const d = t2 - t1;
  return d <= 0 ? d + 24 : d;
}

// Python-style fixed formatting (round-half-even on exact ties, like f'{x:.1f}').
const fx = (x, n) => pyRound(Number(x), n).toFixed(n);

/** Score a logged day. Missing parts are left out and the total is rescaled (marked partial). */
export function score(data, day, tg, plannedRun = null) {
  const log = (data.days || {})[day] || {};
  const parts = {}, notes = [];
  // Sleep (30): duration 24 + consistency 6
  const sh = f(log.sleepHours) || hours(log.bedtime, log.wake);
  if (sh) {
    const dur = Math.min(sh / tg.sleepH, 1.0) * 24;
    let cons = 6.0;
    const tb = (data.profile || {}).targetBedtime || DEFAULTS.targetBedtime;
    if (log.bedtime) {
      let off = Math.abs(hours(tb, log.bedtime) || 0);
      off = Math.min(off, 24 - off);
      cons = off <= 0.5 ? 6.0 : off <= 1.0 ? 3.0 : 0.0;
    }
    parts.sleep = [dur + cons, 30];
    if (sh < 7) notes.push(`Slept ${fx(sh, 1)} h — under 7 h cuts recovery and reaction time; protect tonight's bedtime.`);
  }
  // Hydration (15)
  const wl = f(log.waterL);
  if (wl !== null) {
    parts.water = [Math.min(wl / tg.waterL, 1.0) * 15, 15];
    if (wl < tg.waterL * 0.7) notes.push(`Water ${fx(wl, 1)}/${fx(tg.waterL, 1)} L — drink ~${fx(tg.waterL - wl, 1)} L more, spread out.`);
  }
  // Nutrition (20): protein 10 + energy 10
  const pg = f(log.proteinG), kc = f(log.kcal);
  if (pg !== null || kc !== null) {
    let s = 0, m = 0;
    if (pg !== null) {
      s += Math.min(pg / tg.proteinG, 1.0) * 10; m += 10;
      if (pg < tg.proteinG * 0.8) notes.push(`Protein ${fx(pg, 0)}/${tg.proteinG} g — add a yogurt, eggs or a shake.`);
    }
    if (kc !== null) {
      const ratio = kc / tg.kcal;
      s += ratio >= 0.9 && ratio <= 1.15 ? 10 : Math.max(0, 10 - Math.abs(ratio - 1) * 40); m += 10;
      if (ratio < 0.85) notes.push("Under-eating — you won't recover from runs on a deficit.");
    }
    parts.food = [s, m];
  }
  // Training (20): only scored once logged, so a run later today doesn't drag the score down
  const done = log.trained;
  if (done !== undefined && done !== null) {
    let s;
    if (plannedRun) {
      s = done ? 20 : 0;
      if (!done) notes.push('Planned run not logged as done.');
    } else s = 20; // rest day honoured, or extra activity
    parts.training = [s, 20];
  }
  // Recovery (15): resting HR vs baseline 8 + how-you-feel 7
  const rhr = f(log.restingHR), feel = f(log.feel);
  if (rhr !== null || feel !== null) {
    let s = 0, m = 0;
    if (rhr !== null) {
      const prev = Object.keys(data.days || {}).sort().filter(k => k < day && f(data.days[k].restingHR))
        .map(k => f(data.days[k].restingHR));
      const last = prev.slice(-7);
      const base = last.length ? last.reduce((a, b) => a + b, 0) / last.length : rhr;
      s += rhr <= base + 3 ? 8 : Math.max(0, 8 - (rhr - base - 3) * 2); m += 8;
      if (rhr > base + 5) notes.push(`Resting HR ${fx(rhr, 0)} vs ~${fx(base, 0)} usual — sign of fatigue or illness; make today easy.`);
    }
    if (feel !== null) { s += (feel - 1) / 4 * 7; m += 7; }
    parts.recovery = [s, m];
  }
  const got = Object.values(parts).reduce((a, v) => a + v[0], 0);
  const maxp = Object.values(parts).reduce((a, v) => a + v[1], 0);
  const total = maxp ? pyRound(got / maxp * 100) : null;
  return {
    score: total, partial: maxp < 100, coverage: maxp,
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, [pyRound(v[0], 1), v[1]]])),
    grade: total === null ? null : total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D',
    notes,
  };
}
