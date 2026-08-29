import type { MatterData } from './types';
import type { WpProfile } from './wp-profile';
import type { MultiSiteTarget } from './multi-site-targets';
import type { PublishingTemplate } from './publishing-templates';
import { applyPublishingTemplate } from './publishing-templates';
import { readPublishFrontMatter } from './front-matter';
import { resolveProfilePublishingDefaults } from './profile-publishing-defaults';
import {
  PublishUpdateStrategy,
  type PublishUpdateStrategy as PublishUpdateStrategyValue
} from './publish-strategy';
import { PostTypeConst, type CommentStatus, type PostStatus } from './wp-api';
import type { WordPressPostParams } from './wp-client';
import { parseSeriesFrontMatter } from './series';

export interface BuildCoordinatedPostParamsOptions {
  profile: Pick<WpProfile, 'publishDefaults' | 'lastSelectedCategories'>;
  globalDefaults: {
    status: PostStatus;
    commentStatus: CommentStatus;
  };
  matter: MatterData;
  template?: PublishingTemplate;
  target?: MultiSiteTarget;
  updateStrategy?: PublishUpdateStrategyValue;
}

/** Season labels are site-owned, so the first Series release reviews them one site at a time. */
export function requiresSingleSiteSeriesReview(matter: MatterData): boolean {
  const parsed = parseSeriesFrontMatter(matter);
  return parsed.intent?.kind === 'placement'
    && parsed.intent.placement.seriesSeason !== undefined;
}

/** Build the non-content fields shared by multi-site and batch publishing. */
export function buildCoordinatedPostParams(
  options: BuildCoordinatedPostParamsOptions
): WordPressPostParams {
  const defaults = resolveProfilePublishingDefaults(
    options.profile,
    options.globalDefaults
  );
  const publishMetadata = readPublishFrontMatter(options.matter);
  const availablePostTypes = [
    options.target?.postType,
    publishMetadata.postType,
    options.template?.postType,
    defaults.postType,
    PostTypeConst.Post
  ].filter((value, index, values): value is string =>
    Boolean(value) && values.indexOf(value) === index
  );
  const fields = applyPublishingTemplate(
    defaults,
    options.template,
    options.matter,
    availablePostTypes,
    options.target?.postType ?? publishMetadata.postType
  );
  return {
    status: fields.status,
    commentStatus: fields.commentStatus,
    categories: options.profile.lastSelectedCategories ?? [ 1 ],
    postType: fields.postType,
    tags: fields.tags,
    title: '',
    content: '',
    updateStrategy: options.target
      ? options.updateStrategy ?? PublishUpdateStrategy.Full
      : PublishUpdateStrategy.Full
  };
}
