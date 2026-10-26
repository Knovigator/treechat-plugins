---
description: Publish a new clip to a scene card on the board
argument-hint: <board url> <scene id> <video file> <tag> [what]
---
Publish a new clip to a scene card, following the sceneboard skill's loop (step 3, then steps 4 and 6): $ARGUMENTS

- Upload the file: use `files` (`a/<name>.mp4`) when it is under 20 MiB, and `asset: true` for anything larger and for every 4K clip.
- Read the scene row with `out_dir` and pass it as `--current`.
- Write the `sb clip` update with `if_version`.
- Post a short note in that scene's chat with `--media` pointing at the clip.
