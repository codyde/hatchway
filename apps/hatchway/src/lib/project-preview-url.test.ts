import assert from 'node:assert/strict';
import test from 'node:test';
import { getProjectPreviewUrl } from './project-preview-url';

test('uses the tunnel URL when one is available', () => {
  assert.equal(getProjectPreviewUrl({
    executionMode: 'sandbox',
    tunnelUrl: 'https://preview.example.test',
    devServerPort: 4173,
  }), 'https://preview.example.test');
});

test('does not expose a localhost URL for a sandbox without a tunnel', () => {
  assert.equal(getProjectPreviewUrl({
    executionMode: 'sandbox',
    tunnelUrl: null,
    devServerPort: 4173,
  }), null);
});

test('uses the active local development server port', () => {
  assert.equal(getProjectPreviewUrl({
    executionMode: 'local',
    devServerPort: 5173,
    port: 3000,
  }), 'http://localhost:5173');
});

test('returns no URL when a local project has no known port', () => {
  assert.equal(getProjectPreviewUrl({ executionMode: 'local' }), null);
});
