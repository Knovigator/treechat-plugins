import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNote, buildClip, buildActivity, buildFull, parseMedia, validateScenes, extractStatic, whenUTC, UsageError } from '../bin/scenes.mjs';

const now = 1792460035051;

test('a question must carry ask', () => {
  assert.throws(() => buildNote({ scene: 's01', text: 'Take 1 or 2?', now }), UsageError);
  assert.throws(() => buildNote({ scene: 's01', text: 'Want me to run it', now }), UsageError);
  assert.equal(buildNote({ scene: 's01', text: 'Take 1 or 2?', ask: 'Take 1 or 2?', now }).ask, 'Take 1 or 2?');
  assert.equal(buildNote({ scene: 's01', text: 'Who knows?', noAsk: true, now }).ask, undefined);
  assert.throws(() => buildNote({ scene: 's01', text: 'x?', ask: 'x?', noAsk: true, now }), UsageError);
});

test('notes are stamped with the real time and by claude', () => {
  const n = buildNote({ scene: 's01', text: 'Done.', now });
  assert.deepEqual(n, { by: 'claude', scene: 's01', text: 'Done.', at: now });
});

test('media srcs must be published paths or blob ids', () => {
  assert.equal(parseMedia('a/x.mp4').kind, 'video');
  assert.equal(parseMedia('/_blob/' + 'a'.repeat(32) + '|4K take').name, '4K take');
  for (const bad of ['/etc/passwd', '../x.png', 'a/../../x.png', 'https://evil.example/x.png', '/_blob/zz'])
    assert.throws(() => parseMedia(bad), UsageError, bad);
});

test('a new clip keeps the one it replaces in the assets', () => {
  const current = { video: 'a/r1.mp4', clip: { tag: 'r1' }, assets: [{ src: 'a/still.jpg', kind: 'image', name: 'still' }] };
  const u = buildClip({ current, video: 'a/r2.mp4', tag: 'r2 · 4K', what: 'K mouth', ref: 'abc123', now });
  assert.equal(u.video, 'a/r2.mp4');
  assert.deepEqual(u.clip, { tag: 'r2 · 4K', what: 'K mouth', when: whenUTC(now), ref: 'abc123' });
  assert.deepEqual(u.assets.map((a) => a.src), ['a/r1.mp4', 'a/still.jpg']);
  assert.equal(buildClip({ current, video: 'a/r1.mp4', tag: 'r1b', now }).assets, undefined);
});

test('activity and full cut', () => {
  assert.throws(() => buildActivity({ state: 'busy', now }), UsageError);
  assert.equal(buildActivity({ state: 'running', now }).at, now);
  assert.equal(buildFull({ src: 'v/full.mp4', hls: 'v/full/index.m3u8.txt', tag: 'v38', now }).full.hls, 'v/full/index.m3u8.txt');
});

test('scenes validate and number themselves', () => {
  const v = validateScenes([{ id: 's01', title: 'A', t1: 3 }, { id: 's02', title: 'B', t0: 3, t1: 5 }]);
  assert.deepEqual(v.map(([id, s]) => [id, s.n]), [['s01', 1], ['s02', 2]]);
  assert.throws(() => validateScenes([{ id: 's01', title: 'A' }, { id: 's01', title: 'B' }]), UsageError);
  assert.throws(() => validateScenes([{ id: 's01', title: 'A', status: 'done' }]), UsageError);
});

test('extract pulls baked scenes out of a v0 board', () => {
  const html = '<title>Film Scenes</title><script>\nconst SCENES = [{"id":"s01","title":"A","t0":0,"t1":2}];\nconst FULL = {"src":"v/f.mp4","tag":"v1"};\n</script>';
  const { scenes, meta } = extractStatic(html);
  assert.equal(scenes[0].id, 's01');
  assert.deepEqual(meta, { title: 'Film', full: { src: 'v/f.mp4', tag: 'v1' } });
});

test('whenUTC', () => assert.equal(whenUTC(Date.UTC(2026, 9, 16, 3, 57)), 'Oct 16 03:57'));

import { buildSpend, buildCommand } from '../bin/scenes.mjs';

test('spend rows are whole cents with a provider and action', () => {
  assert.deepEqual(buildSpend({ scene: 's03', provider: 'treechat', action: 'seedance2.5hf', cents: '276', now }),
    { scene: 's03', provider: 'treechat', action: 'seedance2.5hf', cents: 276, at: now });
  assert.throws(() => buildSpend({ scene: 's03', provider: 'treechat', action: 'x', cents: '2.76', now }), UsageError);
  assert.throws(() => buildSpend({ scene: 's03', action: 'x', cents: 1, now }), UsageError);
  assert.equal(buildSpend({ scene: 'board', provider: 'fal', action: 'x', cents: 0, now }).scene, 'board');
});

test('bring-your-own commands fill placeholders per argument, never through a shell', () => {
  const tpl = ['my-gen', '--prompt', '{prompt}', '--image', '{ref}', '--out', '{out}'];
  assert.deepEqual(buildCommand(tpl, { prompt: 'a; rm -rf ~ $(x)', ref: 'a.png', out: 'o.mp4' }),
    ['my-gen', '--prompt', 'a; rm -rf ~ $(x)', '--image', 'a.png', '--out', 'o.mp4']);
  assert.deepEqual(buildCommand(tpl, { prompt: 'p', out: 'o.mp4' }), ['my-gen', '--prompt', 'p', '--out', 'o.mp4']);
  assert.deepEqual(buildCommand(['g', 'x={prompt}'], { prompt: 'p' }), ['g', 'x=p']);
  assert.throws(() => buildCommand(['g', 'x={prompt}'], {}), UsageError);
  assert.throws(() => buildCommand('my-gen {prompt}', {}), UsageError);
});
