// Run Lab training model (runs entirely in the browser).
//
// Three pieces, all fitted to the runner's own logged data:
// 1. Fitness estimate (VDOT) from each hard effort, using Jack Daniels' VO2 formulas.
//    Recency-weighted -> current VDOT -> predicted time for the goal distance.
// 2. Personal endurance exponent: least-squares fit of log(time) ~ k*log(distance)
//    over the best efforts (Riegel's 1.06 is the population default; we learn yours).
// 3. Banister impulse-response load model: fitness (42-day) / fatigue (7-day) / form,
//    plus acute:chronic workload ratio as an injury-risk flag.
// Then: gap to the goal, training paces, a week-by-week mileage ramp to race day and
// a suggested session for any given day.
//
// This is a faithful port of the original Python reference (test/reference/model.py);
// test/parity.mjs checks the two agree. The only changes are generalisations from
// "half marathon" to any of 5K / 10K / half / marathon.

export const DISTANCES = {
  '5k':       { m: 5000,    label: '5K',            peakKm: 40, longCap: 12 },
  '10k':      { m: 10000,   label: '10K',           peakKm: 45, longCap: 16 },
  'half':     { m: 21097.5, label: 'Half marathon', peakKm: 55, longCap: 20 },
  'marathon': { m: 42195,   label: 'Marathon',      peakKm: 75, longCap: 32 },
};
export const HALF_M = 21097.5;

// Python's round(): half-to-even. Keeps the port bit-for-bit faithful on ties.
export function pyRound(x, nd = 0) {
  const f = Math.pow(10, nd);
  const y = x * f;
  let r = Math.round(y);
  if (Math.abs(y % 1) === 0.5) r = 2 * Math.round(y / 2);
  return nd ? Number((r / f).toFixed(nd)) : r;
}

export function vo2(v) { // v in m/min
  return -4.60 + 0.182258 * v + 0.000104 * v * v;
}

export function pctMax(t) { // t in minutes
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
}

export function vdot(distM, tMin) {
  return vo2(distM / tMin) / pctMax(tMin);
}

/** Minutes to run distM at VDOT vd (bisection). */
export function raceTime(vd, distM) {
  let lo = distM / 600, hi = distM / 50;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distM, mid) > vd) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function vForVo2(target) { // inverse of vo2(v)
  const a = 0.000104, b = 0.182258, c = -4.60 - target;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export function paceStr(secPerKm) {
  const s = Math.trunc(pyRound(secPerKm));
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${String(r).padStart(2, '0')}/km`;
}

export function hms(minutes) {
  let s = Math.trunc(pyRound(minutes * 60));
  const h = Math.floor(s / 3600), r = s - h * 3600;
  const m = Math.floor(r / 60); s = r - m * 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Daniels-style training paces from a VDOT, plus race pace for the goal distance. */
export function paces(vd, distM = HALF_M) {
  const out = {};
  for (const [name, frac] of [['Easy', 0.66], ['Long', 0.70], ['Threshold', 0.88], ['Interval', 0.98]]) {
    const v = vForVo2(vd * frac);
    out[name] = paceStr(60000 / v);
  }
  out['Race pace'] = paceStr(raceTime(vd, distM) * 60 / (distM / 1000));
  return out;
}

// ---- dates: plain YYYY-MM-DD strings, arithmetic in UTC so DST never shifts a day ----
export function dayNum(s) { // days since epoch
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}
export function numDay(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
export function addDays(s, k) { return numDay(dayNum(s) + k); }
export function weekday(s) { return (new Date(dayNum(s) * 864e5).getUTCDay() + 6) % 7; } // Mon=0 like Python
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function goalOf(data) {
  const g = (data && data.goal) || {};
  const distance = DISTANCES[g.distance] ? g.distance : 'half';
  return {
    name: g.name || 'Goal race',
    distance,
    distM: DISTANCES[distance].m,
    goalMinutes: +g.goalMinutes || 120,
    raceDate: g.raceDate || null,
  };
}

export function analyse(data, today) {
  today = today || localToday();
  const G = goalOf(data);
  const D = DISTANCES[G.distance];
  const distM = G.distM, distKm = distM / 1000;
  const goalMin = G.goalMinutes;
  const raceDay = G.raceDate || addDays(today, 112);
  const tN = dayNum(today), rN = dayNum(raceDay);
  const runs = (data.runs || []).filter(r => r.km && r.minutes)
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const goalVdot = vdot(distM, goalMin);
  const res = {
    goal: {
      name: G.name, distance: G.distance, distanceLabel: D.label,
      time: hms(goalMin), vdot: pyRound(goalVdot, 1), pace: paceStr(goalMin * 60 / distKm),
      raceDate: raceDay, daysLeft: rN - tN, weeksLeft: pyRound((rN - tN) / 7, 1),
    },
    goalPaces: paces(goalVdot, distM), runs: runs.length,
  };

  // 1) fitness from hard efforts (RPE>=7 or marked race/test/tempo/intervals), >=1.5 km, last 120 days
  const efforts = [];
  for (const r of runs) {
    const age = tN - dayNum(r.date);
    if (age > 120 || r.km < 1.5) continue;
    const hard = ['race', 'test', 'tempo', 'intervals'].includes(r.type) || (r.rpe || 0) >= 7;
    efforts.push({ date: r.date, km: r.km, min: r.minutes, vdot: vdot(r.km * 1000, r.minutes), hard, age });
  }
  const hard = efforts.filter(e => e.hard);
  const pool = hard.length ? hard : efforts;
  if (pool.length) {
    // recency weight (half-life 30 d) x favour the best: top-3 by vdot
    for (const e of pool) e.w = Math.pow(0.5, e.age / 30);
    const best = pool.slice().sort((a, b) => b.vdot - a.vdot).slice(0, 3);
    let cur = best.reduce((s, e) => s + e.vdot * e.w, 0) / best.reduce((s, e) => s + e.w, 0);
    if (!hard.length) cur *= 1.08; // easy runs understate fitness; rough correction, flagged below
    res.current = {
      vdot: pyRound(cur, 1), predicted: hms(raceTime(cur, distM)), predictedMinutes: raceTime(cur, distM),
      basis: hard.length ? 'hard efforts' : 'easy runs only (rough: log a 5 km test at RPE 8-9)',
      paces: paces(cur, distM),
      // equivalent times at the other standard distances (same VDOT)
      equivalents: Object.fromEntries(Object.entries(DISTANCES).map(([k, v]) => [k, hms(raceTime(cur, v.m))])),
    };
    const gap = goalVdot - cur;
    const weeks = Math.max(res.goal.weeksLeft, 0.1);
    // trained runners typically gain ~0.3-0.5 VDOT/week early on, slowing later
    const need = gap / weeks;
    res.gap = {
      vdot: pyRound(gap, 1), perWeekNeeded: pyRound(need, 2),
      verdict: gap <= 0 ? 'on track — already at goal fitness'
        : need <= 0.35 ? 'realistic'
        : need <= 0.55 ? 'ambitious but possible'
        : 'very unlikely by this race — consider a stepping-stone goal',
    };
  }

  // 2) personal endurance exponent
  if (new Set(hard.map(e => pyRound(e.km))).size >= 2) {
    const xs = hard.map(e => Math.log(e.km)), ys = hard.map(e => Math.log(e.min));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    if (den > 1e-9) {
      let k = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / den;
      k = Math.min(Math.max(k, 1.0), 1.2);
      const ref = hard.reduce((m, e) => (e.km > m.km ? e : m), hard[0]);
      const pm = ref.min * Math.pow(distKm / ref.km, k);
      res.personal = {
        exponent: pyRound(k, 3), riegelDefault: 1.06, predicted: hms(pm), predictedMinutes: pm,
        note: '<1.06 = you hold pace well over distance; >1.06 = endurance is your limiter',
      };
    }
  }

  // 3) Banister load model
  const load = new Map();
  for (const r of runs) {
    const rpe = r.rpe || 5;
    const k = dayNum(r.date);
    load.set(k, (load.get(k) || 0) + r.minutes * rpe / 10);
  }
  if (runs.length) {
    let ctl = 0, atl = 0;
    const week7 = [];
    for (let d = dayNum(runs[0].date); d <= tN; d++) {
      const l = load.get(d) || 0;
      ctl += (l - ctl) / 42;
      atl += (l - atl) / 7;
      week7.push(l);
    }
    const sum = a => a.reduce((s, x) => s + x, 0);
    const a7 = sum(week7.slice(-7));
    const c28 = week7.length >= 7 ? sum(week7.slice(-28)) / 4 : a7;
    const acwr = c28 ? a7 / c28 : 0;
    res.load = {
      fitness: pyRound(ctl, 1), fatigue: pyRound(atl, 1), form: pyRound(ctl - atl, 1), acwr: pyRound(acwr, 2),
      flag: acwr > 1.5 ? '⚠️ load spike — injury risk, ease off' : acwr >= 0.8 ? 'building well' : 'detraining / low load',
    };
    // Acute:chronic needs a real 28-day base; with less history every new runner reads as a "spike".
    if (week7.length < 28) {
      res.load.flag = `still learning your normal load (${week7.length}/28 days of history)`;
      res.load.learning = true;
    }
    const last7 = runs.filter(r => tN - dayNum(r.date) < 7);
    res.load.km7 = pyRound(last7.reduce((s, r) => s + r.km, 0), 1);
  }

  // 4) mileage ramp to race day: +10%/wk, cutback every 4th week, taper, peak and long-run caps by distance
  const base = (res.load && res.load.km7) || 15;
  const plan = [];
  let km = Math.max(base, 12), wk = 1, d = tN + (7 - weekday(today)) % 7;
  while (d + 6 <= rN) {
    const wtr = Math.floor((rN - d) / 7);
    let target, focus;
    if (wtr <= 0) { target = km * (G.distance === 'marathon' ? 0.5 : 0.55); focus = 'race week'; }
    else if (wtr <= 1) { target = km * (G.distance === 'marathon' ? 0.65 : 0.75); focus = 'taper'; }
    else if (G.distance === 'marathon' && wtr <= 2) { target = km * 0.8; focus = 'taper'; }
    else if (wk % 4 === 0) { target = km * 0.8; focus = 'cutback'; }
    else {
      km = Math.min(km * 1.10, D.peakKm);
      target = km;
      focus = wk <= 6 ? 'base (easy + strides)' : wk <= 14 ? 'threshold (tempo + cruise intervals)'
        : `race-pace (${res.goal.pace} blocks)`;
    }
    const longRun = Math.min(pyRound(4 + target * 0.3), D.longCap);
    plan.push({ week: wk, start: numDay(d), km: pyRound(target), longRun, focus });
    d += 7; wk += 1;
  }
  res.plan = plan;
  return res;
}

/**
 * Suggested session for `day`, derived from the plan (replaces a calendar lookup).
 * Weekly template (Mon=0): rest, quality, easy, quality/easy, rest, easy, long.
 * Returns null on rest days; otherwise {title, km, minutes, hard, kind}.
 */
export function suggestSession(model, day) {
  const goal = model.goal;
  const dN = dayNum(day), rN = dayNum(goal.raceDate);
  if (dN === rN) {
    const km = DISTANCES[goal.distance].m / 1000;
    const min = model.current ? model.current.predictedMinutes : km * 6;
    return { title: `Race day: ${goal.name}`, km: pyRound(km, 1), minutes: Math.round(min), hard: true, kind: 'race' };
  }
  if (dN > rN) return null;
  let week = null;
  for (const w of model.plan) if (dayNum(w.start) <= dN && dN < dayNum(w.start) + 7) week = w;
  if (!week) { // before the plan's first Monday (or no plan): a gentle base week
    const km = Math.max((model.load && model.load.km7) || 15, 12);
    week = { km: pyRound(km), longRun: Math.min(pyRound(4 + km * 0.3), DISTANCES[goal.distance].longCap), focus: 'base (easy + strides)' };
  }
  const wd = weekday(day);
  const rest = week.km - week.longRun;
  const pace = model.current ? model.current.paces : model.goalPaces;
  const easySec = paceToSec(pace.Easy) || 390;
  const f = week.focus;
  const quality = f.startsWith('threshold') ? 'Tempo: 2 km easy, 20 min at threshold, 2 km easy'
    : f.startsWith('race-pace') ? `Race-pace blocks: 3 × 10 min at ${pace['Race pace']} (3 min jog)`
    : f === 'taper' ? 'Short sharpener: easy + 4 × 3 min at race pace'
    : f === 'race week' ? 'Shakeout: easy + 4 strides'
    : 'Easy + 6 × 20 s strides';
  const slots = {
    1: { share: 0.3, title: quality, hard: !f.startsWith('base') && f !== 'cutback' && f !== 'race week' },
    2: { share: 0.25, title: 'Easy run' },
    3: { share: 0.25, title: f.startsWith('threshold') ? 'Cruise intervals: 4 × 1 km at threshold (1 min jog)' : 'Easy run', hard: f.startsWith('threshold') },
    5: { share: 0.2, title: 'Easy run (keep it conversational)' },
  };
  if (wd === 6) {
    if (f === 'race week') return null;
    const km = week.longRun;
    return { title: `Long run at ${pace.Long}`, km, minutes: Math.round(km * (paceToSec(pace.Long) || easySec) / 60), hard: km >= 12, kind: 'long' };
  }
  // low-volume weeks get fewer, not shorter-than-useful, runs: ~1 session per 4 km of non-long volume
  const n = Math.min(Math.max(Math.floor(rest / 4), 1), 4);
  const active = [1, 3, 5, 2].slice(0, n);
  const s = active.includes(wd) ? slots[wd] : null;
  if (!s) return null;
  const share = s.share / active.reduce((a, k) => a + slots[k].share, 0);
  const km = Math.max(pyRound(rest * share, 1), 2);
  return { title: s.title, km, minutes: Math.round(km * easySec / 60), hard: !!s.hard, kind: s.hard ? 'quality' : 'easy' };
}

export function paceToSec(p) {
  const m = /^(\d+):(\d\d)/.exec(p || '');
  return m ? +m[1] * 60 + +m[2] : null;
}
