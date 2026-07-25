export const BatchPublishState = {
  Idle: 'idle',
  Queued: 'queued',
  Publishing: 'publishing',
  Success: 'success',
  Failure: 'failure',
  Skipped: 'skipped'
} as const;

export type BatchPublishState = typeof BatchPublishState[
  keyof typeof BatchPublishState
];

export interface BatchPublishCounts {
  idle: number;
  queued: number;
  publishing: number;
  success: number;
  failure: number;
  skipped: number;
}

export function isPathInFolder(notePath: string, folderPath: string): boolean {
  const folder = folderPath.replace(/^\/+|\/+$/g, '');
  if (!folder) {
    return true;
  }
  return notePath === folder || notePath.startsWith(folder + '/');
}

export function filterBatchNotePaths(
  notePaths: readonly string[],
  options: {
    folderPath: string;
    query: string;
    selectedPaths?: ReadonlySet<string>;
    onlySelected?: boolean;
  }
): string[] {
  const query = options.query.trim().toLocaleLowerCase();
  return notePaths.filter(notePath => {
    if (!isPathInFolder(notePath, options.folderPath)) {
      return false;
    }
    if (options.onlySelected && !options.selectedPaths?.has(notePath)) {
      return false;
    }
    return !query || notePath.toLocaleLowerCase().includes(query);
  });
}

export function isRetryableBatchState(state: BatchPublishState): boolean {
  return state === BatchPublishState.Failure
    || state === BatchPublishState.Skipped;
}

export function countBatchPublishStates(
  states: readonly BatchPublishState[]
): BatchPublishCounts {
  const counts: BatchPublishCounts = {
    idle: 0,
    queued: 0,
    publishing: 0,
    success: 0,
    failure: 0,
    skipped: 0
  };
  states.forEach(state => {
    counts[state] += 1;
  });
  return counts;
}
