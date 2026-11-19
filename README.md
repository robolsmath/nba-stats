# NBA Stats

A static page (GitHub Pages) showing the **top 10 NBA players of the day and of the season**, ranked by nine-category fantasy value, plus daily and season stats for the players you follow.

- **Page**: `index.html`, `css/style.css`, `js/app.js`. Vanilla ES modules, no build step, full-width Apple-style layout, light/dark.
- **Data**: `data/` (JSON), written by `scripts/update.mjs` and committed by a scheduled GitHub Action.
- **Source**: ESPN's public JSON feed (scoreboard, box scores, season totals). The NBA's own feeds (`stats.nba.com`, `cdn.nba.com`) block or time out for scripts, so they are not used.

## One-time setup

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. **Settings → Actions → General → Workflow permissions**: *Read and write permissions* (the workflow also declares `contents: write`).
4. The `data/` folder in this repo already holds the 2026-27 season so far. To rebuild or extend it, run the **Update NBA stats** workflow from the Actions tab, optionally with a `since` date to backfill.

The workflow then runs every 20 minutes during US game hours and once in the morning. GitHub can start scheduled runs a few minutes late, and pauses them if the repo has no commits for 60 days (the data commits normally keep it active).

## Run locally

```bash
node scripts/update.mjs                  # refresh yesterday + today (US Eastern) and season totals
node scripts/update.mjs --since 2026-10-20   # backfill from a date
node scripts/serve.mjs                   # preview at http://127.0.0.1:5072
```

Needs Node 18+. No dependencies.

## How "value" works

Value is a nine-category z-score: PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, and TO (lower is better). Each category is compared with the season's per-game mean and spread across *regular* players (at least 40% of the most games played and 15 minutes a game). FG% and FT% are weighted by attempts (made shots minus what an average shooter would make on the same attempts). The same baseline scores a single night and a whole season, so a +10 night means a night as good as a top season-long performer. The category chips on the page switch categories off if your league scores differently; the choice is remembered in the browser.

## Files

| Path | What |
| --- | --- |
| `data/index.json` | List of days with data, latest day, last update time |
| `data/days/YYYY-MM-DD.json` | Games and every player's box-score line for that day |
| `data/season.json` | Season totals for every player |
| `scripts/update.mjs` | Fetches ESPN and writes `data/` |
| `.github/workflows/update.yml` | Schedule that runs the script and commits changes |

Days with no games, and preseason games, are skipped. Completed days older than two days are never re-fetched.
