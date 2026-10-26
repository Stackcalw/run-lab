"""Daily health targets + health score (0-100). Stdlib only.

Targets are standard sports-nutrition rules of thumb, not medical advice:
- Energy: Mifflin-St Jeor BMR x 1.4 (active) + ~1 kcal/kg/km running + 300 kcal surplus
  (this reference version assumes a slow lean-gain goal).
- Protein 1.8 g/kg; carbs scale with training load (4 / 5 / 6.5 g/kg); fat = remainder.
- Water: 35 ml/kg/day + 600 ml per hour of running (+500 ml if >20 C).
- Sleep: 8.5 h target; bedtime from the profile.
"""
from datetime import date, datetime, timedelta


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def latest_weight(data):
    days = sorted((d for d in data.get("days", {}).items() if _f(d[1].get("weightKg"))), key=lambda kv: kv[0])
    if days:
        return _f(days[-1][1]["weightKg"])
    return _f(data.get("profile", {}).get("weightKg")) or 70.0


def targets(data, day, planned_run=None, temp_max=None):
    p = data.get("profile", {})
    w = latest_weight(data)
    h = _f(p.get("heightCm"))
    age = int(p.get("age") or 30)
    assumed = []
    if not h:
        h = 175.0
        assumed.append("height 175 cm (set yours in Profile)")
    bmr = 10 * w + 6.25 * h - 5 * age + 5
    km = (planned_run or {}).get("km") or 0
    run_min = (planned_run or {}).get("minutes") or (km * 6.5 if km else 0)
    kind = "rest" if not km else ("long/hard" if km >= 12 or (planned_run or {}).get("hard") else "easy")
    kcal = bmr * 1.4 + 1.0 * w * km + 300
    protein = 1.8 * w
    carbs = {"rest": 4, "easy": 5, "long/hard": 6.5}[kind] * w
    fat = max((kcal - protein * 4 - carbs * 4) / 9, 0.8 * w)
    water = 35 * w + 600 * run_min / 60 + (500 if (temp_max or 0) > 20 else 0)
    return {
        "dayType": kind, "weightKg": round(w, 1), "assumed": assumed,
        "kcal": int(round(kcal, -1)), "proteinG": int(round(protein)), "carbsG": int(round(carbs)),
        "fatG": int(round(fat)), "waterL": round(water / 1000, 1), "sleepH": 8.5,
        "meals": meals(kind, w),
    }


def meals(kind, w):
    p = int(round(1.8 * w / 4))  # protein per meal, 4 feeds
    base = [
        f"Breakfast: porridge (80 g oats + milk) + banana + 2 eggs or Greek yogurt (~{p} g protein)",
        f"Lunch: rice/pasta + chicken, tuna or tofu + veg (~{p} g protein)",
        f"Dinner: big carb portion + salmon/beef/chicken or lentils + veg (~{p} g protein)",
        "Snack before bed: Greek yogurt or milk + handful of nuts (casein, helps overnight recovery)",
    ]
    if kind == "rest":
        return base + ["Rest day: normal portions, still hit protein — this is when muscle is built."]
    pre = "60-90 min before the run: toast + honey or a banana (easy carbs, low fibre)."
    post = "Within 60 min after: 20-30 g protein + carbs (chocolate milk, or a rice + chicken meal)."
    extra = ["Long/hard day: +1 extra carb portion at lunch and dinner; take a gel/snack every ~40 min on runs >75 min."] if kind == "long/hard" else []
    return base[:1] + [pre, post] + base[1:] + extra


def _hours(a, b):
    try:
        t1 = datetime.strptime(a, "%H:%M")
        t2 = datetime.strptime(b, "%H:%M")
    except (TypeError, ValueError):
        return None
    d = (t2 - t1).total_seconds() / 3600
    return d + 24 if d <= 0 else d


def score(data, day, tg, planned_run=None):
    """Score a logged day. Missing parts are left out and the total is rescaled (marked partial)."""
    log = data.get("days", {}).get(day, {})
    parts, notes = {}, []
    # Sleep (30): duration 24 + consistency 6
    sh = _f(log.get("sleepHours")) or _hours(log.get("bedtime"), log.get("wake"))
    if sh:
        dur = min(sh / tg["sleepH"], 1.0) * 24
        cons = 6.0
        tb = data.get("profile", {}).get("targetBedtime", "22:30")
        if log.get("bedtime"):
            off = abs(_hours(tb, log["bedtime"]) or 0)
            off = min(off, 24 - off)
            cons = 6.0 if off <= 0.5 else 3.0 if off <= 1.0 else 0.0
        parts["sleep"] = (dur + cons, 30)
        if sh < 7:
            notes.append(f"Slept {sh:.1f} h — under 7 h cuts recovery and reaction time; protect tonight's bedtime.")
    # Hydration (15)
    wl = _f(log.get("waterL"))
    if wl is not None:
        parts["water"] = (min(wl / tg["waterL"], 1.0) * 15, 15)
        if wl < tg["waterL"] * 0.7:
            notes.append(f"Water {wl:.1f}/{tg['waterL']} L — drink ~{tg['waterL'] - wl:.1f} L more, spread out.")
    # Nutrition (20): protein 10 + energy 10
    pg, kc = _f(log.get("proteinG")), _f(log.get("kcal"))
    if pg is not None or kc is not None:
        s, m = 0.0, 0
        if pg is not None:
            s += min(pg / tg["proteinG"], 1.0) * 10
            m += 10
            if pg < tg["proteinG"] * 0.8:
                notes.append(f"Protein {pg:.0f}/{tg['proteinG']} g — add a yogurt, eggs or a shake.")
        if kc is not None:
            ratio = kc / tg["kcal"]
            s += 10 if 0.9 <= ratio <= 1.15 else max(0.0, 10 - abs(ratio - 1) * 40)
            m += 10
            if ratio < 0.85:
                notes.append("Under-eating — you won't recover from runs on a deficit.")
        parts["food"] = (s, m)
    # Training (20)
    done = log.get("trained")
    if done is not None:  # only scored once logged, so a run later today doesn't drag the score down
        if planned_run:
            s = 20 if done else 0
            if not done:
                notes.append("Planned run not logged as done.")
        else:
            s = 20  # rest day honoured, or extra activity
        parts["training"] = (s, 20)
    # Recovery (15): resting HR vs baseline 8 + how-you-feel 7
    rhr, feel = _f(log.get("restingHR")), _f(log.get("feel"))
    if rhr is not None or feel is not None:
        s, m = 0.0, 0
        if rhr is not None:
            prev = [_f(v.get("restingHR")) for k, v in data.get("days", {}).items() if k < day and _f(v.get("restingHR"))]
            base = sum(prev[-7:]) / len(prev[-7:]) if prev else rhr
            s += 8 if rhr <= base + 3 else max(0.0, 8 - (rhr - base - 3) * 2)
            m += 8
            if rhr > base + 5:
                notes.append(f"Resting HR {rhr:.0f} vs ~{base:.0f} usual — sign of fatigue or illness; make today easy.")
        if feel is not None:
            s += (feel - 1) / 4 * 7
            m += 7
        parts["recovery"] = (s, m)
    got = sum(v[0] for v in parts.values())
    maxp = sum(v[1] for v in parts.values())
    total = round(got / maxp * 100) if maxp else None
    return {"score": total, "partial": maxp < 100, "coverage": maxp,
            "parts": {k: [round(v[0], 1), v[1]] for k, v in parts.items()},
            "grade": None if total is None else "A" if total >= 85 else "B" if total >= 70 else "C" if total >= 55 else "D",
            "notes": notes}
