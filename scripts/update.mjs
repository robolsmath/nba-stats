// Fetches NBA box scores (per day) and season totals from ESPN's public JSON feed
// and writes small static files under data/ for the web page to read.
//
//   node scripts/update.mjs                  # refresh yesterday + today (US Eastern) and season totals
//   node scripts/update.mjs --since 2026-10-20   # also backfill every day from that date
//   node scripts/update.mjs --no-season      # skip the season totals request
//
// No dependencies; needs Node 18+ (global fetch).

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const DAYS = join(DATA, "days");
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";
const UA = "Mozilla/5.0 (compatible; nba-stats-page/1.0)";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

async function getJSON(url, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${err.message}`);
}

// ---- dates (US Eastern, which is how NBA game days are defined) -------------------------------
function etDate(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p; // YYYY-MM-DD
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function range(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---- helpers -----------------------------------------------------------------------------------
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const split = (v) => {
  const [a, b] = String(v ?? "0-0").split("-");
  return [num(a), num(b)];
};
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ---- one day -----------------------------------------------------------------------------------
async function buildDay(date) {
  const sb = await getJSON(`${SITE}/scoreboard?dates=${date.replaceAll("-", "")}&limit=50`);
  const season = sb.leagues?.[0]?.season ?? null;
  const events = (sb.events ?? []).filter((e) => e.season?.type !== 1); // drop preseason
  const started = events.filter((e) => e.status?.type?.state !== "pre");
  if (!started.length) return { day: null, season };

  const games = [];
  const players = [];
  await pool(started, 4, async (ev) => {
    const comp = ev.competitions[0];
    const state = ev.status.type.state; // in | post
    const teams = {};
    for (const c of comp.competitors) teams[c.homeAway] = { abbr: c.team.abbreviation, score: num(c.score) };
    games.push({
      id: ev.id,
      home: teams.home,
      away: teams.away,
      state,
      status: ev.status.type.shortDetail,
    });
    const sum = await getJSON(`${SITE}/summary?event=${ev.id}`);
    for (const t of sum.boxscore?.players ?? []) {
      const block = t.statistics?.[0];
      if (!block) continue;
      const k = Object.fromEntries(block.keys.map((key, i) => [key, i]));
      for (const a of block.athletes ?? []) {
        if (a.didNotPlay || !a.stats?.length) continue;
        const s = a.stats;
        const min = num(s[k.minutes]);
        if (!min) continue;
        const [fgm, fga] = split(s[k["fieldGoalsMade-fieldGoalsAttempted"]]);
        const [tpm, tpa] = split(s[k["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]]);
        const [ftm, fta] = split(s[k["freeThrowsMade-freeThrowsAttempted"]]);
        players.push({
          id: a.athlete.id,
          name: a.athlete.displayName,
          team: t.team.abbreviation,
          pos: a.athlete.position?.abbreviation ?? "",
          img: a.athlete.headshot?.href ?? "",
          game: ev.id,
          min, pts: num(s[k.points]), reb: num(s[k.rebounds]), ast: num(s[k.assists]),
          stl: num(s[k.steals]), blk: num(s[k.blocks]), tov: num(s[k.turnovers]),
          fgm, fga, tpm, tpa, ftm, fta, pm: num(s[k.plusMinus]),
        });
      }
    }
  });
  games.sort((a, b) => a.id.localeCompare(b.id));
  return {
    day: { date, updated: new Date().toISOString(), live: games.some((g) => g.state === "in"), games, players },
    season,
  };
}

// ---- season totals -----------------------------------------------------------------------------
async function buildSeason(seasonYear) {
  const url = `${WEB}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page=1&limit=1000&season=${seasonYear}&seasontype=2`;
  const j = await getJSON(url);
  const players = [];
  const namesBy = Object.fromEntries((j.categories ?? []).map((c) => [c.name, c.names]));
  for (const row of j.athletes ?? []) {
    const t = {};
    // Names live once at the top level; each row only carries the matching arrays of totals.
    for (const c of row.categories ?? []) {
      const names = namesBy[c.name] ?? [];
      names.forEach((n, i) => { t[n] = num(c.totals?.[i]); });
    }
    const a = row.athlete;
    if (!t.gamesPlayed) continue;
    players.push({
      id: a.id,
      name: a.displayName,
      team: a.teamShortName ?? "",
      pos: a.position?.abbreviation ?? "",
      img: a.headshot?.href ?? "",
      gp: t.gamesPlayed, min: t.minutes, pts: t.points, reb: t.rebounds, ast: t.assists,
      stl: t.steals, blk: t.blocks, tov: t.turnovers,
      fgm: t.fieldGoalsMade, fga: t.fieldGoalsAttempted,
      tpm: t.threePointFieldGoalsMade, tpa: t.threePointFieldGoalsAttempted,
      ftm: t.freeThrowsMade, fta: t.freeThrowsAttempted,
    });
  }
  return { season: `${seasonYear - 1}-${String(seasonYear).slice(2)}`, updated: new Date().toISOString(), players };
}

// ---- main --------------------------------------------------------------------------------------
async function main() {
  await mkdir(DAYS, { recursive: true });
  const today = etDate();
  const since = opt("--since");
  const from = since && since < addDays(today, -1) ? since : addDays(today, -1);
  const dates = range(from, today);

  let seasonInfo = null;
  let wrote = 0;
  for (const date of dates) {
    const file = join(DAYS, `${date}.json`);
    // Past days that are already complete never change; only (re)fetch recent ones.
    if (date < addDays(today, -2) && existsSync(file)) {
      const old = JSON.parse(await readFile(file, "utf8"));
      if (!old.live) continue;
    }
    const { day, season } = await buildDay(date);
    if (season) seasonInfo = season;
    if (!day) continue;
    await writeFile(file, JSON.stringify(day));
    wrote++;
    console.log(`${date}: ${day.games.length} games, ${day.players.length} player lines${day.live ? " (live)" : ""}`);
  }

  // Season totals.
  if (!flag("--no-season")) {
    let year = seasonInfo?.year;
    if (!year) {
      const sb = await getJSON(`${SITE}/scoreboard`);
      year = sb.leagues?.[0]?.season?.year;
    }
    const season = await buildSeason(year);
    if (season.players.length) {
      await writeFile(join(DATA, "season.json"), JSON.stringify(season));
      console.log(`season ${season.season}: ${season.players.length} players`);
    } else {
      console.log("season: no players returned, keeping previous file");
    }
  }

  // Index of available days.
  const files = (await readdir(DAYS)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort().reverse();
  const index = { updated: new Date().toISOString(), latest: files[0] ?? null, days: files };
  await writeFile(join(DATA, "index.json"), JSON.stringify(index));
  console.log(`index: ${files.length} days, latest ${index.latest}; wrote ${wrote} day file(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
