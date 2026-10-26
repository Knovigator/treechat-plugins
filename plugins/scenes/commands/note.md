---
description: Post a note (or a question for the director) in a scene's chat
argument-hint: <board url> <scene id> <text>
---
Post this in the scene chat using `node ${CLAUDE_PLUGIN_ROOT}/bin/scenes.mjs note`: $ARGUMENTS

- If it asks the director anything, pass `--ask "<the question, one line>"`.
- Write the printed `ArtifactData set` call.
