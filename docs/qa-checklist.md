# Manual QA checklist

The sidebar UI, the content script, and everything that touches claude.ai's
live DOM have **no automated coverage** (deliberate — see the README).
Run this pass in a real Chrome before handing a build to testers, and
again after any change to `src/content/`, `src/sidepanel/`, or the
manifest.

Setup: `pnpm run build` (or `node build.mjs`), load `dist/` unpacked,
open a fresh claude.ai tab.

## 1. Install / lifecycle

- [ ] Extension loads with no errors on the `chrome://extensions` card.
- [ ] Card shows ID `fhaeedmmhjjkhnopifppigddjbbmdegh`.
- [ ] Service worker console (Inspect views: service worker) is clean.
- [ ] Toolbar icon opens the side panel on a claude.ai tab.
- [ ] Icon does nothing / panel disabled on a non-claude.ai tab.
- [ ] claude.ai tab console shows `[Claude Tools] content script loaded`.
- [ ] Rebuild + reload the card → panel and content script pick up the new build.

## 2. Personal buttons (no sign-in)

- [ ] Add a **Prompt** button → appears in the list.
- [ ] Add a **Skill** button (e.g. `/summary`) → shows the `/` badge.
- [ ] Click a prompt button → text lands in claude.ai's chat box, **nothing is sent**.
- [ ] Click a skill button → claude.ai's own `/` picker opens.
- [ ] Edit a button → change name, text, type, tab → persists.
- [ ] Delete a button → confirm dialog → row goes.
- [ ] Drag a row by its handle to reorder → order holds after reopening the panel.
- [ ] Focus a row, press Arrow Up / Arrow Down → same reorder.
- [ ] Create a second tab, move a button to it, switch tabs → button follows.
- [ ] Rename a tab; set an emoji by typing it at the start of the name.
- [ ] Delete a non-active tab; confirm the last tab cannot be deleted.
- [ ] Reorder tabs by drag.
- [ ] "Most used" toggle sorts by personal run count.

## 3. Backup

- [ ] Settings → Export → a `.json` file downloads with every button.
- [ ] Import that file → buttons are added (not duplicated away), tabs preserved.
- [ ] Import a hand-broken file (invalid JSON) → clean error, no crash, existing buttons untouched.
- [ ] Import a bare v1 array (no `type`) → entries import as Prompt into "General".

## 4. Persistence

- [ ] Reload the claude.ai tab → buttons, tabs, active tab all survive.
- [ ] Reload the extension → same.
- [ ] Restart Chrome → same.

## 5. Organisation sign-in

- [ ] Settings → sign in (Google, and Clerk if enabled).
- [ ] "Signing in…" spinner shows during the flow.
- [ ] After sign-in: "Checking organisation…" then the correct state.
- [ ] First sign-in at a **company domain** → onboarding screen → create org → you are admin.
- [ ] Second account at the **same domain** → "Waiting for approval from <org>".
- [ ] A `gmail.com` / `outlook.com` account → onboarding, its own separate org (never auto-joins).

## 6. Admin (director)

- [ ] "Manage Organisation" appears in Settings.
- [ ] Approve a pending member → they move to active.
- [ ] Add someone by email → they appear as **Pending** (not active).
- [ ] Promote a member to admin / demote back.
- [ ] The last admin cannot be removed or demoted (button blocked / error).
- [ ] Create / rename / reorder / delete a shared tab.
- [ ] Create / edit / delete a shared prompt; assign it to a tab.
- [ ] Analytics: Prompt runs, Active members, the per-day chart (a single
      day shows as one small bar, **not** a full-width block), Top prompts,
      Per member.
- [ ] Member usage limits section lists snapshots once members report.

## 7. Member / pending

- [ ] Approved member sees the Team section with the org's shared prompts, grouped by tab.
- [ ] Running a team prompt inserts text, **never sends**.
- [ ] Settings shows "Member of <org>." + **Leave organisation**.
- [ ] Pending user sees "Waiting for approval from <org>." + **Cancel request**.
- [ ] **Leave organisation** → confirm → Team section disappears; Settings returns to signed-in-no-org.
- [ ] After leaving, signing in again → onboarding / pending as appropriate.
- [ ] **Cancel request** on a pending state → same, request is withdrawn.

## 8. Usage widget (claude.ai sidebar)

- [ ] Rings appear above the Recents list.
- [ ] Percentages roughly match claude.ai's own usage screen.
- [ ] Refresh button re-fetches.
- [ ] Widget re-appears if claude.ai re-renders its sidebar.

## 9. Sign-out

- [ ] Sign out → Team section and org state clear immediately.
- [ ] Personal buttons still work.
- [ ] Usage reporting stops (no more `POST /api/usage-report` in the network tab).

## 10. Failure handling

- [ ] Run a button with the claude.ai tab on a non-chat page → "reload the tab" message, no crash.
- [ ] Go offline, open the panel → personal buttons work; org section falls back to cache, no crash.
- [ ] Let a Google session token pass 1 hour → next org action silently refreshes or prompts re-sign-in (no stuck spinner).
