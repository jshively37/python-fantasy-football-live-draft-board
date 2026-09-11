const API = {
  state: "/api/state",
  pick: "/api/pick",
  undo: "/api/undo",
  pause: "/api/timer/pause",
  resume: "/api/timer/resume",
  restartTimer: "/api/timer/restart",
  settings: "/api/settings",
  reset: "/api/reset",
};

let state = null;
let activePosFilter = "ALL";
let showDrafted = false;
let pendingPlayerId = null;
let localRemaining = null;
let lastWholeSecond = null;
let audioCtx = null;

// ---------- Networking ----------

async function fetchState() {
  const res = await fetch(API.state);
  state = await res.json();
  localRemaining = state.seconds_remaining;
  render();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Something went wrong.");
    return null;
  }
  state = data;
  localRemaining = state.seconds_remaining;
  render();
  return data;
}

// ---------- Sound ----------

function beep(freq, duration) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    /* audio not available; ignore */
  }
}

// ---------- Rendering ----------

function teamName(id) {
  const t = state.teams.find((t) => t.id === id);
  return t ? t.name : "—";
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function render() {
  if (!state) return;
  renderTopBar();
  renderGrid();
  renderTeamOrder();
  renderHistory();
}

function renderTopBar() {
  const complete = state.draft_complete;
  document.getElementById("on-clock-team").textContent = complete
    ? "Draft Complete"
    : teamName(state.on_clock_team_id);
  document.getElementById("pick-number").textContent = complete
    ? state.total_players
    : state.current_pick_overall;
  document.getElementById("round-number").textContent = complete ? "—" : state.current_round;

  const timerEl = document.getElementById("timer-display");
  if (complete) {
    timerEl.textContent = "--:--";
    timerEl.className = "";
  } else {
    timerEl.textContent = formatTime(localRemaining);
    timerEl.className = localRemaining <= 10 ? "critical" : localRemaining <= 30 ? "warn" : "";
  }

  document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
}

function playerMatchesFilters(p) {
  if (activePosFilter !== "ALL" && p.position !== activePosFilter) return false;
  if (!showDrafted && p.drafted_by !== null) return false;
  const q = document.getElementById("search-box").value.trim().toLowerCase();
  if (q && !p.name.toLowerCase().includes(q)) return false;
  return true;
}

function renderGrid() {
  const grid = document.getElementById("player-grid");
  const players = state.players.filter(playerMatchesFilters);
  grid.innerHTML = "";

  if (players.length === 0) {
    grid.innerHTML = `<div style="color:var(--text-dim); padding: 20px;">No players match.</div>`;
    return;
  }

  for (const p of players) {
    const card = document.createElement("div");
    card.className = `player-card pos-${p.position}` + (p.drafted_by !== null ? " drafted" : "");
    card.innerHTML = `
      ${p.drafted_by !== null ? `<div class="drafted-tag">${escapeHTML(teamName(p.drafted_by))}</div>` : ""}
      <div class="rank">#${p.rank}</div>
      <div class="name">${escapeHTML(p.name)}</div>
      <div class="meta">
        <span class="badge">${p.position}</span>
        <span>${p.nfl_team}${p.bye_week ? " · BYE " + p.bye_week : ""}</span>
      </div>
    `;
    if (p.drafted_by === null && !state.draft_complete) {
      card.addEventListener("click", () => openConfirmModal(p.id));
    }
    grid.appendChild(card);
  }
}

function renderTeamOrder() {
  const list = document.getElementById("team-order-list");
  list.innerHTML = "";
  const banner = document.getElementById("draft-complete-banner");
  banner.classList.toggle("hidden", !state.draft_complete);

  for (const team of state.teams) {
    const li = document.createElement("li");
    if (!state.draft_complete && team.id === state.on_clock_team_id) {
      li.classList.add("on-clock");
    }
    const count = (state.rosters[team.id] || []).length;
    li.innerHTML = `<span>${escapeHTML(team.name)}</span><span class="count">${count} pk${count === 1 ? "" : "s"}</span>`;
    li.addEventListener("click", () => openRosterModal(team.id));
    list.appendChild(li);
  }
}

function renderHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";
  const items = [...state.history].reverse();
  if (items.length === 0) {
    list.innerHTML = `<li>No picks yet.</li>`;
    return;
  }
  for (const h of items) {
    const player = state.players.find((p) => p.id === h.player_id);
    const li = document.createElement("li");
    li.innerHTML = `#${h.overall_pick} — <b>${escapeHTML(player ? player.name : "?")}</b>
      <span class="pos-tag">${player ? player.position : ""}</span>
      → ${escapeHTML(teamName(h.team_id))}`;
    list.appendChild(li);
  }
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Confirm pick modal ----------

function openConfirmModal(playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  pendingPlayerId = playerId;

  document.getElementById("confirm-title").textContent = `Draft ${player.name}?`;
  document.getElementById("confirm-body").textContent =
    `${player.position} · ${player.nfl_team} — Pick #${state.current_pick_overall} (Round ${state.current_round})`;

  const select = document.getElementById("confirm-team-select");
  select.innerHTML = "";
  for (const team of state.teams) {
    const opt = document.createElement("option");
    opt.value = team.id;
    opt.textContent = team.name;
    if (team.id === state.on_clock_team_id) opt.selected = true;
    select.appendChild(opt);
  }

  document.getElementById("confirm-modal").classList.remove("hidden");
}

function closeConfirmModal() {
  document.getElementById("confirm-modal").classList.add("hidden");
  pendingPlayerId = null;
}

// ---------- Roster modal ----------

function openRosterModal(teamId) {
  const team = state.teams.find((t) => t.id === teamId);
  document.getElementById("roster-title").textContent = `${team.name} Roster`;
  const list = document.getElementById("roster-list");
  list.innerHTML = "";
  const roster = state.rosters[teamId] || [];
  if (roster.length === 0) {
    list.innerHTML = `<li style="color:var(--text-dim)">No picks yet.</li>`;
  } else {
    for (const p of roster) {
      const li = document.createElement("li");
      li.innerHTML = `<span>#${p.pick_number} ${escapeHTML(p.name)}</span><span class="pos-tag">${p.position}</span>`;
      list.appendChild(li);
    }
  }
  document.getElementById("roster-modal").classList.remove("hidden");
}

// ---------- Settings modal ----------

function openSettingsModal() {
  document.getElementById("setting-num-teams").value = state.num_teams;
  document.getElementById("setting-pick-seconds").value = state.pick_seconds;
  document.getElementById("setting-draft-type").value = state.draft_type;
  renderTeamNameInputs(state.num_teams);
  document.getElementById("settings-modal").classList.remove("hidden");
}

function renderTeamNameInputs(count) {
  const container = document.getElementById("team-name-inputs");
  const existing = Array.from(container.querySelectorAll("input")).map((i) => i.value);
  container.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const input = document.createElement("input");
    const current = state.teams[i] ? state.teams[i].name : null;
    input.value = existing[i] || current || `Team ${i + 1}`;
    input.placeholder = `Team ${i + 1} name`;
    container.appendChild(input);
  }
}

function closeSettingsModal() {
  document.getElementById("settings-modal").classList.add("hidden");
}

// ---------- Event wiring ----------

document.getElementById("search-box").addEventListener("input", renderGrid);

document.querySelectorAll(".pos-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pos-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activePosFilter = btn.dataset.pos;
    renderGrid();
  });
});

document.getElementById("show-drafted").addEventListener("change", (e) => {
  showDrafted = e.target.checked;
  renderGrid();
});

document.getElementById("confirm-cancel").addEventListener("click", closeConfirmModal);
document.getElementById("confirm-ok").addEventListener("click", async () => {
  if (pendingPlayerId === null) return;
  const teamId = parseInt(document.getElementById("confirm-team-select").value, 10);
  await postJSON(API.pick, { player_id: pendingPlayerId, team_id: teamId });
  closeConfirmModal();
});

document.getElementById("roster-close").addEventListener("click", () => {
  document.getElementById("roster-modal").classList.add("hidden");
});

document.getElementById("btn-undo").addEventListener("click", async () => {
  if (state.history.length === 0) return;
  if (confirm("Undo the most recent pick?")) {
    await postJSON(API.undo);
  }
});

document.getElementById("btn-pause").addEventListener("click", async () => {
  await postJSON(state.paused ? API.resume : API.pause);
});

document.getElementById("btn-restart-timer").addEventListener("click", async () => {
  await postJSON(API.restartTimer);
});

document.getElementById("btn-reset").addEventListener("click", async () => {
  if (confirm("Reset the entire draft? All picks will be cleared.")) {
    await postJSON(API.reset);
  }
});

document.getElementById("btn-settings").addEventListener("click", openSettingsModal);
document.getElementById("settings-cancel").addEventListener("click", closeSettingsModal);

document.getElementById("setting-num-teams").addEventListener("input", (e) => {
  const n = Math.max(2, Math.min(20, parseInt(e.target.value, 10) || 2));
  renderTeamNameInputs(n);
});

document.getElementById("settings-save").addEventListener("click", async () => {
  const names = Array.from(document.querySelectorAll("#team-name-inputs input")).map((i) => i.value.trim());
  const pickSeconds = parseInt(document.getElementById("setting-pick-seconds").value, 10) || 90;
  const draftType = document.getElementById("setting-draft-type").value;
  await postJSON(API.settings, { team_names: names, pick_seconds: pickSeconds, draft_type: draftType });
  closeSettingsModal();
});

// close modals by clicking outside
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });
});

// ---------- Timer loop ----------

setInterval(() => {
  if (!state || state.draft_complete || state.paused) return;
  localRemaining = Math.max(0, localRemaining - 1);
  const rounded = Math.ceil(localRemaining);
  if (rounded !== lastWholeSecond) {
    lastWholeSecond = rounded;
    if (rounded === 0) beep(220, 0.5);
    else if (rounded <= 5) beep(880, 0.12);
  }
  renderTopBar();
}, 1000);

// periodic resync with server (covers multi-viewer drift & catches auto changes)
setInterval(fetchState, 5000);

fetchState();
