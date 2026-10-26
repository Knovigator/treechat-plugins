---
description: Move a board whose scenes are baked into the page onto db rows
argument-hint: <board url> <local copy of its index.html>
---
Migrate the board, following the scenes skill's "Setting up a board" section: $ARGUMENTS

1. Read the artifact first. Then run `sb extract <html> --out <dir>` and check the scene count against the page.
2. Write the batches, which only create rows. Confirm them with `ArtifactData list scenes`.
3. Republish `${CLAUDE_PLUGIN_ROOT}/template/index.html` to the same `url`. Omit `capabilities` and `files` so both carry over.
4. Open the board and check that every card, the header and the chats are still there.
