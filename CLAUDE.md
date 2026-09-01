# Competitive Intelligence Agent

## What this is
A Next.js app that uses Solari (managed browser) to autonomously research a competitor
and produce a structured teardown report. The synthesis step is bring-your-own-key:
the user picks Claude, OpenAI, or Gemini and supplies their own API key.

## Stack
- Next.js 16 (App Router, Turbopack)
- TypeScript, strict mode
- Solari SDK: `@solarisdk/browser`
- Model SDKs: `@anthropic-ai/sdk`, `openai`, `@google/genai`
- Tailwind CSS v4
- Server-Sent Events (SSE) for live status streaming

## Routes
- `/` — full-viewport landing: background video, hero, competitor URL field
- `/replay/[id]` — rrweb playback of the recorded browser session
- `/settings` — provider, API key, and model picker (bring-your-own-key)
- `/report/[id]` — live agent feed, then the teardown

## UI
- One visual language everywhere: the same CloudFront background video, the
  Reference Sans/Display faces, and glass panels (`.glass`, `.glass-soft`,
  `.glass-bar` in `globals.css`).
- The landing is a fixed, non-scrolling composition (`app/vantage.css`); it adds
  `.vantage-lock` to `<html>` while mounted and removes it on unmount.
- `body` is transparent and `html` is black so the fixed `.backdrop-layer`
  (z-index -3) shows through on the scrolling surfaces.
- Font files go in `public/fonts/`; the stack falls back to Geist if absent.

## Architecture
- User sets a provider + key on `/settings`, then submits a URL from the hero
- `POST /api/run` validates, kicks off the agent, returns a run ID (202)
- Client watches `/api/status/[id]` over SSE for live updates
- Agent scrapes: homepage, /pricing, /about, web search, ProductHunt; and pulls
  Hacker News + GitHub over plain HTTPS
- Raw data goes to the chosen model for synthesis under a fixed JSON schema
- Structured report stored in memory (Map), rendered on `/report/[id]`

## Bring-your-own-key
The app ships **no** model credentials. `SOLARI_API_KEY` is the only server-side
secret (it pays for the browsing). A user's model key:
- arrives in the `POST /api/run` body,
- is held only in the in-flight closure,
- is **never** written to the run record, the event log, or any response,
- is kept client-side in that tab's `sessionStorage` only.

`POST /api/models` lists the models a key can use, which doubles as key validation
before a run starts — so the model picker always shows real, current model IDs
rather than hard-coded ones that go stale.

## Solari usage
- `@solarisdk/browser` for all page loads and search.
- **Launch with `stealth: true`.** This is not optional: from a plain datacenter
  egress, Google serves an "unusual traffic" interstitial, DuckDuckGo and Brave
  serve captchas, Mojeek 403s, Startpage hard-blocks, and Bing returns HTTP 200
  with an identical canned SERP for *every* query. With stealth on, DuckDuckGo
  answers correctly. The launch falls back to non-stealth on `FeatureRequiresPlan`.
- `probeTimeoutMs: 8000` — the 2s default times out on a cold session.
- **Launch with `recording: true`** for session replay. `BrowserSession.close()`
  already does a `releaseAndWait`, but the recording is only queryable ~1-3s
  after release, so `captureReplay()` polls up to 5 times.
- Capture the session id from `browser.id` **before** `close()`.
- Images, media, and fonts are aborted at the route level; we never read them.
- Avoid LinkedIn/G2.

## Session replay
Every run is recorded. The replay link is captured in `withBrowser`'s `finally`
block and handed back through an `onReplay` callback rather than the return
value — the session is only released after `fn` has returned, and routing it
through a callback means a **failed** run still gets a replay, which is when it
is most useful.

Two things the Solari API does that the UI has to work around:
- `getReplayUrl` returns a presigned S3 URL with `expiresInSeconds: 900` — a
  15-minute lifetime, far shorter than the retention window. So the button
  points at `GET /api/replay/[id]`, which mints a fresh URL at click time and
  307s to it. Never store the presigned URL in a link.
- The artefact is `*.ndjson.gz` — a gzipped **rrweb event log** (`{"type":4,…}`
  Meta, then FullSnapshot/IncrementalSnapshot), not a video, so it cannot be
  played by a `<video>` tag. `/replay/[id]` mounts `rrweb-player`, fed by
  `GET /api/replay/[id]/events` which mints a URL, gunzips, and returns JSON.
  Proxied because the bucket sends no CORS headers. One Meta+FullSnapshot pair
  appears per page the agent opened (~15 for a normal run).

## Sources (in order)
1. Homepage — one navigation yields text, asset fingerprints, and the link graph
2. /pricing + /about, discovered from the homepage links, in parallel
3. Web search: "{company} reviews" / "funding" / "news"
4. ProductHunt, via a host-filtered search
5. Hacker News (Algolia API) — dated, scored, and never bot-blocked
6. GitHub org, detected from the homepage's external links

Every search result must mention the company or host to be kept. A search engine
that answers a blocked query with a generic SERP is treated as a failure — a
silently wrong result set is worse than a blocked one.

## Demo mode
`POST /api/run` with `{ demo: true }` replays `demo-fixtures/<host>.json` instead
of browsing — no credentials, ~14s, deterministic. `scheduleReplay` preserves the
original gaps between events and compresses the whole run into `DEMO_REPLAY_MS`.

**Fixtures are only ever written by `captureFixture` on a successful live run**,
so a replay is real captured output rather than authored content. Never
hand-write one: the point is that the demo shows what the agent actually
produced. Replayed runs carry `demo: true` on the record and render a "cached
run" badge.

The rrweb recording is downloaded at capture time to
`demo-fixtures/<host>.replay.ndjson.gz` — Solari's presigned URL expires in 900s
and the recording is retained about a day, so a demo cannot rely on it.
`/api/replay/[id]/events` branches on `run.demo` and serves from disk.
`POST /api/demo/capture { runId }` backfills a completed run.

## Token budget
The dossier is deliberately small — a teardown does not get better by feeding
the model footer boilerplate.
- `MAX_PAGE_TEXT` 2,600 chars/page. Marketing pages front-load their substance.
- 5 search results per query, 180-char snippets, 6 Hacker News hits, 5 repos.
- `MAX_OUTPUT_TOKENS` 6,000. **This one matters for rate limits:** OpenAI counts
  `max_tokens` against tokens-per-minute as a *reservation*, so the old 16k
  ceiling plus a ~9k dossier burned ~26k TPM per call and tripped a 429 on lower
  tiers before a single token was generated.

Measured worst case: dossier 34,586 chars (~8.6k tokens) → 15,514 (~3.9k), a 55%
cut. Per-call TPM ~26.6k → ~11.9k. The live feed prints the estimate before each
call, so cost is visible rather than guessed.

## Timeouts — three layers, and they are not interchangeable
1. **Navigation** (`NAV_TIMEOUT_MS` 15s, search pages 8s) — bounds one page load.
2. **Phase deadlines** (`withDeadline`) — bound a group of pages. Their
   rejections must always be **caught**; letting one propagate reaches
   `withBrowser`'s `finally`, which closes the browser out from under in-flight
   pages and surfaces a meaningless "Browser closed" error.
3. **Hard watchdog** (`hardDeadline` in `/api/run`, `RUN_TIMEOUT_MS + 15s`) —
   races the whole agent. Necessary because Playwright ignores `AbortSignal`
   entirely, so without it a wedged browser call leaves the run "running"
   forever and blocks every later run behind the one-at-a-time guard.

## Model prompts
- Shared across all three providers in `lib/prompt.ts`
- System prompt: "You are a product analyst producing competitive teardowns"
- Fixed JSON keys: positioning, pricing, techStack, complaints, recentMoves,
  opportunities (plus company, headline, confidence, gaps)
- Enforced with structured output: Anthropic `output_config.format`, OpenAI
  `response_format.json_schema`, Gemini `responseJsonSchema`
- Gemini rejects `additionalProperties`/`maxItems`, so `toGeminiSchema()` strips
  them rather than maintaining a second schema

## Environment variables
```
SOLARI_API_KEY=slr_live_...
```
That is the only one. Model keys come from the user at runtime.

## Code style
- TypeScript strict mode
- Async/await throughout, no callbacks
- Error boundaries on the report page
- Stream status updates via SSE, not polling
- `agent.ts`, `prompt.ts`, and the provider adapters are pure — no store access,
  no logging; the agent takes an injected `emit` sink
- `lib/providers.ts` holds provider metadata with **no SDK imports** so client
  components can use it without pulling server SDKs into the browser bundle
- `next.config.ts` marks `@solarisdk/browser` and `patchright-core` as
  `serverExternalPackages` — they cannot be bundled

## What makes this stand out
- Live agent status feed (watch it work in real time)
- Honest sourcing: failed sources are shown, not hidden, and the report carries
  a confidence level plus an explicit "not established" list
- Bring-your-own-key across three providers, with live model discovery
- Fast: collection runs ~20s; whole run capped at 90s
