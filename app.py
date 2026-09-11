"""Fantasy Football Live Draft Board.

A single-room dashboard for running an in-person snake/linear draft.
Run with `python app.py` and open the printed URL on the room's screen.
State is kept in memory and mirrored to data/draft_state.json so a
server restart doesn't lose an in-progress draft.
"""
import csv
import json
import time
from pathlib import Path
from threading import Lock

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
PLAYERS_CSV = BASE_DIR / "data" / "players.csv"
STATE_FILE = BASE_DIR / "data" / "draft_state.json"

DEFAULT_NUM_TEAMS = 10
DEFAULT_PICK_SECONDS = 90

app = Flask(__name__)
state_lock = Lock()


def load_players():
    players = []
    with open(PLAYERS_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            players.append({
                "id": int(row["id"]),
                "name": row["name"],
                "position": row["position"],
                "nfl_team": row["nfl_team"],
                "rank": int(row["rank"]),
                "bye_week": int(row["bye_week"]) if row["bye_week"] else None,
                "drafted_by": None,
                "pick_number": None,
            })
    players.sort(key=lambda p: p["rank"])
    return players


def default_team_names(n):
    return [f"Team {i + 1}" for i in range(n)]


def new_state():
    num_teams = DEFAULT_NUM_TEAMS
    return {
        "players": load_players(),
        "teams": [
            {"id": i, "name": name}
            for i, name in enumerate(default_team_names(num_teams))
        ],
        "num_teams": num_teams,
        "draft_type": "snake",  # "snake" or "linear"
        "pick_seconds": DEFAULT_PICK_SECONDS,
        "current_pick_overall": 1,
        "pick_started_at": time.time(),
        "paused": False,
        "pause_remaining": None,
        "history": [],  # list of {overall_pick, team_id, player_id}
    }


def save_state():
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(STATE, f, indent=2)


def load_state():
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, encoding="utf-8") as f:
                data = json.load(f)
            # sanity check it has the shape we expect; otherwise start fresh
            if "players" in data and "teams" in data:
                return data
        except (json.JSONDecodeError, KeyError):
            pass
    return new_state()


STATE = load_state()


def pick_team_index(overall_pick, num_teams, draft_type):
    round_num = (overall_pick - 1) // num_teams
    pick_in_round = (overall_pick - 1) % num_teams
    if draft_type == "snake" and round_num % 2 == 1:
        return num_teams - 1 - pick_in_round
    return pick_in_round


def total_players():
    return len(STATE["players"])


def is_draft_complete():
    drafted = sum(1 for p in STATE["players"] if p["drafted_by"] is not None)
    return drafted >= total_players()


def public_state():
    num_teams = STATE["num_teams"]
    overall = STATE["current_pick_overall"]
    complete = is_draft_complete()
    on_clock = None
    round_num = None
    if not complete:
        idx = pick_team_index(overall, num_teams, STATE["draft_type"])
        on_clock = STATE["teams"][idx]["id"]
        round_num = (overall - 1) // num_teams + 1

    remaining = None
    if not complete:
        if STATE["paused"]:
            remaining = STATE["pause_remaining"]
        else:
            elapsed = time.time() - STATE["pick_started_at"]
            remaining = max(0, STATE["pick_seconds"] - elapsed)

    rosters = {team["id"]: [] for team in STATE["teams"]}
    for p in STATE["players"]:
        if p["drafted_by"] is not None:
            rosters[p["drafted_by"]].append(p)
    for team_id in rosters:
        rosters[team_id].sort(key=lambda p: p["pick_number"])

    return {
        "players": STATE["players"],
        "teams": STATE["teams"],
        "num_teams": num_teams,
        "draft_type": STATE["draft_type"],
        "pick_seconds": STATE["pick_seconds"],
        "current_pick_overall": overall,
        "current_round": round_num,
        "on_clock_team_id": on_clock,
        "paused": STATE["paused"],
        "seconds_remaining": remaining,
        "history": STATE["history"][-25:],
        "rosters": rosters,
        "draft_complete": complete,
        "total_players": total_players(),
        "total_picks_made": len(STATE["history"]),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def get_state():
    return jsonify(public_state())


@app.route("/api/pick", methods=["POST"])
def make_pick():
    data = request.get_json(force=True)
    player_id = data.get("player_id")
    team_id_override = data.get("team_id")

    with state_lock:
        if is_draft_complete():
            return jsonify({"error": "Draft is already complete."}), 400

        player = next((p for p in STATE["players"] if p["id"] == player_id), None)
        if player is None:
            return jsonify({"error": "Unknown player."}), 404
        if player["drafted_by"] is not None:
            return jsonify({"error": "Player already drafted."}), 400

        overall = STATE["current_pick_overall"]
        idx = pick_team_index(overall, STATE["num_teams"], STATE["draft_type"])
        team_id = team_id_override if team_id_override is not None else STATE["teams"][idx]["id"]

        player["drafted_by"] = team_id
        player["pick_number"] = overall
        STATE["history"].append({
            "overall_pick": overall,
            "team_id": team_id,
            "player_id": player_id,
        })
        STATE["current_pick_overall"] += 1
        STATE["pick_started_at"] = time.time()
        STATE["paused"] = False
        STATE["pause_remaining"] = None
        save_state()

    return jsonify(public_state())


@app.route("/api/undo", methods=["POST"])
def undo_pick():
    with state_lock:
        if not STATE["history"]:
            return jsonify({"error": "Nothing to undo."}), 400
        last = STATE["history"].pop()
        player = next(p for p in STATE["players"] if p["id"] == last["player_id"])
        player["drafted_by"] = None
        player["pick_number"] = None
        STATE["current_pick_overall"] = last["overall_pick"]
        STATE["pick_started_at"] = time.time()
        STATE["paused"] = False
        STATE["pause_remaining"] = None
        save_state()
    return jsonify(public_state())


@app.route("/api/timer/pause", methods=["POST"])
def pause_timer():
    with state_lock:
        if not STATE["paused"]:
            elapsed = time.time() - STATE["pick_started_at"]
            STATE["pause_remaining"] = max(0, STATE["pick_seconds"] - elapsed)
            STATE["paused"] = True
            save_state()
    return jsonify(public_state())


@app.route("/api/timer/resume", methods=["POST"])
def resume_timer():
    with state_lock:
        if STATE["paused"]:
            remaining = STATE["pause_remaining"] or 0
            STATE["pick_started_at"] = time.time() - (STATE["pick_seconds"] - remaining)
            STATE["paused"] = False
            STATE["pause_remaining"] = None
            save_state()
    return jsonify(public_state())


@app.route("/api/timer/restart", methods=["POST"])
def restart_timer():
    with state_lock:
        STATE["pick_started_at"] = time.time()
        STATE["paused"] = False
        STATE["pause_remaining"] = None
        save_state()
    return jsonify(public_state())


@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = request.get_json(force=True)
    with state_lock:
        if "team_names" in data:
            names = data["team_names"]
            new_num = len(names)
            old_teams = {t["id"]: t for t in STATE["teams"]}
            STATE["teams"] = [
                {"id": i, "name": names[i] or old_teams.get(i, {}).get("name", f"Team {i + 1}")}
                for i in range(new_num)
            ]
            STATE["num_teams"] = new_num
        if "pick_seconds" in data:
            STATE["pick_seconds"] = max(10, int(data["pick_seconds"]))
        if "draft_type" in data:
            if data["draft_type"] in ("snake", "linear"):
                STATE["draft_type"] = data["draft_type"]
        STATE["pick_started_at"] = time.time()
        STATE["paused"] = False
        STATE["pause_remaining"] = None
        save_state()
    return jsonify(public_state())


@app.route("/api/reset", methods=["POST"])
def reset_draft():
    """Reset all picks but keep team names/settings."""
    with state_lock:
        for p in STATE["players"]:
            p["drafted_by"] = None
            p["pick_number"] = None
        STATE["current_pick_overall"] = 1
        STATE["history"] = []
        STATE["pick_started_at"] = time.time()
        STATE["paused"] = False
        STATE["pause_remaining"] = None
        save_state()
    return jsonify(public_state())


@app.route("/api/reset_full", methods=["POST"])
def reset_full():
    """Wipe everything back to defaults, including team names/settings."""
    global STATE
    with state_lock:
        STATE = new_state()
        save_state()
    return jsonify(public_state())


if __name__ == "__main__":
    print("Fantasy Football Live Draft Board running at http://127.0.0.1:5050")
    app.run(host="0.0.0.0", port=5050, debug=True)
