# Claude Tools Sidebar

A Chrome extension that adds a sidebar of configurable buttons to
[claude.ai](https://claude.ai). Each button holds a saved prompt or a
skill invocation; clicking it types that text into Claude's chat box so
you can review (and edit) it before sending — nothing is ever sent
automatically.

## Features

- **Prompt and skill buttons** — a button either holds a plain prompt or
  a skill invocation (e.g. `/doc-summary`). Skill buttons show a small
  `/` badge in the list; picking "Skill" as the type in the add/edit
  form lets claude.ai's own slash-command picker take over once the text
  is inserted.
- **Insert, don't send** — clicking a button types its text into the
  chat box and stops. You press Send yourself.
- **Drag-and-drop reordering**, with keyboard support (focus a row, use
  Arrow Up / Arrow Down).
- **Export / import** as JSON, for backing up your buttons or sharing a
  set with someone else.
- **Light and dark mode**, matching your OS setting and claude.ai's own
  color palette.
- Runs entirely client-side — no account, no backend, no data leaves
  your browser. Buttons are stored with `chrome.storage.local`.

## Installing (unpacked, for now)

This extension isn't published to the Chrome Web Store yet, so it's
loaded as an unpacked extension from a local build:

1. Install dependencies and build:

   ```bash
   pnpm install
   pnpm run build
   ```

   This produces a `dist/` folder — that's what Chrome loads, not the
   repo root.

2. In Chrome, go to `chrome://extensions`, turn on **Developer mode**
   (top right), click **Load unpacked**, and select the `dist/` folder.

3. Open [claude.ai](https://claude.ai). The extension's icon becomes
   active on claude.ai pages only; click it to open the sidebar (or it
   opens automatically depending on your Chrome version's side panel
   behavior).

**After rebuilding** (`pnpm run build` again), go back to
`chrome://extensions` and click the reload icon on the extension's card
— Chrome doesn't pick up a new build automatically.

## Using it

- **Add a button:** open the sidebar, click **Add**, choose **Prompt**
  or **Skill**, give it a name, and enter the text to insert. For a
  skill, this is the slash-invocation itself (e.g. `/doc-summary`).
- **Run a button:** click its name. This types the saved text into
  claude.ai's chat box — for a skill invocation, claude.ai's own
  autocomplete picker takes over from there, exactly as if you'd typed
  `/` yourself. You still press Send.
- **Edit or delete:** use the buttons in each row.
- **Reorder:** drag a row by its handle, or focus it and use Arrow
  Up/Down.
- **Export / import:** in Settings, export writes a JSON file of all
  your buttons; import adds the buttons from a JSON file to your
  existing list. Files exported before skill buttons existed still
  import fine — entries with no type default to Prompt.

### Troubleshooting

**"Could not establish connection. Receiving end does not exist" /
"Reload the Claude tab and try again"** — the extension talks to
claude.ai through a content script that Chrome only injects into tabs
loaded *after* the extension was installed or last reloaded. If you see
this:

- Reload the claude.ai tab (F5), then try the button again.
- If that doesn't help, confirm you loaded the `dist/` folder (not the
  repo root) as the unpacked extension, and that you clicked the reload
  icon on the extension's card in `chrome://extensions` after your most
  recent `pnpm run build`.
- Check the claude.ai tab's own DevTools console (F12) for a line like
  `[Claude Tools] content script loaded on https://claude.ai/...`. If
  it's missing, the content script never ran on that page — re-check
  the extension is loaded from `dist/` and enabled.

**"Open claude.ai to use this tool"** — the active browser tab isn't a
claude.ai page. Switch to your claude.ai tab and try again.

## Development

```bash
pnpm install       # install dependencies (this project uses pnpm, not npm)
pnpm run dev       # Vite dev build with watch mode
pnpm run build     # type-check + production build to dist/
pnpm test          # run the test suite (Vitest)
pnpm run typecheck # tsc --noEmit only
```

Load `dist/` as described above; re-run `pnpm run build` (or keep
`pnpm run dev` running) and reload the extension in `chrome://extensions`
to see changes.

## Architecture

- **`src/background/service-worker.ts`** — enables the side panel only
  on claude.ai tabs and configures it to open on the toolbar icon click.
- **`src/content/`** — the content script injected into claude.ai pages;
  `claude-adapter.ts` finds the chat input and inserts text into it,
  `content-script.ts` wires that up to messages from the sidebar.
- **`src/sidepanel/`** — the sidebar UI (vanilla TypeScript + DOM, no
  framework): the button list, the add/edit form, drag-and-drop reorder,
  and the settings panel.
- **`src/shared/`** — code shared between the sidebar and content
  script: the `Button`/`ButtonType` data model, the `StorageAdapter`
  interface (implemented today by `chrome-local-adapter.ts` over
  `chrome.storage.local`), `ToolService` (the CRUD layer the sidebar UI
  calls), and `backup.ts` (export/import JSON handling).

The storage layer sits behind the `StorageAdapter` interface
specifically so a different backend (e.g. a synced account-based store)
can be swapped in later without changing the UI or `ToolService`.

## Testing

Tests cover the storage, service, and backup layers (`tests/shared/`) —
pure logic with no DOM dependency. The sidebar UI and content script are
verified manually in a real Chrome browser rather than with DOM tests,
which is a deliberate boundary for this project rather than a gap.
