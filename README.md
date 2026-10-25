# sceneboard

A scene-by-scene review board for AI films. The director comments on a scene, and a Claude Code agent fixes it and publishes the new clip back to that scene's card. We built it to make **CLIMB**, a 3-minute #slopcore music video. Its 16 scenes went through hundreds of review notes this way.

The board is a [claude.ai Artifact](https://claude.ai). It shows:

- **Timeline**: every scene sized by its length. A yellow dot means a scene is waiting on the director, a purple dot means an agent is working on it, and a `4K` badge marks a 4K clip.
- **Scene cards**: the current clip with its version tag, the lyrics, what we see, where the scene stands, and every asset ever made for it.
- **A chat per scene**: the director writes, and the message is sent to the Claude session; Claude answers in the same thread. A question from Claude lands in the **Global** card's Inbox tab until the director replies. Its Chat tab is a board-wide chat for anything not about one scene.
- **The latest full cut** in the header, with a cinema player (HLS).

All content lives in the artifact's database, so an agent changes one row and every open board updates live.

## Install (Claude Code plugin)

```
/plugin marketplace add <owner>/sceneboard
/plugin install sceneboard@sceneboard
```

This gives you the `sceneboard` skill, which teaches the agent the review loop, and these commands:

| Command | Does |
| --- | --- |
| `/sceneboard:new <scenes.json>` | publish a new board and seed its scenes |
| `/sceneboard:clip …` | put a new clip on a scene card |
| `/sceneboard:note …` | post in a scene's chat (questions carry `ask`) |
| `/sceneboard:full …` | publish a new full cut to the header |
| `/sceneboard:migrate …` | move an old board, with scenes baked into the page, onto db rows |

## The loop

```
director comments on scene 3 ─▶ agent: activity=running (purple dot)
                                 └▶ fix → gates → render → publish clip → note in the chat → activity=idle
agent asks "take 1 or 2?"    ─▶ note with ask (yellow dot + inbox) ─▶ director answers in the chat
```

The `sceneboard` CLI builds every row with the rules checked in code:

- timestamps come from the clock, never typed by the agent;
- a question without `--ask` is refused;
- media paths must be published files or asset ids;
- a new clip keeps the one it replaced in the card's assets.

```
node bin/sceneboard.mjs note --scene s03 --text "r12 is up. Keep it?" --ask "Keep r12?" --media a/s03-r12.mp4 --out note.json
```

## Models: Treechat AI or your own

The plugin connects Claude Code to **Treechat AI** (`https://api.treechat.com/mcp`). Sign in once, set a per-run and a daily spending cap, and your agents can quote and run image, video, lip-sync and 4K-upscale models on one bill. A run over your cap waits for your approval in the browser.

Prefer your own? Connect any other MCP server (fal, Replicate, a local ComfyUI), or point `sceneboard gen` at your own command in `sceneboard.config.json` (see `sceneboard.config.example.json`). Commands run without a shell, and your keys stay in your environment, never on the board.

Whichever you use, every paid run is quoted and approved first, then logged with `sceneboard spend`. People who can edit the board see the film's running cost in its header.

## Run it locally

```
npm run preview            # http://127.0.0.1:4321, seeded from examples/demo, no sign-in
npm test
```

The preview stands in for the claude.ai runtime with an in-memory db. `POST /_db/<collection>/<doc>` writes a row, so you can watch the page update.

## Data model

| Row | Holds |
| --- | --- |
| `board/meta` | title, subtitle, director's name, latest full cut |
| `scenes/<id>` | n, title, t0/t1, shots, see, state, lyrics, status, video, clip {tag, what, when, ref}, picks, assets |
| `status/<id>` | the director's status pick |
| `notes/*` | scene chat messages (`ask` = waiting on the director) |
| `activity/<id>` | what an agent is doing right now |
| `spend/*` | one row per paid run (provider, model, cents) |

## Credits

The method behind the film follows [@anabology](https://x.com/anabology)'s slopcore making-of. The board, the agent loop and the CLI are ours. MIT licensed.
