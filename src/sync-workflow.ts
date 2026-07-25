import { SyncState, type SyncState as SyncStateValue } from './sync-baseline';

export const SyncWorkflowAction = {
  Push: 'push',
  Pull: 'pull',
  Merge: 'merge',
  OpenWordPress: 'open-wordpress',
  Refresh: 'refresh'
} as const;

export type SyncWorkflowAction = typeof SyncWorkflowAction[
  keyof typeof SyncWorkflowAction
];

export function safeSyncActions(state: SyncStateValue): SyncWorkflowAction[] {
  switch (state) {
    case SyncState.LocalOnly:
      return [
        SyncWorkflowAction.Push,
        SyncWorkflowAction.OpenWordPress,
        SyncWorkflowAction.Refresh
      ];
    case SyncState.RemoteOnly:
      return [
        SyncWorkflowAction.Pull,
        SyncWorkflowAction.OpenWordPress,
        SyncWorkflowAction.Refresh
      ];
    case SyncState.Diverged:
      return [
        SyncWorkflowAction.Merge,
        SyncWorkflowAction.OpenWordPress,
        SyncWorkflowAction.Refresh
      ];
    case SyncState.Unknown:
      return [
        SyncWorkflowAction.Pull,
        SyncWorkflowAction.OpenWordPress,
        SyncWorkflowAction.Refresh
      ];
    default:
      return [ SyncWorkflowAction.OpenWordPress, SyncWorkflowAction.Refresh ];
  }
}
