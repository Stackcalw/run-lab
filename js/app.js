// Run Lab UI. Plain ES modules, no framework, no backend.
import * as M from './model.js';
import * as H from './health.js';
import * as S from './store.js';
import * as W from './weather.js';

let D = S.load();
const $ = id => document.getElementById(id);
const today = () => M.localToday();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const save = () => { S.save(D); };
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

export function hmsToMin(s) {
  const p = String(s || '').trim().split(':').map(Number);
  if (!p.length || p.some(x => isNaN(x))) return null;
  const v = p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p.length === 2 ? p[0] + p[1] / 60 : p[0];
  return v > 0 ? v : null;
}
const minToHms = m => M.hms(m);
const pace = (km, min) => M.paceStr(min * 60 / km);
const num = id => { const v = $(id).value; return v === '' ? undefined : +v; };
const fmtDate = s => new Date(M.dayNum(s) * 864e5).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---------------- navigation ----------------
const SECTIONS = ['onboard', 'today', 'train', 'health', 'settings'];
function show(t) {
  SECTIONS.forEach(s => $(s).classList.toggle('hidden', s !== t));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('nav').classList.toggle('hidden', t === 'onboard');
  if (t === 'today') renderToday();
  if (t === 'train') renderTrain();
  if (t === 'health') renderDays();
  if (t === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.t)));

function model() { return M.analyse(D, today()); }

function renderHeader() {
  const g = M.goalOf(D);
  if (!D.onboarded) { $('countdown').textContent = 'Set up your goal race'; return; }
  const lbl = M.DISTANCES[g.distance].label;
  const date = g.raceDate ? fmtDate(g.raceDate) : 'no date set';
  const days = g.raceDate ? M.dayNum(g.raceDate) - M.dayNum(today()) : null;
  $('countdown').textContent = `${g.name} · ${lbl} · ${date}${days !== null ? ` · ${days >= 0 ? days + ' days' : 'done'}` : ''} · goal ${minToHms(g.goalMinutes)}`;
}

// ---------------- today ----------------
function renderToday() {
  renderHeader();
  const day = today(), mdl = model();
  const run = M.suggestSession(mdl, day);
  const tmax = (window._wx && window._wx.daily && window._wx.daily.temperature_2m_max) ? window._wx.daily.temperature_2m_max[0] : null;
  const tg = H.targets(D, day, run, tmax), sc = H.score(D, day, tg, run);
  const s = sc.score;
  $('scoreNum').textContent = s ?? '–';
  $('scoreGrade').textContent = s == null ? 'log your day' : 'Grade ' + sc.grade;
  const css = getComputedStyle(document.documentElement);
  const col = s == null ? css.getPropertyValue('--line') : s >= 85 ? css.getPropertyValue('--ok') : s >= 70 ? css.getPropertyValue('--blue') : s >= 55 ? css.getPropertyValue('--warn') : css.getPropertyValue('--bad');
  $('ring').style.background = `conic-gradient(${col} ${(s || 0) * 3.6}deg, ${css.getPropertyValue('--line')} 0)`;
  $('scoreCov').textContent = s == null ? 'Nothing logged yet today' : sc.partial ? `Based on ${sc.coverage}% of the score (log more to complete)` : 'Full day logged';
  const names = { sleep: 'Sleep', water: 'Water', food: 'Nutrition', training: 'Training', recovery: 'Recovery' };
  $('parts').innerHTML = Object.entries(sc.parts).map(([k, v]) => `<tr><td>${names[k]}</td><td>${v[0]} / ${v[1]}</td></tr>`).join('') || '<tr><td class="mut">Log sleep, water, food, training and resting HR in “Log”.</td></tr>';
  $('notes').innerHTML = sc.notes.map(n => `<li>${esc(n)}</li>`).join('');
  if (run) {
    $('runTitle').textContent = run.title;
    $('runInfo').textContent = `~${run.km} km · ~${run.minutes} min${run.hard ? ' · quality day' : ''}`;
    const p = mdl.current ? mdl.current.paces : mdl.goalPaces;
    $('runPace').textContent = run.kind === 'race' ? `Goal pace ${mdl.goal.pace}. Start controlled.` : `Easy ${p.Easy} · threshold ${p.Threshold}${mdl.current ? '' : ' (goal paces until you log a hard effort)'}`;
  } else {
    $('runTitle').textContent = 'Rest day';
    $('runInfo').textContent = 'No session planned today: walk, stretch, sleep.';
    $('runPace').textContent = '';
  }
  $('bed').textContent = tg.bedtime;
  const [bh, bm] = tg.bedtime.split(':').map(Number);
  const wk = new Date(2000, 0, 1, bh, bm + tg.sleepH * 60);
  $('wakeTxt').textContent = `→ wake ${String(wk.getHours()).padStart(2, '0')}:${String(wk.getMinutes()).padStart(2, '0')} · ${tg.sleepH} h target`;
  $('macros').innerHTML = `<div class="big" style="font-size:22px">${tg.kcal} kcal</div><div class="small">Protein <b>${tg.proteinG} g</b> · Carbs <b>${tg.carbsG} g</b> · Fat <b>${tg.fatG} g</b> · <span class="pill">${tg.dayType} day</span></div>`;
  $('meals').innerHTML = tg.meals.map(m => `<li>${esc(m)}</li>`).join('');
  $('assumed').textContent = tg.assumed.length ? 'Assumed: ' + tg.assumed.join('; ') : '';
  $('waterT').textContent = tg.waterL + ' L';
  const wl = +(D.days[day] || {}).waterL || 0;
  $('waterBar').style.width = Math.min(wl / tg.waterL * 100, 100) + '%';
  $('waterNow').textContent = `${wl.toFixed(2)} L so far`;
  renderWx(run);
}

let wxFor = null;
async function renderWx(run) {
  const loc = D.location;
  $('wxBlocks').classList.toggle('hidden', !loc);
  if (!loc) {
    $('wxTitle').textContent = 'Weather';
    $('wxNow').textContent = '–';
    $('wxDesc').innerHTML = 'No location set. <a href="#" id="goLoc">Choose one in Settings</a> to see the forecast and what to wear.';
    $('goLoc').onclick = e => { e.preventDefault(); show('settings'); };
    $('wxRun').textContent = '';
    return;
  }
  $('wxTitle').textContent = `${loc.name} now`;
  const key = `${loc.lat},${loc.lon}`;
  try {
    if (!window._wx || wxFor !== key || Date.now() - window._wxAt > 15 * 60e3) {
      window._wx = await W.forecast(loc.lat, loc.lon); window._wxAt = Date.now(); wxFor = key;
    }
    const X = window._wx, c = X.current;
    $('wxNow').textContent = `${W.icon(c.weather_code)} ${Math.round(c.temperature_2m)}°C`;
    $('wxDesc').textContent = `${W.WX[c.weather_code] || ''} · feels ${Math.round(c.apparent_temperature)}° · wind ${Math.round(c.wind_speed_10m)} km/h · ${c.relative_humidity_2m}% humidity`;
    const locNow = (c.time || '').slice(0, 13); // forecast is in the location's own timezone
    const start = Math.max(X.hourly.time.findIndex(t => t.slice(0, 13) >= locNow), 0);
    const idx = [...Array(24).keys()].map(i => i + start).filter(i => i < X.hourly.time.length);
    $('hours').innerHTML = idx.map(i => `<div>${X.hourly.time[i].slice(11, 16)}<br>${W.icon(X.hourly.weather_code[i])}<br><b>${Math.round(X.hourly.temperature_2m[i])}°</b><br><span class="mut">${X.hourly.precipitation_probability[i] ?? '–'}%</span></div>`).join('');
    $('days').innerHTML = X.daily.time.map((t, i) => `<div style="min-width:80px">${new Date(M.dayNum(t) * 864e5).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}<br>${W.icon(X.daily.weather_code[i])}<br><b>${Math.round(X.daily.temperature_2m_max[i])}°</b> / ${Math.round(X.daily.temperature_2m_min[i])}°<br><span class="mut">${X.daily.precipitation_probability_max[i] ?? '–'}% rain</span></div>`).join('');
    if (run) {
      // pick the coolest daylight-ish hour window: next 12 h, prefer low rain
      const cand = idx.slice(0, 14).filter(i => { const h = +X.hourly.time[i].slice(11, 13); return h >= 6 && h <= 20; });
      const best = cand.sort((a, b) => (X.hourly.precipitation_probability[a] - X.hourly.precipitation_probability[b]) || (a - b))[0] ?? idx[0];
      const t = X.hourly.temperature_2m[best], p = X.hourly.precipitation_probability[best] ?? 0, wd = X.hourly.wind_speed_10m[best];
      $('wxRun').innerHTML = `Driest slot soon: <b>${X.hourly.time[best].slice(11, 16)}</b>, ${Math.round(t)}°C, ${p}% rain, wind ${Math.round(wd)} km/h → wear ${esc(W.kit(t, p, wd))}.`;
    } else $('wxRun').textContent = 'Rest day.';
  } catch (e) {
    $('wxNow').textContent = 'offline';
    $('wxDesc').textContent = 'Weather needs a connection; everything else works offline.';
    $('wxRun').textContent = '';
  }
}

// ---------------- training ----------------
function renderTrain() {
  renderHeader();
  const mdl = model(), g = mdl.goal;
  $('predTitle').textContent = `Predicted ${g.distanceLabel} (now)`;
  $('goalT').textContent = g.time;
  $('goalInfo').textContent = `${g.pace} · VDOT ${g.vdot} · ${g.daysLeft} days (${g.weeksLeft} wk)`;
  if (mdl.current) {
    $('predNow').textContent = mdl.current.predicted;
    $('predBasis').textContent = `VDOT ${mdl.current.vdot} · from ${mdl.current.basis}`;
    $('gapV').textContent = (mdl.gap.vdot > 0 ? '+' : '') + mdl.gap.vdot + ' VDOT';
    const v = mdl.gap.verdict;
    $('gapVerdict').innerHTML = `<span class="${v.startsWith('on') || v === 'realistic' ? 'ok' : v.startsWith('amb') ? 'warn' : 'bad'}">${esc(v)}</span> · need ${mdl.gap.perWeekNeeded}/wk`;
    $('equiv').innerHTML = Object.entries(mdl.current.equivalents).map(([k, t]) => `${M.DISTANCES[k].label} <b>${t}</b>`).join(' · ');
  } else {
    $('predNow').textContent = '–';
    $('predBasis').textContent = 'Log a run (ideally a 5 km time trial) to start the model.';
    $('gapV').textContent = '–'; $('gapVerdict').textContent = ''; $('equiv').textContent = '–';
  }
  if (mdl.load) {
    $('formV').textContent = (mdl.load.form > 0 ? '+' : '') + mdl.load.form;
    $('loadInfo').innerHTML = `fitness ${mdl.load.fitness} · fatigue ${mdl.load.fatigue}<br>ACWR ${mdl.load.acwr}: ${esc(mdl.load.flag)}<br>last 7 days: ${mdl.load.km7} km`;
  } else { $('formV').textContent = '–'; $('loadInfo').textContent = 'Log runs to see fitness, fatigue and form.'; }
  const P = mdl.current ? mdl.current.paces : null, G = mdl.goalPaces;
  $('pacesT').innerHTML = '<tr><th>Zone</th><th>Now</th><th>Goal</th></tr>' + Object.keys(G).map(k => `<tr><td>${k}</td><td>${P ? P[k] : '–'}</td><td>${G[k]}</td></tr>`).join('');
  $('personal').innerHTML = mdl.personal
    ? `Your fade exponent <b>${mdl.personal.exponent}</b> (average runner 1.06) → ${esc(g.distanceLabel)} ≈ <b>${mdl.personal.predicted}</b>. ${esc(mdl.personal.note)}.`
    : 'Log hard efforts at 2+ different distances to fit your own fade curve.';
  const t = today();
  let wkNow = mdl.plan.findIndex(w => w.start > t) - 1;
  if (wkNow < -1) wkNow = mdl.plan.length - 1;
  $('planT').innerHTML = mdl.plan.length
    ? '<tr><th>Wk</th><th>Starts</th><th>km</th><th>Long run</th><th>Focus</th></tr>' + mdl.plan.map((w, i) => `<tr class="planrow ${i === Math.max(wkNow, 0) ? 'now' : ''}"><td>${w.week}</td><td>${w.start}</td><td>${w.km}</td><td>${w.longRun} km</td><td>${esc(w.focus)}</td></tr>`).join('')
    : `<tr><td class="mut">${g.daysLeft < 7 ? 'Race is under a week away (or past): set a new goal race in Settings for a fresh plan.' : 'No plan yet.'}</td></tr>`;
  const rs = [...D.runs].sort((a, b) => b.date.localeCompare(a.date));
  $('runsT').innerHTML = '<tr><th>Date</th><th>km</th><th>Time</th><th>Pace</th><th>Type</th><th>RPE</th><th></th></tr>' + (rs.map(r => `<tr><td>${r.date}</td><td>${r.km}</td><td>${minToHms(r.minutes)}</td><td>${pace(r.km, r.minutes)}</td><td>${esc(r.type)}</td><td>${r.rpe ?? ''}</td><td><button class="x" data-del="${esc(r.id)}" aria-label="Delete run">✕</button></td></tr>`).join('') || '<tr><td class="mut" colspan="7">No runs yet.</td></tr>');
}
$('runsT').addEventListener('click', e => {
  const id = e.target.dataset && e.target.dataset.del;
  if (!id || !confirm('Delete this run?')) return;
  D.runs = D.runs.filter(r => r.id !== id); save(); renderTrain();
});
$('addRun').addEventListener('click', () => {
  const km = +$('rKm').value, min = hmsToMin($('rTime').value);
  if (!(km > 0) || !min) return toast('Distance and time needed');
  const rpe = Math.min(Math.max(+$('rRpe').value || 0, 0), 10) || null;
  D.runs.push({ id: Math.random().toString(36).slice(2, 10), date: $('rDate').value || today(), km, minutes: min, type: $('rType').value, rpe });
  save(); $('rKm').value = ''; $('rTime').value = ''; renderTrain(); toast('Run added');
});

// ---------------- day log ----------------
document.querySelectorAll('[data-water]').forEach(b => b.addEventListener('click', () => {
  const d = D.days[today()] = D.days[today()] || {};
  d.waterL = Math.round(((+d.waterL || 0) + +b.dataset.water) * 100) / 100;
  save(); renderToday();
}));
$('saveDay').addEventListener('click', () => {
  const day = $('hDate').value || today(), d = D.days[day] = D.days[day] || {};
  const set = (k, v) => { if (v !== undefined && v !== '' && !Number.isNaN(v)) d[k] = v; };
  set('bedtime', $('hBed').value); set('wake', $('hWake').value); set('waterL', num('hWater')); set('proteinG', num('hProt')); set('kcal', num('hKcal'));
  set('weightKg', num('hW')); set('restingHR', num('hHR')); set('feel', num('hFeel'));
  if ($('hTrained').value !== '') d.trained = $('hTrained').value === '1';
  set('note', $('hNote').value);
  save(); renderDays(); toast('Day saved');
});
function fillDayForm() {
  const d = D.days[$('hDate').value] || {};
  const map = { hBed: 'bedtime', hWake: 'wake', hWater: 'waterL', hProt: 'proteinG', hKcal: 'kcal', hW: 'weightKg', hHR: 'restingHR', hFeel: 'feel', hNote: 'note' };
  for (const [id, k] of Object.entries(map)) $(id).value = d[k] ?? '';
  $('hTrained').value = d.trained === undefined ? '' : d.trained ? '1' : '0';
}
$('hDate').addEventListener('change', fillDayForm);
function renderDays() {
  if (!$('hDate').value) { $('hDate').value = today(); fillDayForm(); }
  const ks = Object.keys(D.days).sort().reverse();
  $('daysT').innerHTML = '<tr><th>Date</th><th>Sleep</th><th>Water</th><th>Protein</th><th>kcal</th><th>Weight</th><th>RHR</th><th>Feel</th><th>Trained</th><th>Note</th></tr>' + (ks.map(k => {
    const d = D.days[k];
    return `<tr><td>${k}</td><td>${esc(d.bedtime || '')}${d.wake ? '→' + esc(d.wake) : ''}</td><td>${d.waterL ?? ''}</td><td>${d.proteinG ?? ''}</td><td>${d.kcal ?? ''}</td><td>${d.weightKg ?? ''}</td><td>${d.restingHR ?? ''}</td><td>${d.feel ?? ''}</td><td>${d.trained === undefined ? '' : d.trained ? '✓' : '✗'}</td><td>${esc(d.note || '')}</td></tr>`;
  }).join('') || '<tr><td class="mut" colspan="10">Nothing logged yet.</td></tr>');
}

// ---------------- location ----------------
function locText(id) { $(id).textContent = D.location ? `Weather for: ${D.location.name} (${D.location.lat}, ${D.location.lon})` : 'No location set. Weather is skipped until you choose one.'; }
function setLocation(loc) {
  D.location = loc ? { name: String(loc.name).slice(0, 80), lat: +loc.lat, lon: +loc.lon } : null;
  window._wx = null; save(); locText('oLoc'); locText('sLoc');
  $('oPlaces').innerHTML = ''; $('sPlaces').innerHTML = '';
  if (loc) toast('Location set: ' + D.location.name);
}
document.querySelectorAll('[data-act=geo]').forEach(b => b.addEventListener('click', async () => {
  try { b.disabled = true; setLocation(await W.myLocation()); } catch (e) { toast('Location unavailable: ' + e.message); } finally { b.disabled = false; }
}));
async function citySearch(srcId) {
  const q = $(srcId).value.trim(), out = srcId === 'oCity' ? $('oPlaces') : $('sPlaces');
  if (q.length < 2) return toast('Type at least 2 letters');
  try {
    const res = await W.searchPlace(q);
    window._places = res;
    out.innerHTML = res.length ? res.map((p, i) => `<button class="sec" type="button" data-pick="${i}">${esc(p.name)} <span class="mut small">${p.lat}, ${p.lon}</span></button>`).join('') : '<div class="small mut">No matches.</div>';
  } catch (e) { out.innerHTML = '<div class="small bad">Search needs a connection.</div>'; }
}
document.querySelectorAll('[data-act=city]').forEach(b => b.addEventListener('click', () => citySearch(b.dataset.src)));
['oCity', 'sCity'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); citySearch(id); } }));
['oPlaces', 'sPlaces'].forEach(id => $(id).addEventListener('click', e => {
  const b = e.target.closest('[data-pick]'); if (b) setLocation(window._places[+b.dataset.pick]);
}));
$('clearLoc').addEventListener('click', () => { setLocation(null); toast('Location cleared'); });

// ---------------- onboarding / settings ----------------
function defaultRaceDate() { return M.addDays(today(), 16 * 7 - M.weekday(today()) + 6); } // a Sunday ~16 weeks out
function readGoal(prefix) {
  const id = { o: { name: 'oRace', dist: 'oDist', date: 'oDate', time: 'oTime' }, g: { name: 'gName', dist: 'gDist', date: 'gDate', time: 'gTime' } }[prefix];
  return {
    name: $(id.name).value.trim().slice(0, 60) || 'Goal race',
    distance: $(id.dist).value,
    raceDate: $(id.date).value || defaultRaceDate(),
    goalMinutes: hmsToMin($(id.time).value),
  };
}
const DEFAULT_GOAL = { '5k': '25:00', '10k': '52:00', half: '1:59:00', marathon: '4:15:00' };
$('oDist').addEventListener('change', () => { $('oTime').placeholder = DEFAULT_GOAL[$('oDist').value]; });
function renderOnboard() {
  $('oDate').value = $('oDate').value || defaultRaceDate();
  $('oTime').placeholder = DEFAULT_GOAL[$('oDist').value];
  locText('oLoc');
}
$('oStart').addEventListener('click', () => {
  const age = num('oAge'), h = num('oH'), w = num('oW');
  if (!(age >= 12 && age <= 100)) return toast('Age should be 12–100');
  if (!(h >= 120 && h <= 230)) return toast('Height should be 120–230 cm');
  if (!(w >= 30 && w <= 250)) return toast('Weight should be 30–250 kg');
  const g = readGoal('o');
  g.goalMinutes = g.goalMinutes || hmsToMin(DEFAULT_GOAL[g.distance]);
  D.profile = { age, sex: $('oSex').value, heightCm: h, weightKg: w, goal: $('oGoalW').value, targetBedtime: $('oBed').value || '22:30' };
  D.goal = g; D.onboarded = true; save();
  show('today'); toast('All set. Log your first run in Train.');
});
function renderSettings() {
  const p = D.profile, g = M.goalOf(D);
  $('pAge').value = p.age ?? ''; $('pSex').value = p.sex || ''; $('pH').value = p.heightCm ?? ''; $('pW').value = p.weightKg ?? '';
  $('pGoalW').value = p.goal || 'maintain'; $('pBed').value = p.targetBedtime || '22:30';
  $('gName').value = D.goal.name || ''; $('gDist').value = g.distance; $('gDate').value = D.goal.raceDate || ''; $('gTime').value = minToHms(g.goalMinutes);
  $('pTheme').value = D.settings.theme || '';
  locText('sLoc');
  const bytes = new Blob([JSON.stringify(D)]).size;
  $('dataInfo').textContent = `${D.runs.length} runs · ${Object.keys(D.days).length} logged days · ${(bytes / 1024).toFixed(1)} KB stored in this browser. Export regularly to back up or move devices.`;
}
$('saveProfile').addEventListener('click', () => {
  const p = D.profile;
  p.age = num('pAge'); p.sex = $('pSex').value; p.heightCm = num('pH'); p.weightKg = num('pW'); p.goal = $('pGoalW').value; p.targetBedtime = $('pBed').value || '22:30';
  const g = readGoal('g');
  D.goal = { ...D.goal, ...g, goalMinutes: g.goalMinutes || D.goal.goalMinutes };
  D.settings.theme = $('pTheme').value; applyTheme();
  save(); renderHeader(); renderSettings(); toast('Saved');
});
function applyTheme() {
  const t = D.settings.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#f4f5f7' : '#0e1117';
}
$('exportBtn').addEventListener('click', () => { S.exportJSON(D); toast('Exported'); });
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = await S.importFile(f);
    if (!confirm(`Replace the data in this browser with ${d.runs.length} runs and ${Object.keys(d.days).length} days from ${f.name}?`)) return;
    D = d; if (!D.onboarded && (D.runs.length || D.profile.age)) D.onboarded = true;
    save(); applyTheme(); renderSettings(); renderHeader(); toast('Imported');
  } catch (err) { toast('Import failed: ' + err.message); } finally { e.target.value = ''; }
});
$('wipeBtn').addEventListener('click', () => {
  if (!confirm('Delete ALL Run Lab data in this browser? Export first if you want a backup.')) return;
  localStorage.removeItem(S.KEY); D = S.load(); applyTheme(); show('onboard'); renderOnboard(); renderHeader();
});

// keep tabs in sync if the app is open twice
window.addEventListener('storage', e => { if (e.key === S.KEY) { D = S.load(); renderHeader(); } });

// ---------------- boot ----------------
$('rDate').value = today();
applyTheme();
if (D.onboarded) show('today'); else { show('onboard'); renderOnboard(); }
renderHeader();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.RunLab = { get data() { return D; }, model, M, H, S };
