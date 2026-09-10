import assert from 'node:assert/strict';
import test from 'node:test';
import { PublishPanelResource } from '../src/publish-panel-resource.ts';

const deferred = () => Promise.withResolvers();

test('reports loading immediately without waiting for a slow server', async () => {
  const resource = new PublishPanelResource();
  const server = deferred();
  const states = [];
  resource.onChange = () => states.push(resource.status);
  const pending = resource.load(() => server.promise);
  assert.equal(resource.status, 'loading');
  assert.deepEqual(states, ['loading']);
  server.resolve(['selected-series']);
  await pending;
  assert.equal(resource.status, 'ready');
  assert.deepEqual(resource.value, ['selected-series']);
});

test('late success or failure from a previous post type cannot replace the current one', async () => {
  for (const fail of [false, true]) {
    const resource = new PublishPanelResource();
    const old = deferred();
    const pending = resource.load(() => old.promise);
    await resource.load(async () => ({ type: 'page' }));
    if (fail) old.reject(new Error('old post request failed'));
    else old.resolve({ type: 'post' });
    await pending;
    assert.equal(resource.status, 'ready');
    assert.deepEqual(resource.value, { type: 'page' });
    assert.equal(resource.error, '');
  }
});

test('closing the modal discards pending responses and prevents further loads', async () => {
  const resource = new PublishPanelResource();
  const server = deferred();
  let changes = 0;
  resource.onChange = () => changes++;
  const pending = resource.load(() => server.promise);
  resource.close();
  server.resolve(['late taxonomy']);
  await pending;
  await resource.load(() => assert.fail('closed modal started a request'));
  assert.equal(changes, 1);
  assert.equal(resource.value, undefined);
});

test('a failed catalog refresh retains existing choices and can be retried', async () => {
  const resource = new PublishPanelResource();
  await resource.load(async () => ['selected']);
  await resource.load(async () => { throw new Error('offline'); });
  assert.equal(resource.status, 'error');
  assert.equal(resource.error, 'offline');
  assert.deepEqual(resource.value, ['selected']);
  await resource.load(async () => ['selected', 'another']);
  assert.equal(resource.status, 'ready');
  assert.equal(resource.error, '');
  assert.deepEqual(resource.value, ['selected', 'another']);
});
