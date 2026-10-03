#!/usr/bin/env python3
"""
TrainMe – Phase 1 activity catalog (knowledge base) builder.

Single source of truth for the Phase 1 catalog seed. Running it:
  1. validates the catalog (unique keys, conditions, metric references, type rules),
  2. writes  catalog/phase1/catalog.json            (seed loaded by the catalog-svc seed Job),
  3. writes  docs/07_Phase1_Activity_Catalog.md      (human-readable reference).

Usage:  python3 catalog/tools/build_phase1_catalog.py
"""
import json
import os
import sys
from collections import OrderedDict, Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VERSION = "phase1-2026.10"

# ---------------------------------------------------------------------------
# Small builders
# ---------------------------------------------------------------------------

def P(key, type_, label=None, unit=None, min=None, max=None, step=None, options=None, agg=None,
      req=False, when=None, desc=None, max_ref=None):
    """Parameter definition. when=(key, value) makes it conditional (shown/required only then)."""
    d = OrderedDict(key=key, label=label or key.replace("_", " ").capitalize(), type=type_)
    if unit: d["unit"] = unit
    c = OrderedDict()
    if min is not None: c["min"] = min
    if max is not None: c["max"] = max
    if step is not None: c["step"] = step
    if options: c["options"] = options
    if max_ref: c["max_ref"] = max_ref
    if c: d["constraints"] = c
    d["agg"] = agg or {"BOOL": "COUNT_TRUE", "INT": "SUM", "DECIMAL": "AVG", "DURATION": "SUM",
                       "ENUM": "COUNT", "TEXT": "NONE"}[type_]
    d["required"] = req
    if when: d["condition"] = {"when": {"key": when[0], "eq": when[1]}}
    if desc: d["description"] = desc
    return d


def T(fn, param="*", where=None, expr=None):
    t = OrderedDict(fn=fn)
    if expr: t["expr"] = expr
    else: t["param"] = param
    if where: t["where"] = where
    return t


def M(key, label, num, den=None, fmt="NUMBER", unit=None, decimals=1, scale=None):
    d = OrderedDict(key=key, label=label, kind="RATIO" if den is not None else "SINGLE", numerator=num)
    if den is not None: d["denominator"] = den
    disp = OrderedDict(format=fmt, decimals=decimals)
    if unit: disp["unit"] = unit
    if scale: disp["scale"] = scale
    d["display"] = disp
    return d


def pct(key, label, num, den):
    return M(key, label, num, den, fmt="PERCENT")


def attempt_pair(prefix, label):
    """The attempted -> accurate pattern requested for bowling (and reused across sports)."""
    return [P(f"{prefix}_attempted", "BOOL", f"{label} attempted", req=True),
            P(f"{prefix}_accurate", "BOOL", f"{label} accurate", req=True, when=(f"{prefix}_attempted", True))]


def attempt_metric(prefix, label):
    return pct(f"{prefix}_accuracy", f"{label} accuracy", T("COUNT_TRUE", f"{prefix}_accurate"),
               T("COUNT_TRUE", f"{prefix}_attempted"))


# ---------------------------------------------------------------------------
# Lookups (facets for search)
# ---------------------------------------------------------------------------
EQUIPMENT = ["barbell", "dumbbell", "kettlebell", "cable", "machine", "smith_machine", "ez_bar", "bench", "pull_up_bar",
             "dip_bars", "resistance_band", "medicine_ball", "foam_roller", "ab_wheel", "trap_bar", "landmine", "sled",
             "box", "jump_rope", "treadmill", "stationary_bike", "rower", "elliptical", "stair_climber", "body_only",
             "cones", "ladder", "bowling_machine", "stumps", "cricket_ball", "tennis_ball", "racquet", "shuttle",
             "football", "goal", "speed_gun", "stopwatch", "heart_rate_monitor", "other"]

MUSCLES = OrderedDict([
    ("chest", "Chest"), ("upper_chest", "Upper chest"), ("lats", "Latissimus dorsi"), ("middle_back", "Middle back / rhomboids"),
    ("lower_back", "Lower back / erectors"), ("traps", "Trapezius"), ("front_delts", "Front deltoids"),
    ("side_delts", "Side deltoids"), ("rear_delts", "Rear deltoids"), ("rotator_cuff", "Rotator cuff"),
    ("biceps", "Biceps"), ("brachialis", "Brachialis"), ("triceps", "Triceps"), ("forearms", "Forearms / grip"),
    ("quadriceps", "Quadriceps"), ("hamstrings", "Hamstrings"), ("glutes", "Glutes"), ("adductors", "Adductors"),
    ("abductors", "Abductors"), ("calves", "Calves"), ("hip_flexors", "Hip flexors"), ("abdominals", "Abdominals"),
    ("obliques", "Obliques"), ("full_body", "Full body"), ("cardiovascular", "Cardiovascular system"),
])

LEVELS = ["beginner", "intermediate", "advanced"]

# ---------------------------------------------------------------------------
# Reusable parameter sets (shared by many activities -> no duplication)
# ---------------------------------------------------------------------------
PSETS = OrderedDict()

PSETS["strength_set"] = dict(name="Weighted set", desc="One row per working set with external load.",
    params=[P("reps", "INT", "Reps", "reps", 0, 100, req=True),
            P("weight_kg", "DECIMAL", "Weight", "kg", 0, 600, 0.25, agg="MAX", req=True),
            P("rpe", "INT", "RPE (1–10)", None, 1, 10, agg="AVG"),
            P("to_failure", "BOOL", "Taken to failure"),
            P("assisted_reps", "INT", "Assisted / forced reps", "reps", 0, 20, when=("to_failure", True)),
            P("rest_s", "DURATION", "Rest before set", "s", 0, 900, agg="AVG")],
    metrics=[M("sets", "Sets", T("COUNT")),
             M("total_reps", "Total reps", T("SUM", "reps")),
             M("volume_kg", "Volume load", T("SUM", expr="reps * weight_kg"), unit="kg", decimals=0),
             M("top_set_kg", "Top set weight", T("MAX", "weight_kg"), unit="kg"),
             M("est_1rm_kg", "Estimated 1RM (Epley)", T("MAX", expr="weight_kg * (1 + reps / 30)"), unit="kg"),
             M("avg_rpe", "Average RPE", T("SUM", "rpe"), T("COUNT", "rpe")),
             pct("failure_rate", "Sets to failure", T("COUNT_TRUE", "to_failure"), T("COUNT"))])

PSETS["bodyweight_set"] = dict(name="Body-weight set", desc="Reps with optional added load (vest/belt) or assistance (band/machine).",
    params=[P("reps", "INT", "Reps", "reps", 0, 200, req=True),
            P("added_weight_kg", "DECIMAL", "Added weight", "kg", 0, 150, 0.25, agg="MAX"),
            P("assistance_kg", "DECIMAL", "Assistance (band/machine)", "kg", 0, 150, 0.25, agg="AVG"),
            P("rpe", "INT", "RPE (1–10)", None, 1, 10, agg="AVG"),
            P("to_failure", "BOOL", "Taken to failure"),
            P("assisted_reps", "INT", "Assisted reps", "reps", 0, 20, when=("to_failure", True))],
    metrics=[M("sets", "Sets", T("COUNT")), M("total_reps", "Total reps", T("SUM", "reps")),
             M("max_reps", "Best set (reps)", T("MAX", "reps")),
             M("avg_rpe", "Average RPE", T("SUM", "rpe"), T("COUNT", "rpe"))])

PSETS["timed_hold"] = dict(name="Timed hold", desc="Isometric holds and carries measured by time.",
    params=[P("duration_s", "DURATION", "Hold time", "s", 0, 1800, req=True),
            P("added_weight_kg", "DECIMAL", "Added weight", "kg", 0, 200, 0.25, agg="MAX"),
            P("side", "ENUM", "Side", options=["both", "left", "right"]),
            P("rpe", "INT", "RPE (1–10)", None, 1, 10, agg="AVG")],
    metrics=[M("sets", "Sets", T("COUNT")), M("total_time_s", "Total time", T("SUM", "duration_s"), fmt="DURATION"),
             M("best_hold_s", "Longest hold", T("MAX", "duration_s"), fmt="DURATION")])

PSETS["carry"] = dict(name="Loaded carry", desc="Farmer's walk, suitcase carry, sled push/pull.",
    params=[P("distance_m", "DECIMAL", "Distance", "m", 0, 1000, req=True, agg="SUM"),
            P("weight_kg", "DECIMAL", "Load (total)", "kg", 0, 500, 0.5, agg="MAX", req=True),
            P("duration_s", "DURATION", "Time", "s", 0, 900)],
    metrics=[M("total_distance_m", "Total distance", T("SUM", "distance_m"), unit="m", decimals=0),
             M("top_load_kg", "Heaviest carry", T("MAX", "weight_kg"), unit="kg")])

PSETS["cardio_bout"] = dict(name="Cardio bout / interval", desc="Steady-state piece or one interval on a machine or outdoors.",
    params=[P("duration_s", "DURATION", "Duration", "s", 0, 6 * 3600, req=True),
            P("distance_m", "DECIMAL", "Distance", "m", 0, 100000, agg="SUM"),
            P("avg_hr", "INT", "Average heart rate", "bpm", 40, 220, agg="AVG"),
            P("max_hr", "INT", "Max heart rate", "bpm", 40, 230, agg="MAX"),
            P("calories", "INT", "Calories", "kcal", 0, 5000),
            P("resistance_level", "INT", "Resistance / incline level", None, 0, 40, agg="AVG"),
            P("is_work_interval", "BOOL", "Work interval (vs recovery)"),
            P("rpe", "INT", "RPE (1–10)", None, 1, 10, agg="AVG")],
    metrics=[M("total_duration_s", "Total time", T("SUM", "duration_s"), fmt="DURATION"),
             M("total_distance_km", "Total distance", T("SUM", "distance_m"), unit="km", scale=0.001, decimals=2),
             M("avg_pace_s_per_km", "Average pace", T("SUM", "duration_s"), T("SUM", "distance_m"), fmt="PACE", unit="min/km", scale=1000),
             M("time_weighted_hr", "Average HR (time-weighted)", T("SUM", expr="avg_hr * duration_s"), T("SUM", "duration_s", where={"avg_hr": {"gte": 1}}), unit="bpm", decimals=0),
             M("calories", "Calories", T("SUM", "calories"), unit="kcal", decimals=0)])

PSETS["sprint_rep"] = dict(name="Sprint / timed run rep", desc="Short timed effort over a fixed distance or course.",
    params=[P("distance_m", "DECIMAL", "Distance", "m", 1, 2000, req=True, agg="SUM"),
            P("time_s", "DECIMAL", "Time", "s", 0.5, 900, 0.01, agg="MIN", req=True),
            P("start", "ENUM", "Start", options=["standing", "crouch", "flying", "reactive"]),
            P("timing", "ENUM", "Timing method", options=["hand", "gates", "app"]),
            P("rest_s", "DURATION", "Rest after rep", "s", 0, 900, agg="AVG")],
    metrics=[M("reps", "Reps", T("COUNT")), M("best_time_s", "Best time", T("MIN", "time_s"), unit="s", decimals=2),
             M("avg_time_s", "Average time", T("SUM", "time_s"), T("COUNT", "time_s"), unit="s", decimals=2)])

PSETS["jump_throw"] = dict(name="Jump / throw effort", desc="Plyometric or ballistic effort measured by height or distance.",
    params=[P("reps", "INT", "Reps", "reps", 1, 50, req=True),
            P("height_cm", "DECIMAL", "Height", "cm", 0, 200, agg="MAX"),
            P("distance_cm", "DECIMAL", "Distance", "cm", 0, 3000, agg="MAX"),
            P("load_kg", "DECIMAL", "Load (box height / ball)", "kg", 0, 50, agg="MAX"),
            P("side", "ENUM", "Side", options=["both", "left", "right"])],
    metrics=[M("contacts", "Ground contacts / throws", T("SUM", "reps")),
             M("best_height_cm", "Best height", T("MAX", "height_cm"), unit="cm"),
             M("best_distance_cm", "Best distance", T("MAX", "distance_cm"), unit="cm")])

PSETS["mobility_set"] = dict(name="Mobility / stretch", desc="Stretch, mobility drill or soft-tissue work.",
    params=[P("duration_s", "DURATION", "Duration", "s", 0, 1800, req=True),
            P("reps", "INT", "Reps", "reps", 0, 100),
            P("side", "ENUM", "Side", options=["both", "left", "right"]),
            P("discomfort", "INT", "Discomfort (0–10)", None, 0, 10, agg="AVG")],
    metrics=[M("total_time_s", "Total time", T("SUM", "duration_s"), fmt="DURATION"),
             M("avg_discomfort", "Average discomfort", T("SUM", "discomfort"), T("COUNT", "discomfort"))])

PSETS["drill_block"] = dict(name="Drill block (attempts vs successes)", desc="Generic block: N attempts, M successful – for target and execution drills.",
    params=[P("attempts", "INT", "Attempts", None, 1, 500, req=True),
            P("successes", "INT", "Successful", None, 0, 500, req=True, max_ref="attempts"),
            P("duration_s", "DURATION", "Block time", "s", 0, 7200),
            P("rpe", "INT", "RPE (1–10)", None, 1, 10, agg="AVG")],
    metrics=[pct("success_rate", "Success rate", T("SUM", "successes"), T("SUM", "attempts")),
             M("attempts", "Attempts", T("SUM", "attempts"))])

PSETS["session_load"] = dict(name="Session load (sRPE)", desc="Foster session-RPE training load: RPE × minutes.",
    params=[P("duration_min", "INT", "Session minutes", "min", 1, 600, req=True),
            P("session_rpe", "INT", "Session RPE (CR-10)", None, 0, 10, req=True, agg="AVG"),
            P("sleep_quality", "INT", "Sleep quality (1–5)", None, 1, 5, agg="AVG"),
            P("soreness", "INT", "Soreness (1–5)", None, 1, 5, agg="AVG")],
    metrics=[M("srpe_load", "Training load (sRPE·min)", T("SUM", expr="session_rpe * duration_min"), unit="AU", decimals=0),
             M("minutes", "Minutes", T("SUM", "duration_min"))])

# ---------------------------------------------------------------------------
# Categories (taxonomy, any depth). kind: DOMAIN, SPORT, ROLE_GROUP, ROLE, DISCIPLINE, MUSCLE_GROUP, MUSCLE, AREA
# ---------------------------------------------------------------------------
CATS = OrderedDict()

def C(code, name, parent=None, kind="AREA", desc=None):
    CATS[code] = OrderedDict(code=code, name=name, parent=parent, kind=kind, **({"description": desc} if desc else {}))

C("sports", "Sports", kind="DOMAIN")
C("fitness", "Fitness", kind="DOMAIN")
# Cricket – roles
C("cricket", "Cricket", "sports", "SPORT", "Roles: batter, bowler (fast / spin), wicket-keeper, fielder; all-rounder combines them.")
C("cricket.batting", "Batting", "cricket", "ROLE_GROUP")
C("cricket.batter", "Batter", "cricket.batting", "ROLE")
C("cricket.bowling", "Bowling", "cricket", "ROLE_GROUP")
C("cricket.bowler", "Bowler", "cricket.bowling", "ROLE")
C("cricket.fast_bowler", "Fast / Medium-pace Bowler", "cricket.bowler", "ROLE")
C("cricket.spin_bowler", "Spin Bowler", "cricket.bowler", "ROLE")
C("cricket.fielding", "Fielding", "cricket", "ROLE_GROUP")
C("cricket.fielder", "Fielder", "cricket.fielding", "ROLE")
C("cricket.wicket_keeper", "Wicket-keeper", "cricket.fielding", "ROLE")
C("cricket.all_rounder", "All-rounder", "cricket", "ROLE")
C("cricket.fitness", "Cricket Fitness", "cricket", "AREA")
# Racquet sports – no roles
C("racquet", "Racquet Sports", "sports", "AREA")
C("tennis", "Lawn Tennis", "racquet", "SPORT", "No player roles; practice is organised by stroke area (serve, return, groundstrokes, net, movement) and match play.")
C("badminton", "Badminton", "racquet", "SPORT", "No player roles; singles and doubles share the same stroke library.")
# Football – positions
C("football", "Football (Soccer)", "sports", "SPORT", "Positions: goalkeeper, defender, midfielder, forward.")
C("football.goalkeeper", "Goalkeeper", "football", "ROLE")
C("football.defender", "Defender", "football", "ROLE")
C("football.midfielder", "Midfielder", "football", "ROLE")
C("football.forward", "Forward / Striker", "football", "ROLE")
# Athletics
C("athletics", "Athletics", "sports", "SPORT")
C("athletics.running", "Running", "athletics", "DISCIPLINE")
C("athletics.sprints", "Sprints", "athletics", "DISCIPLINE")
# Shared athletic conditioning
C("conditioning", "Athletic Conditioning", "sports", "AREA", "Shared by all sports: speed, agility, plyometrics, fitness tests, injury prevention, load monitoring.")
# Gym – muscle groups
C("gym", "Gym", "fitness", "AREA")
C("gym.chest", "Chest", "gym", "MUSCLE_GROUP")
C("gym.back", "Back", "gym", "MUSCLE_GROUP")
C("gym.shoulders", "Shoulders", "gym", "MUSCLE_GROUP")
C("gym.arms", "Arms", "gym", "MUSCLE_GROUP")
C("gym.arms.biceps", "Biceps", "gym.arms", "MUSCLE")
C("gym.arms.triceps", "Triceps", "gym.arms", "MUSCLE")
C("gym.arms.forearms", "Forearms & Grip", "gym.arms", "MUSCLE")
C("gym.legs", "Legs", "gym", "MUSCLE_GROUP")
C("gym.legs.quads", "Quadriceps", "gym.legs", "MUSCLE")
C("gym.legs.hamstrings", "Hamstrings", "gym.legs", "MUSCLE")
C("gym.legs.glutes", "Glutes", "gym.legs", "MUSCLE")
C("gym.legs.calves", "Calves", "gym.legs", "MUSCLE")
C("gym.core", "Core & Abs", "gym", "MUSCLE_GROUP")
C("gym.full_body", "Full Body & Olympic Lifts", "gym", "MUSCLE_GROUP")
C("gym.cardio", "Cardio", "gym", "AREA")
C("gym.mobility", "Mobility & Recovery", "gym", "AREA")
C("gym.splits", "Training Splits & Programs", "gym", "AREA")
C("body", "Body Composition", "fitness", "AREA")

# ---------------------------------------------------------------------------
# Activity library (reusable across templates)
# ---------------------------------------------------------------------------
ACTS = OrderedDict()

def A(code, name, kind, mode, cats, params=(), psets=(), metrics=(), grouping=None, sports=(), roles=(), equipment=(),
      primary=(), secondary=(), mechanic=None, force=None, level="beginner", synonyms=(), desc=None):
    ACTS[code] = OrderedDict(code=code, name=name, kind=kind, recordingMode=mode, categories=list(cats),
                             sports=list(sports), roles=list(roles), parameterSets=list(psets), params=list(params),
                             metrics=list(metrics), grouping=grouping, equipment=list(equipment),
                             primaryMuscles=list(primary), secondaryMuscles=list(secondary), mechanic=mechanic,
                             force=force, level=level, synonyms=list(synonyms), description=desc)

LINES = ["outside_off", "off_stump", "middle", "leg_stump", "down_leg", "wide"]
LENGTHS = ["yorker", "full", "good", "back_of_length", "short", "bouncer", "full_toss"]

# ----------------------------- CRICKET: fast bowling ------------------------
A("cricket.fast.delivery", "Fast Bowling – Delivery (ball by ball)", "DRILL", "PER_ATTEMPT",
  ["cricket.fast_bowler"], sports=["cricket"], roles=["fast_bowler"], grouping={"label": "Over", "size": 6},
  equipment=["cricket_ball", "stumps", "cones", "speed_gun"], level="beginner",
  synonyms=["pace bowling", "seam bowling", "net bowling", "ball by ball"],
  params=[P("speed_kmph", "DECIMAL", "Speed", "km/h", 40, 170, 0.1, agg="AVG"),
          P("line", "ENUM", "Line", options=LINES),
          P("length_landed", "ENUM", "Length landed", options=LENGTHS),
          *attempt_pair("yorker", "Yorker"), *attempt_pair("seam", "Seam-up / hit the seam"),
          *attempt_pair("bouncer", "Bouncer"), *attempt_pair("swing", "Swing"),
          *attempt_pair("slower_ball", "Slower ball"),
          P("target_hit", "BOOL", "Hit target zone / cone"),
          P("no_ball", "BOOL", "No-ball", req=True), P("wide", "BOOL", "Wide"),
          P("ball_age", "ENUM", "Ball", options=["new", "old"])],
  metrics=[attempt_metric("yorker", "Yorker"), attempt_metric("seam", "Seam"), attempt_metric("bouncer", "Bouncer"),
           attempt_metric("swing", "Swing"), attempt_metric("slower_ball", "Slower ball"),
           pct("target_hit_rate", "Target hit rate", T("COUNT_TRUE", "target_hit"), T("COUNT", "target_hit")),
           pct("good_length_pct", "Good-length %", T("COUNT", "length_landed", where={"length_landed": {"in": ["good", "back_of_length"]}}), T("COUNT", "length_landed")),
           pct("no_ball_rate", "No-ball rate", T("COUNT_TRUE", "no_ball"), T("COUNT")),
           pct("wide_rate", "Wide rate", T("COUNT_TRUE", "wide"), T("COUNT")),
           M("balls", "Balls bowled", T("COUNT")),
           M("avg_speed", "Average speed", T("SUM", "speed_kmph"), T("COUNT", "speed_kmph"), unit="km/h"),
           M("top_speed", "Top speed", T("MAX", "speed_kmph"), unit="km/h"),
           M("avg_bouncer_speed", "Average bouncer speed", T("SUM", "speed_kmph", where={"bouncer_attempted": True}),
             T("COUNT", "speed_kmph", where={"bouncer_attempted": True}), unit="km/h")],
  desc="Log every ball in nets or a spell: pace, line/length, and attempted → accurate for each skill (yorker, seam, bouncer, swing, slower ball).")

A("cricket.fast.target_drill", "Target / Cone Bowling Drill", "DRILL", "PER_SET", ["cricket.fast_bowler", "cricket.spin_bowler"],
  sports=["cricket"], roles=["fast_bowler", "spin_bowler"], equipment=["cones", "stumps", "cricket_ball"], psets=["drill_block"],
  params=[P("target_zone", "ENUM", "Target zone", options=["off_stump_good_length", "yorker_zone", "wide_yorker", "bouncer_zone", "fourth_stump", "leg_stump_yorker"], req=True)],
  synonyms=["accuracy drill", "cone drill", "corridor of uncertainty"], desc="Blocks of N balls at a marked target; success = landed in the zone.")

A("cricket.fast.run_up", "Run-up & Alignment Drill", "DRILL", "PER_ATTEMPT", ["cricket.fast_bowler"], sports=["cricket"], roles=["fast_bowler"],
  equipment=["cones"], params=[P("run_up_time_s", "DECIMAL", "Run-up time", "s", 1, 15, 0.01, agg="AVG"),
                               P("on_mark", "BOOL", "Front foot landed on mark", req=True),
                               P("aligned", "BOOL", "Aligned through crease (cone gate)", req=True),
                               P("no_ball", "BOOL", "No-ball")],
  metrics=[pct("on_mark_rate", "On-mark rate", T("COUNT_TRUE", "on_mark"), T("COUNT")),
           pct("alignment_rate", "Alignment rate", T("COUNT_TRUE", "aligned"), T("COUNT"))],
  synonyms=["approach", "rhythm", "cone alignment"])

A("cricket.bowling.spell_figures", "Bowling Spell / Match Figures", "MATCH", "PER_SESSION", ["cricket.bowler"],
  sports=["cricket"], roles=["fast_bowler", "spin_bowler"],
  params=[P("format", "ENUM", "Format", options=["T20", "ODI", "multi_day", "club", "practice_match"]),
          P("balls_bowled", "INT", "Balls bowled", None, 0, 600, req=True), P("maidens", "INT", "Maidens", None, 0, 100),
          P("runs_conceded", "INT", "Runs conceded", None, 0, 400, req=True), P("wickets", "INT", "Wickets", None, 0, 10, req=True),
          P("dot_balls", "INT", "Dot balls", None, 0, 600), P("wides", "INT", "Wides", None, 0, 100), P("no_balls", "INT", "No-balls", None, 0, 100)],
  metrics=[M("economy", "Economy (runs/over)", T("SUM", "runs_conceded"), T("SUM", "balls_bowled"), scale=6, decimals=2),
           M("bowling_average", "Bowling average", T("SUM", "runs_conceded"), T("SUM", "wickets"), decimals=2),
           M("bowling_strike_rate", "Strike rate (balls/wicket)", T("SUM", "balls_bowled"), T("SUM", "wickets")),
           pct("dot_ball_pct", "Dot-ball %", T("SUM", "dot_balls"), T("SUM", "balls_bowled")),
           M("wickets", "Wickets", T("SUM", "wickets"), decimals=0)],
  synonyms=["bowling figures", "economy", "spell"])

A("cricket.bowling.workload", "Bowling Workload Check-in", "LOG", "PER_SESSION", ["cricket.bowler", "cricket.fitness"],
  sports=["cricket"], roles=["fast_bowler", "spin_bowler"], psets=["session_load"],
  params=[P("balls_bowled", "INT", "Total balls (all activities)", None, 0, 600, req=True),
          P("pain_flag", "BOOL", "Any pain (back, side, ankle)?"),
          P("pain_site", "ENUM", "Pain site", options=["lower_back", "side", "shoulder", "knee", "ankle", "other"], when=("pain_flag", True))],
  metrics=[M("weekly_balls", "Balls bowled", T("SUM", "balls_bowled"), decimals=0)],
  synonyms=["workload", "srpe", "injury prevention"], desc="Daily ball count + session RPE for workload monitoring (Foster sRPE).")

# ----------------------------- CRICKET: spin bowling ------------------------
A("cricket.spin.delivery", "Spin Bowling – Delivery (ball by ball)", "DRILL", "PER_ATTEMPT", ["cricket.spin_bowler"],
  sports=["cricket"], roles=["spin_bowler"], grouping={"label": "Over", "size": 6}, equipment=["cricket_ball", "stumps", "cones"],
  synonyms=["off spin", "leg spin", "wrist spin", "finger spin", "googly", "doosra", "carrom ball"],
  params=[P("spin_type", "ENUM", "Spin type", options=["off_spin", "leg_spin", "left_arm_orthodox", "left_arm_wrist"]),
          P("delivery", "ENUM", "Delivery", options=["stock", "arm_ball", "top_spinner", "slider", "googly_doosra", "carrom", "flipper"], req=True),
          P("speed_kmph", "DECIMAL", "Speed", "km/h", 40, 120, 0.1, agg="AVG"),
          P("revs_rpm", "INT", "Revolutions", "rpm", 0, 3500, agg="AVG"),
          P("flight", "ENUM", "Flight", options=["flat", "normal", "flighted"]),
          P("line", "ENUM", "Line", options=LINES), P("length_landed", "ENUM", "Length landed", options=LENGTHS),
          *attempt_pair("turn", "Turn"), *attempt_pair("drift", "Drift"), *attempt_pair("variation", "Variation (disguised)"),
          P("target_hit", "BOOL", "Hit target zone"), P("full_toss", "BOOL", "Full toss"), P("long_hop", "BOOL", "Long hop"),
          P("no_ball", "BOOL", "No-ball", req=True), P("wide", "BOOL", "Wide")],
  metrics=[attempt_metric("turn", "Turn"), attempt_metric("drift", "Drift"), attempt_metric("variation", "Variation"),
           pct("target_hit_rate", "Target hit rate", T("COUNT_TRUE", "target_hit"), T("COUNT", "target_hit")),
           pct("bad_ball_rate", "Bad-ball rate (full toss + long hop)", [T("COUNT_TRUE", "full_toss"), T("COUNT_TRUE", "long_hop")], T("COUNT")),
           M("avg_revs", "Average revs", T("SUM", "revs_rpm"), T("COUNT", "revs_rpm"), unit="rpm", decimals=0),
           M("balls", "Balls bowled", T("COUNT"))])

# ----------------------------- CRICKET: batting -----------------------------
SHOTS = ["leave", "forward_defence", "back_defence", "straight_drive", "cover_drive", "off_drive", "on_drive", "square_drive",
         "cut", "late_cut", "pull", "hook", "flick", "glance", "sweep", "paddle_sweep", "slog_sweep", "reverse_sweep",
         "loft", "ramp_scoop", "switch_hit", "other"]
A("cricket.bat.ball_faced", "Batting – Ball Faced (nets / throw-downs)", "DRILL", "PER_ATTEMPT", ["cricket.batter"],
  sports=["cricket"], roles=["batter"], grouping={"label": "Over", "size": 6},
  equipment=["cricket_ball", "bowling_machine", "stumps"], synonyms=["net session", "throwdowns", "sidearm", "bowling machine"],
  params=[P("feed", "ENUM", "Feed", options=["pace", "spin", "throwdown", "sidearm", "bowling_machine"], req=True),
          P("ball_speed_kmph", "DECIMAL", "Ball speed", "km/h", 30, 160, agg="AVG"),
          P("line", "ENUM", "Line", options=LINES), P("length", "ENUM", "Length", options=LENGTHS),
          P("shot", "ENUM", "Shot played", options=SHOTS, req=True),
          P("foot", "ENUM", "Foot", options=["front", "back", "none"]),
          P("intent", "ENUM", "Intent", options=["defend", "rotate_strike", "attack"]),
          P("middled", "BOOL", "Middled", req=True), P("edged", "BOOL", "Edged"), P("beaten", "BOOL", "Beaten / played & missed"),
          P("dismissed", "BOOL", "Would be out", req=True),
          P("dismissal", "ENUM", "How out", options=["bowled", "caught", "lbw", "stumped", "run_out"], when=("dismissed", True)),
          P("runs_est", "INT", "Runs (estimated)", None, 0, 6)],
  metrics=[pct("middle_rate", "Middled % (shots, excl. leaves)", T("COUNT_TRUE", "middled"), T("COUNT", where={"shot": {"ne": "leave"}})),
           pct("false_shot_rate", "False-shot % (edged or beaten)", [T("COUNT_TRUE", "edged"), T("COUNT_TRUE", "beaten")], T("COUNT")),
           M("balls_per_dismissal", "Balls per dismissal", T("COUNT"), T("COUNT_TRUE", "dismissed")),
           M("strike_rate_est", "Strike rate (est.)", T("SUM", "runs_est"), T("COUNT", "runs_est"), scale=100),
           pct("boundary_pct", "Boundary-ball %", T("COUNT", where={"runs_est": {"in": [4, 6]}}), T("COUNT")),
           pct("attack_middle_rate", "Middled % when attacking", T("COUNT_TRUE", "middled", where={"intent": "attack"}), T("COUNT", where={"intent": "attack"})),
           M("balls", "Balls faced", T("COUNT"))],
  desc="One row per ball faced: what came (feed, line, length), what was played, and quality of contact.")

A("cricket.bat.shot_drill", "Batting Shot Drill (block)", "DRILL", "PER_SET", ["cricket.batter"], sports=["cricket"], roles=["batter"],
  psets=["drill_block"], equipment=["cricket_ball", "cones"],
  params=[P("shot", "ENUM", "Shot practised", options=SHOTS, req=True), P("feed", "ENUM", "Feed", options=["throwdown", "sidearm", "bowling_machine", "tee", "drop_feed"])],
  synonyms=["drive drill", "pull drill", "sweep drill", "front foot", "back foot"], desc="Blocks of throw-downs on one shot; success = executed as intended.")

A("cricket.bat.running_between", "Running Between Wickets", "DRILL", "PER_ATTEMPT", ["cricket.batter", "cricket.fitness"],
  sports=["cricket"], roles=["batter", "all_rounder"], equipment=["stumps", "stopwatch"],
  params=[P("runs", "ENUM", "Runs", options=["1", "2", "3"], req=True), P("time_s", "DECIMAL", "Time", "s", 2, 20, 0.01, agg="MIN", req=True),
          P("turn_side", "ENUM", "Turn", options=["left", "right"]), P("bat_grounded", "BOOL", "Bat slid in / grounded")],
  metrics=[M("best_run_three_s", "Best run-a-three", T("MIN", "time_s", where={"runs": "3"}), unit="s", decimals=2)],
  synonyms=["run a three", "quick singles"])

A("cricket.bat.innings", "Batting Innings (match)", "MATCH", "PER_SESSION", ["cricket.batter"], sports=["cricket"], roles=["batter", "all_rounder"],
  params=[P("format", "ENUM", "Format", options=["T20", "ODI", "multi_day", "club", "practice_match"]),
          P("position", "INT", "Batting position", None, 1, 11), P("runs", "INT", "Runs", None, 0, 500, req=True),
          P("balls", "INT", "Balls faced", None, 0, 700, req=True), P("fours", "INT", "Fours", None, 0, 100), P("sixes", "INT", "Sixes", None, 0, 50),
          P("dismissed", "BOOL", "Dismissed", req=True),
          P("dismissal", "ENUM", "How out", options=["bowled", "caught", "lbw", "stumped", "run_out", "hit_wicket", "other"], when=("dismissed", True))],
  metrics=[M("batting_average", "Batting average", T("SUM", "runs"), T("COUNT_TRUE", "dismissed"), decimals=2),
           M("strike_rate", "Strike rate", T("SUM", "runs"), T("SUM", "balls"), scale=100),
           pct("boundary_run_pct", "Runs in boundaries", T("SUM", expr="fours * 4 + sixes * 6"), T("SUM", "runs")),
           M("runs", "Runs", T("SUM", "runs"), decimals=0), M("high_score", "High score", T("MAX", "runs"), decimals=0)],
  synonyms=["innings", "scorecard", "batting stats"])

# ----------------------------- CRICKET: fielding & keeping ------------------
A("cricket.field.catch", "Catching Drill", "DRILL", "PER_ATTEMPT", ["cricket.fielder", "cricket.wicket_keeper"], sports=["cricket"],
  roles=["fielder", "wicket_keeper", "batter", "fast_bowler", "spin_bowler"], equipment=["cricket_ball"],
  params=[P("catch_type", "ENUM", "Catch type", options=["high", "flat", "slip_cordon", "close_in", "boundary", "reflex", "diving"], req=True),
          P("hands", "ENUM", "Hands", options=["two", "left", "right"]), P("distance_m", "DECIMAL", "Feed distance", "m", 1, 80),
          P("dive", "BOOL", "Dive required"), P("caught", "BOOL", "Caught", req=True),
          P("dropped_type", "ENUM", "Why dropped", options=["misjudged", "hands", "late", "sun_lights", "collision"], when=("caught", False))],
  metrics=[pct("catch_success", "Catch success", T("COUNT_TRUE", "caught"), T("COUNT")),
           pct("high_catch_success", "High-catch success", T("COUNT_TRUE", "caught", where={"catch_type": "high"}), T("COUNT", where={"catch_type": "high"})),
           pct("slip_catch_success", "Slip-catch success", T("COUNT_TRUE", "caught", where={"catch_type": "slip_cordon"}), T("COUNT", where={"catch_type": "slip_cordon"}))],
  synonyms=["high catches", "slip catching", "reflex catches", "skiers"])

A("cricket.field.ground", "Ground Fielding Drill", "DRILL", "PER_ATTEMPT", ["cricket.fielder"], sports=["cricket"], roles=["fielder"],
  equipment=["cricket_ball", "cones", "stopwatch"],
  params=[P("technique", "ENUM", "Technique", options=["attacking_one_hand", "attacking_two_hand", "long_barrier", "slide", "dive"], req=True),
          P("clean_pickup", "BOOL", "Clean pick-up", req=True), P("time_to_release_s", "DECIMAL", "Pick-up to release", "s", 0.2, 10, 0.01, agg="AVG")],
  metrics=[pct("clean_pickup_rate", "Clean pick-up %", T("COUNT_TRUE", "clean_pickup"), T("COUNT")),
           M("avg_release_s", "Average pick-up to release", T("SUM", "time_to_release_s"), T("COUNT", "time_to_release_s"), unit="s", decimals=2)],
  synonyms=["long barrier", "pick up and throw", "attacking fielding"])

A("cricket.field.throw", "Throwing Accuracy Drill", "DRILL", "PER_ATTEMPT", ["cricket.fielder", "cricket.wicket_keeper"], sports=["cricket"],
  roles=["fielder"], equipment=["cricket_ball", "stumps"],
  params=[P("throw_type", "ENUM", "Throw", options=["overarm", "underarm", "side_arm", "relay", "on_the_run"], req=True),
          P("distance_m", "DECIMAL", "Distance", "m", 2, 90, agg="AVG"), P("target", "ENUM", "Target", options=["stumps", "keeper_gloves", "bowler_end"]),
          P("on_target", "BOOL", "On target (reached gloves / within 1 m)", req=True),
          P("direct_hit", "BOOL", "Direct hit", when=("on_target", True)), P("throw_speed_kmph", "DECIMAL", "Throw speed", "km/h", 20, 160, agg="MAX")],
  metrics=[pct("on_target_rate", "On-target %", T("COUNT_TRUE", "on_target"), T("COUNT")),
           pct("direct_hit_rate", "Direct-hit %", T("COUNT_TRUE", "direct_hit"), T("COUNT")),
           M("max_throw_speed", "Fastest throw", T("MAX", "throw_speed_kmph"), unit="km/h")],
  synonyms=["direct hit", "throw at stumps", "arm strength"])

A("cricket.keep.take", "Wicket-keeping – Take", "DRILL", "PER_ATTEMPT", ["cricket.wicket_keeper"], sports=["cricket"], roles=["wicket_keeper"],
  equipment=["cricket_ball", "stumps"], grouping={"label": "Over", "size": 6},
  params=[P("ball_from", "ENUM", "Ball from", options=["pace", "spin", "throw", "machine"], req=True),
          P("stance", "ENUM", "Position", options=["standing_back", "standing_up"], req=True),
          P("side", "ENUM", "Side", options=["off", "leg", "straight"]), P("height", "ENUM", "Height", options=["low", "waist", "chest", "high"]),
          P("clean_take", "BOOL", "Clean take", req=True), P("dive", "BOOL", "Dive"),
          *attempt_pair("stumping", "Stumping chance"),
          *attempt_pair("catch", "Catch chance")],
  metrics=[pct("clean_take_rate", "Clean takes %", T("COUNT_TRUE", "clean_take"), T("COUNT")),
           pct("standing_up_clean_rate", "Clean takes standing up", T("COUNT_TRUE", "clean_take", where={"stance": "standing_up"}), T("COUNT", where={"stance": "standing_up"})),
           pct("stumping_conversion", "Stumping conversion", T("COUNT_TRUE", "stumping_accurate"), T("COUNT_TRUE", "stumping_attempted")),
           pct("catch_conversion", "Catch conversion", T("COUNT_TRUE", "catch_accurate"), T("COUNT_TRUE", "catch_attempted"))],
  synonyms=["keeping", "glovework", "stumping drill", "standing up"])

# ----------------------------- TENNIS (no roles) ----------------------------
A("tennis.serve", "Tennis Serve (serve by serve)", "DRILL", "PER_ATTEMPT", ["tennis"], sports=["tennis"],
  equipment=["tennis_ball", "racquet", "cones", "speed_gun"], synonyms=["first serve", "second serve", "ace", "double fault", "kick serve"],
  params=[P("serve_number", "ENUM", "Serve", options=["first", "second"], req=True),
          P("court_side", "ENUM", "Side", options=["deuce", "ad"]),
          P("target", "ENUM", "Target", options=["T", "body", "wide"]),
          P("serve_type", "ENUM", "Type", options=["flat", "slice", "kick"]),
          P("speed_kmh", "DECIMAL", "Speed", "km/h", 50, 260, agg="AVG"),
          P("in", "BOOL", "In", req=True),
          P("target_hit", "BOOL", "Hit intended target", when=("in", True)),
          P("ace", "BOOL", "Ace / unreturned", when=("in", True)),
          P("fault_type", "ENUM", "Fault", options=["net", "long", "wide", "foot_fault"], when=("in", False))],
  metrics=[pct("first_serve_in_pct", "1st serve in %", T("COUNT_TRUE", "in", where={"serve_number": "first"}), T("COUNT", where={"serve_number": "first"})),
           pct("second_serve_in_pct", "2nd serve in %", T("COUNT_TRUE", "in", where={"serve_number": "second"}), T("COUNT", where={"serve_number": "second"})),
           pct("double_fault_rate", "Double-fault rate", T("COUNT", where={"serve_number": "second", "in": False}), T("COUNT", where={"serve_number": "second"})),
           pct("serve_target_accuracy", "Target accuracy (of serves in)", T("COUNT_TRUE", "target_hit"), T("COUNT_TRUE", "in")),
           pct("ace_rate", "Ace rate", T("COUNT_TRUE", "ace"), T("COUNT")),
           M("avg_first_serve_speed", "Avg 1st-serve speed", T("SUM", "speed_kmh", where={"serve_number": "first"}), T("COUNT", "speed_kmh", where={"serve_number": "first"}), unit="km/h"),
           M("top_serve_speed", "Fastest serve", T("MAX", "speed_kmh"), unit="km/h")])

STROKE_PARAMS = [P("in", "BOOL", "In", req=True), P("target_hit", "BOOL", "Hit target zone", when=("in", True)),
                 P("winner", "BOOL", "Winner", when=("in", True)),
                 P("error_type", "ENUM", "Error", options=["net", "long", "wide"], when=("in", False)),
                 P("forced", "BOOL", "Forced error (under pressure)", when=("in", False))]
STROKE_METRICS = [pct("in_pct", "Consistency (in %)", T("COUNT_TRUE", "in"), T("COUNT")),
                  pct("target_accuracy", "Target accuracy (of balls in)", T("COUNT_TRUE", "target_hit"), T("COUNT_TRUE", "in")),
                  pct("winner_rate", "Winner rate", T("COUNT_TRUE", "winner"), T("COUNT")),
                  pct("unforced_error_rate", "Unforced-error rate", T("COUNT", where={"in": False, "forced": False}), T("COUNT"))]

A("tennis.groundstroke", "Tennis Groundstroke (shot by shot)", "DRILL", "PER_ATTEMPT", ["tennis"], sports=["tennis"],
  equipment=["tennis_ball", "racquet", "cones"], synonyms=["forehand", "backhand", "cross court", "down the line", "topspin", "slice"],
  params=[P("stroke", "ENUM", "Stroke", options=["forehand", "backhand", "inside_out_forehand"], req=True),
          P("spin", "ENUM", "Spin", options=["topspin", "flat", "slice"]),
          P("direction", "ENUM", "Direction", options=["cross_court", "down_the_line", "middle"]),
          P("depth_target", "ENUM", "Depth target", options=["deep", "mid", "short_angle"]), *STROKE_PARAMS],
  metrics=[*STROKE_METRICS,
           pct("forehand_in_pct", "Forehand in %", T("COUNT_TRUE", "in", where={"stroke": "forehand"}), T("COUNT", where={"stroke": "forehand"})),
           pct("backhand_in_pct", "Backhand in %", T("COUNT_TRUE", "in", where={"stroke": "backhand"}), T("COUNT", where={"stroke": "backhand"}))])

A("tennis.return", "Tennis Return of Serve", "DRILL", "PER_ATTEMPT", ["tennis"], sports=["tennis"], equipment=["tennis_ball", "racquet"],
  synonyms=["return", "chip return", "block return"],
  params=[P("vs_serve", "ENUM", "Against", options=["first", "second"], req=True), P("stroke", "ENUM", "Stroke", options=["forehand", "backhand"]),
          P("returned_in", "BOOL", "Returned in", req=True), P("deep", "BOOL", "Landed deep (past service line)", when=("returned_in", True))],
  metrics=[pct("return_in_pct", "Returns in %", T("COUNT_TRUE", "returned_in"), T("COUNT")),
           pct("deep_return_pct", "Deep returns (of returns in)", T("COUNT_TRUE", "deep"), T("COUNT_TRUE", "returned_in")),
           pct("second_return_in_pct", "Returns in vs 2nd serve", T("COUNT_TRUE", "returned_in", where={"vs_serve": "second"}), T("COUNT", where={"vs_serve": "second"}))])

A("tennis.net_play", "Tennis Volley / Overhead", "DRILL", "PER_ATTEMPT", ["tennis"], sports=["tennis"], equipment=["tennis_ball", "racquet"],
  synonyms=["volley", "smash", "overhead", "half volley", "drop volley", "net play"],
  params=[P("shot", "ENUM", "Shot", options=["forehand_volley", "backhand_volley", "half_volley", "drop_volley", "overhead"], req=True), *STROKE_PARAMS],
  metrics=STROKE_METRICS)

A("tennis.rally_drill", "Tennis Rally Consistency Drill", "DRILL", "PER_SET", ["tennis"], sports=["tennis"], equipment=["tennis_ball", "racquet"],
  synonyms=["cross court rally", "consistency", "mini tennis"],
  params=[P("pattern", "ENUM", "Pattern", options=["cross_court_fh", "cross_court_bh", "down_the_line", "figure_8", "mini_tennis", "live_ball"], req=True),
          P("rally_length", "INT", "Shots before error", None, 0, 500, req=True, agg="AVG"), P("goal", "INT", "Goal (shots)", None, 1, 500)],
  metrics=[M("avg_rally", "Average rally length", T("SUM", "rally_length"), T("COUNT"), decimals=1),
           M("best_rally", "Longest rally", T("MAX", "rally_length"), decimals=0)])

A("tennis.match", "Tennis Match Stats", "MATCH", "PER_SESSION", ["tennis"], sports=["tennis"],
  synonyms=["match", "scorecard", "break points", "unforced errors"],
  params=[P("format", "ENUM", "Format", options=["singles", "doubles"], req=True), P("surface", "ENUM", "Surface", options=["hard", "clay", "grass", "carpet"]),
          P("won", "BOOL", "Won", req=True), P("sets_won", "INT", "Sets won", None, 0, 5), P("sets_lost", "INT", "Sets lost", None, 0, 5),
          P("games_won", "INT", "Games won", None, 0, 100), P("games_lost", "INT", "Games lost", None, 0, 100),
          P("aces", "INT", "Aces", None, 0, 100), P("double_faults", "INT", "Double faults", None, 0, 100),
          P("first_serves_in", "INT", "1st serves in", None, 0, 300), P("first_serves_total", "INT", "1st serves total", None, 0, 300),
          P("first_serve_pts_won", "INT", "1st-serve points won", None, 0, 300),
          P("second_serve_pts_won", "INT", "2nd-serve points won", None, 0, 300), P("second_serve_pts_total", "INT", "2nd-serve points played", None, 0, 300),
          P("break_pts_won", "INT", "Break points converted", None, 0, 50), P("break_pts_total", "INT", "Break-point chances", None, 0, 50),
          P("winners", "INT", "Winners", None, 0, 200), P("unforced_errors", "INT", "Unforced errors", None, 0, 200)],
  metrics=[pct("win_rate", "Match win rate", T("COUNT_TRUE", "won"), T("COUNT")),
           pct("first_serve_pct", "1st serve %", T("SUM", "first_serves_in"), T("SUM", "first_serves_total")),
           pct("first_serve_pts_won_pct", "1st-serve points won", T("SUM", "first_serve_pts_won"), T("SUM", "first_serves_in")),
           pct("second_serve_pts_won_pct", "2nd-serve points won", T("SUM", "second_serve_pts_won"), T("SUM", "second_serve_pts_total")),
           pct("bp_conversion", "Break-point conversion", T("SUM", "break_pts_won"), T("SUM", "break_pts_total")),
           M("winner_ue_ratio", "Winners ÷ unforced errors", T("SUM", "winners"), T("SUM", "unforced_errors"), decimals=2)])

# ----------------------------- BADMINTON (no roles) -------------------------
A("badminton.serve", "Badminton Serve", "DRILL", "PER_ATTEMPT", ["badminton"], sports=["badminton"], equipment=["shuttle", "racquet"],
  synonyms=["low serve", "flick serve", "high serve"],
  params=[P("serve", "ENUM", "Serve", options=["low_short", "flick", "high_long", "drive"], req=True),
          P("in", "BOOL", "In / legal", req=True), P("tight", "BOOL", "Tight over net / on target", when=("in", True))],
  metrics=[pct("serve_in_pct", "Serves in", T("COUNT_TRUE", "in"), T("COUNT")),
           pct("tight_serve_pct", "Tight serves (of serves in)", T("COUNT_TRUE", "tight"), T("COUNT_TRUE", "in"))])

A("badminton.stroke", "Badminton Stroke (shot by shot)", "DRILL", "PER_ATTEMPT", ["badminton"], sports=["badminton"], equipment=["shuttle", "racquet"],
  synonyms=["smash", "clear", "drop shot", "net shot", "drive", "lift", "multi shuttle"],
  params=[P("stroke", "ENUM", "Stroke", options=["smash", "jump_smash", "clear", "drop", "net_shot", "net_kill", "drive", "lift", "push", "block"], req=True),
          P("side", "ENUM", "Side", options=["forehand", "backhand", "overhead", "round_the_head"]),
          P("speed_kmh", "DECIMAL", "Shuttle speed", "km/h", 20, 500, agg="MAX"), *STROKE_PARAMS],
  metrics=[*STROKE_METRICS,
           pct("smash_target_accuracy", "Smash accuracy", T("COUNT_TRUE", "target_hit", where={"stroke": {"in": ["smash", "jump_smash"]}}), T("COUNT", where={"stroke": {"in": ["smash", "jump_smash"]}})),
           M("top_smash_speed", "Fastest smash", T("MAX", "speed_kmh"), unit="km/h")])

A("badminton.footwork", "Badminton Footwork / Shadow Drill", "DRILL", "PER_SET", ["badminton"], sports=["badminton"], equipment=["cones", "stopwatch"],
  synonyms=["shadow badminton", "six corners", "court coverage", "split step"],
  params=[P("pattern", "ENUM", "Pattern", options=["six_corner", "front_back", "side_to_side", "random_call"], req=True),
          P("touches", "INT", "Corner touches", None, 1, 200, req=True), P("time_s", "DECIMAL", "Time", "s", 1, 900, 0.1, req=True, agg="MIN"),
          P("avg_hr", "INT", "Avg HR", "bpm", 40, 220, agg="AVG")],
  metrics=[M("touches_per_min", "Touches per minute", T("SUM", "touches"), T("SUM", "time_s"), scale=60)])

A("badminton.match", "Badminton Match Stats", "MATCH", "PER_SESSION", ["badminton"], sports=["badminton"],
  params=[P("format", "ENUM", "Format", options=["singles", "doubles", "mixed"], req=True), P("won", "BOOL", "Won", req=True),
          P("games_won", "INT", "Games won", None, 0, 3), P("points_won", "INT", "Points won", None, 0, 200), P("points_total", "INT", "Points played", None, 0, 400),
          P("smash_winners", "INT", "Smash winners", None, 0, 100), P("unforced_errors", "INT", "Unforced errors", None, 0, 200)],
  metrics=[pct("win_rate", "Match win rate", T("COUNT_TRUE", "won"), T("COUNT")),
           pct("points_won_pct", "Points won", T("SUM", "points_won"), T("SUM", "points_total"))])

# ----------------------------- FOOTBALL (positions) -------------------------
A("football.shot", "Football Shooting (shot by shot)", "DRILL", "PER_ATTEMPT", ["football.forward", "football.midfielder"], sports=["football"],
  roles=["forward", "midfielder"], equipment=["football", "goal", "cones"], synonyms=["finishing", "shooting drill", "penalty", "one on one"],
  params=[P("situation", "ENUM", "Situation", options=["open_play", "one_on_one", "cutback", "cross", "free_kick", "penalty", "rebound"], req=True),
          P("technique", "ENUM", "Technique", options=["instep", "inside_foot", "outside_foot", "volley", "half_volley", "header", "chip", "toe"]),
          P("foot", "ENUM", "Foot", options=["left", "right", "head", "other"], req=True), P("distance_m", "DECIMAL", "Distance", "m", 1, 50, agg="AVG"),
          P("first_time", "BOOL", "First-time finish"),
          P("on_target", "BOOL", "On target", req=True), P("goal", "BOOL", "Scored", when=("on_target", True)),
          P("corner_hit", "BOOL", "Hit corner target zone", when=("on_target", True)), P("speed_kmh", "DECIMAL", "Ball speed", "km/h", 10, 180, agg="MAX")],
  metrics=[pct("shot_accuracy", "Shots on target", T("COUNT_TRUE", "on_target"), T("COUNT")),
           pct("conversion", "Conversion (goals ÷ shots)", T("COUNT_TRUE", "goal"), T("COUNT")),
           pct("left_foot_accuracy", "Left-foot on target", T("COUNT_TRUE", "on_target", where={"foot": "left"}), T("COUNT", where={"foot": "left"})),
           pct("penalty_conversion", "Penalty conversion", T("COUNT_TRUE", "goal", where={"situation": "penalty"}), T("COUNT", where={"situation": "penalty"}))])

A("football.pass", "Football Passing & Receiving", "DRILL", "PER_ATTEMPT", ["football.midfielder", "football.defender", "football.forward"], sports=["football"],
  roles=["midfielder", "defender", "forward", "goalkeeper"], equipment=["football", "cones"], synonyms=["passing drill", "rondo", "long ball", "switch", "through ball", "first touch"],
  params=[P("pass_type", "ENUM", "Pass", options=["short", "medium", "long", "through_ball", "switch", "cross", "cutback"], req=True),
          P("foot", "ENUM", "Foot", options=["left", "right"]), P("distance_m", "DECIMAL", "Distance", "m", 1, 80, agg="AVG"),
          P("pressure", "ENUM", "Pressure", options=["none", "passive", "active"]),
          P("completed", "BOOL", "Completed", req=True), P("into_target", "BOOL", "Into target gate / zone", when=("completed", True)),
          P("first_touch_clean", "BOOL", "Clean first touch (receiving)")],
  metrics=[pct("pass_completion", "Pass completion", T("COUNT_TRUE", "completed"), T("COUNT")),
           pct("long_pass_completion", "Long-pass completion", T("COUNT_TRUE", "completed", where={"pass_type": {"in": ["long", "switch"]}}), T("COUNT", where={"pass_type": {"in": ["long", "switch"]}})),
           pct("under_pressure_completion", "Completion under pressure", T("COUNT_TRUE", "completed", where={"pressure": "active"}), T("COUNT", where={"pressure": "active"})),
           pct("first_touch_rate", "Clean first touch", T("COUNT_TRUE", "first_touch_clean"), T("COUNT", "first_touch_clean"))])

A("football.dribble", "Football Dribbling / 1v1", "DRILL", "PER_ATTEMPT", ["football.forward", "football.midfielder"], sports=["football"],
  roles=["forward", "midfielder"], equipment=["football", "cones", "stopwatch"], synonyms=["take on", "cone dribbling", "ball mastery"],
  params=[P("drill", "ENUM", "Drill", options=["cone_slalom", "1v1_live", "1v1_shadow", "ball_mastery"], req=True),
          P("time_s", "DECIMAL", "Course time", "s", 1, 300, 0.01, agg="MIN"), P("ball_lost", "BOOL", "Lost the ball"),
          P("beat_defender", "BOOL", "Beat defender", when=("drill", "1v1_live"))],
  metrics=[pct("take_on_success", "1v1 success", T("COUNT_TRUE", "beat_defender"), T("COUNT", where={"drill": "1v1_live"})),
           M("best_slalom_s", "Best slalom time", T("MIN", "time_s", where={"drill": "cone_slalom"}), unit="s", decimals=2)])

A("football.defend", "Football Defending Duel", "DRILL", "PER_ATTEMPT", ["football.defender", "football.midfielder"], sports=["football"],
  roles=["defender", "midfielder"], equipment=["football", "cones"], synonyms=["tackling", "interceptions", "aerial duel", "clearances"],
  params=[P("action", "ENUM", "Action", options=["standing_tackle", "slide_tackle", "interception", "block", "aerial_duel", "clearance", "jockey_delay"], req=True),
          P("won", "BOOL", "Won / successful", req=True), P("foul", "BOOL", "Foul conceded")],
  metrics=[pct("duel_success", "Duels won", T("COUNT_TRUE", "won"), T("COUNT")),
           pct("aerial_success", "Aerial duels won", T("COUNT_TRUE", "won", where={"action": "aerial_duel"}), T("COUNT", where={"action": "aerial_duel"})),
           pct("tackle_success", "Tackles won", T("COUNT_TRUE", "won", where={"action": {"in": ["standing_tackle", "slide_tackle"]}}), T("COUNT", where={"action": {"in": ["standing_tackle", "slide_tackle"]}})),
           pct("foul_rate", "Foul rate", T("COUNT_TRUE", "foul"), T("COUNT"))])

A("football.gk_save", "Goalkeeping – Shot Stopping", "DRILL", "PER_ATTEMPT", ["football.goalkeeper"], sports=["football"], roles=["goalkeeper"],
  equipment=["football", "goal"], synonyms=["shot stopping", "diving save", "handling", "parry", "penalty save"],
  params=[P("shot_height", "ENUM", "Shot height", options=["ground", "mid", "high"], req=True), P("side", "ENUM", "Side", options=["left", "centre", "right"]),
          P("source", "ENUM", "Source", options=["close_range", "edge_of_box", "long_range", "penalty", "cross", "one_on_one"]),
          P("dive", "BOOL", "Dive"), P("saved", "BOOL", "Saved", req=True),
          P("held", "BOOL", "Held (caught, no rebound)", when=("saved", True)),
          P("parry_safe", "BOOL", "Parried to safe area", when=("held", False))],
  metrics=[pct("save_pct", "Save %", T("COUNT_TRUE", "saved"), T("COUNT")),
           pct("handling_pct", "Clean handling (of saves)", T("COUNT_TRUE", "held"), T("COUNT_TRUE", "saved")),
           pct("dive_save_pct", "Diving save %", T("COUNT_TRUE", "saved", where={"dive": True}), T("COUNT", where={"dive": True})),
           pct("penalty_save_pct", "Penalty save %", T("COUNT_TRUE", "saved", where={"source": "penalty"}), T("COUNT", where={"source": "penalty"}))])

A("football.gk_distribution", "Goalkeeping – Distribution", "DRILL", "PER_ATTEMPT", ["football.goalkeeper"], sports=["football"], roles=["goalkeeper"],
  equipment=["football", "cones"], synonyms=["goal kick", "throw out", "punt", "drop kick"],
  params=[P("method", "ENUM", "Method", options=["goal_kick", "punt", "drop_kick", "throw", "roll", "pass_under_pressure"], req=True),
          P("distance_m", "DECIMAL", "Distance", "m", 1, 90, agg="MAX"), P("accurate", "BOOL", "Reached target", req=True)],
  metrics=[pct("distribution_accuracy", "Distribution accuracy", T("COUNT_TRUE", "accurate"), T("COUNT")),
           M("max_kick_m", "Longest kick", T("MAX", "distance_m"), unit="m")])

A("football.match", "Football Match Stats", "MATCH", "PER_SESSION", ["football"], sports=["football"],
  roles=["goalkeeper", "defender", "midfielder", "forward"],
  params=[P("minutes", "INT", "Minutes played", "min", 0, 130, req=True), P("position", "ENUM", "Position", options=["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"]),
          P("goals", "INT", "Goals", None, 0, 20), P("assists", "INT", "Assists", None, 0, 20), P("shots", "INT", "Shots", None, 0, 50),
          P("shots_on_target", "INT", "Shots on target", None, 0, 50), P("passes", "INT", "Passes", None, 0, 200), P("passes_completed", "INT", "Passes completed", None, 0, 200),
          P("tackles_won", "INT", "Tackles won", None, 0, 50), P("saves", "INT", "Saves", None, 0, 50), P("goals_conceded", "INT", "Goals conceded", None, 0, 20)],
  metrics=[pct("pass_accuracy", "Pass accuracy", T("SUM", "passes_completed"), T("SUM", "passes")),
           pct("shot_accuracy", "Shot accuracy", T("SUM", "shots_on_target"), T("SUM", "shots")),
           M("goals_per_90", "Goals per 90", T("SUM", "goals"), T("SUM", "minutes"), scale=90, decimals=2),
           M("goal_contributions", "Goals + assists", T("SUM", expr="goals + assists"), decimals=0)])

# ----------------------------- ATHLETICS / RUNNING --------------------------
A("athletics.run", "Run (easy / long / tempo)", "EXERCISE", "PER_SESSION", ["athletics.running", "gym.cardio"], sports=["athletics"],
  roles=["distance_runner"], equipment=["heart_rate_monitor"], synonyms=["jog", "long run", "tempo run", "easy run", "road run"],
  psets=["cardio_bout"], params=[P("run_type", "ENUM", "Type", options=["easy", "long", "tempo", "recovery", "race", "trail"]),
                                 P("elevation_gain_m", "INT", "Elevation gain", "m", 0, 5000), P("cadence_spm", "INT", "Cadence", "spm", 100, 220, agg="AVG")])

A("athletics.lap", "Run Lap / Split", "EXERCISE", "PER_ATTEMPT", ["athletics.running", "athletics.sprints"], sports=["athletics"],
  roles=["distance_runner", "sprinter"], equipment=["stopwatch"], synonyms=["splits", "km split", "400 m lap", "intervals"],
  params=[P("distance_m", "DECIMAL", "Lap distance", "m", 50, 10000, req=True, agg="SUM"), P("time_s", "DECIMAL", "Lap time", "s", 5, 7200, 0.01, req=True, agg="SUM"),
          P("is_work", "BOOL", "Work rep (vs recovery)"), P("avg_hr", "INT", "Avg HR", "bpm", 40, 220, agg="AVG")],
  metrics=[M("avg_pace", "Average pace (work laps)", T("SUM", "time_s", where={"is_work": True}), T("SUM", "distance_m", where={"is_work": True}), fmt="PACE", unit="min/km", scale=1000),
           M("fastest_lap_s", "Fastest lap", T("MIN", "time_s"), unit="s", decimals=2)])

A("athletics.time_trial", "Time Trial (1.6 km / 2 km / 5 km)", "TEST", "PER_SESSION", ["athletics.running", "conditioning", "cricket.fitness"],
  sports=["athletics", "cricket", "football"], equipment=["stopwatch"], synonyms=["2 km time trial", "5k time trial", "mile test"],
  params=[P("distance", "ENUM", "Distance", options=["1600m", "2km", "3km", "5km", "10km"], req=True), P("time_s", "DECIMAL", "Time", "s", 180, 7200, 0.1, req=True, agg="MIN")],
  metrics=[M("best_2km_s", "Best 2 km", T("MIN", "time_s", where={"distance": "2km"}), fmt="DURATION"),
           M("best_5km_s", "Best 5 km", T("MIN", "time_s", where={"distance": "5km"}), fmt="DURATION")])

# ----------------------------- SHARED CONDITIONING ---------------------------
A("cond.sprint", "Linear Sprint (10/20/30/40 m)", "TEST", "PER_ATTEMPT", ["conditioning", "athletics.sprints", "cricket.fitness"],
  sports=["cricket", "football", "tennis", "badminton", "athletics"], psets=["sprint_rep"], equipment=["cones", "stopwatch"],
  synonyms=["acceleration", "speed test", "20 m sprint", "flying 30"])
A("cond.agility", "Agility Test / Drill (5-10-5, T-test, Illinois)", "TEST", "PER_ATTEMPT", ["conditioning"],
  sports=["cricket", "football", "tennis", "badminton"], equipment=["cones", "stopwatch"], synonyms=["pro agility", "shuttle run", "change of direction"],
  params=[P("test", "ENUM", "Test", options=["5_10_5", "t_test", "illinois", "505", "spider_tennis", "ladder"], req=True),
          P("time_s", "DECIMAL", "Time", "s", 2, 120, 0.01, req=True, agg="MIN"), P("turn_side", "ENUM", "Turn side", options=["left", "right", "both"])],
  metrics=[M("best_5105_s", "Best 5-10-5", T("MIN", "time_s", where={"test": "5_10_5"}), unit="s", decimals=2),
           M("best_t_test_s", "Best T-test", T("MIN", "time_s", where={"test": "t_test"}), unit="s", decimals=2)])
A("cond.yoyo_ir1", "Yo-Yo Intermittent Recovery Test Level 1", "TEST", "PER_SESSION", ["conditioning", "cricket.fitness"],
  sports=["cricket", "football", "tennis", "badminton"], equipment=["cones"], synonyms=["yo yo test", "beep test", "IR1"],
  params=[P("level_reached", "DECIMAL", "Level reached (e.g. 17.4)", None, 5, 23, 0.1, req=True, agg="MAX"),
          P("distance_m", "INT", "Total distance", "m", 0, 5000, req=True, agg="MAX"), P("max_hr", "INT", "Max HR", "bpm", 100, 230, agg="MAX")],
  metrics=[M("best_level", "Best level", T("MAX", "level_reached")), M("best_distance_m", "Best distance", T("MAX", "distance_m"), unit="m", decimals=0)],
  desc="40 m shuttles with 10 s active recovery; widely used in cricket and football fitness selection.")
A("cond.bronco", "Bronco Test (1.2 km shuttle)", "TEST", "PER_SESSION", ["conditioning", "cricket.fitness"], sports=["cricket", "football"],
  equipment=["cones", "stopwatch"], synonyms=["bronco"],
  params=[P("time_s", "DECIMAL", "Time", "s", 180, 900, 0.1, req=True, agg="MIN")],
  metrics=[M("best_bronco_s", "Best Bronco", T("MIN", "time_s"), fmt="DURATION")])
A("cond.plyo", "Plyometrics (box / broad / bounding)", "EXERCISE", "PER_SET", ["conditioning", "gym.legs"],
  sports=["cricket", "football", "tennis", "badminton", "athletics"], psets=["jump_throw"], equipment=["box"],
  params=[P("exercise", "ENUM", "Exercise", options=["box_jump", "broad_jump", "depth_jump", "countermovement_jump", "lateral_bound", "skater_jump", "pogo_hops"], req=True)],
  primary=["quadriceps", "glutes", "calves"], mechanic="compound", force="push", level="intermediate", synonyms=["jumps", "plyo", "vertical jump", "CMJ"])
A("cond.med_ball", "Medicine-ball Throws", "EXERCISE", "PER_SET", ["conditioning", "gym.core"],
  sports=["cricket", "tennis", "badminton", "football"], psets=["jump_throw"], equipment=["medicine_ball"],
  params=[P("exercise", "ENUM", "Throw", options=["rotational_side_throw", "overhead_slam", "chest_pass", "overhead_backward", "scoop_toss"], req=True)],
  primary=["obliques", "abdominals"], secondary=["front_delts", "glutes"], mechanic="compound", force="push", synonyms=["rotational power", "med ball"])
A("cond.injury_prevention", "Injury-prevention Routine (e.g. FIFA 11+)", "EXERCISE", "PER_SESSION", ["conditioning"],
  sports=["football", "cricket", "tennis", "badminton"], psets=["mobility_set"],
  params=[P("routine", "ENUM", "Routine", options=["fifa_11_plus", "nordic_program", "shoulder_prehab", "ankle_stability", "custom"], req=True),
          P("completed_fully", "BOOL", "Completed all parts")],
  metrics=[pct("completion_rate", "Completed fully", T("COUNT_TRUE", "completed_fully"), T("COUNT"))], synonyms=["prehab", "warm up", "11+"])
A("cond.session_load", "Training Session Load (sRPE)", "LOG", "PER_SESSION", ["conditioning", "cricket.fitness"],
  sports=["cricket", "football", "tennis", "badminton", "athletics"], psets=["session_load"],
  params=[P("session_type", "ENUM", "Session", options=["skills", "nets", "match", "gym", "conditioning", "recovery"], req=True)],
  synonyms=["rpe", "training load", "wellness"])

# ----------------------------- GYM exercise library --------------------------
def G(code, name, cat, equip, primary, secondary=(), mechanic="compound", force="push", level="beginner", pset="strength_set", syn=(), desc=None):
    A("gym." + code, name, "EXERCISE", "PER_SET", [cat], psets=[pset], equipment=equip if isinstance(equip, (list, tuple)) else [equip],
      primary=primary, secondary=secondary, mechanic=mechanic, force=force, level=level, synonyms=syn, desc=desc)

# Chest
G("barbell_bench_press", "Barbell Bench Press", "gym.chest", ["barbell", "bench"], ["chest"], ["triceps", "front_delts"], syn=["bench", "flat bench", "BP"])
G("incline_barbell_bench_press", "Incline Barbell Bench Press", "gym.chest", ["barbell", "bench"], ["upper_chest"], ["front_delts", "triceps"], syn=["incline bench"])
G("decline_bench_press", "Decline Bench Press", "gym.chest", ["barbell", "bench"], ["chest"], ["triceps"], level="intermediate")
G("dumbbell_bench_press", "Dumbbell Bench Press", "gym.chest", ["dumbbell", "bench"], ["chest"], ["triceps", "front_delts"], syn=["DB press"])
G("incline_dumbbell_press", "Incline Dumbbell Press", "gym.chest", ["dumbbell", "bench"], ["upper_chest"], ["front_delts", "triceps"])
G("dumbbell_fly", "Dumbbell Fly", "gym.chest", ["dumbbell", "bench"], ["chest"], ["front_delts"], mechanic="isolation", syn=["flye", "chest fly"])
G("cable_crossover", "Cable Crossover / Cable Fly", "gym.chest", ["cable"], ["chest"], ["front_delts"], mechanic="isolation", syn=["cable fly"])
G("machine_chest_press", "Machine Chest Press", "gym.chest", ["machine"], ["chest"], ["triceps"])
G("pec_deck", "Pec Deck", "gym.chest", ["machine"], ["chest"], mechanic="isolation", syn=["butterfly", "machine fly"])
G("push_up", "Push-up", "gym.chest", ["body_only"], ["chest"], ["triceps", "front_delts", "abdominals"], pset="bodyweight_set", syn=["press up", "pushup"])
G("chest_dip", "Chest Dip", "gym.chest", ["dip_bars"], ["chest"], ["triceps", "front_delts"], pset="bodyweight_set", level="intermediate", syn=["dips"])
# Back
G("deadlift", "Conventional Deadlift", "gym.back", ["barbell"], ["lower_back", "hamstrings", "glutes"], ["traps", "forearms", "quadriceps"], force="pull", level="intermediate", syn=["DL", "deadlifts"])
G("pull_up", "Pull-up", "gym.back", ["pull_up_bar"], ["lats"], ["biceps", "middle_back"], force="pull", pset="bodyweight_set", level="intermediate", syn=["pullup", "chin up bar"])
G("chin_up", "Chin-up", "gym.back", ["pull_up_bar"], ["lats", "biceps"], ["middle_back"], force="pull", pset="bodyweight_set", syn=["chinup"])
G("lat_pulldown", "Lat Pulldown", "gym.back", ["cable", "machine"], ["lats"], ["biceps", "middle_back"], force="pull", syn=["pulldown"])
G("barbell_row", "Barbell Bent-over Row", "gym.back", ["barbell"], ["middle_back", "lats"], ["biceps", "rear_delts", "lower_back"], force="pull", syn=["bent over row", "BOR"])
G("one_arm_dumbbell_row", "One-arm Dumbbell Row", "gym.back", ["dumbbell", "bench"], ["lats", "middle_back"], ["biceps"], force="pull", syn=["DB row"])
G("seated_cable_row", "Seated Cable Row", "gym.back", ["cable"], ["middle_back", "lats"], ["biceps"], force="pull", syn=["cable row", "low row"])
G("t_bar_row", "T-bar Row", "gym.back", ["landmine", "barbell"], ["middle_back"], ["lats", "biceps"], force="pull", level="intermediate")
G("straight_arm_pulldown", "Straight-arm Pulldown", "gym.back", ["cable"], ["lats"], mechanic="isolation", force="pull")
G("back_extension", "Back Extension (45°)", "gym.back", ["bench"], ["lower_back"], ["glutes", "hamstrings"], mechanic="isolation", force="pull", pset="bodyweight_set", syn=["hyperextension"])
G("rack_pull", "Rack Pull", "gym.back", ["barbell"], ["lower_back", "traps"], ["glutes", "forearms"], force="pull", level="advanced")
# Shoulders
G("overhead_press", "Barbell Overhead Press", "gym.shoulders", ["barbell"], ["front_delts"], ["side_delts", "triceps"], syn=["OHP", "military press", "standing press"])
G("seated_dumbbell_press", "Seated Dumbbell Shoulder Press", "gym.shoulders", ["dumbbell", "bench"], ["front_delts"], ["side_delts", "triceps"], syn=["DB shoulder press"])
G("arnold_press", "Arnold Press", "gym.shoulders", ["dumbbell"], ["front_delts", "side_delts"], ["triceps"], level="intermediate")
G("lateral_raise", "Dumbbell Lateral Raise", "gym.shoulders", ["dumbbell"], ["side_delts"], mechanic="isolation", syn=["side raise", "lateral"])
G("cable_lateral_raise", "Cable Lateral Raise", "gym.shoulders", ["cable"], ["side_delts"], mechanic="isolation")
G("front_raise", "Front Raise", "gym.shoulders", ["dumbbell"], ["front_delts"], mechanic="isolation")
G("rear_delt_fly", "Rear-delt Fly", "gym.shoulders", ["dumbbell", "machine"], ["rear_delts"], ["middle_back"], mechanic="isolation", force="pull", syn=["reverse fly", "reverse pec deck"])
G("face_pull", "Face Pull", "gym.shoulders", ["cable"], ["rear_delts"], ["rotator_cuff", "traps"], mechanic="isolation", force="pull")
G("upright_row", "Upright Row", "gym.shoulders", ["barbell", "cable"], ["side_delts", "traps"], ["biceps"], force="pull")
G("barbell_shrug", "Barbell Shrug", "gym.shoulders", ["barbell"], ["traps"], mechanic="isolation", force="pull", syn=["shrugs"])
G("external_rotation", "Cable / Band External Rotation", "gym.shoulders", ["cable", "resistance_band"], ["rotator_cuff"], mechanic="isolation", force="pull", syn=["rotator cuff", "shoulder prehab"])
# Biceps
G("barbell_curl", "Barbell Curl", "gym.arms.biceps", ["barbell"], ["biceps"], ["forearms"], mechanic="isolation", force="pull", syn=["bicep curl"])
G("dumbbell_curl", "Dumbbell Curl", "gym.arms.biceps", ["dumbbell"], ["biceps"], ["forearms"], mechanic="isolation", force="pull")
G("hammer_curl", "Hammer Curl", "gym.arms.biceps", ["dumbbell"], ["brachialis", "biceps"], ["forearms"], mechanic="isolation", force="pull")
G("preacher_curl", "Preacher Curl", "gym.arms.biceps", ["ez_bar", "bench"], ["biceps"], mechanic="isolation", force="pull")
G("incline_dumbbell_curl", "Incline Dumbbell Curl", "gym.arms.biceps", ["dumbbell", "bench"], ["biceps"], mechanic="isolation", force="pull")
G("cable_curl", "Cable Curl", "gym.arms.biceps", ["cable"], ["biceps"], mechanic="isolation", force="pull")
G("concentration_curl", "Concentration Curl", "gym.arms.biceps", ["dumbbell"], ["biceps"], mechanic="isolation", force="pull")
# Triceps
G("close_grip_bench_press", "Close-grip Bench Press", "gym.arms.triceps", ["barbell", "bench"], ["triceps"], ["chest", "front_delts"], syn=["CGBP"])
G("triceps_pushdown", "Triceps Pushdown", "gym.arms.triceps", ["cable"], ["triceps"], mechanic="isolation", syn=["pushdown", "rope pushdown"])
G("overhead_triceps_extension", "Overhead Triceps Extension", "gym.arms.triceps", ["dumbbell", "cable"], ["triceps"], mechanic="isolation")
G("skull_crusher", "Lying Triceps Extension (Skull Crusher)", "gym.arms.triceps", ["ez_bar", "bench"], ["triceps"], mechanic="isolation", level="intermediate")
G("bench_dip", "Bench Dip", "gym.arms.triceps", ["bench"], ["triceps"], ["chest"], pset="bodyweight_set")
G("triceps_kickback", "Triceps Kickback", "gym.arms.triceps", ["dumbbell"], ["triceps"], mechanic="isolation")
# Forearms
G("wrist_curl", "Wrist Curl", "gym.arms.forearms", ["barbell", "dumbbell"], ["forearms"], mechanic="isolation", force="pull")
G("reverse_wrist_curl", "Reverse Wrist Curl", "gym.arms.forearms", ["barbell", "dumbbell"], ["forearms"], mechanic="isolation", force="pull")
G("farmers_walk", "Farmer's Walk", "gym.arms.forearms", ["dumbbell", "trap_bar"], ["forearms", "traps"], ["abdominals", "glutes"], force="static", pset="carry", syn=["farmer carry"])
G("dead_hang", "Dead Hang", "gym.arms.forearms", ["pull_up_bar"], ["forearms"], ["lats"], mechanic="isolation", force="static", pset="timed_hold", syn=["bar hang", "grip"])
# Quads
G("back_squat", "Barbell Back Squat", "gym.legs.quads", ["barbell"], ["quadriceps", "glutes"], ["hamstrings", "lower_back"], syn=["squat", "high bar", "low bar"])
G("front_squat", "Front Squat", "gym.legs.quads", ["barbell"], ["quadriceps"], ["glutes", "abdominals"], level="intermediate")
G("goblet_squat", "Goblet Squat", "gym.legs.quads", ["dumbbell", "kettlebell"], ["quadriceps", "glutes"])
G("leg_press", "Leg Press", "gym.legs.quads", ["machine"], ["quadriceps"], ["glutes", "hamstrings"])
G("hack_squat", "Hack Squat", "gym.legs.quads", ["machine"], ["quadriceps"], ["glutes"])
G("bulgarian_split_squat", "Bulgarian Split Squat", "gym.legs.quads", ["dumbbell", "bench"], ["quadriceps", "glutes"], ["adductors"], level="intermediate", syn=["rear foot elevated split squat", "RFESS"])
G("walking_lunge", "Walking Lunge", "gym.legs.quads", ["dumbbell", "body_only"], ["quadriceps", "glutes"], ["hamstrings"], syn=["lunges"])
G("leg_extension", "Leg Extension", "gym.legs.quads", ["machine"], ["quadriceps"], mechanic="isolation")
G("step_up", "Step-up", "gym.legs.quads", ["dumbbell", "box"], ["quadriceps", "glutes"])
# Hamstrings
G("romanian_deadlift", "Romanian Deadlift", "gym.legs.hamstrings", ["barbell", "dumbbell"], ["hamstrings", "glutes"], ["lower_back"], force="pull", syn=["RDL", "stiff leg deadlift"])
G("lying_leg_curl", "Lying Leg Curl", "gym.legs.hamstrings", ["machine"], ["hamstrings"], mechanic="isolation", force="pull")
G("seated_leg_curl", "Seated Leg Curl", "gym.legs.hamstrings", ["machine"], ["hamstrings"], mechanic="isolation", force="pull")
G("good_morning", "Good Morning", "gym.legs.hamstrings", ["barbell"], ["hamstrings", "lower_back"], ["glutes"], force="pull", level="intermediate")
G("nordic_curl", "Nordic Hamstring Curl", "gym.legs.hamstrings", ["body_only"], ["hamstrings"], mechanic="isolation", force="pull", pset="bodyweight_set", level="intermediate", syn=["nordics", "NHE"], desc="Eccentric hamstring exercise used in injury-prevention programmes.")
# Glutes
G("hip_thrust", "Barbell Hip Thrust", "gym.legs.glutes", ["barbell", "bench"], ["glutes"], ["hamstrings"], syn=["glute bridge", "hip thrusts"])
G("glute_bridge", "Glute Bridge", "gym.legs.glutes", ["body_only", "barbell"], ["glutes"], ["hamstrings"], pset="bodyweight_set")
G("cable_kickback", "Cable Glute Kickback", "gym.legs.glutes", ["cable"], ["glutes"], mechanic="isolation")
G("sumo_deadlift", "Sumo Deadlift", "gym.legs.glutes", ["barbell"], ["glutes", "adductors", "quadriceps"], ["lower_back"], force="pull", level="intermediate")
G("hip_abduction", "Hip Abduction (machine / band)", "gym.legs.glutes", ["machine", "resistance_band"], ["abductors", "glutes"], mechanic="isolation")
G("copenhagen_plank", "Copenhagen Plank", "gym.legs.glutes", ["bench"], ["adductors"], ["obliques"], mechanic="isolation", force="static", pset="timed_hold", level="intermediate", syn=["copenhagen adduction"])
# Calves
G("standing_calf_raise", "Standing Calf Raise", "gym.legs.calves", ["machine", "dumbbell"], ["calves"], mechanic="isolation")
G("seated_calf_raise", "Seated Calf Raise", "gym.legs.calves", ["machine"], ["calves"], mechanic="isolation")
G("single_leg_calf_raise", "Single-leg Calf Raise", "gym.legs.calves", ["body_only", "dumbbell"], ["calves"], mechanic="isolation", pset="bodyweight_set")
# Core
G("plank", "Plank", "gym.core", ["body_only"], ["abdominals"], ["obliques", "lower_back"], mechanic="isolation", force="static", pset="timed_hold", syn=["front plank"])
G("side_plank", "Side Plank", "gym.core", ["body_only"], ["obliques"], ["abductors"], mechanic="isolation", force="static", pset="timed_hold")
G("hanging_leg_raise", "Hanging Leg Raise", "gym.core", ["pull_up_bar"], ["abdominals", "hip_flexors"], mechanic="isolation", force="pull", pset="bodyweight_set", level="intermediate")
G("cable_crunch", "Cable Crunch", "gym.core", ["cable"], ["abdominals"], mechanic="isolation", force="pull")
G("ab_wheel_rollout", "Ab-wheel Rollout", "gym.core", ["ab_wheel"], ["abdominals"], ["lats"], force="pull", pset="bodyweight_set", level="intermediate")
G("russian_twist", "Russian Twist", "gym.core", ["body_only", "medicine_ball"], ["obliques"], mechanic="isolation", pset="bodyweight_set")
G("dead_bug", "Dead Bug", "gym.core", ["body_only"], ["abdominals"], mechanic="isolation", force="static", pset="bodyweight_set")
G("pallof_press", "Pallof Press", "gym.core", ["cable", "resistance_band"], ["obliques", "abdominals"], mechanic="isolation", force="static", syn=["anti rotation"])
G("crunch", "Crunch", "gym.core", ["body_only"], ["abdominals"], mechanic="isolation", pset="bodyweight_set", syn=["sit up"])
# Full body / Olympic
G("power_clean", "Power Clean", "gym.full_body", ["barbell"], ["full_body"], ["traps", "quadriceps", "glutes"], force="pull", level="advanced", syn=["clean", "olympic lift"])
G("clean_and_jerk", "Clean and Jerk", "gym.full_body", ["barbell"], ["full_body"], force="push", level="advanced", syn=["C&J"])
G("snatch", "Snatch", "gym.full_body", ["barbell"], ["full_body"], force="pull", level="advanced")
G("kettlebell_swing", "Kettlebell Swing", "gym.full_body", ["kettlebell"], ["glutes", "hamstrings"], ["lower_back", "front_delts"], force="pull", syn=["KB swing", "russian swing"])
G("thruster", "Thruster", "gym.full_body", ["barbell", "dumbbell"], ["quadriceps", "front_delts"], ["glutes", "triceps"], level="intermediate")
G("burpee", "Burpee", "gym.full_body", ["body_only"], ["full_body"], ["cardiovascular"], pset="bodyweight_set")
G("turkish_get_up", "Turkish Get-up", "gym.full_body", ["kettlebell"], ["full_body"], ["obliques", "front_delts"], level="advanced", syn=["TGU"])
G("sled_push", "Sled Push / Pull", "gym.full_body", ["sled"], ["quadriceps", "glutes"], ["calves", "cardiovascular"], pset="carry", syn=["prowler"])
# Cardio
for code, name, eq, syn in [("treadmill_run", "Treadmill Run / Walk", "treadmill", ["treadmill", "incline walk"]),
                            ("stationary_bike", "Stationary Bike", "stationary_bike", ["spin bike", "cycling", "assault bike"]),
                            ("rowing_machine", "Rowing Machine", "rower", ["erg", "rower", "concept2"]),
                            ("elliptical", "Elliptical Trainer", "elliptical", ["cross trainer"]),
                            ("stair_climber", "Stair Climber", "stair_climber", ["stairmaster", "step mill"]),
                            ("jump_rope", "Jump Rope", "jump_rope", ["skipping", "double unders"]),
                            ("hiit_interval", "HIIT Interval (any modality)", "other", ["tabata", "intervals", "circuit"])]:
    A("gym." + code, name, "EXERCISE", "PER_SET", ["gym.cardio"], psets=["cardio_bout"], equipment=[eq],
      primary=["cardiovascular"], mechanic="compound", force=None, synonyms=syn)
# Mobility
for code, name, prim, syn in [("hip_flexor_stretch", "Hip-flexor Stretch", ["hip_flexors"], ["couch stretch", "kneeling lunge stretch"]),
                              ("hamstring_stretch", "Hamstring Stretch", ["hamstrings"], ["toe touch"]),
                              ("thoracic_rotation", "Thoracic Rotation", ["middle_back"], ["t spine", "open book"]),
                              ("worlds_greatest_stretch", "World's Greatest Stretch", ["hip_flexors", "hamstrings", "middle_back"], ["WGS"]),
                              ("shoulder_pass_through", "Band Shoulder Pass-through", ["front_delts", "rotator_cuff"], ["dislocates"]),
                              ("foam_rolling", "Foam Rolling", ["full_body"], ["SMR", "myofascial release"]),
                              ("ankle_mobility", "Ankle Dorsiflexion Mobility", ["calves"], ["knee to wall"])]:
    A("gym." + code, name, "EXERCISE", "PER_SET", ["gym.mobility"], psets=["mobility_set"],
      equipment=["foam_roller" if code == "foam_rolling" else ("resistance_band" if "band" in name.lower() else "body_only")],
      primary=prim, mechanic="isolation", force="static", synonyms=syn)
# Body composition
A("body.checkin", "Body Measurements Check-in", "LOG", "PER_SESSION", ["body"], synonyms=["weigh in", "body fat", "waist", "measurements"],
  params=[P("body_weight_kg", "DECIMAL", "Body weight", "kg", 20, 300, 0.1, req=True, agg="AVG"),
          P("body_fat_pct", "DECIMAL", "Body fat", "%", 2, 70, 0.1, agg="AVG"), P("waist_cm", "DECIMAL", "Waist", "cm", 40, 200, 0.1, agg="AVG"),
          P("resting_hr", "INT", "Resting HR", "bpm", 30, 120, agg="AVG"), P("sleep_h", "DECIMAL", "Sleep", "h", 0, 16, 0.25, agg="AVG")],
  metrics=[M("avg_weight", "Average weight", T("SUM", "body_weight_kg"), T("COUNT", "body_weight_kg"), unit="kg"),
           M("min_weight", "Lowest weight", T("MIN", "body_weight_kg"), unit="kg")])

# ---------------------------------------------------------------------------
# Profile templates (what users pick). Activities are references into the library.
# ---------------------------------------------------------------------------
TPLS = OrderedDict()

def TP(code, name, cat, acts, desc=None, targets=None):
    TPLS[code] = OrderedDict(code=code, name=name, category=cat, version=1,
                             activities=[OrderedDict(activity=a, **((targets or {}).get(a, {}))) for a in acts],
                             description=desc)

TP("cricket.fast_bowler", "Fast Bowler", "cricket.fast_bowler",
   ["cricket.fast.delivery", "cricket.fast.target_drill", "cricket.fast.run_up", "cricket.bowling.spell_figures", "cricket.bowling.workload",
    "cricket.field.catch", "cond.sprint", "cond.yoyo_ir1", "gym.nordic_curl", "gym.back_squat", "gym.copenhagen_plank"],
   "Pace bowler: ball-by-ball nets/spell logging with attempted → accurate skills, target drills, figures, workload, and key S&C.")
TP("cricket.spin_bowler", "Spin Bowler", "cricket.spin_bowler",
   ["cricket.spin.delivery", "cricket.fast.target_drill", "cricket.bowling.spell_figures", "cricket.bowling.workload", "cricket.field.catch", "cond.agility"])
TP("cricket.batter", "Batter", "cricket.batter",
   ["cricket.bat.ball_faced", "cricket.bat.shot_drill", "cricket.bat.running_between", "cricket.bat.innings", "cricket.field.catch",
    "cricket.field.ground", "cond.sprint", "cond.yoyo_ir1"])
TP("cricket.wicket_keeper", "Wicket-keeper", "cricket.wicket_keeper",
   ["cricket.keep.take", "cricket.field.catch", "cricket.field.throw", "cricket.bat.ball_faced", "cond.agility"])
TP("cricket.fielder", "Fielder (fielding practice)", "cricket.fielder",
   ["cricket.field.catch", "cricket.field.ground", "cricket.field.throw", "cond.sprint", "cond.agility"])
TP("cricket.all_rounder", "All-rounder", "cricket.all_rounder",
   ["cricket.bat.ball_faced", "cricket.bat.innings", "cricket.fast.delivery", "cricket.spin.delivery", "cricket.bowling.spell_figures",
    "cricket.bowling.workload", "cricket.field.catch", "cricket.field.throw"])
TP("cricket.fitness", "Cricket Fitness Testing", "cricket.fitness",
   ["cond.yoyo_ir1", "cond.bronco", "athletics.time_trial", "cond.sprint", "cricket.bat.running_between", "cond.session_load"])
TP("tennis.player", "Tennis Player", "tennis",
   ["tennis.serve", "tennis.return", "tennis.groundstroke", "tennis.net_play", "tennis.rally_drill", "tennis.match", "cond.agility", "cond.sprint", "cond.med_ball"],
   "No roles: one profile covering serve, return, groundstrokes, net play, consistency and match stats.")
TP("tennis.serve_clinic", "Tennis Serve Clinic", "tennis", ["tennis.serve", "tennis.return", "gym.external_rotation"])
TP("badminton.player", "Badminton Player", "badminton",
   ["badminton.serve", "badminton.stroke", "badminton.footwork", "badminton.match", "cond.agility", "cond.plyo"])
TP("football.goalkeeper", "Goalkeeper", "football.goalkeeper", ["football.gk_save", "football.gk_distribution", "football.pass", "football.match", "cond.agility", "cond.plyo"])
TP("football.defender", "Defender", "football.defender", ["football.defend", "football.pass", "football.match", "cond.sprint", "cond.yoyo_ir1", "cond.injury_prevention"])
TP("football.midfielder", "Midfielder", "football.midfielder", ["football.pass", "football.dribble", "football.shot", "football.defend", "football.match", "cond.yoyo_ir1"])
TP("football.forward", "Forward / Striker", "football.forward", ["football.shot", "football.dribble", "football.pass", "football.match", "cond.sprint", "cond.agility"])
TP("athletics.distance_runner", "Distance Runner (5K/10K)", "athletics.running", ["athletics.run", "athletics.lap", "athletics.time_trial", "cond.session_load", "gym.single_leg_calf_raise"])
TP("athletics.sprinter", "Sprinter", "athletics.sprints", ["cond.sprint", "athletics.lap", "cond.plyo", "gym.power_clean", "gym.back_squat"])

GROUP_TPL = [("gym.chest", "Chest Workout"), ("gym.back", "Back Workout"), ("gym.shoulders", "Shoulder Workout"),
             ("gym.arms.biceps", "Biceps Workout"), ("gym.arms.triceps", "Triceps Workout"), ("gym.arms.forearms", "Forearms & Grip"),
             ("gym.legs.quads", "Quads Workout"), ("gym.legs.hamstrings", "Hamstrings Workout"), ("gym.legs.glutes", "Glutes Workout"),
             ("gym.legs.calves", "Calves Workout"), ("gym.core", "Core & Abs Workout"), ("gym.full_body", "Full Body & Olympic"),
             ("gym.cardio", "Cardio Session"), ("gym.mobility", "Mobility & Recovery")]
for cat, name in GROUP_TPL:
    TP(cat, name, cat, [a for a, v in ACTS.items() if cat in v["categories"]])
legs = [a for a, v in ACTS.items() if any(c.startswith("gym.legs") for c in v["categories"]) and a.startswith("gym.")]
TP("gym.legs", "Leg Day", "gym.legs", legs)
arms = [a for a, v in ACTS.items() if any(c.startswith("gym.arms") for c in v["categories"])]
TP("gym.arms", "Arms Workout", "gym.arms", arms)
TP("gym.push_day", "Push Day (PPL)", "gym.splits", ["gym.barbell_bench_press", "gym.incline_dumbbell_press", "gym.overhead_press", "gym.lateral_raise",
   "gym.cable_crossover", "gym.triceps_pushdown", "gym.overhead_triceps_extension"],
   targets={"gym.barbell_bench_press": {"targetSets": 4, "targetReps": "5-8"}})
TP("gym.pull_day", "Pull Day (PPL)", "gym.splits", ["gym.deadlift", "gym.pull_up", "gym.barbell_row", "gym.lat_pulldown", "gym.face_pull", "gym.barbell_curl", "gym.hammer_curl"])
TP("gym.leg_day_ppl", "Leg Day (PPL)", "gym.splits", ["gym.back_squat", "gym.romanian_deadlift", "gym.leg_press", "gym.walking_lunge", "gym.lying_leg_curl", "gym.standing_calf_raise", "gym.hanging_leg_raise"])
TP("gym.full_body_beginner", "Full Body – Beginner", "gym.splits", ["gym.goblet_squat", "gym.dumbbell_bench_press", "gym.lat_pulldown", "gym.romanian_deadlift",
   "gym.seated_dumbbell_press", "gym.plank", "gym.stationary_bike"])
TP("gym.strength_5x5", "Strength 5×5", "gym.splits", ["gym.back_squat", "gym.barbell_bench_press", "gym.barbell_row", "gym.overhead_press", "gym.deadlift"],
   targets={a: {"targetSets": 5, "targetReps": "5"} for a in ["gym.back_squat", "gym.barbell_bench_press", "gym.barbell_row", "gym.overhead_press"]})
TP("gym.upper_lower_upper", "Upper Body (Upper/Lower)", "gym.splits", ["gym.barbell_bench_press", "gym.barbell_row", "gym.overhead_press", "gym.pull_up", "gym.dumbbell_curl", "gym.skull_crusher"])
TP("gym.upper_lower_lower", "Lower Body (Upper/Lower)", "gym.splits", ["gym.back_squat", "gym.romanian_deadlift", "gym.bulgarian_split_squat", "gym.lying_leg_curl", "gym.standing_calf_raise", "gym.ab_wheel_rollout"])
TP("body.checkin", "Body Composition Tracking", "body", ["body.checkin"])

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
NUMERIC = {"INT", "DECIMAL", "DURATION"}

def effective_params(a):
    out = OrderedDict()
    for ps in a["parameterSets"]:
        for p in PSETS[ps]["params"]:
            out[p["key"]] = p
    for p in a["params"]:
        out[p["key"]] = p
    return out

def effective_metrics(a):
    out = OrderedDict()
    for ps in a["parameterSets"]:
        for m in PSETS[ps]["metrics"]:
            out[m["key"]] = m
    for m in a["metrics"]:
        out[m["key"]] = m
    return out

def expr_params(expr):
    import re
    return [t for t in re.findall(r"[a-z][a-z0-9_]*", expr)]

def validate():
    errs = []
    for code, c in CATS.items():
        if c["parent"] and c["parent"] not in CATS: errs.append(f"category {code}: unknown parent {c['parent']}")
    for code, a in ACTS.items():
        for c in a["categories"]:
            if c not in CATS: errs.append(f"{code}: unknown category {c}")
        for ps in a["parameterSets"]:
            if ps not in PSETS: errs.append(f"{code}: unknown parameter set {ps}")
        own = [p["key"] for p in a["params"]]
        dup = [k for k, n in Counter(own).items() if n > 1]
        if dup: errs.append(f"{code}: duplicate params {dup}")
        params = effective_params(a)
        for e in a["equipment"]:
            if e not in EQUIPMENT: errs.append(f"{code}: unknown equipment {e}")
        for m in a["primaryMuscles"] + a["secondaryMuscles"]:
            if m not in MUSCLES: errs.append(f"{code}: unknown muscle {m}")
        for p in params.values():
            cond = p.get("condition")
            if cond:
                k, v = cond["when"]["key"], cond["when"]["eq"]
                if k not in params: errs.append(f"{code}.{p['key']}: condition on unknown {k}")
                elif params[k]["type"] == "BOOL" and not isinstance(v, bool): errs.append(f"{code}.{p['key']}: BOOL condition needs bool")
                elif params[k]["type"] == "ENUM" and v not in params[k]["constraints"]["options"]: errs.append(f"{code}.{p['key']}: bad enum condition {v}")
                elif params[k]["type"] not in ("BOOL", "ENUM"): errs.append(f"{code}.{p['key']}: condition must reference BOOL/ENUM")
                elif k == p["key"]: errs.append(f"{code}.{p['key']}: self condition")
            mr = p.get("constraints", {}).get("max_ref")
            if mr and (mr not in params or params[mr]["type"] not in NUMERIC): errs.append(f"{code}.{p['key']}: max_ref must reference a numeric param")
        mets = effective_metrics(a)
        if not mets: errs.append(f"{code}: no metrics")
        for m in mets.values():
            terms = []
            for side in ("numerator", "denominator"):
                t = m.get(side)
                if t is None: continue
                terms += t if isinstance(t, list) else [t]
            if m["kind"] == "RATIO":
                for t in terms:
                    if t["fn"] in ("MAX", "MIN"): errs.append(f"{code}.{m['key']}: MAX/MIN only allowed in SINGLE metrics")
            for t in terms:
                refs = expr_params(t["expr"]) if "expr" in t else ([] if t["param"] == "*" else [t["param"]])
                for r in refs:
                    if r not in params: errs.append(f"{code}.{m['key']}: unknown param {r}")
                    elif t["fn"] == "COUNT_TRUE" and params[r]["type"] != "BOOL": errs.append(f"{code}.{m['key']}: COUNT_TRUE needs BOOL ({r})")
                    elif t["fn"] in ("SUM", "MAX", "MIN") and params[r]["type"] not in NUMERIC: errs.append(f"{code}.{m['key']}: {t['fn']} needs numeric ({r})")
                for wk, wv in (t.get("where") or {}).items():
                    if wk not in params: errs.append(f"{code}.{m['key']}: where on unknown {wk}"); continue
                    vals = wv["in"] if isinstance(wv, dict) and "in" in wv else ([wv["ne"]] if isinstance(wv, dict) and "ne" in wv else ([] if isinstance(wv, dict) else [wv]))
                    pt = params[wk]
                    for v in vals:
                        if pt["type"] == "ENUM" and v not in pt["constraints"]["options"]: errs.append(f"{code}.{m['key']}: where {wk}={v} not an option")
                        if pt["type"] == "BOOL" and not isinstance(v, bool): errs.append(f"{code}.{m['key']}: where {wk} needs bool")
        dupm = [k for k, n in Counter(x["key"] for x in a["metrics"]).items() if n > 1]
        if dupm: errs.append(f"{code}: duplicate metrics {dupm}")
    for code, t in TPLS.items():
        if t["category"] not in CATS: errs.append(f"template {code}: unknown category {t['category']}")
        if not t["activities"]: errs.append(f"template {code}: empty")
        for x in t["activities"]:
            if x["activity"] not in ACTS: errs.append(f"template {code}: unknown activity {x['activity']}")
    return errs

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
SOURCES = [
    ("Free Exercise DB – 800+ exercises, public domain (Unlicense)", "https://github.com/yuhonas/free-exercise-db"),
    ("wger – open exercise database & API (data CC-BY-SA 3.0)", "https://github.com/wger-project/wger"),
    ("Sportplan – cricket drills: front-/back-foot batting, pull, sweep", "https://www.sportplan.net/drills/Cricket/Front-foot-batting/practiceIndex.jsp"),
    ("Sportplan – cricket ground fielding and throwing drills", "https://www.sportplan.net/drills/Cricket/Ground-fielding-and-throwing/practiceIndex.jsp"),
    ("Australian Cricket Institute – fast bowling drills", "https://australiancricketinstitute.com/3-best-drills-improve-fast-bowling/"),
    ("REPL Sports – fast bowling accuracy and pace drills", "https://replsports.com/blog/fast-bowling-drills-for-beginners-to-improve-accuracy-and-pace/"),
    ("Batting (cricket) – shot taxonomy", "https://en.wikipedia.org/wiki/Batting_(cricket)"),
    ("LTA – tennis stats explained", "https://www.lta.org.uk/fan-zone/tennis-stats-explained/"),
    ("Zenniz – tennis statistics that decide matches", "https://zenniz.com/smart-corner/tennis-statistics"),
    ("Strings and Paddles – badminton smash and clear drills", "https://stringsandpaddles.com/badminton-smash-drills/"),
    ("BadmintonSkills – footwork and court-coverage drills", "https://badmintonskills.com/top-10-drills-to-improve-your-badminton-footwork-and-court-coverage/"),
    ("Position-specific football drills", "https://www.footballgpt.co/guides/position-specific-football-drills-to-sharpen-your-game"),
    ("Soccer Coach Lab – striker finishing drills", "https://www.soccercoachlab.com/blog/striker-drills"),
    ("Yo-Yo intermittent test", "https://en.wikipedia.org/wiki/Yo-Yo_intermittent_test"),
    ("Yo-Yo IR tests – systematic review (PMC)", "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6041409/"),
    ("Session-RPE method for training load (PMC)", "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5673663/"),
    ("Validity of session RPE in cricket fast bowlers", "https://www.researchgate.net/publication/270876165_Validity_of_session_RPE_monitoring_within_cricket_fast_bowlers"),
]

def to_json():
    return OrderedDict(
        version=VERSION,
        generatedBy="catalog/tools/build_phase1_catalog.py",
        sources=[{"title": t, "url": u} for t, u in SOURCES],
        lookups=OrderedDict(equipment=EQUIPMENT, muscles=[{"code": k, "name": v} for k, v in MUSCLES.items()], levels=LEVELS),
        categories=list(CATS.values()),
        parameterSets=[OrderedDict(code=k, name=v["name"], description=v["desc"], params=v["params"], metrics=v["metrics"]) for k, v in PSETS.items()],
        activities=list(ACTS.values()),
        templates=list(TPLS.values()),
    )


def fmt_param(p):
    t = p["type"]
    c = p.get("constraints", {})
    if t == "ENUM": t += "(" + ", ".join(c.get("options", [])) + ")"
    elif "min" in c or "max" in c: t += f" {c.get('min', '')}–{c.get('max', '')}"
    if c.get("max_ref"): t += f" (≤ `{c['max_ref']}`)"
    if p.get("unit"): t += f" {p['unit']}"
    cond = p.get("condition")
    cs = f"when `{cond['when']['key']}` = {str(cond['when']['eq']).lower()}" if cond else ""
    return f"| `{p['key']}` | {p['label']} | {t} | {'✔' if p['required'] else ''} | {cs} |"


def fmt_term(t):
    if isinstance(t, list): return " + ".join(fmt_term(x) for x in t)
    inner = t.get("expr") or t["param"]
    w = ""
    if t.get("where"):
        parts = []
        for k, v in t["where"].items():
            if isinstance(v, dict):
                op, val = next(iter(v.items()))
                parts.append(f"{k} {'∈' if op == 'in' else {'ne': '≠', 'gte': '≥', 'lte': '≤'}[op]} {val}")
            else:
                parts.append(f"{k}={str(v).lower() if isinstance(v, bool) else v}")
        w = " where " + ", ".join(parts)
    return f"{t['fn']}({inner}{w})"


def fmt_metric(m):
    f = fmt_term(m["numerator"]) + (" ÷ " + fmt_term(m["denominator"]) if "denominator" in m else "")
    d = m["display"]
    disp = d["format"].lower() + (f" {d['unit']}" if d.get("unit") else "") + (f" ×{d['scale']}" if d.get("scale") else "")
    return f"| `{m['key']}` | {m['label']} | {m['kind']} | {f} | {disp} |"


def to_md():
    L = []
    w = L.append
    nacts = len(ACTS); ngym = sum(1 for a in ACTS if a.startswith("gym."))
    nparams = sum(len(effective_params(a)) for a in ACTS.values()); nmet = sum(len(effective_metrics(a)) for a in ACTS.values())
    w("# TrainMe – Phase 1 Activity Catalog (Knowledge Base)\n")
    w("| Item | Value |\n|---|---|")
    w(f"| Version | `{VERSION}` · generated by `catalog/tools/build_phase1_catalog.py` (do not edit by hand) |")
    w("| Seed file | `catalog/phase1/catalog.json` – loaded by the catalog-svc seed Job |")
    w(f"| Size | {len(CATS)} categories · {len(TPLS)} profile templates · {nacts} library activities ({ngym} gym / {nacts - ngym} sport & conditioning) · {len(PSETS)} reusable parameter sets · {nparams} effective parameters · {nmet} metrics |")
    w("| Related | LLD §2.1 (catalog DDL), `08_Search_and_Query_Performance.md`, diagram `13_phase1_catalog_taxonomy` |\n")
    w("---\n")
    w("## 1. How the knowledge is organised\n")
    w("- **Taxonomy (categories, any depth)**. Roles are modelled as category nodes where a sport has them: *Cricket › Bowling › Bowler › Fast Bowler*; *Football › Goalkeeper*. Sports without roles (Lawn Tennis, Badminton) have one player profile organised by stroke area. Gym is organised by **muscle group** (Chest, Back, Shoulders, Arms › Biceps/Triceps/Forearms, Legs › Quads/Hamstrings/Glutes/Calves, Core), plus Cardio, Mobility and Training Splits.")
    w("- **Activity library (reusable)**. Every exercise or drill is defined **once** (e.g. *Catching Drill*, *Barbell Back Squat*) and referenced by many profile templates (Batter, Fielder, Wicket-keeper all reuse *Catching Drill*; Push Day, Chest Workout and Strength 5×5 reuse *Barbell Bench Press*).")
    w("- **Reusable parameter sets**. Common shapes such as a weighted set (`reps`, `weight_kg`, `rpe`, `to_failure` → `assisted_reps`) are defined once and attached to 70+ gym exercises, so they share parameters and metrics (volume, top set, estimated 1RM).")
    w("- **Granular recording everywhere**. Ball-by-ball, serve-by-serve, shot-by-shot, set-by-set and lap-by-lap entries (`PER_ATTEMPT` / `PER_SET`). Match stats and check-ins are `PER_SESSION`.")
    w("- **Attempted → accurate pattern**. Applied consistently: bowling skills (yorker, seam, bouncer, swing, slower ball, turn, drift, variation), keeping (stumping / catch chances), tennis and badminton (`in` → `target_hit` / `winner`; out → error type), football (`on_target` → `goal`; `saved` → `held`).")
    w("- **Metrics are data**. Ratios are Σ numerator ÷ Σ denominator, which stays correct for any week or month. `where` filters (e.g. first serves only) and `MAX`/`MIN` (top speed, best time) are supported.")
    w("- **Search facets** come from the same data: sport, role, category, kind (EXERCISE / DRILL / TEST / MATCH / LOG), equipment, primary/secondary muscles, mechanic, force, level and synonyms.\n")
    w("### 1.1 Metric grammar (extension of LLD §2.1)\n")
    w("```\nterm      := {fn: COUNT | COUNT_TRUE | SUM | MAX | MIN, param: <key> | \"*\" | expr: \"<arithmetic over params>\", where?: {<key>: <value> | {in|ne|gte|lte: …}}}\nnumerator := term | [term, term, …]          -- a list is summed (e.g. full_toss + long_hop)\nRATIO     := Σ numerator ÷ Σ denominator      -- additive → exact for day / week / month\nSINGLE    := Σ numerator  (or MAX/MIN, merged with GREATEST/LEAST across periods)\ndisplay   := {format: NUMBER | PERCENT | DURATION | PACE, unit?, decimals, scale?}\n```\n")
    w("---\n")
    w("## 2. Taxonomy and profile templates\n")
    w("![Phase 1 taxonomy](../diagrams/png/13_phase1_catalog_taxonomy.png)\n")
    def tree(parent, depth):
        for c in CATS.values():
            if c["parent"] == parent:
                tpls = [t["name"] for t in TPLS.values() if t["category"] == c["code"]]
                w("  " * depth + f"- **{c['name']}** `{c['code']}` · _{c['kind'].lower().replace('_', ' ')}_" + (f" → templates: {', '.join(tpls)}" if tpls else ""))
                tree(c["code"], depth + 1)
    tree(None, 0)
    w("\n### 2.1 Template contents\n")
    w("| Template | Category | Activities |\n|---|---|---|")
    for t in TPLS.values():
        acts = ", ".join(ACTS[x["activity"]]["name"] + (f" ({x['targetSets']}×{x['targetReps']})" if "targetSets" in x else "") for x in t["activities"])
        w(f"| **{t['name']}** `{t['code']}` | `{t['category']}` | {acts} |")
    w("\n---\n")
    w("## 3. Reusable parameter sets\n")
    for k, v in PSETS.items():
        w(f"### `{k}` – {v['name']}\n{v['desc']}\n")
        w("| Key | Label | Type | Req. | Condition |\n|---|---|---|---|---|")
        for p in v["params"]: w(fmt_param(p))
        w("\n| Metric | Label | Kind | Formula | Display |\n|---|---|---|---|---|")
        for m in v["metrics"]: w(fmt_metric(m))
        w("")
    w("---\n")
    sections = [("4. Cricket", lambda c: c.startswith("cricket.")), ("5. Lawn Tennis (no roles)", lambda c: c.startswith("tennis.")),
                ("6. Badminton (no roles)", lambda c: c.startswith("badminton.")), ("7. Football", lambda c: c.startswith("football.")),
                ("8. Athletics", lambda c: c.startswith("athletics.")), ("9. Shared Athletic Conditioning", lambda c: c.startswith("cond.")),
                ("10. Body Composition", lambda c: c.startswith("body."))]
    for title, f in sections:
        w(f"## {title}\n")
        for code, a in ACTS.items():
            if not f(code): continue
            roles = ", ".join(a["roles"]) or "all"
            w(f"### {a['name']}  \n`{code}` · {a['kind']} · **{a['recordingMode']}**" + (f" · grouped by {a['grouping']['label']} of {a['grouping']['size']}" if a.get("grouping") else "") + f" · roles: {roles}" + (f" · uses sets: {', '.join(a['parameterSets'])}" if a["parameterSets"] else ""))
            if a.get("description"): w(f"\n{a['description']}")
            if a["synonyms"]: w(f"\n_Search synonyms_: {', '.join(a['synonyms'])}")
            w("\n| Key | Label | Type | Req. | Condition |\n|---|---|---|---|---|")
            for p in effective_params(a).values(): w(fmt_param(p))
            w("\n| Metric | Label | Kind | Formula | Display |\n|---|---|---|---|---|")
            for m in effective_metrics(a).values(): w(fmt_metric(m))
            w("")
        w("---\n")
    w("## 11. Gym Exercise Library\n")
    w("All gym exercises are `PER_SET` (one entry per set) and inherit the parameters and metrics of their parameter set (§3).\n")
    for cat in [c for c in CATS.values() if c["code"].startswith("gym.") and c["kind"] in ("MUSCLE_GROUP", "MUSCLE", "AREA") and c["code"] != "gym.splits"]:
        rows = [(k, a) for k, a in ACTS.items() if k.startswith("gym.") and cat["code"] in a["categories"]]
        if not rows: continue
        w(f"### {cat['name']} `{cat['code']}`\n")
        w("| Exercise | Equipment | Primary | Secondary | Mechanic / Force | Level | Parameter set | Synonyms |\n|---|---|---|---|---|---|---|---|")
        for k, a in rows:
            w(f"| {a['name']} `{k}` | {', '.join(a['equipment'])} | {', '.join(a['primaryMuscles'])} | {', '.join(a['secondaryMuscles'])} | {a['mechanic'] or ''} / {a['force'] or ''} | {a['level']} | `{', '.join(a['parameterSets'])}` | {', '.join(a['synonyms'])} |")
        w("")
    w("---\n")
    w("## 12. Phase 2 backlog & import plan\n")
    w("- **Bulk gym import**: map the 800+ public-domain exercises of *Free Exercise DB* (fields: name, force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, instructions, category, images) onto `activity_definition` + the parameter sets above. `strength` maps to `strength_set`; body-weight equipment maps to `bodyweight_set`; `stretching` maps to `mobility_set`; `cardio` maps to `cardio_bout`. Curators review each item before publishing. *wger* data (CC-BY-SA 3.0) can add translations, but it requires attribution and share-alike, so keep it in a separate, attributed dataset.")
    w("- **More sports**: basketball, hockey, volleyball, table tennis, squash, swimming, cycling, kabaddi, yoga – same patterns (attempt → outcome, PER_SET drills, match stats).")
    w("- **Point-by-point tennis charting** (match-charting style) and **wagon-wheel / pitch-map** coordinates for cricket (`value_json` with x/y) once the UI supports tap-on-field input.")
    w("- **Coach-authored templates** (owner_type = COACH) on top of the same library.\n")
    w("## 13. Sources consulted\n")
    for t, u in SOURCES: w(f"- [{t}]({u})")
    w("\nDrill and parameter definitions are TrainMe's own structured descriptions of commonly taught practices. No third-party text or images are copied. Exercise names are generic. Images and instructions from Free Exercise DB may be imported later (public domain).")
    return "\n".join(L) + "\n"


def main():
    errs = validate()
    if errs:
        print("VALIDATION FAILED:\n  " + "\n  ".join(errs)); sys.exit(1)
    os.makedirs(os.path.join(ROOT, "catalog", "phase1"), exist_ok=True)
    with open(os.path.join(ROOT, "catalog", "phase1", "catalog.json"), "w") as f:
        json.dump(to_json(), f, indent=2, ensure_ascii=False)
    with open(os.path.join(ROOT, "docs", "07_Phase1_Activity_Catalog.md"), "w") as f:
        f.write(to_md())
    print(f"OK: {len(CATS)} categories, {len(TPLS)} templates, {len(ACTS)} activities, {len(PSETS)} parameter sets, "
          f"{sum(len(effective_params(a)) for a in ACTS.values())} effective params, {sum(len(effective_metrics(a)) for a in ACTS.values())} metrics")


if __name__ == "__main__":
    main()
