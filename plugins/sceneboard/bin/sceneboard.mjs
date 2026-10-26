#!/usr/bin/env node
// sceneboard: builds the db rows a scene board reads, with the board's rules checked in code.
// It never talks to claude.ai itself. Each command writes a JSON file and prints the ArtifactData call
// that applies it, so the agent's only job is to make that call (pinned with if_version).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const STATES = ['prompt', 'storyboard', 'animatic', 'footage', 'review', 'final'];
// boards seeded before the Prompt stage say 'placeholder'
const stage = (v) => (v === 'placeholder' ? 'prompt' : v);
const ACTIVITY = ['typing', 'running', 'idle'];
const KINDS = ['image', 'video', 'audio', 'text'];

export class UsageError extends Error {}
const fail = (m) => { throw new UsageError(m); };

export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    const v = inline !== undefined ? inline : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    if (opt[k] === undefined) opt[k] = v; else opt[k] = [].concat(opt[k], v);
  }
  return { pos, opt };
}
const list = (v) => (v === undefined ? [] : [].concat(v));

// "Oct 16 03:57", in UTC, the format the board's clip badges use
export function whenUTC(ms) {
  const d = new Date(ms);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const p = (n) => String(n).padStart(2, '0');
  return `${mon} ${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function kindOf(src) {
  if (/\.(mp4|webm|mov|m4v)$/i.test(src)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(src)) return 'audio';
  if (/\.(txt|md|json)$/i.test(src)) return 'text';
  return 'image';
}

// --media / --asset take "src" or "src|name" (kind from the extension, or "src|name|kind")
export function parseMedia(spec, now) {
  const [src, name, kind] = String(spec).split('|');
  if (!src) fail(`empty media spec: "${spec}"`);
  const blob = /^\/_blob\/[0-9a-f]{32}$/.test(src);
  const rel = /^[A-Za-z0-9._~-][A-Za-z0-9._~\-/]*$/.test(src) && !src.split('/').includes('..');
  if (!blob && !rel)
    fail(`media src must be a published relative path (a/clip.mp4) or /_blob/<32-hex id>, got "${src}"`);
  const k = kind || kindOf(src);
  if (!KINDS.includes(k)) fail(`media kind must be one of ${KINDS.join(', ')}`);
  return { src, kind: k, name: name || src.split('/').pop(), ...(now ? { at: now } : {}) };
}

function sceneId(id) {
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail(`scene id must be letters, digits, _ or - (got "${id}")`);
  return id;
}

// A question to the director must carry `ask`, or it never reaches the timeline's "waiting on you" dot.
export function looksLikeQuestion(text) {
  return /\?\s*$/m.test(text) || /\b(want me to|should I|shall I|which one|do you want|ok to)\b/i.test(text);
}

export function buildNote({ scene, text, ask, noAsk = false, media = [], replyTo, now }) {
  sceneId(scene);
  if (!text || !String(text).trim()) fail('--text is required');
  if (String(text).length > 3800) fail('--text is over 3800 characters; the chat would cut it');
  if (ask === true) fail('--ask needs the question text, e.g. --ask "Take 1 or 2?"');
  if (ask && noAsk) fail('pass --ask or --no-ask, not both');
  if (!ask && !noAsk && looksLikeQuestion(text)) fail('this note asks the director something: pass --ask "<the question, one line>" so the timeline shows it as waiting, or --no-ask if it is rhetorical');
  const note = { by: 'claude', scene, text: String(text), at: now };
  if (ask) note.ask = String(ask);
  if (media.length) note.media = media.map((m) => parseMedia(m));
  if (replyTo) note.replyTo = String(replyTo);
  return note;
}

export function buildActivity({ state, label, now }) {
  if (!ACTIVITY.includes(state)) fail(`--state must be one of ${ACTIVITY.join(', ')}`);
  return { state, label: label ? String(label) : (state === 'running' ? 'Claude is working on it' : state === 'typing' ? 'Claude is typing' : ''), at: now };
}

// a new clip goes to the top of the card; the clip it replaces drops into the card's assets so nothing is lost
export function buildClip({ current = {}, video, tag, what, ref, state, status, assets = [], now }) {
  if (!video) fail('--video is required');
  if (!tag) fail('--tag is required (e.g. "r31" or "r31 · 4K"; put "4K" in the tag for 4K clips so the timeline badges them)');
  const v = parseMedia(video).src;
  const update = { video: v, clip: { tag: String(tag), what: what ? String(what) : '', when: whenUTC(now), ref: ref ? String(ref) : '' } };
  const old = Array.isArray(current.assets) ? current.assets : [];
  const added = assets.map((a) => parseMedia(a, now));
  if (current.video && current.video !== v && !old.some((a) => a.src === current.video) && !added.some((a) => a.src === current.video))
    added.push({ src: current.video, kind: 'video', name: `clip ${current.clip?.tag || 'previous'}`, at: now - 1 });
  if (added.length) update.assets = [...added, ...old.filter((a) => !added.some((b) => b.src === a.src))];
  if (state) update.state = String(state);
  if (status) status = stage(status);
  if (status) { if (!STATES.includes(status)) fail(`--status must be one of ${STATES.join(', ')}`); update.status = status; }
  return update;
}

export function buildFull({ src, hls, tag, ref, now }) {
  if (!src) fail('--src is required');
  if (!tag) fail('--tag is required');
  return { full: { src: parseMedia(src).src, ...(hls ? { hls: parseMedia(hls).src } : {}), tag: String(tag), when: whenUTC(now), ref: ref ? String(ref) : '' } };
}

// one paid generation, kept on the board so the header can show what the film has cost so far
export function buildSpend({ scene, provider, action, cents, run, note, now }) {
  const sc = scene === 'board' ? 'board' : sceneId(scene);
  if (!provider) fail('--provider is required (e.g. treechat, fal, mygen)');
  if (!action) fail('--action is required (the model or action that ran)');
  const c = Number(cents);
  if (!Number.isInteger(c) || c < 0) fail('--cents must be a whole number of US cents (0 if free)');
  return { scene: sc, provider: String(provider), action: String(action), cents: c, ...(run ? { run: String(run) } : {}), ...(note ? { note: String(note) } : {}), at: now };
}

// Bring-your-own generators: sceneboard.config.json maps a provider + kind to a command, one argv entry per
// array item. {prompt} {ref} {audio} {out} are filled in per argument and never pass through a shell, so a
// prompt can't run anything. An argument that is only a missing placeholder is dropped with its flag.
export function loadConfig(explicit) {
  const paths = explicit ? [explicit] : [resolve('sceneboard.config.json'), join(homedir(), '.config', 'sceneboard', 'config.json')];
  for (const p of paths) if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  if (explicit) fail(`no config at ${explicit}`);
  return {};
}

export function buildCommand(template, vals) {
  if (!Array.isArray(template) || !template.length || template.some((a) => typeof a !== 'string')) fail('a provider command must be an array of strings, e.g. ["my-gen", "--prompt", "{prompt}"]');
  const out = [];
  for (const arg of template) {
    const only = arg.match(/^\{(\w+)\}$/);
    if (only && (vals[only[1]] == null || vals[only[1]] === '')) {
      if (out.length > 1 && out[out.length - 1].startsWith('-')) out.pop();
      continue;
    }
    out.push(arg.replace(/\{(\w+)\}/g, (m, k) => {
      if (vals[k] == null) fail(`the command needs {${k}}: pass --${k}`);
      return String(vals[k]);
    }));
  }
  return out;
}

export function validateScenes(scenes) {
  if (!Array.isArray(scenes) || !scenes.length) fail('scenes file must be a non-empty JSON array');
  const seen = new Set();
  return scenes.map((s, i) => {
    const id = sceneId(s.id);
    if (id === 'global' || id === 'full') fail(`scene id ${id} is reserved for the board`);
    if (seen.has(id)) fail(`duplicate scene id ${id}`);
    seen.add(id);
    if (!s.title) fail(`scene ${id}: title is required`);
    const out = { ...s, n: s.n ?? i + 1, t0: Number(s.t0 ?? 0), t1: Number(s.t1 ?? 0) };
    if (!(out.t1 >= out.t0)) fail(`scene ${id}: t1 must be >= t0`);
    if (out.status) out.status = stage(out.status);
    if (out.status && !STATES.includes(out.status)) fail(`scene ${id}: status must be one of ${STATES.join(', ')}`);
    delete out.id;
    if (Buffer.byteLength(JSON.stringify(out)) > 250 * 1024) fail(`scene ${id} is over 250 KiB; move old assets out of it`);
    return [id, out];
  });
}

// pulls SCENES and FULL out of a v0 board, where they were baked into the page
export function extractStatic(html) {
  const m = html.match(/const SCENES = (\[.*?\]);\n/s);
  if (!m) fail('no `const SCENES = [...]` found in that page');
  const f = html.match(/const FULL = (\{.*?\});\n/s);
  const t = html.match(/<title>(.*?)<\/title>/s);
  return { scenes: JSON.parse(m[1]), meta: { title: t ? t[1].replace(/ Scenes$/, '') : 'Scene board', ...(f ? { full: JSON.parse(f[1]) } : {}) } };
}

function writeJSON(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  return resolve(path);
}

function call(action, collection, docId, file, pinned) {
  return { tool: 'ArtifactData', action, url: '<board url>', collection, doc_id: docId, file_path: file, ...(pinned ? { if_version: '<version from your last read; omit only when creating>' } : {}) };
}

function seedCalls(scenes, meta, out) {
  const writes = [];
  if (meta) writes.push({ op: 'set', collection: 'board', doc_id: 'meta', file_path: writeJSON(join(out, 'board', 'meta.json'), meta) });
  for (const [id, s] of scenes) writes.push({ op: 'set', collection: 'scenes', doc_id: id, file_path: writeJSON(join(out, 'scenes', `${id}.json`), s) });
  const batches = [];
  for (let i = 0; i < writes.length; i += 50) batches.push({ tool: 'ArtifactData', action: 'batch', url: '<board url>', writes: writes.slice(i, i + 50) });
  return batches;
}

const HELP = `sceneboard <command> [options]   (every command writes --out <file|dir> and prints the ArtifactData call to make)

  now                                       print the current epoch ms (never invent an \`at\`)
  seed <scenes.json> [--meta m.json] --out <dir>
                                            validate scenes and write one row per scene + board/meta, as batch calls
  extract <old-board.html> --out <dir>      migrate a board whose SCENES were baked into the page
  note --scene <id|global> --text <t> [--ask <q> | --no-ask] [--media <src|name>]... [--reply-to <noteId>] --out <file>
                                            a Claude chat note; questions must carry --ask
  activity --scene <id|global|full> --state typing|running|idle [--label <t>] --out <file>
  clip --scene <id> --video <src> --tag <t> [--what <t>] [--ref <sha>] [--state <t>] [--status <s>]
       [--asset <src|name>]... [--current <scene.json>] --out <file>
                                            put a new clip at the top of a card (pass --current, the row you just read,
                                            so the replaced clip and new assets are kept)
  full --src <mp4> [--hls <m3u8.txt>] --tag <t> [--ref <sha>] --out <file>   the header's full cut
  spend --scene <id|board> --provider <p> --action <model> --cents <n> [--run <id>] [--note <t>] --out <file>
                                            record one paid run (the header shows the running total to editors)
  gen --provider <name> --kind <kind> --prompt <t> [--ref <file>] [--audio <file>] --out <file> --approved
      [--config <file>]                     run your own generator from sceneboard.config.json (no shell);
                                            --approved means the user said yes to this run and its cost
`;

export function run(argv, now = Date.now()) {
  const [cmd, ...rest] = argv;
  const { pos, opt } = parseArgs(rest);
  const out = typeof opt.out === 'string' ? opt.out : null;
  const needOut = () => out || fail('--out <path> is required');
  switch (cmd) {
    case 'now': return { print: String(now) };
    case 'seed': case 'extract': {
      if (!pos[0]) fail(`${cmd} needs a file`);
      const src = readFileSync(pos[0], 'utf8');
      let scenes, meta;
      if (cmd === 'extract') ({ scenes, meta } = extractStatic(src));
      else { scenes = JSON.parse(src); meta = opt.meta ? JSON.parse(readFileSync(opt.meta, 'utf8')) : undefined; }
      const v = validateScenes(scenes);
      return { print: JSON.stringify(seedCalls(v, meta, needOut()), null, 2), note: `${v.length} scenes${meta ? ' + board/meta' : ''}. New rows need no if_version; to overwrite existing rows, read them and add if_version to each write.` };
    }
    case 'note': {
      const note = buildNote({ scene: opt.scene, text: opt.text, ask: opt.ask, noAsk: !!opt['no-ask'], media: list(opt.media), replyTo: opt['reply-to'], now });
      const id = `c-${note.scene}-${now}`;
      return { print: JSON.stringify(call('set', 'notes', id, writeJSON(needOut(), note)), null, 2) };
    }
    case 'activity': {
      const scene = opt.scene === 'full' ? 'full' : sceneId(opt.scene);
      return { print: JSON.stringify(call('set', 'activity', scene, writeJSON(needOut(), buildActivity({ state: opt.state, label: opt.label, now })), true), null, 2) };
    }
    case 'clip': {
      const scene = sceneId(opt.scene);
      const current = opt.current ? JSON.parse(readFileSync(opt.current, 'utf8')) : {};
      if (!opt.current) process.stderr.write('note: no --current row given, so the replaced clip will not be kept in the assets\n');
      const row = current.data && typeof current.data === 'object' && !current.video ? current.data : current;
      const upd = buildClip({ current: row, video: opt.video, tag: opt.tag, what: opt.what, ref: opt.ref, state: opt.state, status: opt.status, assets: list(opt.asset), now });
      return { print: JSON.stringify(call('update', 'scenes', scene, writeJSON(needOut(), upd), true), null, 2) };
    }
    case 'spend': {
      const row = buildSpend({ scene: opt.scene, provider: opt.provider, action: opt.action, cents: opt.cents, run: opt.run, note: opt.note, now });
      return { print: JSON.stringify(call('set', 'spend', `${row.provider}-${now}`, writeJSON(needOut(), row)), null, 2) };
    }
    case 'gen': {
      if (!opt.provider || !opt.kind) fail('--provider and --kind are required');
      if (!opt.approved) fail('show the user the prompt and the expected cost, get a yes, then pass --approved');
      const cfg = loadConfig(typeof opt.config === 'string' ? opt.config : undefined);
      const tpl = cfg.providers?.[opt.provider]?.[opt.kind];
      if (!tpl) fail(`no providers.${opt.provider}.${opt.kind} command in sceneboard.config.json`);
      const argv = buildCommand(tpl, { prompt: opt.prompt, ref: opt.ref, audio: opt.audio, out: needOut() });
      execFileSync(argv[0], argv.slice(1), { stdio: ['ignore', 'inherit', 'inherit'] });
      return { print: JSON.stringify({ ran: argv[0], out: resolve(out) }), note: 'Record the cost with `sceneboard spend`, then publish the file to the card.' };
    }
    case 'full':
      return { print: JSON.stringify(call('update', 'board', 'meta', writeJSON(needOut(), buildFull({ src: opt.src, hls: opt.hls, tag: opt.tag, ref: opt.ref, now })), true), null, 2) };
    case undefined: case 'help': case '--help': return { print: HELP };
    default: fail(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  try {
    const r = run(process.argv.slice(2));
    process.stdout.write(r.print + '\n');
    if (r.note) process.stderr.write(r.note + '\n');
  } catch (e) {
    if (e instanceof UsageError) { process.stderr.write(`sceneboard: ${e.message}\n`); process.exit(2); }
    throw e;
  }
}
