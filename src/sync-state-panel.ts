import type { TranslateKey } from './i18n';
import type {
  SyncBaseline,
  SyncStateResult
} from './sync-baseline';
import {
  syncStateDescriptionKey,
  syncStateLabelKey,
  syncStateMark
} from './sync-state-presentation';

type Translator = (key: TranslateKey, vars?: Record<string, string>) => string;

function createFact(parent: HTMLElement, label: string, value: string): void {
  const fact = parent.createDiv();
  fact.createSpan({ text: label });
  fact.createEl('strong', { text: value });
}

export function renderSyncStatePanel(options: {
  parent: HTMLElement;
  result: SyncStateResult;
  baseline?: SyncBaseline;
  t: Translator;
  dateLabel: (value: string | undefined) => string;
}): HTMLElement {
  const { result, baseline, t } = options;
  const panel = options.parent.createEl('section', {
    cls: 'wp-publisher-sync-state is-' + result.state
  });
  panel.createDiv({
    cls: 'wp-publisher-sync-state-mark',
    text: syncStateMark(result.state)
  });
  const copy = panel.createDiv({ cls: 'wp-publisher-sync-state-copy' });
  copy.createSpan({
    cls: 'wp-publisher-sync-state-kicker',
    text: t('syncState_heading')
  });
  copy.createEl('h2', { text: t(syncStateLabelKey(result.state)) });
  copy.createEl('p', { text: t(syncStateDescriptionKey(result.state)) });

  const facts = panel.createDiv({ cls: 'wp-publisher-sync-state-facts' });
  createFact(
    facts,
    t('syncState_lastAgreed'),
    baseline
      ? options.dateLabel(baseline.lastAgreedAt)
      : t('syncState_notEstablished')
  );
  createFact(
    facts,
    t('syncState_trackedFields'),
    String(baseline ? Object.keys(baseline.fields).length : 0)
  );
  if (baseline) {
    createFact(
      facts,
      t('syncState_localChanges'),
      String(result.localChangedFields.length)
    );
    createFact(
      facts,
      t('syncState_remoteChanges'),
      String(result.remoteChangedFields.length)
    );
  }
  if (result.remoteMarkerChanged) {
    panel.createDiv({
      cls: 'wp-publisher-sync-state-note',
      text: t('syncState_remoteMarkerChanged')
    });
  }
  return panel;
}
