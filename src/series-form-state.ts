import {
  SeriesRole, SeriesScope, SeriesStructure,
  type PortableSeriesPlacement, type SeriesDefinition, type SeriesPlacementIntent
} from './series';

export function selectSeriesDefinition(
  current: SeriesPlacementIntent | undefined,
  definition: SeriesDefinition
): SeriesPlacementIntent {
  return {
    kind: 'placement',
    placement: current?.kind === 'placement' && current.placement.series === definition.slug
      ? { ...current.placement }
      : { series: definition.slug, seriesRole: SeriesRole.Article }
  };
}

export function changeSeriesRole(
  placement: PortableSeriesPlacement,
  role: SeriesRole,
  definition: SeriesDefinition
): PortableSeriesPlacement {
  const next = { ...placement, seriesRole: role };
  if (role === SeriesRole.Article) {
    delete next.seriesScope;
  } else if (!next.seriesScope && (placement.seriesRole === SeriesRole.Article
    || definition.structure === SeriesStructure.Flat)) {
    next.seriesScope = definition.structure === SeriesStructure.Seasoned
      && next.seriesSeason !== undefined ? SeriesScope.Season : SeriesScope.Series;
  }
  if (definition.structure === SeriesStructure.Flat || next.seriesScope === SeriesScope.Series) {
    delete next.seriesSeason;
  }
  return next;
}

export function changeSeriesScope(
  placement: PortableSeriesPlacement,
  scope: SeriesScope | undefined
): PortableSeriesPlacement {
  const next = { ...placement };
  if (next.seriesRole === SeriesRole.Article || scope === undefined) delete next.seriesScope;
  else next.seriesScope = scope;
  if (next.seriesScope === SeriesScope.Series) delete next.seriesSeason;
  return next;
}

export function showsSeriesSeason(
  placement: PortableSeriesPlacement,
  definition: SeriesDefinition
): boolean {
  return definition.structure === SeriesStructure.Seasoned
    && (placement.seriesRole === SeriesRole.Article || placement.seriesScope !== SeriesScope.Series);
}
