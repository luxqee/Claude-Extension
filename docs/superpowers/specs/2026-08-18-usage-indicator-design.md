# Personal Usage Indicator Design

Date: 2026-08-18
Status: Approved

## Context

Part of the same Stage 2 exploration that produced the Phase 2 login/team
storage design (`2026-08-18-phase2-login-team-storage-design.md`). This
piece — a personal usage meter in the sidebar — was fully designed and
approved earlier in that same conversation, including live verification
against claude.ai's actual internal usage endpoint, but was never written
up as its own spec. It's independent of login/backend work (no account,
no server, purely client-side), so it's being folded into the same
implementation wave as Phase 2 rather than sequenced separately, per the
user's request to build both together.

## Goal

Show the signed-in claude.ai user their own usage (session, weekly, and
pay-as-you-go spend where applicable) directly in the sidebar, without
consuming any tokens to check it and without any new permissions.

## How the data is obtained

claude.ai's own web app calls `GET /api/organizations/{org_id}/usage` to
power its own usage warnings. This was verified directly against a real
account:

- **Auth**: cookie-based only. A bare `fetch(url, { credentials: 'include' })` — no custom headers — returns the same data claude.ai's own JS gets. No extra headers need to be faked.
- **Org id**: available without a separate lookup — it's already present in the `lastActiveOrg` cookie on `claude.ai`.
- **No new permissions needed**: `https://claude.ai/*` is already in this extension's `host_permissions`.
- **No token cost**: this is an account-metadata read, not a model call.

Example real response shape (fields not used by this design, like the
internal-codename buckets, are omitted from the excerpt but exist in the
real payload and must be ignored, not parsed):

```json
{
  "limits": [
    { "kind": "session", "percent": 13, "severity": "normal", "resets_at": "2026-08-18T14:10:00Z" },
    { "kind": "weekly_all", "percent": 25, "severity": "normal", "resets_at": "2026-08-19T23:00:00Z" }
  ],
  "spend": {
    "enabled": true,
    "percent": 73,
    "severity": "normal",
    "used": { "amount_minor": 2929, "currency": "AUD", "exponent": 2 },
    "limit": { "amount_minor": 4000, "currency": "AUD", "exponent": 2 }
  }
}
```

This is undocumented and internal — not an officially supported API. It
could change without notice. This design treats it as best-effort,
supplementary data, never load-bearing (see Error handling).

## Data model

```ts
// src/shared/usage.ts
export interface UsageMeter {
  label: string           // 'Session', 'Weekly', 'Extra usage'
  percent: number
  severity: string        // passed through from the API as-is, not recomputed
  resetsAt: string | null
}

export interface UsageSnapshot {
  meters: UsageMeter[]
}

export function parseUsageResponse(raw: unknown): UsageSnapshot
```

`parseUsageResponse` builds its meter list from the response's `limits[]`
array (mapping `kind: 'session'` → "Session", `kind: 'weekly_all'` →
"Weekly"), plus a synthesized "Extra usage" meter from `spend` **only**
when `spend.enabled` is `true` — not every account has pay-as-you-go on.
Every other field in the raw response (the internal-codename buckets) is
ignored. Severity is passed straight through from whatever the API
assigns per meter — Anthropic's own judgment of what counts as
"normal" vs. a warning state is trusted rather than recomputed from raw
percentages (verified directly: a real account's spend meter at 73%
was still reported `severity: "normal"`).

## Message architecture

Mirrors the existing `INSERT_PROMPT` pattern in `src/shared/messages.ts`:

```ts
export interface GetUsageRequest { type: 'GET_USAGE' }
export type GetUsageResponse = { ok: true; usage: UsageSnapshot } | { ok: false }
```

The sidepanel sends `GET_USAGE` via `chrome.tabs.sendMessage` to the
active claude.ai tab; the content script fetches the endpoint, calls
`parseUsageResponse`, and replies. Same request/response shape and same
call site pattern already used for prompt insertion.

## UI

Two states of the same design, chosen after reviewing mockups:

**Expanded (normal sidebar width):** a card above the button list, same
visual language as a button row (`--surface-card`, `--border`, 8px
radius) — one thin progress bar per meter, with its label and
percentage, colored by the meter's severity.

**Collapsed (squished/icon-rail sidebar mode):** the same meters render
as compact ring gauges (SVG circles, `stroke-dasharray` proportional to
percent) stacked vertically, colored the same way. This state also
covers the button list collapsing to icon-only and an expand control —
see the mockup at the artifact published during design for the full
layout (refresh icon, rings, expand button, button icons, account
avatar placeholder — the avatar itself belongs to the login phase, not
this one, and stays a non-functional placeholder here).

Severity color mapping (both states): `severity: "normal"` →
`--success`, an unrecognized/other value → `--warning` (new token, since
none currently exists in `style.css`), reserving `--danger` for whatever
Anthropic's API considers most severe if a non-"normal"/"warning" value
is ever observed. This hasn't been verified against a real over-limit
account — the mapping is a reasonable default, not confirmed against
every possible value.

## Refresh cadence

Fetched once when the sidebar loads, and again immediately after any
button finishes running (a button run is a real usage event, so it's a
natural moment to refresh).

## Error handling

No skeleton/loading state, no error card. The usage card/rings simply
don't render until the first fetch succeeds, and disappear (or never
appear) if it fails. This data is supplementary — a failure here must
never be visible the way a failed button run is, and must never block
or affect any other part of the sidebar.

## Testing

`parseUsageResponse` is pure and gets full TDD coverage in
`tests/shared/usage.test.ts`, matching the existing pattern for
`storage`/`tool-service`/`backup`. The card/ring rendering and the
content script's fetch wiring are manual-verification-only, consistent
with every other UI piece in this project.
