# Competitive Intelligence Agent

Drop in a competitor's URL. An agent browses their site and the public web, then a
model of your choosing writes a structured teardown — positioning, pricing, tech
stack, complaints, recent moves, and the gaps you could exploit — while you watch
it work in real time.

Built with Next.js 16, [Solari](https://getsolari.com) for the managed browser, and
your choice of Claude, OpenAI, or Gemini for synthesis.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # add your Solari key
npm run dev
```

Then open http://localhost:3000, add a model API key under **Settings**, and run a
teardown from the hero field.

The hero also has four one-click examples — `vercel.com`, `cal.com`,
`posthog.com`, `supabase.com`. Each was verified end to end: homepage, pricing, and about all
load, the searches return on-topic results, and both Hacker News and GitHub
resolve, so a demo run always has real material. (`linear.app` is deliberately
not among them: its homepage times out and its Hacker News matches are "Linear
Algebra" noise.)

### Demo mode

Clicking an example **replays a saved run** rather than browsing live: no API
key, no quota, ~14 seconds, identical every time. Useful for recording a
walkthrough.

Fixtures are never hand-written. One is created only when a genuine run
completes successfully — `captureFixture` writes the real events and the real
teardown to `demo-fixtures/<host>.json`. So a replay is a *cache of real
output*, not a mock-up, and the report page marks it with a **cached run**
badge. A host with no fixture yet returns a 404 telling you to run it live once;
that first successful run seeds it permanently.

Each fixture is a pair of files:

```
demo-fixtures/vercel.com.json               events + teardown
demo-fixtures/vercel.com.replay.ndjson.gz   the rrweb session recording
```

The recording is downloaded and stored at capture time, so a demo's **watch
agent replay** button keeps working forever — Solari's own copy sits behind a
900-second presigned URL and is retained about a day.

To fill the remaining hosts, run each once with a working key. If a run finished
before capture existed, back it up while it is still in memory:

```bash
curl -X POST localhost:3000/api/demo/capture   -H 'content-type: application/json' -d '{"runId":"<run-id>"}'
# -> {"host":"vercel.com","fixture":true,"recording":true}
```

### Fonts

The UI is designed for two variable faces, **Reference Sans** and **Reference
Display**. Drop `ReferenceSans.woff2` and `ReferenceDisplay.woff2` into
`public/fonts/` to get them; without those files the stack falls through to Geist
and the layout is unaffected.

### Environment

Only one server-side secret:

```
SOLARI_API_KEY=slr_live_...
```

**Model keys are not configured here.** Each user brings their own — pick Claude,
OpenAI, or Gemini in the UI and paste a key. See [Bring your own key](#bring-your-own-key).

---

## How a run works

1. `POST /api/run` validates the URL and the provider credentials, creates a run
   ID, and starts the agent in the background (returns `202` immediately).
2. The client opens an `EventSource` on `/api/status/[id]` and renders each step
   as it happens.
3. The agent collects, in roughly 20 seconds:
   - **Homepage** — a single navigation yields readable text, front-end asset
     fingerprints, and the link graph.
   - **/pricing and /about** — located from the homepage links, fetched in parallel.
   - **Web search** — "{company} reviews", "funding", and "news".
   - **ProductHunt** — via a host-filtered search.
   - **Hacker News** — the public Algolia index: dated, scored, never bot-blocked.
   - **GitHub** — the org detected from the site's outbound links.
4. The dossier goes to the chosen model under a fixed JSON schema.
5. The report renders as section cards, exportable as Markdown.

A run is capped at **90 seconds** by a hard watchdog that races the whole agent —
Playwright ignores `AbortSignal`, so a cooperative cancel alone cannot guarantee
the run ever ends. The browser session is always released. One run at a time,
enforced both client-side and server-side.

### Token cost

The dossier is kept small on purpose: 2,600 chars per page, 5 search results per
query, 6 Hacker News hits. A typical run sends **~2-4k tokens** and caps output at
6,000. The live feed prints the estimate before the call.

If you are on a low OpenAI tier, note that `max_tokens` counts against your
tokens-per-minute budget as a reservation — which is why the output ceiling is
6k and not 16k.

---

## Session replay

Every browser session is recorded (`recording: true`), and the report page has a
**watch agent replay** button next to the Markdown export. Failed runs get one
too — that is when watching what the agent saw matters most.

The button points at `GET /api/replay/[id]` rather than at a stored URL, because
Solari's presigned link lives for only **900 seconds**. The route mints a fresh
one on each click and redirects, so the link keeps working for as long as the
recording is retained.

The recording is not a video. Solari captures an **rrweb event log** — DOM
snapshots plus mutations — so `/replay/[id]` rebuilds the pages in an iframe and
plays them back on a scrubbable timeline. Text stays selectable, and the long
inactive gaps between pages are skipped automatically.

`GET /api/replay/[id]/events` proxies the log: it mints a presigned URL, gunzips
the body, and returns the events as JSON. It is proxied rather than fetched
directly because the S3 bucket serves no CORS headers for our origin.

`GET /api/replay/[id]` still exists and redirects to the raw `.ndjson.gz` for
anyone who wants the log itself.

---

## Bring your own key

The app ships no model credentials. When you start a run, your key:

- travels in the `POST /api/run` body,
- is held only in the in-flight closure for that one call,
- is **never** written to the run record, the event log, or any response body,
- lives client-side in that browser tab's `sessionStorage`, and nowhere else.

"Verify key" calls `POST /api/models`, which lists the models that key can actually
use. That both validates the key and populates the model picker with real, current
model IDs instead of hard-coded ones that go stale.

> Run it over HTTPS if you deploy it. On `http://localhost` the key is fine; over a
> plain-HTTP deployment it would cross the wire in clear text.

---

## Honest sourcing

Competitive research is only useful if you can trust it, so the agent is built to
fail loudly rather than quietly:

- **Every source failure is shown** in the live feed and passed to the model, so a
  blocked page becomes a stated gap rather than an invented fact.
- **Search results must mention the target.** Bing, from a datacenter IP, answers
  blocked queries with HTTP 200 and an identical canned SERP for *every* query. A
  result set where nothing names the company is treated as a failure — a silently
  wrong source is worse than a missing one.
- **Tech-stack signals are detected deterministically** from script, link, and meta
  tags, not guessed by the model.
- **Every report carries a confidence level** and a "not established by this run"
  list.

### On stealth

Solari sessions launch with `stealth: true`. Measured from a plain datacenter
egress: Google serves an "unusual traffic" interstitial, DuckDuckGo and Brave serve
captchas, Mojeek 403s, Startpage hard-blocks, and Bing serves that canned SERP. With
stealth on, DuckDuckGo answers normally. The launch falls back to a non-stealth
session if the plan does not allow it — the run still completes, with the search
phase degraded and marked as such in the feed.

---

## Project layout

```
app/
  page.tsx                  landing (full-viewport hero + competitor URL field)
  settings/page.tsx         bring-your-own-key: provider, key, model
  report/[id]/page.tsx      live agent + results (with error boundary)
  api/run/route.ts          starts a run
  api/status/[id]/route.ts  SSE stream
  api/models/route.ts       model discovery + key validation
lib/
  types.ts       shared types
  solari.ts      browser session, page scraping, fingerprinting, search
  sources.ts     Hacker News + GitHub over plain HTTPS
  prompt.ts      system prompt, JSON schema, dossier rendering (provider-agnostic)
  claude.ts      Anthropic adapter
  openai.ts      OpenAI adapter
  gemini.ts      Gemini adapter
  llm.ts         provider dispatch (server-only)
  providers.ts   provider metadata, no SDK imports (client-safe)
  agent.ts       orchestration
  store.ts       in-memory run store + SSE pub/sub
  markdown.ts    Markdown export
components/
  VantageLanding.tsx   full-viewport landing composition
  VantageBackdrop.tsx  shared background video + vignette
  AppChrome.tsx        header/footer for the working surfaces
  SettingsForm.tsx  ProviderPicker.tsx
  StatusFeed.tsx  TeardownReport.tsx  RunView.tsx
```

The landing owns its layout in `app/vantage.css`; the shared visual language —
fonts, backdrop video, and the glass panels — lives in `app/globals.css` so the
report and settings surfaces match it.

## Notes and limits

- **Stateless by design.** Reports live in a process-local `Map` for one hour and do
  not survive a server restart. No auth, no database.
- `@solarisdk/browser` and `patchright-core` are declared as
  `serverExternalPackages` — they drive a real Chromium and cannot be bundled.
- Single-process only: the in-memory store and the one-run-at-a-time guard assume
  one server instance.

## Scripts

```bash
npm run dev     # dev server
npm run build   # production build
npm run start   # serve the build
npm run lint    # eslint
```
