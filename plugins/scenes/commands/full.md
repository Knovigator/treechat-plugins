---
description: Publish a new full cut to the board header
argument-hint: <board url> <mp4> [hls dir] <tag> <ref>
---
Publish the full cut, following the scenes skill's "full cut" section: $ARGUMENTS

- Upload the mp4 and the HLS ladder, with the playlist as `index.m3u8.txt`.
- Write `sb full` to `board/meta` with `if_version`.
- Clear `activity/full`.
