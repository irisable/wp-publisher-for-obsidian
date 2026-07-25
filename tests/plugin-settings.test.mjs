import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypescriptModule } from './import-typescript-module.mjs';

const {
  DEFAULT_SETTINGS,
  SettingsVersion,
  upgradeSettings
} = await importTypescriptModule(
  new URL('../src/plugin-settings.ts', import.meta.url)
);

test('shows the ribbon icon by default on a fresh installation', () => {
  assert.equal(DEFAULT_SETTINGS.showRibbonIcon, true);
});

test('preserves an explicit ribbon preference while upgrading legacy settings', async () => {
  const enabled = await upgradeSettings({}, SettingsVersion.V2);
  const disabled = await upgradeSettings(
    { showRibbonIcon: false },
    SettingsVersion.V2
  );

  assert.equal(enabled.settings.showRibbonIcon, true);
  assert.equal(disabled.settings.showRibbonIcon, false);
});
