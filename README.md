# claude-pet

A tiny desktop pet that mirrors your [Claude Code](https://code.claude.com) sessions — like Codex Pets, but for Claude. It floats above your windows and tells you at a glance whether the agent is **working**, **waiting on you**, **done**, or **failed**.

No assets, no cloud, no dependencies beyond Electron and TypeScript. The pet is drawn procedurally on a canvas, and Claude Code talks to it through built-in `http` hooks posting to `127.0.0.1` — the pet only ever *listens*; it can never affect a session.

## Install

```bash
npm install
npm test                          # nothing touches global config until this is green
npm start                         # the pet appears (bottom-right by default)
npm run install-hooks -- --dry-run  # preview the change to ~/.claude/settings.json
npm run install-hooks             # backs up settings.json, then merges the hooks
```

Then use Claude Code anywhere on this machine. Remove everything with `npm run uninstall-hooks` (a timestamped backup of `settings.json` is also kept next to it).

## What the pet reacts to

| Claude Code event | Pet |
|---|---|
| You submit a prompt | working — munching tokens (code-chip snacks fly into his mouth; paws match the tool: Bash taps, Edit hammers, Read/Grep peers, Web gazes off) |
| Permission prompt / your turn | **waiting** — bouncing with a `?` (optional chime); ignore him for 1 / 3 minutes and he escalates: bigger bounces, frantic shaking, `!?`, repeat chime |
| Turn finished | done — jump, `✓`, confetti, then idle |
| Tool failed / turn errored | failed — droop, shake, `!`; consecutive failures add sweat drops and nerves |
| Subagents running | small orbiting dots |
| Context compacting | dizzy — spiral eyes and a woozy sway |
| 15 min of quiet | sleeping (`z`) |

Multiple sessions are tracked at once; the pet shows the most urgent state and **hovering it lists every session** (`repo — state`).

## Controls

- **Drag** the pet anywhere (position is remembered). **Click** to poke it. **Hold the cursor on him** while he's idle to pet him — closed eyes, hearts. **Right-click** (or the tray icon) for the menu: form (claude/clawd/blob/ghost), scale, pets (1–4 copies — a little flock that mirrors the same state; each copy wears a different randomly-picked form, each is draggable, and outings pick a random adventurer; settings changes happen on the main pet — a clone's menu is view-only), hide/show (hiding is session-only and the tray menu always offers Show, so he can't be stranded invisible), wander (off / subtle drift / **adventure** — long walks, climbing a screen corner, walking upside-down along the top, dropping at the far corner), chime (off/quiet/normal/loud), test states, copy debug info, quit.
- Clicks pass through the transparent parts of its window — only the pet itself is clickable.

## Dev

```bash
npm run dev                 # build + launch with the debug label
npm run emit -- waiting     # drive any state without a real session:
                            # idle|working|waiting|done|failed|sleeping|subagent|end|wander
curl 127.0.0.1:47821/state     # current sessions + last 50 events
curl 127.0.0.1:47821/snapshot -o pet.png  # PNG of the pet window (handy over SSH)
npm test                    # typecheck + unit tests (run natively via Node type stripping)
npm run typecheck           # all three tsconfigs, no emit
```

The app is TypeScript; Electron runs the compiled output in `out/`
(`npm run build`, wired into `npm start`). The `scripts/` folder stays plain JS
on purpose so the hook installer runs with zero toolchain, and the tests run
their `.ts` sources directly — Node strips the types natively. The one
deliberate oddity is `src/preload.cts`: sandboxed preloads only support
CommonJS, so that single file compiles to `.cjs` while everything else is ESM.

Add a pet form: drop a module in `src/renderer/forms/` exposing a `PetForm` (`{ name, draw(ctx, f) }`) and register it in `forms/index.ts`. `pet.ts` owns all timing and state; a form only draws the body. Rerun `npm start` to rebuild.

## Package as a real app

```bash
npm run package
```

Produces `dist/claude-pet-darwin-arm64/claude-pet.app` — double-clickable; copy it
into `/Applications` if you like. Notes:

- **Start at login** appears in the right-click menu only in the packaged app
  (macOS login items launch app bundles, which `electron .` isn't).
- Quit any dev instance first when running the packaged app for real — both
  want port 47821, and the second one will tell you so and exit.
- The app icon is generated at package time from the tray sprite (a tiny
  hand-rolled PNG encoder + `iconutil`) — the project still ships zero image
  assets.
- The bundle is unsigned: fine on the Mac that built it; other Macs need a
  one-time right-click → Open.
- The app is **self-contained for sharing**: right-click the pet →
  **Claude Code hooks → Install / update hooks…** does the same idempotent
  merge as `npm run install-hooks`, behind a confirmation dialog with a
  timestamped backup (uninstall lives in the same submenu). The CLI scripts
  keep working from the repo; both share one implementation
  (`scripts/hooks-spec.js`).

## Safety design

- The hook server answers a bare `200 {}` **before reading the request body** — there is no code path that can return a permission decision, block a tool, or inject context into a session.
- `PermissionRequest` is never hooked; the "needs you" signal comes from `Notification` instead.
- Every installed hook has `timeout: 5`, so even a hung pet can't stall a session; when the pet isn't running, Claude Code just logs a warning and continues.
- The server binds to `127.0.0.1` only. Port: `47821` (override with `CLAUDE_PET_PORT` — set it both for the app and when running `install-hooks`).

## Troubleshooting

- **"port in use" dialog** — another claude-pet is already running (the port is fixed because `settings.json` hard-codes it).
- **Pet doesn't react** — check hooks are installed (`grep claude-pet -A2 ~/.claude/settings.json` or `npm run install-hooks -- --dry-run` says "already installed"), and that new Claude Code sessions were started *after* installing (running sessions load hooks at startup).
- **Pet vanished** — tray menu → Reset position.
