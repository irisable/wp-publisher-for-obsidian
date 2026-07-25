import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const { SyncState } = await importTypescriptModule(
  new URL('../src/sync-baseline.ts', import.meta.url)
);
const { safeSyncActions, SyncWorkflowAction } = await importTypescriptModule(
  new URL('../src/sync-workflow.ts', import.meta.url)
);

test('offers exactly one reviewed write direction for each classified state', () => {
  assert.equal(safeSyncActions(SyncState.LocalOnly)[0], SyncWorkflowAction.Push);
  assert.equal(safeSyncActions(SyncState.RemoteOnly)[0], SyncWorkflowAction.Pull);
  assert.equal(safeSyncActions(SyncState.Diverged)[0], SyncWorkflowAction.Merge);
  assert.equal(safeSyncActions(SyncState.Unknown)[0], SyncWorkflowAction.Pull);
  assert.ok(!safeSyncActions(SyncState.InSync).includes(SyncWorkflowAction.Push));
  assert.ok(!safeSyncActions(SyncState.RemoteMissing).includes(SyncWorkflowAction.Pull));
});
