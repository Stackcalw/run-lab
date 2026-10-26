"""Reference half-marathon model (stdlib only). Original server-side implementation
that js/model.js ports; kept here only so test/parity.mjs can check the port.

Three pieces, all fitted to the runner's own logged data:
1. Fitness estimate (VDOT) from each hard effort, using Jack Daniels' VO2 formulas.
   Recency-weighted -> current VDOT -> predicted half-marathon time.
2. Personal endurance exponent: least-squares fit of log(time) ~ k*log(distance)
   over the best efforts (Riegel's 1.06 is the population default; we learn yours).
3. Banister impulse-response load model: fitness (42-day) / fatigue (7-day) / form,
   plus acute:chronic workload ratio as an injury-risk flag.
Then: gap to the goal, training paces, and a week-by-week mileage ramp to race day.
"""
import math
from datetime import date, datetime, timedelta

HALF_M = 21097.5


def vo2(v):  # v in m/min
    return -4.60 + 0.182258 * v + 0.000104 * v * v


def pct_max(t):  # t in minutes
    return 0.8 + 0.1894393 * math.exp(-0.012778 * t) + 0.2989558 * math.exp(-0.1932605 * t)


def vdot(dist_m, t_min):
    return vo2(dist_m / t_min) / pct_max(t_min)


def race_time(vd, dist_m):
    """Minutes to run dist_m at VDOT vd (bisection)."""
    lo, hi = dist_m / 600, dist_m / 50
    for _ in range(80):
        mid = (lo + hi) / 2
        if vdot(dist_m, mid) > vd:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def v_for_vo2(target):  # inverse of vo2(v)
    a, b, c = 0.000104, 0.182258, -4.60 - target
    return (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)


def pace_str(sec_per_km):
    m, s = divmod(int(round(sec_per_km)), 60)
    return f"{m}:{s:02d}/km"


def hms(minutes):
    s = int(round(minutes * 60))
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def paces(vd):
    """Daniels-style training paces from a VDOT."""
    out = {}
    for name, frac in [("Easy", 0.66), ("Long", 0.70), ("Threshold", 0.88), ("Interval", 0.98)]:
        v = v_for_vo2(vd * frac)
        out[name] = pace_str(60000 / v)
    out["Half race pace"] = pace_str(race_time(vd, HALF_M) * 60 / 21.0975)
    return out


def _d(s):
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def analyse(data, today=None):
    today = today or date.today()
    goal_min = data.get("goal", {}).get("halfMinutes", 90)
    race_day = _d(data.get("goal", {}).get("raceDate", "2027-04-04"))
    runs = sorted([r for r in data.get("runs", []) if r.get("km") and r.get("minutes")], key=lambda r: r["date"])
    goal_vdot = vdot(HALF_M, goal_min)
    res = {"goal": {"time": hms(goal_min), "vdot": round(goal_vdot, 1), "pace": pace_str(goal_min * 60 / 21.0975),
                    "raceDate": race_day.isoformat(), "daysLeft": (race_day - today).days,
                    "weeksLeft": round((race_day - today).days / 7, 1)},
           "goalPaces": paces(goal_vdot), "runs": len(runs)}

    # 1) fitness from hard efforts (RPE>=7 or marked race/test), >=1.5 km, last 120 days
    efforts = []
    for r in runs:
        age = (today - _d(r["date"])).days
        if age > 120 or r["km"] < 1.5:
            continue
        hard = r.get("type") in ("race", "test", "tempo", "intervals") or (r.get("rpe") or 0) >= 7
        vd = vdot(r["km"] * 1000, r["minutes"])
        efforts.append({"date": r["date"], "km": r["km"], "min": r["minutes"], "vdot": vd, "hard": hard, "age": age})
    hard = [e for e in efforts if e["hard"]]
    pool = hard or efforts
    if pool:
        # recency weight (half-life 30 d) x favour the best: top-3 by weighted vdot
        for e in pool:
            e["w"] = 0.5 ** (e["age"] / 30)
        best = sorted(pool, key=lambda e: e["vdot"], reverse=True)[:3]
        cur = sum(e["vdot"] * e["w"] for e in best) / sum(e["w"] for e in best)
        if not hard:
            cur *= 1.08  # easy runs understate fitness; rough correction, flagged below
        res["current"] = {"vdot": round(cur, 1), "predictedHalf": hms(race_time(cur, HALF_M)),
                          "basis": "hard efforts" if hard else "easy runs only (rough: log a 5 km test at RPE 8-9)",
                          "paces": paces(cur)}
        gap = goal_vdot - cur
        weeks = max(res["goal"]["weeksLeft"], 0.1)
        # trained runners typically gain ~0.3-0.5 VDOT/week early on, slowing later
        need = gap / weeks
        res["gap"] = {"vdot": round(gap, 1), "perWeekNeeded": round(need, 2),
                      "verdict": ("on track — already at goal fitness" if gap <= 0 else
                                  "realistic" if need <= 0.35 else
                                  "ambitious but possible" if need <= 0.55 else
                                  "very unlikely by this race — consider a stepping-stone goal")}
    # 2) personal endurance exponent
    if len({round(e["km"]) for e in hard}) >= 2:
        xs = [math.log(e["km"]) for e in hard]
        ys = [math.log(e["min"]) for e in hard]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        den = sum((x - mx) ** 2 for x in xs)
        if den > 1e-9:
            k = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den
            k = min(max(k, 1.0), 1.2)
            ref = max(hard, key=lambda e: e["km"])
            res["personal"] = {"exponent": round(k, 3), "riegelDefault": 1.06,
                               "predictedHalf": hms(ref["min"] * (21.0975 / ref["km"]) ** k),
                               "note": "<1.06 = you hold pace well over distance; >1.06 = endurance is your limiter"}
    # 3) Banister load model
    load = {}
    for r in runs:
        rpe = r.get("rpe") or 5
        load[_d(r["date"])] = load.get(_d(r["date"]), 0) + r["minutes"] * rpe / 10
    if runs:
        start = _d(runs[0]["date"])
        ctl = atl = 0.0
        d = start
        week7 = []
        while d <= today:
            l = load.get(d, 0)
            ctl += (l - ctl) / 42
            atl += (l - atl) / 7
            week7.append(l)
            d += timedelta(days=1)
        a7 = sum(week7[-7:])
        c28 = sum(week7[-28:]) / 4 if len(week7) >= 7 else a7
        acwr = a7 / c28 if c28 else 0
        res["load"] = {"fitness": round(ctl, 1), "fatigue": round(atl, 1), "form": round(ctl - atl, 1),
                       "acwr": round(acwr, 2),
                       "flag": ("⚠️ load spike — injury risk, ease off" if acwr > 1.5 else
                                "building well" if acwr >= 0.8 else "detraining / low load")}
        last7 = [r for r in runs if (today - _d(r["date"])).days < 7]
        res["load"]["km7"] = round(sum(r["km"] for r in last7), 1)
    # 4) mileage ramp to race day: +10%/wk, cutback every 4th week, 2-week taper, peak 55 km, long run to 20 km
    base = res.get("load", {}).get("km7") or 15
    plan, km, wk, d = [], max(base, 12), 1, today + timedelta(days=(7 - today.weekday()) % 7)
    while d + timedelta(days=6) <= race_day:
        weeks_to_race = (race_day - d).days // 7
        if weeks_to_race <= 0:
            target, focus = km * 0.55, "race week"
        elif weeks_to_race <= 1:
            target, focus = km * 0.75, "taper"
        elif wk % 4 == 0:
            target, focus = km * 0.8, "cutback"
        else:
            km = min(km * 1.10, 55)
            target = km
            focus = ("base (easy + strides)" if wk <= 6 else "threshold (tempo + cruise intervals)" if wk <= 14
                     else "race-pace (4:16/km blocks)")
        longrun = min(round(4 + target * 0.3), 20)
        plan.append({"week": wk, "start": d.isoformat(), "km": round(target), "longRun": longrun, "focus": focus})
        d += timedelta(days=7)
        wk += 1
    res["plan"] = plan
    return res
