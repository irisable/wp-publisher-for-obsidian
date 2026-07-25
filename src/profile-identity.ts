import type { WpProfile } from './wp-profile';

const PROFILE_ID_PREFIX = 'wp-profile-';

function normalizedProfileId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const id = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/.test(id) ? id : undefined;
}

export function createProfileId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return PROFILE_ID_PREFIX + randomUuid;
  }
  return PROFILE_ID_PREFIX
    + Date.now().toString(36)
    + '-'
    + Math.random().toString(36).slice(2, 12);
}

/** Add rename-safe identities to legacy profiles and repair duplicate IDs. */
export function ensureStableProfileIds(
  profiles: WpProfile[],
  idFactory: () => string = createProfileId
): boolean {
  const used = new Set<string>();
  let changed = false;

  profiles.forEach((profile, index) => {
    const existing = normalizedProfileId(profile.id);
    if (existing && !used.has(existing)) {
      if (profile.id !== existing) {
        profile.id = existing;
        changed = true;
      }
      used.add(existing);
      return;
    }

    const generatedBase = normalizedProfileId(idFactory())
      ?? PROFILE_ID_PREFIX + (index + 1);
    let generated = generatedBase;
    let suffix = 2;
    while (used.has(generated)) {
      generated = generatedBase + '-' + suffix;
      suffix += 1;
    }
    profile.id = generated;
    used.add(generated);
    changed = true;
  });

  return changed;
}
