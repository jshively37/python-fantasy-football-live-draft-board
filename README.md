# Fantasy Football Live Draft Board

A sticker-board style dashboard for running an in-person PPR fantasy draft on a shared
screen/projector. Click a player to assign them to whoever's on the clock, and the pick
timer resets and advances to the next drafter automatically.

## Setup

```bash
cd python-fantasty-football-live-draft-board
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5050` (or your machine's IP on the same port, from any device on
the network — handy if you want the board on a TV while controlling it from a laptop/phone).

## Using it on draft day

1. Click **Settings** and set your number of teams, team/owner names, seconds per pick,
   and snake vs. linear draft order.
2. As players are called out, click their sticker in the grid. Confirm the pick (you can
   override which team it's assigned to, in case of a mis-click) and the board advances to
   the next team on the clock with a fresh timer.
3. **Undo Last Pick** fixes mistakes. **Pause/Resume** and **Reset Timer** manage the clock
   for bathroom breaks or trade discussions. **Reset Draft** clears all picks but keeps your
   team names and settings.
4. The search box and position tabs (QB/RB/WR/TE/K/DEF) help you find a player fast in a
   loud room. "show drafted" reveals who's already gone if you want to double check.
5. Click any team in the **Draft Order** sidebar to see that team's full roster. It's
   grouped **By Position** by default (all QBs together, all RBs together, etc.) so an
   owner can quickly check what they still need — toggle to **By Draft Order** to see picks
   in the order they were made instead.

State is saved to `data/draft_state.json` after every action, so if the server restarts
mid-draft (or a browser tab crashes), just reload the page and everything picks up where
it left off.

## Updating the player pool

`data/players.csv` ships with a starter list of ~200 fantasy-relevant players and rough
rankings so the board works out of the box. It will drift out of date as rosters, trades,
and injuries happen — before your draft, open the CSV and edit/add/remove rows as needed.
Columns:

| column | meaning |
|---|---|
| `id` | unique integer, must not repeat |
| `name` | player display name (or team name for defenses) |
| `position` | `QB`, `RB`, `WR`, `TE`, `K`, or `DEF` |
| `nfl_team` | NFL team abbreviation |
| `rank` | overall rank — controls default sort order in the grid |
| `bye_week` | bye week number |

After editing the CSV, delete `data/draft_state.json` (or click **Reset Draft** then restart
the server) so the new player list gets loaded in.

## Notes

- This is designed for a single shared draft room, not authenticated multi-user access —
  anyone who can load the page can make picks, which matches how an in-person sticker board
  works.
- The countdown timer plays a soft tick in the last 5 seconds and a tone at zero; it doesn't
  auto-pick when it hits zero, since the room is calling out picks verbally — it's just a
  visual/audio nudge to the room.
