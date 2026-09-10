/** Load every REST category page; never return a silently truncated catalog. */
export async function fetchCategoryCatalog<T extends { id: string }>(
  fetchPage: (page: number) => Promise<{ items: T[]; totalPages?: number }>
): Promise<T[]> {
  const catalog = new Map<string, T>();
  for (let page = 1; page <= 1000; page += 1) {
    const { items, totalPages } = await fetchPage(page);
    const previousSize = catalog.size;
    items.forEach(item => catalog.set(item.id, item));
    if (totalPages !== undefined ? page >= totalPages : items.length < 100) {
      return [ ...catalog.values() ];
    }
    if (catalog.size === previousSize) {
      throw new Error('WordPress category pagination did not advance. Please retry.');
    }
  }
  throw new Error('WordPress category catalog exceeded the pagination limit.');
}

/** Resolve only selected terms and their ancestors, including legacy names. */
export async function fetchSelectedCategories<T extends {
  id: string; name: string; slug: string; parent?: string | number;
}>(
  values: readonly (string | number)[],
  fetchTerms: (filter: { include?: string; slug?: string; search?: string }) => Promise<T[]>
): Promise<T[]> {
  const groups = await Promise.all(values.map(async value => {
    const reference = String(value).trim();
    if (/^[1-9]\d*$/.test(reference)) return fetchTerms({ include: reference });
    const bySlug = await fetchTerms({ slug: reference });
    if (bySlug.some(term => term.slug === reference)) return bySlug;
    return (await fetchTerms({ search: reference }))
      .filter(term => term.name === reference || term.slug === reference);
  }));
  const terms = new Map(groups.flat().map(term => [ term.id, term ]));
  const requested = new Set(terms.keys());
  for (let level = 0; level < 100; level += 1) {
    const parents = [ ...new Set([ ...terms.values() ].map(term => String(term.parent ?? 0)))]
      .filter(id => id !== '0' && !requested.has(id));
    if (parents.length === 0) return [ ...terms.values() ];
    parents.forEach(id => requested.add(id));
    const ancestors = await Promise.all(parents.map(include => fetchTerms({ include })));
    ancestors.flat().forEach(term => terms.set(term.id, term));
  }
  throw new Error('WordPress category hierarchy exceeded the depth limit.');
}
