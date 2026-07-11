import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadPendingAuthDraft,
  parsePendingAuthDraft,
  type PendingAuthDraft,
} from './pending-auth-draft';

function draft(savedAt: number): PendingAuthDraft {
  return {
    version: 1,
    savedAt,
    text: 'Build from this screenshot',
    images: [{
      type: 'image',
      image: `data:image/png;base64,${'a'.repeat(6 * 1024 * 1024)}`,
      mimeType: 'image/png',
      fileName: 'large.png',
    }],
    project: null,
    buildConfig: {
      appliedTags: [{ key: 'model', value: 'claude-sonnet-4-6', appliedAt: new Date(savedAt).toISOString() }],
      selectedAgentId: 'claude-code',
      selectedClaudeModelId: 'claude-sonnet-4-6',
      selectedRunnerId: 'runner-1',
      executionMode: 'sandbox',
    },
  };
}

test('preserves image payloads larger than sessionStorage quotas', () => {
  const savedAt = Date.now();
  const parsed = parsePendingAuthDraft(draft(savedAt), savedAt);

  assert.equal(parsed?.images[0].image.length, 6 * 1024 * 1024 + 'data:image/png;base64,'.length);
  assert.equal(parsed?.buildConfig.appliedTags[0].value, 'claude-sonnet-4-6');
});

test('rejects expired or malformed recovery records', () => {
  const savedAt = Date.now();

  assert.equal(parsePendingAuthDraft(draft(savedAt), savedAt + 25 * 60 * 60 * 1000), null);
  assert.equal(parsePendingAuthDraft({ ...draft(savedAt), images: [{ type: 'image', image: 'not-a-data-url' }] }, savedAt), null);
});

test('is safe to load during server rendering without IndexedDB', async () => {
  assert.equal(await loadPendingAuthDraft(), null);
});
