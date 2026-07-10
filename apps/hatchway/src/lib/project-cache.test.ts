import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeProjectUpdate } from './project-cache';

test('applies a ready preview update to the canonical project list', () => {
  const projects = [{
    id: 'project-1',
    name: 'Example',
    status: 'in_progress',
    devServerStatus: 'starting',
    tunnelUrl: null as string | null,
  }];

  const updated = mergeProjectUpdate(projects, {
    ...projects[0],
    status: 'completed',
    devServerStatus: 'running',
    tunnelUrl: 'https://example.railgate.test',
  });

  assert.equal(updated[0].status, 'completed');
  assert.equal(updated[0].devServerStatus, 'running');
  assert.equal(updated[0].tunnelUrl, 'https://example.railgate.test');
  assert.notEqual(updated, projects);
});

test('ignores updates for projects outside the cached list', () => {
  const projects = [{ id: 'project-1', status: 'in_progress' }];
  const updated = mergeProjectUpdate(projects, { id: 'project-2', status: 'completed' });

  assert.equal(updated, projects);
});
