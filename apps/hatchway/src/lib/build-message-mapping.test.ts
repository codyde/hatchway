import assert from 'node:assert/strict';
import test from 'node:test';
import { mapBuildsToRequestMessages } from './build-message-mapping';

const messages = [{ id: 'request-1' }, { id: 'request-2' }, { id: 'request-3' }];

test('uses explicit request identity regardless of session order', () => {
  const buildForSecond = {
    id: 'build-2',
    requestMessageId: 'request-2',
    operationType: 'enhancement',
    startTime: 2,
  };
  const buildForFirst = {
    id: 'build-1',
    requestMessageId: 'request-1',
    operationType: 'initial-build',
    startTime: 1,
  };

  const result = mapBuildsToRequestMessages(messages, [buildForSecond, buildForFirst]);

  assert.equal(result.buildByMessageId.get('request-1'), buildForFirst);
  assert.equal(result.buildByMessageId.get('request-2'), buildForSecond);
  assert.deepEqual(result.unlinkedBuilds, []);
});

test('does not let unlinked auto-fix or retry sessions shift legacy pairings', () => {
  const initial = { id: 'initial', operationType: 'initial-build', startTime: 1 };
  const autoFix = { id: 'autofix', operationType: 'autofix', isAutoFix: true, startTime: 2 };
  const retry = { id: 'retry', operationType: 'continuation', startTime: 3 };
  const enhancement = { id: 'enhancement', operationType: 'enhancement', startTime: 4 };

  const result = mapBuildsToRequestMessages(messages, [enhancement, retry, autoFix, initial]);

  assert.equal(result.buildByMessageId.get('request-1'), initial);
  assert.equal(result.buildByMessageId.get('request-2'), enhancement);
  assert.deepEqual(result.unlinkedBuilds, [autoFix, retry]);
});

test('applies legacy fallback only to messages not consumed by explicit links', () => {
  const linked = {
    id: 'linked',
    requestMessageId: 'request-1',
    operationType: 'initial-build',
    startTime: 2,
  };
  const legacy = { id: 'legacy', operationType: 'enhancement', startTime: 1 };

  const result = mapBuildsToRequestMessages(messages, [linked, legacy]);

  assert.equal(result.buildByMessageId.get('request-1'), linked);
  assert.equal(result.buildByMessageId.get('request-2'), legacy);
});
