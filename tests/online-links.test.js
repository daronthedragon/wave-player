import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaLink, loadSavedLinks } from '../src/online-links.js';

const video = 'dQw4w9WgXcQ';
const playlist = 'PL1234567890_ab-CD';

test('YouTube share, watch, shorts, live and embed URLs normalize to the same video', () => {
  for (const input of [
    `https://youtu.be/${video}?si=tracking`,
    `youtube.com/watch?v=${video}`,
    `http://m.youtube.com/shorts/${video}`,
    `https://www.youtube.com/live/${video}/`,
    `https://www.youtube.com/embed/${video}`
  ]) {
    const link = parseMediaLink(input);
    assert.equal(link.id, `youtube:video:${video}`);
    assert.equal(link.url, `https://www.youtube.com/watch?v=${video}`);
    assert.equal(link.embedUrl, `https://www.youtube-nocookie.com/embed/${video}?playsinline=1`);
  }
});

test('playlist-only links remain playlists and video links retain playlist context', () => {
  const list = parseMediaLink(`https://youtube.com/playlist?list=${playlist}`);
  assert.equal(list.id, `youtube:playlist:${playlist}`);
  assert.equal(new URL(list.embedUrl).pathname, '/embed/videoseries');
  const withVideo = parseMediaLink(`https://youtube.com/watch?v=${video}&list=${playlist}`);
  assert.equal(withVideo.id, `youtube:video:${video}`);
  assert.equal(new URL(withVideo.embedUrl).searchParams.get('list'), playlist);
  assert.equal(new URL(withVideo.embedUrl).pathname, `/embed/${video}`);
  assert.throws(() => parseMediaLink(`https://youtube.com/watch?v=bad&list=${playlist}`));
  assert.throws(() => parseMediaLink('https://youtube.com/playlist?list=%3Cscript%3E'));
});

test('safe YouTube timestamps are retained; invalid and overflowing values are ignored', () => {
  for (const [suffix, expected] of [['?t=1h2m3s', '3723'], ['?start=90', '90'], ['#t=4m', '240'], ['?t=-2', null], ['?t=2;alert(1)', null], ['?t=99999999999999999999999', null]]) {
    assert.equal(new URL(parseMediaLink(`https://youtu.be/${video}${suffix}`).embedUrl).searchParams.get('start'), expected);
  }
});

test('SoundCloud track and set URLs normalize to the official widget with no tracking parameters', () => {
  for (const path of ['/artist/my-track', '/artist/sets/my-playlist']) {
    const link = parseMediaLink(`https://m.soundcloud.com${path}/?utm_source=clipboard`);
    assert.equal(link.url, `https://soundcloud.com${path}`);
    assert.equal(link.provider, 'soundcloud');
    const embed = new URL(link.embedUrl);
    assert.equal(embed.origin, 'https://w.soundcloud.com');
    assert.equal(embed.searchParams.get('url'), link.url);
    assert.equal(embed.searchParams.get('auto_play'), 'false');
  }
  assert.throws(() => parseMediaLink('https://on.soundcloud.com/abc123'), /full soundcloud.com/);
  for (const path of ['/artist', '/artist/sets', '/search/sounds', '/artist/sets/a/extra']) {
    assert.throws(() => parseMediaLink(`https://soundcloud.com${path}`));
  }
});

test('rejects scripts, lookalike hosts, credentials, ports, malformed and non-video paths', () => {
  for (const input of [
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    `https://youtube.com.evil.test/watch?v=${video}`, `https://youtube.com@evil.test/watch?v=${video}`,
    `https://evil.test@youtube.com/watch?v=${video}`, `https://youtube.com:443/watch?v=${video}`,
    `https://youtube.com:8443/watch?v=${video}`, `https://youtube.com\\@evil.test/watch?v=${video}`,
    `https://youtube.com/watch?v=${video.slice(1)}`, `https://youtu.be/${video}/extra`,
    `https://youtube.com/watch?v=${video}%22`, 'https://soundcloud.com.evil.test/artist/track',
    'https://soundcloud.com/artist/%3Cscript%3E', 'https://soundcloud.com/artist/my track',
    `ftp://youtube.com/watch?v=${video}`, '', null, {}, 'https://youtube.com/channel/anything'
  ]) assert.throws(() => parseMediaLink(input), Error, String(input));
});

test('saved links are reparsed, deduplicated and bounded instead of trusting stored embeds', () => {
  const result = loadSavedLinks(JSON.stringify([
    { url: `https://youtu.be/${video}`, title: '  Custom\u0000 name  ', id: 'forged', provider: 'evil', embedUrl: 'javascript:alert(1)' },
    { url: `https://youtube.com/watch?v=${video}`, title: 'Duplicate' },
    { url: 'https://evil.test/attack', title: 'Bad' },
    { url: 'https://soundcloud.com/artist/track', title: 'a'.repeat(150) },
    null, ['array'], { url: null }
  ]));
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'Custom name');
  assert.equal(result[0].provider, 'youtube');
  assert.equal(result[0].id, `youtube:video:${video}`);
  assert.equal(new URL(result[0].embedUrl).host, 'www.youtube-nocookie.com');
  assert.equal(result[1].title.length, 100);
  assert.equal(loadSavedLinks(JSON.stringify(Array.from({ length: 110 }, (_, i) => ({ url: `https://soundcloud.com/artist/track-${i}` })))).length, 100);
});

test('malformed or non-array storage returns an empty list', () => {
  for (const value of [undefined, null, '', '{', '{}', 'null', 'true', '42', '"array"', ' '.repeat(1000001)]) {
    assert.deepEqual(loadSavedLinks(value), []);
  }
});
