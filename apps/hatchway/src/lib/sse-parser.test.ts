import assert from 'node:assert/strict';
import test from 'node:test';
import { createSSEPayloadParser } from './sse-parser';

test('carries an unfinished physical line across arbitrary chunks', () => {
  const parser = createSSEPayloadParser();
  const frame = 'data: {"type":"text-delta","delta":"hello"}\n\n';
  const payloads = [...frame].flatMap((character) => parser.push(character));

  assert.deepEqual(payloads, ['{"type":"text-delta","delta":"hello"}']);
});

test('handles CRLF boundaries split across chunks', () => {
  const parser = createSSEPayloadParser();

  assert.deepEqual(parser.push('data: first\r'), []);
  assert.deepEqual(parser.push('\ndata: second\r'), []);
  assert.deepEqual(parser.push('\n\r'), []);
  assert.deepEqual(parser.push('\n'), ['first\nsecond']);
});

test('ignores comments and emits multiple complete events', () => {
  const parser = createSSEPayloadParser();
  const payloads = parser.push(': keep-alive\n\ndata: one\n\ndata: two\n\n');

  assert.deepEqual(payloads, ['one', 'two']);
});

test('flushes a final event without a trailing blank line', () => {
  const parser = createSSEPayloadParser();

  assert.deepEqual(parser.push('data: [DONE]'), []);
  assert.deepEqual(parser.finish(), ['[DONE]']);
});
