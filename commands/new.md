---
description: Create a new scene board artifact from a scenes list
argument-hint: <scenes.json> [meta.json]
---
Create a scene board using the sceneboard skill.

1. Check the scenes file ($ARGUMENTS) with `node ${CLAUDE_PLUGIN_ROOT}/bin/sceneboard.mjs seed <scenes.json> [--meta <meta.json>] --out <scratch dir>`. If there is no scenes file yet, draft one with the user first: one object per scene with `id`, `title`, `t0`, `t1`, and optionally `see`, `lyrics` and `status`.
2. Copy `${CLAUDE_PLUGIN_ROOT}/template/index.html` into the scratchpad and publish it with the Artifact tool, using `capabilities: {"db":{},"user":{"scopes":["profile"]},"comments":{},"assets":{}}`. Set `<title>` to the film's name.
3. Apply each printed `ArtifactData` batch to the new artifact's url.
4. List each collection once with `ArtifactData list` to confirm the rows, then give the user the link.
