import type { TFile } from 'obsidian';
import { CommentStatus, PostStatus, PostType } from './wp-api';
import type { PublishUpdateStrategy } from './publish-strategy';
import type { MatterData } from './types';
import type { RemotePostSnapshot, RemotePostTarget } from './remote-post';
import type { PullField } from './sync-diff';
import type { PublishHistoryAction } from './publish-history';

export enum WordPressClientReturnCode {
  OK,
  Error,
  ServerInternalError,
}

interface _wpClientResult {
  /**
   * Response from WordPress server.
   */
  response?: unknown;

  code: WordPressClientReturnCode;
}

interface WpClientOkResult<T> extends _wpClientResult {
  code: WordPressClientReturnCode.OK;
  data: T;
}

interface WpClientErrorResult extends _wpClientResult {
  code: WordPressClientReturnCode.Error;
  error: {
    /**
     * This code could be returned from remote server
     */
    code: WordPressClientReturnCode | string;
    message: string;
  }
}

export type WordPressClientResult<T> =
  | WpClientOkResult<T>
  | WpClientErrorResult;

export interface WordPressAuthParams {
  username: string | null;
  password: string | null;
}

export interface WordPressPostParams {
  status: PostStatus;
  commentStatus: CommentStatus;
  categories: number[];
  postType: PostType;
  tags: string[];

  /**
   * Post title.
   */
  title: string;

  /**
   * Post content.
   */
  content: string;

  /** Optional editorial metadata. */
  slug?: string;
  excerpt?: string;
  featuredImage?: string;
  featuredMediaId?: number;
  focusKeyword?: string;
  metaDescription?: string;
  secondaryTitle?: string;
  /** Attachment metadata extracted from image-adjacent `wp-media` comments. */
  mediaMetadata?: import('./media-metadata').MediaMetadataMap;

  /** Fields to update when publishing an existing WordPress post. */
  updateStrategy?: PublishUpdateStrategy;
  /** Exact reviewed fields included by a three-way merge update. */
  updateFields?: PullField[];

  /**
   * WordPress post ID.
   *
   * If this is assigned, the post will be updated, otherwise created.
   */
  postId?: string;

  /**
   * WordPress profile name.
   */
  profileName?: string;

  datetime?: Date;
}

export interface WordPressPublishParams extends WordPressAuthParams {
  postParams: WordPressPostParams;
  matterData: MatterData;
}

export interface WordPressPublishResult {
  postId: string;
  categories: number[];
  warnings?: string[];
  /** Whether a strong post-publish readback established the new baseline. */
  syncBaselineUpdated?: boolean;
}

export interface WordPressMediaUploadResult {
  url: string;
  id?: string | number;
  metadataApplied?: boolean;
}

export type WordPressPublishTarget =
  | { mode: 'create' }
  | { mode: 'update'; postId: string; postType?: PostType };

export interface WordPressSourceSnapshot {
  title: string;
  content: string;
  matter: MatterData;
}

export interface WordPressPublishOptions {
  /** Lock publishing to this file instead of whichever editor is active later. */
  sourceFile?: TFile;
  /** Freeze one note revision across every target in a coordinated operation. */
  sourceSnapshot?: WordPressSourceSnapshot;
  /** Bypass front-matter target inference for controlled multi-target workflows. */
  target?: WordPressPublishTarget;
  /** Keep the legacy single-site front-matter write-back unless explicitly disabled. */
  writeBackToNote?: boolean;
  /** Override whether uploaded media URLs replace links in the source note. */
  replaceMediaLinks?: boolean;
  /** Suppress per-target notices when a coordinator presents combined results. */
  showNotices?: boolean;
  /** Override the post-publish browser confirmation. */
  showEditConfirm?: boolean;
  /** Reuse validated credentials and media checks within one bounded queue. */
  reuseSession?: boolean;
  /** Record a controlled workflow under its own activity action. */
  historyAction?: PublishHistoryAction;
}

export interface WordPressClient {

  /**
   * Publish a post to WordPress.
   *
   * If there is a `postId` in front-matter, the post will be updated,
   * otherwise, create a new one.
   *
   * @param defaultPostParams Use this parameter instead of popup publish modal if this is not undefined.
   */
  publishPost(
    defaultPostParams?: WordPressPostParams,
    options?: WordPressPublishOptions
  ): Promise<WordPressClientResult<WordPressPublishResult>>;

  /** Fetch one explicit linked post without mutating either side. */
  fetchPost(
    target: RemotePostTarget
  ): Promise<WordPressClientResult<RemotePostSnapshot>>;

  /**
   * Checks if the login certificate is OK.
   * @param certificate
   */
  validateUser(certificate: WordPressAuthParams): Promise<WordPressClientResult<boolean>>;

}
