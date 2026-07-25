export interface CategoryReference {
  id: string | number;
  name: string;
  slug: string;
  parent?: string | number;
}

export interface CategoryTreeItem {
  category: CategoryReference;
  depth: number;
  path: string[];
  ancestorIds: string[];
}

/** Resolve IDs while accepting legacy category names or slugs. */
export function resolveCategoryIds(
  value: unknown,
  categories: readonly CategoryReference[],
  fallback: readonly number[] = [ 1 ]
): number[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [ value ];
  const resolved: number[] = [];

  values.forEach(item => {
    let id: number | undefined;
    if (typeof item === 'number') {
      id = item;
    } else if (typeof item === 'string') {
      const numericId = Number(item);
      if (item.trim() !== '' && Number.isFinite(numericId)) {
        id = numericId;
      } else {
        const category = categories.find(term => term.slug === item || term.name === item);
        if (category) {
          const categoryId = Number(category.id);
          if (Number.isFinite(categoryId)) {
            id = categoryId;
          }
        }
      }
    }

    if (id !== undefined && Number.isFinite(id) && !resolved.includes(id)) {
      resolved.push(id);
    }
  });

  return resolved.length > 0 ? resolved : [ ...fallback ];
}

/** Convert site-specific IDs back to portable slugs for note properties. */
export function categorySlugsForIds(
  ids: readonly number[],
  categories: readonly CategoryReference[]
): string[] {
  return ids
    .map(id => categories.find(category => String(category.id) === String(id)))
    .filter((category): category is CategoryReference => category !== undefined)
    .map(category => category.slug || category.name);
}

/** Order categories as a parent-first tree while tolerating missing or cyclic parents. */
export function buildCategoryTree(categories: readonly CategoryReference[]): CategoryTreeItem[] {
  const byId = new Map(categories.map(category => [ String(category.id), category ]));
  const children = new Map<string, CategoryReference[]>();
  const roots: CategoryReference[] = [];

  categories.forEach(category => {
    const id = String(category.id);
    const parentId = category.parent === undefined || category.parent === null
      ? ''
      : String(category.parent);
    if (!parentId || parentId === '0' || parentId === id || !byId.has(parentId)) {
      roots.push(category);
    } else {
      const siblings = children.get(parentId) ?? [];
      siblings.push(category);
      children.set(parentId, siblings);
    }
  });

  const result: CategoryTreeItem[] = [];
  const visited = new Set<string>();
  const visit = (
    category: CategoryReference,
    depth: number,
    parentPath: string[],
    ancestorIds: string[]
  ) => {
    const id = String(category.id);
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    const categoryPath = [ ...parentPath, category.name ];
    result.push({ category, depth, path: categoryPath, ancestorIds });
    (children.get(id) ?? []).forEach(child => visit(
      child,
      depth + 1,
      categoryPath,
      [ ...ancestorIds, id ]
    ));
  };

  roots.forEach(category => visit(category, 0, [], []));
  categories.forEach(category => visit(category, 0, [], []));
  return result;
}

/** Return matching categories and their ancestors in tree order. */
export function getVisibleCategoryIds(
  items: readonly CategoryTreeItem[],
  query: string
): Set<string> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return new Set(items.map(item => String(item.category.id)));
  }

  const matchedIds = new Set<string>();
  items.forEach(item => {
    const searchableText = [
      item.category.name,
      item.category.slug,
      ...item.path
    ].join(' ').toLocaleLowerCase();
    if (searchableText.includes(normalizedQuery)) {
      matchedIds.add(String(item.category.id));
      item.ancestorIds.forEach(id => matchedIds.add(id));
    }
  });

  return new Set(
    items
      .map(item => String(item.category.id))
      .filter(id => matchedIds.has(id))
  );
}
