// NBA Stats page. Vanilla ES module, no build step. Reads data/*.json written by scripts/update.mjs.

// ---------- categories ----------
// f: value shown/ranked per game. imp: for percentages, the attempt-weighted impact per game.
const CATS = [
  { k: "pts", l: "PTS", f: (p, g) => p.pts / g },
  { k: "reb", l: "REB", f: (p, g) => p.reb / g },
  { k: "ast", l: "AST", f: (p, g) => p.ast / g },
  { k: "stl", l: "STL", f: (p, g) => p.stl / g },
  { k: "blk", l: "BLK", f: (p, g) => p.blk / g },
  { k: "tpm", l: "3PM", f: (p, g) => p.tpm / g },
  { k: "fgp", l: "FG%", f: (p) => (p.fga ? (p.fgm / p.fga) * 100 : null), imp: (p, g, b) => (p.fgm - b.fg * p.fga) / g },
  { k: "ftp", l: "FT%", f: (p) => (p.fta ? (p.ftm / p.fta) * 100 : null), imp: (p, g, b) => (p.ftm - b.ft * p.fta) / g },
  { k: "tov", l: "TO", f: (p, g) => p.tov / g, inv: true },
];

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  index: null, season: null, day: null, dayDate: null,
  base: null,
  cats: new Set(store.get("nbs-cats", CATS.map((c) => c.k))),
  tab: "day", sort: { key: "z", dir: -1 }, q: "", few: false,
  watch: store.get("nbs-watch", []),
};

// DOM helper (textContent only, so feed data can never inject markup).
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

// ---------- math ----------
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1e-9; };

function qualifies(p, maxGp) {
  return p.gp >= Math.max(1, Math.round(maxGp * 0.4)) && p.min / p.gp >= 15;
}

function computeBase(players) {
  const maxGp = Math.max(1, ...players.map((p) => p.gp));
  const q = players.filter((p) => qualifies(p, maxGp));
  const pool = q.length >= 20 ? q : players;
  const b = { maxGp, fg: 0, ft: 0, m: {}, s: {} };
  const sum = (k) => pool.reduce((s, p) => s + p[k], 0);
  b.fg = sum("fgm") / (sum("fga") || 1);
  b.ft = sum("ftm") / (sum("fta") || 1);
  for (const c of CATS) {
    const vals = pool.map((p) => (c.imp ? c.imp(p, p.gp, b) : c.f(p, p.gp)));
    b.m[c.k] = mean(vals);
    b.s[c.k] = std(vals);
  }
  return b;
}

// Per-category z-scores for a stat line over g games (g = 1 for a single night).
function zs(p, g) {
  const out = {};
  for (const c of CATS) {
    const v = c.imp ? c.imp(p, g, state.base) : c.f(p, g);
    out[c.k] = ((v - state.base.m[c.k]) / state.base.s[c.k]) * (c.inv ? -1 : 1);
  }
  return out;
}
const total = (z) => CATS.reduce((s, c) => s + (state.cats.has(c.k) ? z[c.k] : 0), 0);

function seasonRows() {
  if (!state.season) return [];
  return state.season.players.map((p) => {
    const z = zs(p, p.gp);
    return { p, g: p.gp, z, value: total(z), q: qualifies(p, state.base.maxGp) };
  });
}
function dayRows() {
  if (!state.day) return [];
  return state.day.players.map((p) => {
    const z = zs(p, 1);
    return { p, g: 1, z, value: total(z), q: true };
  });
}

// ---------- formatting ----------
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "–");
const sign = (n) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1);
const pct = (m, a) => (a ? ((m / a) * 100).toFixed(1) : "–");
function stat(row, k, day) {
  const { p, g } = row;
  if (day) {
    if (k === "fgp") return `${p.fgm}-${p.fga}`;
    if (k === "ftp") return `${p.ftm}-${p.fta}`;
    return String(p[k]);
  }
  if (k === "fgp") return pct(p.fgm, p.fga);
  if (k === "ftp") return pct(p.ftm, p.fta);
  return f1(p[k] / g);
}
function dayLabel(ymd, long) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric", ...(long ? { year: "numeric" } : {}) });
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.round(hr / 24)} d ago`;
}
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function headshot(p, cls) {
  const img = h("img", { src: p.img || "", alt: "", loading: "lazy", class: cls });
  img.addEventListener("error", () => { img.style.visibility = "hidden"; });
  if (!p.img) img.style.visibility = "hidden";
  return img;
}

// ---------- top-10 cards ----------
function card(row, rank, day) {
  const { p } = row;
  const lines = day
    ? [["pts", "PTS"], ["reb", "REB"], ["ast", "AST"]].map(([k, l]) => [String(p[k]), l])
    : [["pts", "PTS"], ["reb", "REB"], ["ast", "AST"]].map(([k, l]) => [f1(p[k] / row.g), l]);
  const rest = [
    ["stl", "STL"], ["blk", "BLK"], ["tpm", "3PM"],
  ].map(([k, l]) => `${stat(row, k, day)} ${l}`);
  rest.push(`${stat(row, "fgp", day)}${day ? "" : "%"} FG`, `${stat(row, "ftp", day)}${day ? "" : "%"} FT`, `${stat(row, "tov", day)} TO`);
  return h("article", { class: "card" + (rank === 1 ? " first" : "") },
    h("div", { class: "rk", text: `#${rank}` }),
    headshot(p, "shot"),
    h("div", { class: "nm", text: p.name }),
    h("div", { class: "tm", text: [p.team, p.pos].filter(Boolean).join(" · ") + (day ? ` · ${Math.round(p.min)} min` : ` · ${p.gp} GP`) }),
    h("div", { class: "big" }, lines.map(([v, l]) => h("div", {}, v, h("small", { text: l })))),
    h("div", { class: "rest", text: rest.join("  ·  ") }),
    h("div", { class: "val" }, "Value", h("b", { text: sign(row.value) })),
  );
}

function renderTop() {
  const day = dayRows().sort((a, b) => b.value - a.value).slice(0, 10);
  const box = $("top-day");
  box.replaceChildren(...(day.length ? day.map((r, i) => card(r, i + 1, true)) : [h("div", { class: "empty", text: "No games with stats yet." })]));
  if (box.firstChild && !day.length) box.className = "";
  else box.className = "cards";
  $("today-title").textContent = state.dayDate ? `Top 10 · ${dayLabel(state.dayDate)}` : "Top 10 of the day";
  $("today-sub").textContent = state.day
    ? `${state.day.games.length} game${state.day.games.length === 1 ? "" : "s"}${state.day.live ? ", still in progress. Updates through the night." : "."} Each line is judged against a typical regular's game this season.`
    : "";

  const s = seasonRows().filter((r) => r.q).sort((a, b) => b.value - a.value).slice(0, 10);
  $("top-season").replaceChildren(...s.map((r, i) => card(r, i + 1, false)));
  $("season-sub").textContent = state.season ? `${state.season.season} regular season, per-game averages through ${state.base.maxGp} games for the busiest team.` : "";
}

// ---------- tables ----------
function heat(z, td) {
  const a = Math.min(Math.abs(z) / 3, 1) * 0.34;
  if (a < 0.03) return;
  td.classList.add("heat");
  td.style.setProperty("--tint", `rgba(var(--${z > 0 ? "pos" : "neg"}), ${a.toFixed(3)})`);
}

function starBtn(id) {
  const on = state.watch.includes(id);
  return h("button", {
    class: "star" + (on ? " on" : ""), type: "button", "aria-label": on ? "Remove from my players" : "Add to my players", title: on ? "Remove from my players" : "Add to my players",
    text: on ? "★" : "☆",
    onclick: () => toggleWatch(id),
  });
}

function playerCell(p) {
  return h("td", { class: "l" }, h("div", { class: "pl" }, headshot(p), h("div", {}, h("b", { text: p.name }), h("small", { text: [p.team, p.pos].filter(Boolean).join(" · ") }))));
}

function sortVal(row, key, day) {
  const p = row.p;
  switch (key) {
    case "name": return p.name;
    case "team": return p.team;
    case "gp": return p.gp ?? 1;
    case "min": return day ? p.min : p.min / p.gp;
    case "z": return row.value;
    default: {
      const c = CATS.find((x) => x.k === key);
      if (!c) return 0;
      const v = day && !c.imp ? p[key] : c.f(p, row.g);
      return v == null ? -Infinity : v;
    }
  }
}

function renderTable() {
  const day = state.tab === "day";
  let rows = day ? dayRows() : seasonRows();
  const qn = norm(state.q.trim());
  if (!day && !state.few) rows = rows.filter((r) => r.q);
  // Rank is by value among the listed (qualified) rows, independent of the current sort.
  const ranked = [...rows].sort((a, b) => b.value - a.value);
  const rankOf = new Map(ranked.map((r, i) => [r.p.id, i + 1]));
  if (qn) rows = rows.filter((r) => norm(`${r.p.name} ${r.p.team}`).includes(qn));
  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const x = sortVal(a, key, day), y = sortVal(b, key, day);
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (c || b.value - a.value) * dir;
  });

  $("few-wrap").hidden = day;
  const cols = [
    { key: "rank", l: "#", sortable: false },
    { key: "name", l: "Player", left: true },
    ...(day ? [{ key: "min", l: "MIN" }] : [{ key: "gp", l: "GP" }, { key: "min", l: "MPG" }]),
    ...CATS.map((c) => ({ key: c.k, l: c.l, off: !state.cats.has(c.k) })),
    { key: "z", l: "Value" },
    { key: "star", l: "", sortable: false },
  ];
  const thead = h("thead", {}, h("tr", {}, cols.map((c) => {
    const th = h("th", { class: c.left ? "l" : "", scope: "col", "aria-sort": c.key === key ? (dir > 0 ? "ascending" : "descending") : null, text: c.l });
    if (c.sortable !== false) th.addEventListener("click", () => {
      state.sort = { key: c.key, dir: state.sort.key === c.key ? -state.sort.dir : (c.key === "name" || c.key === "team" || c.key === "tov" ? 1 : -1) };
      renderTable();
    });
    if (c.off) th.style.opacity = ".45";
    return th;
  })));
  const body = h("tbody", {});
  const MAX = 300;
  for (const r of rows.slice(0, MAX)) {
    const p = r.p;
    body.append(h("tr", {},
      h("td", { class: "rk", text: rankOf.get(p.id) ?? "–" }),
      playerCell(p),
      day ? h("td", { text: String(Math.round(p.min)) }) : [h("td", { text: String(p.gp) }), h("td", { text: f1(p.min / p.gp) })],
      CATS.map((c) => { const td = h("td", { text: stat(r, c.k, day) }); if (state.cats.has(c.k)) heat(r.z[c.k], td); return td; }),
      h("td", { class: "val", text: sign(r.value) }),
      h("td", {}, starBtn(p.id)),
    ));
  }
  if (!rows.length) body.append(h("tr", {}, h("td", { colspan: cols.length, text: day ? "No stats for this day yet." : "No players match.", class: "muted" })));
  $("table").replaceChildren(thead, body);
}

// ---------- my players ----------
function renderMine() {
  const box = $("mine-body");
  if (!state.watch.length) {
    box.replaceChildren(h("div", { class: "empty", text: "No players yet. Search above, or tap ☆ next to any player in the tables below." }));
    return;
  }
  const sRows = seasonRows();
  const qRank = new Map(sRows.filter((r) => r.q).sort((a, b) => b.value - a.value).map((r, i) => [r.p.id, i + 1]));
  const sBy = new Map(sRows.map((r) => [r.p.id, r]));
  const dBy = new Map(dayRows().map((r) => [r.p.id, r]));
  const ids = state.watch.filter((id) => sBy.has(id) || dBy.has(id));

  const mk = (title, items, day) => {
    const cols = [
      { l: "Player", left: true }, ...(day ? [{ l: "MIN" }] : [{ l: "GP" }, { l: "MPG" }, { l: "Rank" }]),
      ...CATS.map((c) => ({ l: c.l, off: !state.cats.has(c.k) })), { l: "Value" }, { l: "" },
    ];
    const head = h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.left ? "l" : "", style: c.off ? "opacity:.45" : null, text: c.l }))));
    const body = h("tbody", {}, items.map(({ id, r }) => {
      const p = r.p;
      return h("tr", {},
        playerCell(p),
        day ? h("td", { text: String(Math.round(p.min)) }) : [h("td", { text: String(p.gp) }), h("td", { text: f1(p.min / p.gp) }), h("td", { text: qRank.get(id) ? `#${qRank.get(id)}` : "–" })],
        CATS.map((c) => { const td = h("td", { text: stat(r, c.k, day) }); if (state.cats.has(c.k)) heat(r.z[c.k], td); return td; }),
        h("td", { class: "val", text: sign(r.value) }),
        h("td", {}, h("button", { class: "rm", type: "button", text: "Remove", onclick: () => toggleWatch(id) })),
      );
    }));
    return [h("h3", { class: "sec-label", text: title }), h("div", { class: "table-wrap" }, h("table", {}, head, body))];
  };

  const dayItems = ids.filter((id) => dBy.has(id)).map((id) => ({ id, r: dBy.get(id) })).sort((a, b) => b.r.value - a.r.value);
  const seasonItems = ids.filter((id) => sBy.has(id)).map((id) => ({ id, r: sBy.get(id) })).sort((a, b) => b.r.value - a.r.value);
  const idle = ids.filter((id) => !dBy.has(id)).map((id) => (sBy.get(id) || dBy.get(id)).p.name);
  const out = [];
  if (dayItems.length) out.push(...mk(`${dayLabel(state.dayDate)}`, dayItems, true));
  else if (state.dayDate) out.push(h("h3", { class: "sec-label", text: dayLabel(state.dayDate) }), h("p", { class: "muted", text: "None of your players played on this day." }));
  if (dayItems.length && idle.length) out.push(h("p", { class: "muted", text: `Did not play: ${idle.join(", ")}.` }));
  if (seasonItems.length) out.push(...mk("Season averages", seasonItems, false));
  box.replaceChildren(...out);
}

function toggleWatch(id) {
  const i = state.watch.indexOf(id);
  if (i >= 0) state.watch.splice(i, 1); else state.watch.push(id);
  store.set("nbs-watch", state.watch);
  renderMine();
  renderTable();
}

// ---------- search to add ----------
function setupFinder() {
  const input = $("find"), list = $("find-list");
  let results = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const paint = () => {
    list.replaceChildren(...results.map((p, i) => h("li", { role: "option", "aria-selected": i === active ? "true" : "false", onmousedown: (e) => { e.preventDefault(); pick(p); } },
      p.name, h("span", { text: [p.team, p.pos].filter(Boolean).join(" · ") }))));
  };
  const pick = (p) => {
    if (!state.watch.includes(p.id)) toggleWatch(p.id);
    input.value = ""; close();
  };
  input.addEventListener("input", () => {
    const q = norm(input.value.trim());
    if (!q) return close();
    const pool = new Map();
    for (const p of [...(state.season?.players ?? []), ...(state.day?.players ?? [])]) if (!pool.has(p.id)) pool.set(p.id, p);
    results = [...pool.values()].filter((p) => !state.watch.includes(p.id) && norm(p.name).includes(q))
      .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name)).slice(0, 8);
    active = results.length ? 0 : -1;
    list.hidden = !results.length; input.setAttribute("aria-expanded", String(!!results.length));
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = (active + 1) % results.length; paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + results.length) % results.length; paint(); e.preventDefault(); }
    else if (e.key === "Enter" && results[active]) { pick(results[active]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", close);
}

// ---------- header, games strip, categories ----------
function renderGames() {
  const box = $("games");
  if (!state.day) return box.replaceChildren();
  box.replaceChildren(...state.day.games.map((g) => {
    const aw = g.away.score > g.home.score, hw = g.home.score > g.away.score, over = g.state === "post";
    return h("div", { class: "game" },
      h("div", { class: "row" + (over && aw ? " win" : "") }, g.away.abbr, h("b", { text: String(g.away.score) })),
      h("div", { class: "row" + (over && hw ? " win" : "") }, g.home.abbr, h("b", { text: String(g.home.score) })),
      h("div", { class: "st" + (g.state === "in" ? " live" : ""), text: g.status }),
    );
  }));
}

function renderPicker() {
  const days = state.index?.days ?? [];
  const sel = $("day-select");
  sel.replaceChildren(...days.map((d) => h("option", { value: d, text: dayLabel(d, true), selected: d === state.dayDate })));
  const i = days.indexOf(state.dayDate);
  $("prev").disabled = i < 0 || i >= days.length - 1;
  $("next").disabled = i <= 0;
  $("stamp").textContent = state.index ? `Updated ${ago(state.index.updated)}` : "";
  $("season-label").textContent = state.season ? `${state.season.season} season` : "NBA";
}

function renderChips() {
  $("chips").replaceChildren(...CATS.map((c) => h("button", {
    class: "chip", type: "button", "aria-pressed": String(state.cats.has(c.k)), text: c.l,
    onclick: () => {
      if (state.cats.has(c.k) && state.cats.size === 1) return; // keep at least one
      state.cats.has(c.k) ? state.cats.delete(c.k) : state.cats.add(c.k);
      store.set("nbs-cats", [...state.cats]);
      renderChips(); renderAll();
    },
  })));
}

function renderAll() {
  renderTop(); renderMine(); renderTable();
}

// ---------- loading ----------
async function getJSON(path) {
  const r = await fetch(`${path}?t=${Math.floor(Date.now() / 60000)}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function loadDay(date) {
  state.dayDate = date;
  state.day = date ? await getJSON(`data/days/${date}.json`).catch(() => null) : null;
  renderPicker(); renderGames(); renderAll();
}

async function load(first) {
  const [index, season] = await Promise.all([
    getJSON("data/index.json").catch(() => null),
    getJSON("data/season.json").catch(() => null),
  ]);
  state.index = index; state.season = season;
  if (season) state.base = computeBase(season.players);
  if (!season) {
    document.querySelector(".hero .sub").textContent = "No data yet. Run the “Update NBA stats” workflow once to create it.";
    return;
  }
  const keep = !first && index?.days.includes(state.dayDate) ? state.dayDate : null;
  await loadDay(keep || index?.latest || null);
}

function setup() {
  renderChips(); setupFinder();
  $("day-select").addEventListener("change", (e) => loadDay(e.target.value));
  $("prev").addEventListener("click", () => { const d = state.index.days; loadDay(d[d.indexOf(state.dayDate) + 1]); });
  $("next").addEventListener("click", () => { const d = state.index.days; loadDay(d[d.indexOf(state.dayDate) - 1]); });
  const seg = (tab) => {
    state.tab = tab;
    state.sort = { key: "z", dir: -1 };
    $("tab-day").setAttribute("aria-selected", String(tab === "day"));
    $("tab-season").setAttribute("aria-selected", String(tab === "season"));
    renderTable();
  };
  $("tab-day").addEventListener("click", () => seg("day"));
  $("tab-season").addEventListener("click", () => seg("season"));
  $("q").addEventListener("input", (e) => { state.q = e.target.value; renderTable(); });
  $("few").addEventListener("change", (e) => { state.few = e.target.checked; renderTable(); });

  // Theme: auto -> light -> dark.
  $("theme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || "auto";
    const next = { auto: "light", light: "dark", dark: "auto" }[cur];
    if (next === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    try { next === "auto" ? localStorage.removeItem("nbs-theme") : localStorage.setItem("nbs-theme", next); } catch { /* ignore */ }
    $("theme").title = `Theme: ${next}`;
  });

  // Refresh data every few minutes while the tab is visible.
  setInterval(() => { if (!document.hidden) load(false).catch(() => {}); }, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.index && Date.now() - new Date(state.index.updated) > 5 * 60 * 1000) load(false).catch(() => {}); });
}

setup();
load(true).catch((e) => {
  console.error(e);
  document.querySelector(".hero .sub").textContent = "Could not load the stats data.";
});
