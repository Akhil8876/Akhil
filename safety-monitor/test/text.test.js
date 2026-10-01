import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandShortMapLink, extractCoordinates, findShortMapLink, parseText } from '../src/text.js';

test('coordinates from the map links people actually paste', () => {
  const cases = [
    ['https://maps.google.com/?q=17.385044,78.486671', [17.385044, 78.486671]],
    ['https://www.google.com/maps/search/?api=1&query=17.4401%2C78.3489', [17.4401, 78.3489]],
    ['https://www.google.com/maps/search/17.3850,+78.4867?entry=tts', [17.385, 78.4867]],
    // A place link: the pin (!3d/!4d) wins over the viewport centre (@...)
    ['https://www.google.com/maps/place/Charminar/@17.3615636,78.4720827,17z/data=!3m1!4b1!4m6!3m5!8m2!3d17.3615687!4d78.4746574', [17.3615687, 78.4746574]],
    ['geo:12.9716,77.5946?z=17', [12.9716, 77.5946]],
    ['https://consent.google.com/ml?continue=https://www.google.com/maps/search/17.42,%2B78.41%3Fentry%3Dtts', [17.42, 78.41]],
    ['https://maps.apple.com/?ll=19.0760,72.8777&q=Pin', [19.076, 72.8777]],
    ['I am at 17.4401, 78.3489 near the bus stop', [17.4401, 78.3489]],
  ];
  for (const [text, [lat, lng]] of cases) assert.deepEqual(extractCoordinates(text), { lat, lng }, text);
});

test('ordinary numbers are not mistaken for coordinates', () => {
  for (const text of ['paid 12.50, 45.00 rupees', 'pin 500001', 'train at 10.30, platform 4', 'q=0,0', '']) {
    assert.equal(extractCoordinates(text), null, text);
  }
});

test('short Google Maps links', () => {
  assert.equal(findShortMapLink('look https://maps.app.goo.gl/AbC123xyz ok'), 'https://maps.app.goo.gl/AbC123xyz');
  assert.equal(findShortMapLink('https://example.com/x'), null);
});

test('short links are expanded through Google redirects only', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('maps.app.goo.gl')) {
      return new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps?q=17.39,78.49&ftid=0' } });
    }
    throw new Error('unexpected fetch');
  };
  assert.deepEqual(await expandShortMapLink('https://maps.app.goo.gl/abc', { fetchImpl: fakeFetch }), { lat: 17.39, lng: 78.49 });
  assert.equal(calls.length, 1, 'stops as soon as the redirect carries coordinates');

  // Never fetch hosts other than Google's, so a message cannot make the server call arbitrary URLs.
  const evil = async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
  assert.equal(await expandShortMapLink('https://maps.app.goo.gl/abc', { fetchImpl: evil }), null);
  assert.equal(await expandShortMapLink('https://evil.test/maps', { fetchImpl: () => assert.fail('fetched') }), null);
});

test('commands, SOS and personal codes', () => {
  const kw = ['sos', 'help', 'bachao'];
  const p = (t) => parseText(t, kw);
  assert.deepEqual(p('SOS 482913'), { isSos: true, command: null, code: '482913' });
  assert.deepEqual(p('ID: 482913 bachao'), { isSos: true, command: null, code: '482913' });
  assert.deepEqual(p('482913'), { isSos: false, command: null, code: '482913' });
  assert.deepEqual(p('TRACK'), { isSos: false, command: 'track', code: null });
  assert.deepEqual(p('track 482913'), { isSos: false, command: 'track', code: '482913' });
  assert.deepEqual(p('live'), { isSos: false, command: 'track', code: null });
  assert.deepEqual(p('stop'), { isSos: false, command: 'stop', code: null });
  assert.deepEqual(p('Stop sharing'), { isSos: false, command: 'stop', code: null });
  assert.deepEqual(p('code'), { isSos: false, command: 'code', code: null });
  // "stop following me" is a cry for help, not the STOP command
  assert.equal(p('stop following me').command, null);
  // A 6-digit postal PIN in an address is not a personal code
  assert.equal(p('Road 5, Hyderabad 500001, please help').code, null);
  assert.equal(p('Road 5, Hyderabad 500001, please help').isSos, true);
  assert.equal(p('helpful driver, thanks').isSos, false);
});
