// Local storage: one key, versioned schema. Nothing leaves the browser.
export const KEY = 'runlab.data';
export const SCHEMA = 1;

export function blank() {
  return {
    schema: SCHEMA,
    onboarded: false,
    profile: { age: null, sex: '', heightCm: null, weightKg: null, goal: 'maintain', targetBedtime: '22:30' },
    goal: { name: '', distance: 'half', raceDate: '', goalMinutes: 120 },
    location: null, // {name, lat, lon}
    settings: { theme: '' }, // '' = match system
    runs: [],
    days: {},
  };
}

/** Bring any older/partial object up to the current schema (also used for imports). */
export function migrate(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Not a Run Lab data object');
  const b = blank();
  const out = {
    ...b, ...d,
    profile: { ...b.profile, ...(d.profile || {}) },
    goal: { ...b.goal, ...(d.goal || {}) },
    settings: { ...b.settings, ...(d.settings || {}) },
    runs: Array.isArray(d.runs) ? d.runs : [],
    days: d.days && typeof d.days === 'object' && !Array.isArray(d.days) ? d.days : {},
  };
  // schema 0 (original server app) stored a half-marathon goal as halfMinutes
  if (d.goal && d.goal.halfMinutes && !d.goal.goalMinutes) { out.goal.goalMinutes = d.goal.halfMinutes; out.goal.distance = 'half'; }
  delete out.goal.halfMinutes;
  out.runs = out.runs.filter(r => r && /^\d{4}-\d\d-\d\d/.test(r.date) && +r.km > 0 && +r.minutes > 0)
    .map(r => ({ id: String(r.id || Math.random().toString(36).slice(2, 10)), date: r.date.slice(0, 10), km: +r.km, minutes: +r.minutes,
      type: ['easy', 'long', 'tempo', 'intervals', 'test', 'race'].includes(r.type) ? r.type : 'easy', rpe: r.rpe ? +r.rpe : null }));
  if (out.location && !(Number.isFinite(+out.location.lat) && Number.isFinite(+out.location.lon))) out.location = null;
  out.schema = SCHEMA;
  return out;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : blank();
  } catch (e) {
    console.warn('Run Lab: stored data unreadable, starting fresh', e);
    return blank();
  }
}

export function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

export function exportJSON(d) {
  const blob = new Blob([JSON.stringify({ app: 'run-lab', exported: new Date().toISOString(), ...d }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `run-lab-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importFile(file) {
  const text = await file.text();
  const obj = JSON.parse(text);
  delete obj.app; delete obj.exported;
  return migrate(obj);
}
