import type { MatterData } from './types';
import { writeBackSeriesGroup } from './front-matter';
import { composePulledNoteRevision } from './sync-diff';
import {
  applyGuardedNoteRevision,
  freezeNoteRevision,
  type AtomicNoteStore,
  type FrozenNoteRevision,
  type PullRestoreSnapshot
} from './note-sync-transaction';

/** Keep canonicalization in the same guarded revision and undo transaction as the merge. */
export async function writeBackMergedSeriesGroup<FileRef>(options: {
  store: AtomicNoteStore<FileRef>;
  file: FileRef;
  frozen: FrozenNoteRevision;
  matter: MatterData;
  canonical: string;
  restoreSnapshot: PullRestoreSnapshot;
  stringifyMatter: (matter: MatterData) => string;
  saveRestore: (snapshot: PullRestoreSnapshot) => Promise<void>;
}): Promise<{
  frozen: FrozenNoteRevision;
  matter: MatterData;
  restoreSnapshot: PullRestoreSnapshot;
}> {
  const { frozen, restoreSnapshot } = options;
  if (options.matter.seriesGroup === options.canonical) {
    return { frozen, matter: options.matter, restoreSnapshot };
  }
  const matter = { ...options.matter };
  writeBackSeriesGroup(matter, options.matter, options.canonical);
  const raw = composePulledNoteRevision({
    raw: frozen.content,
    serializedMatter: options.stringifyMatter(matter)
  });
  const next = await freezeNoteRevision(raw);
  const updatedRestore = { ...restoreSnapshot, appliedHash: next.hash };
  await options.saveRestore(updatedRestore);
  try {
    await applyGuardedNoteRevision(options.store, options.file, frozen, raw);
  } catch (error) {
    await options.saveRestore(restoreSnapshot);
    throw error;
  }
  return { frozen: next, matter, restoreSnapshot: updatedRestore };
}
