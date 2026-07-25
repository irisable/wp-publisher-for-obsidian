import type { TranslateKey } from './i18n';
import { SyncState, type SyncState as SyncStateValue } from './sync-baseline';

export function syncStateLabelKey(state: SyncStateValue): TranslateKey {
  switch (state) {
    case SyncState.InSync:
      return 'syncState_inSync';
    case SyncState.LocalOnly:
      return 'syncState_localOnly';
    case SyncState.RemoteOnly:
      return 'syncState_remoteOnly';
    case SyncState.Diverged:
      return 'syncState_diverged';
    case SyncState.RemoteMissing:
      return 'syncState_remoteMissing';
    default:
      return 'syncState_unknown';
  }
}

export function syncStateDescriptionKey(state: SyncStateValue): TranslateKey {
  switch (state) {
    case SyncState.InSync:
      return 'syncState_inSyncDescription';
    case SyncState.LocalOnly:
      return 'syncState_localOnlyDescription';
    case SyncState.RemoteOnly:
      return 'syncState_remoteOnlyDescription';
    case SyncState.Diverged:
      return 'syncState_divergedDescription';
    case SyncState.RemoteMissing:
      return 'syncState_remoteMissingDescription';
    default:
      return 'syncState_unknownDescription';
  }
}

export function syncStateMark(state: SyncStateValue): string {
  switch (state) {
    case SyncState.InSync:
      return 'OK';
    case SyncState.LocalOnly:
      return 'OB';
    case SyncState.RemoteOnly:
      return 'WP';
    case SyncState.Diverged:
      return '!';
    case SyncState.RemoteMissing:
      return '404';
    default:
      return '?';
  }
}
