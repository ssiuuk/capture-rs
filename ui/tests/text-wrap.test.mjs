import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapLines } from '../text-wrap.js';

// Every character is 10 px wide, so a 50 px line holds five.
const width = (s) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)).length * 10;

test('breaks between words', () => {
  assert.deepEqual(wrapLines('hello world foo', 110, width), ['hello world', 'foo']);
  assert.deepEqual(wrapLines('one two\nthree', 200, width), ['one two', 'three']);
});

test('splits a long first word', () => {
  assert.deepEqual(wrapLines('abcdefghijkl', 50, width), ['abcde', 'fghij', 'kl']);
});

test('splits a long later word onto its own lines', () => {
  assert.deepEqual(wrapLines('hi abcdefghijkl', 50, width), ['hi', 'abcde', 'fghij', 'kl']);
});

test('splits unspaced CJK text', () => {
  assert.deepEqual(wrapLines('这是一个没有空格的句子', 50, width), ['这是一个没', '有空格的句', '子']);
});

test('never splits a grapheme', () => {
  const family = '👨‍👩‍👧';
  const lines = wrapLines(family.repeat(7), 50, width);
  assert.deepEqual(lines, [family.repeat(5), family.repeat(2)]);
});

test('keeps empty lines and drops overflowing spaces', () => {
  assert.deepEqual(wrapLines('a\n\nb', 50, width), ['a', '', 'b']);
  assert.deepEqual(wrapLines('abcd      efg', 50, width), ['abcd', 'efg']);
});
