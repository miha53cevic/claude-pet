# claude-pet — technical notes

How the pet works, how to hack on it, and how to package it. For installing and
using it, see the [README](README.md).

- [Architecture](#architecture)
- [Hook events → pet states](#hook-events--pet-states)
- [Safety design](#safety-design)
- [The state machine](#the-state-machine)
- [Rendering](#rendering)
- [Windows, dragging, gaze and wandering](#windows-dragging-gaze-and-wandering)
- [Configuration](#configuration)
- [The hook installer](#the-hook-installer)
- [Development](#development)
- [Packaging](#packaging)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

## Architecture

```
 Claude Code session(s)                    claude-pet (Electron)
 ─────────────────────                     ─────────────────────────────────────────────
  hook fires ── HTTP POST ──▶ 127.0.0.1:47821/hook
                                  │  hook-server.ts   answers 200 {} immediately,
                                  │                   then parses + whitelists fields
                                  ▼
                              state.ts (PetState)   per-session registry → one resolved state
                                  │  onChange (≤10/s)
                                  ▼
                              main.ts               IPC 'pet:state' / 'pet:gaze' / 'pet:motion'
                                  │
                                  ▼
                              renderer/pet.ts       timing, particles, bubbles, chime
                                  │
                                  ▼
                              renderer/forms/*.ts   draws one body per frame on a <canvas>
```

Claude Code's built-in `http` hook type posts each event's JSON payload to a URL.
The installer registers one such handler per event in `~/.claude/settings.json`,
all pointing at the pet's local server. There is no polling, no log scraping and
no network access beyond loopback.

The app is two Electron processes:

| Process | Code | Job |
|---|---|---|
| Main (Node, ESM) | `src/*.ts` | HTTP server, state machine, windows, tray/menu, drag, gaze, wandering, config |
| Renderer (sandboxed, no Node) | `src/renderer/**` | Canvas animation, hit-testing, tooltip, chime |

They talk only through the small `window.pet` bridge in `src/preload.cts`.

## Hook events → pet states

These 12 events are installed (`EVENTS` in `scripts/hooks-spec.js`):

| Event | Effect on that session |
|---|---|
| `SessionStart` | idle, failure streak reset |
| `UserPromptSubmit` | working |
| `PreToolUse` | working, remembers `tool_name` (drives the paw animation) |
| `PostToolUseFailure` | failed for 1.5 s, then back to working; failure streak +1 |
| `Notification` (`permission_prompt` / `idle_prompt`) | waiting; the waiting clock starts |
| `Stop` | done for 2.5 s, then idle |
| `StopFailure` | failed, sticky until the next event |
| `SessionEnd` | session forgotten |
| `SubagentStart` / `SubagentStop` | subagent counter ±1 (orbiting dots) |
| `PreCompact` | working with the `compact` flavor (dizzy) |
| `PostCompact` | working, flavor cleared |

Tool names map to a **flavor** (`TOOL_FLAVORS` in `src/state.ts`): `Bash` → bash,
`Read/Grep/Glob/LS` → search, `Edit/Write/NotebookEdit` → edit,
`WebFetch/WebSearch` → web, anything else → generic.

The server only reads five fields from a payload — `hook_event_name`,
`session_id`, `cwd`, `tool_name`, `notification_type` — and ignores the rest.
Bodies are capped at 256 KB.

## Safety design

The pet is a pure observer. It cannot change what Claude Code does.

- **The response is written before the request is read.** Every request to the
  hook server gets `200 {}` before the body is even collected, so there is no
  code path that could return a permission decision, block a tool, add context
  or stop a turn.
- **`PermissionRequest` is never hooked.** The "needs you" signal comes from
  `Notification` instead, so the pet never touches the permission flow.
- **Every handler has `timeout: 5`.** A hung pet can't stall a session. When
  the pet isn't running at all, Claude Code logs a connection warning and
  carries on.
- **Loopback only.** The server binds `127.0.0.1`, never `0.0.0.0`.
- **Settings edits are careful.** Install/uninstall write a timestamped backup
  first, write atomically (tmp file + rename), keep the file's trailing-newline
  style, leave every other hook untouched, and refuse to touch a
  `settings.json` that doesn't parse.
- **Renderer is locked down.** `contextIsolation`, `sandbox`, no Node
  integration, and a CSP of `default-src 'none'; script-src 'self'; style-src 'self'`.

## The state machine

`src/state.ts` holds one record per `session_id` and resolves them all into the
single state the pet shows. It has no Electron imports and takes an injectable
clock, so the tests drive it with a fake one.

**Priority.** The most urgent session wins:
`waiting` > `failed` > `working` > `done` > `idle`. With no sessions, or all of
them idle for 15 minutes, the pet is `sleeping`.

**Timers** (checked by `tick()`, which main calls once a second):

| Constant | Value | Meaning |
|---|---|---|
| `DONE_MS` | 2.5 s | length of the done celebration |
| `FAILED_FLASH_MS` | 1.5 s | a tool failure blip before returning to working |
| `WORKING_STALE_MS` | 3 min | a silent "working" session decays to idle (missed `Stop`) |
| `EVICT_MS` | 60 min | a silent session is forgotten |
| `SLEEP_AFTER_MS` | 15 min | no activity anywhere → sleeping |
| `URGENCY_1_MS` / `URGENCY_2_MS` | 1 / 3 min | waiting escalation tiers |
| `OVERRIDE_MS` | 8 s | how long a "Test state" override lasts |

**Derived signals** sent alongside the state:

- `flavor` — the tool flavor while working, the notification type while waiting.
- `urgency` (0–2) — how long the longest-waiting session has been ignored.
- `frazzle` (0–5) — the longest consecutive-failure streak; adds sweat and nerves.
- `subagents` — total running subagents across sessions.
- `sessions` — `{ name, cwd, state, tool }` per session, for the hover tooltip.

**Emission.** `onChange` fires only when the resolved JSON actually changes, at
most once per 100 ms; bursts of `PreToolUse` coalesce into one trailing update.
The all-day idle path skips the resolve entirely.

The last 50 events are kept in a ring buffer for `GET /state` and
**Copy debug info**.

## Rendering

`src/renderer/pet.ts` owns everything time-based. Each frame it computes a
`PetFrame` — breath, blink, squash, lift, tilt, gaze, sleep, chomp and palette —
from the resolved state, then hands it to the current **form**, which only
draws a body. Effects drawn on top by `pet.ts`:

- **working** — code-chip "tokens" (`{ }`, `=>`, `</>`…) arc into the mouth.
- **done** — a jump and a burst of confetti.
- **failed** — red palette, droop and shake; sweat drops with a failure streak.
- **waiting** — bouncing `?` bubble; tiers 1 and 2 bounce higher and shake,
  and tier 2 shows `!?`. The chime replays on each tier increase.
- **subagents** — up to six dots orbiting the head.
- **compacting** — spiral eyes and a woozy sway.
- **sleeping** — `z` bubble, tucked in.
- **petting** — hold the cursor on him for 0.8 s while idle or asleep: closed
  eyes and hearts.

The **chime** is synthesized with Web Audio (two triangle-wave notes with a
pitch glide), so the project ships no audio files. Main enables the
`no-user-gesture-required` autoplay policy, because the pet window never gets
focus.

**Frame rate.** 30 fps while something is happening, 12 fps when idle or
asleep, and nothing at all while the window is hidden. The loop sleeps with
`setTimeout` until the next frame is due instead of waking on every display
refresh.

**Forms** live in `src/renderer/forms/` and implement:

```ts
interface PetForm {
  name: string;
  draw(ctx: CanvasRenderingContext2D, f: PetFrame): void;
}
```

To add one: create the module, register it in `forms/index.ts`, and add its
name to `FORM_NAMES` in `src/renderer/catalog.ts` (the menu reads that list).
The canvas uses a fixed 260×260 logical coordinate space from
`src/renderer/layout.ts`; draw around `(CX, CY)` and stand on `GROUND`.

## Windows, dragging, gaze and wandering

Each pet is a frameless, transparent, non-focusable, always-on-top window that
is visible on every Space and over full-screen apps.

- **Click-through.** The window ignores mouse events by default (with
  forwarding on). The renderer hit-tests the pet's circle on every mouse move
  and tells main to start catching events only while the cursor is over the
  pet, so the empty corners of the window never steal clicks.
- **Dragging.** Main follows the cursor at 60 Hz while the button is down, then
  clamps the pet's visual box (`PET_BOX`, not the window rect) to the work area
  and saves the position.
- **Gaze.** Main samples the cursor at 5 Hz and sends each pet a normalized
  vector toward it, skipping the IPC when the cursor hasn't moved.
- **Multiple pets.** 1–4 windows mirror the same state. Each clone picks a form
  nobody else is wearing, has its chime off, and shows a read-only menu.
- **Hiding** is never saved, so a restart always brings the pets back.
- **Display changes.** If a saved position ends up off-screen (an unplugged
  monitor), the pet snaps back to the default corner.

**Wandering** runs entirely in main, which moves the window and sends a
`PetMotion` hint (`walk` / `climb` / `ceiling` / `fall` / `land`) so the
renderer can lean, cling, stretch or splat to match.

- `drift` — a small eased sideways shuffle every 30 s.
- `adventure` — every 45–120 s a random pet sets off. It either takes a two-leg
  stroll along the bottom of the screen, or walks to a corner, climbs it, crawls
  upside-down along the top, drops at the far side and lands. Wandering only
  happens while idle; if a session needs attention mid-trip, the pet drops to
  the ground and the trip ends.

## Configuration

Settings live in `~/Library/Application Support/claude-pet/config.json` and are
written atomically whenever you change something in the menu. Two keys are only
settable by editing the file (quit the pet first):

| Key | Default | Notes |
|---|---|---|
| `form` | `"claude"` | `claude`, `clawd`, `blob`, `ghost` |
| `scale` | `1` | `1`, `1.5`, `2` from the menu |
| `petCount` | `1` | 1–4 |
| `wander` | `"off"` | `off`, `drift`, `adventure` |
| `chime` | `"off"` | `off`, `quiet`, `normal`, `loud` |
| `position`, `extraPositions` | `null`, `[]` | saved window positions |
| `projectFilter` | `null` | path prefix; sessions whose `cwd` is outside it are ignored |
| `palette` | `null` | color override, e.g. `{ "body": "#6a8caf", "light": "#9bb5cf" }` |

**Environment variables**

| Variable | Effect |
|---|---|
| `CLAUDE_PET_PORT` | Port for the server and the installed hooks (default `47821`). Set it for both the app and `install-hooks`. A non-default port also gets its own config directory and single-instance lock, so two pets can run side by side. |
| `CLAUDE_PET_DEBUG` | Shows a state label under the pet and logs wander plans (`npm run dev` sets it). |

## The hook installer

`scripts/hooks-spec.js` holds the single implementation of the settings merge.
It is used by three callers:

- `npm run install-hooks` / `npm run uninstall-hooks` (`--dry-run` previews,
  `--settings <file>` targets another file),
- the in-app **Claude Code hooks** menu (`src/hooks-installer.ts` imports it at
  runtime; the packager ships that one script inside the app),
- the tests.

The merge appends a handler to the `matcher: "*"` group of each event (creating
the group if needed), and skips events that already have it, so it is
idempotent. Removal strips only handlers whose URL matches
`http://127.0.0.1:<port>/hook`, then prunes groups, events and the `hooks` key
if they end up empty. An install followed by an uninstall gives back the
original file byte for byte, and the tests check this.

The scripts stay plain JavaScript on purpose, so installing hooks needs no
TypeScript toolchain.

## Development

```bash
npm install
npm run dev                  # build + launch with the debug label
npm test                     # tests for the state machine and installer
npm run typecheck            # all three tsconfigs, no emit
```

Drive the pet without a real session:

```bash
npm run emit -- working      # also: idle waiting done failed frazzled subagent
                             #       compact sleeping end wander
curl 127.0.0.1:47821/state   # resolved state + the last 50 events
curl 127.0.0.1:47821/snapshot -o pet.png        # PNG of the main pet window
curl '127.0.0.1:47821/snapshot?i=2' -o pet.png  # ...or the third pet
```

The right-click menu also has **Test state** (forces a state for 8 s) and
**Copy debug info**.

**Toolchain notes**

- TypeScript compiles into `out/` (`npm run build`, which `npm start` runs).
- The tests run their `.ts` sources directly with Node's built-in type
  stripping, which is why Node ≥ 22.18 is required.
- `src/preload.cts` is the one CommonJS file, because sandboxed preloads can't
  be ESM. Everything else is ESM.
- `src/renderer/layout.ts` and `catalog.ts` are imported by both processes;
  main compiles its own copy into `out/main/renderer/`.
- `tsconfig.json` is a solution file that points editors at the three real
  projects: main, renderer, and tests + scripts.

## Packaging

```bash
npm run package
open dist/claude-pet-darwin-arm64/claude-pet.app
```

`scripts/package.js` renders the app icon from the tray sprite with a small
PNG encoder, builds the `.icns` with `sips` and `iconutil`, and runs
`@electron/packager`. The project ships no image assets at all; the tray icon
is a macOS template image drawn at runtime by `src/tray-icon.ts`.

- **Start at login** shows up in the menu only in the packaged app.
- The bundle is unsigned. Other Macs need a one-time right-click → **Open**.
- Quit any dev instance first, since both want the same port.

## Project layout

```
src/
  main.ts             app lifecycle, windows, tray/menu, drag, gaze, wander
  hook-server.ts      loopback HTTP server (respond first, inspect later)
  state.ts            session registry + state resolution (pure, tested)
  config.ts           config.json store + port resolution
  hooks-installer.ts  in-app install/uninstall dialogs
  tray-icon.ts        procedural menu-bar icon
  preload.cts         the window.pet IPC bridge
  shared.d.ts         types shared by every process
  renderer/
    pet.ts            render loop, effects, interaction, chime
    forms/            claude, clawd, blob, ghost bodies
    layout.ts         logical geometry shared with main
    catalog.ts        form names, state names, bubble glyphs
scripts/
  hooks-spec.js       settings merge/remove (single source of truth)
  install-hooks.js    CLI installer
  uninstall-hooks.js  CLI uninstaller
  emit.js             synthetic events for development
  package.js          icon generation + .app packaging
test/                 node:test suites
docs/media/           README GIFs
```

## Troubleshooting

- **"port in use" dialog** — another claude-pet is already running. The port is
  fixed because `settings.json` has it hard-coded in the hook URLs.
- **The pet doesn't react** — check that the hooks are installed
  (`npm run install-hooks -- --dry-run` should say "already installed", or look
  at the menu's **Claude Code hooks** entry). Then start a **new** Claude Code
  session, because running sessions only load hooks at startup.
- **The pet vanished** — tray icon → **Show pets**, or **Reset position**.
- **No sound** — the chime is off by default; turn it on under
  **Chime on waiting**.
