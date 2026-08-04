import { Notice, TFile } from 'obsidian';
import WordpressPlugin from './main';
import {
  WordPressAuthParams,
  WordPressClient,
  WordPressClientResult,
  WordPressClientReturnCode,
  WordPressMediaUploadResult,
  WordPressPostParams,
  WordPressPublishOptions,
  WordPressPublishResult
} from './wp-client';
import { WpPublishModal } from './wp-publish-modal';
import { PostStatus, PostType, PostTypeConst, Term } from './wp-api';
import { ERROR_NOTICE_TIMEOUT } from './consts';
import { isPromiseFulfilledResult, openWithBrowser, processFile, showError, } from './utils';
import { WpProfile } from './wp-profile';
import { AppState } from './app-state';
import { ConfirmCode, openConfirmModal } from './confirm-modal';
import fileTypeChecker from 'file-type-checker';
import { MatterData, Media } from './types';
import { openPostPublishedModal } from './post-published-modal';
import { openLoginModal } from './wp-login-modal';
import {
  fillExcerptFromMetaDescription,
  readEditorialFrontMatter,
  readPublishingControlFrontMatter,
  readPublishFrontMatter,
  resolveWordPressTitle,
  updatePublishFrontMatter
} from './front-matter';
import { applyTextReplacements, TextReplacement } from './content-replacements';
import { categorySlugsForIds, resolveCategoryIds } from './categories';
import { determinePublishTarget, PublishTarget, PublishTargetMode } from './publish-target';
import {
  scheduledPublishErrorKey,
  validateScheduledPublishDate
} from './scheduled-publish';
import {
  EditorialMetadataCapabilities,
  parseFeaturedImageReference
} from './editorial-metadata';
import { renderWordPressPostContent } from './wordpress-blocks';
import {
  findCachedMedia,
  forgetCachedMedia,
  mediaContentHash,
  rememberMediaMetadata,
  rememberMediaUpload
} from './media-cache';
import {
  resolveProfilePublishingDefaults,
  resolvePublishingTags,
  selectAvailablePostType
} from './profile-publishing-defaults';
import {
  buildUploadedImageReference,
  extractMediaMetadataBlocks,
  getMarkdownImages,
  imageCaptionsFromMetadata,
  mediaMetadataNeedsUpdate,
  resolveImageCaptionMetadata,
  resolveMediaMetadata,
  type ImageCaptionMetadata,
  type MediaMetadata
} from './media-metadata';
import { isContentOnlyUpdate, isMergeUpdate } from './publish-strategy';
import { rememberMultiSiteTarget } from './multi-site-targets';
import {
  addPublishHistoryEntry,
  createPublishHistoryEntry,
  formatLocalPublishTimestamp,
  PublishHistoryOutcome,
  resolvePublishHistoryAction,
  type PublishHistoryAction,
  type PublishHistoryEntryInput
} from './publish-history';
import {
  createRemotePostSnapshot,
  RemotePostError,
  RemotePostErrorCode,
  validateRemotePostIdentity,
  type RemotePostDocument,
  type RemotePostSnapshot,
  type RemotePostTarget
} from './remote-post';
import { PULL_FIELD_ORDER, PullField } from './sync-diff';
import { convertWordPressToMarkdown } from './wordpress-to-markdown';
import {
  createLocalSyncDocument,
  createOrUpdateSyncBaseline,
  createRemoteSyncDocument,
  getSyncBaseline,
  upsertSyncBaseline
} from './sync-baseline';

interface PublishExecutionContext {
  sourceFile: TFile;
  writeBackToNote: boolean;
  replaceMediaLinks: boolean;
  showNotices: boolean;
  showEditConfirm: boolean;
  reuseSession: boolean;
  historyAction?: PublishHistoryAction;
}

interface PublishSyncContext {
  localContent: string;
  publishedTags?: string[];
}

export abstract class AbstractWordPressClient implements WordPressClient {

  /**
   * Client name.
   */
  name = 'AbstractWordPressClient';

  private readonly publishWarnings = new Set<string>();
  private readonly checkedMediaHashes = new Set<string>();
  private sessionAuth?: WordPressAuthParams;

  protected constructor(
    protected readonly plugin: WordpressPlugin,
    protected readonly profile: WpProfile
  ) { }

  abstract publish(
    title: string,
    content: string,
    postParams: WordPressPostParams,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<WordPressPublishResult>>;

  protected abstract fetchRemotePost(
    target: RemotePostTarget,
    certificate: WordPressAuthParams
  ): Promise<RemotePostDocument>;

  abstract getCategories(
    certificate: WordPressAuthParams
  ): Promise<Term[]>;

  abstract getPostTypes(
    certificate: WordPressAuthParams
  ): Promise<PostType[]>;

  abstract validateUser(
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<boolean>>;

  abstract getTag(
    name: string,
    certificate: WordPressAuthParams
  ): Promise<Term>;

  abstract uploadMedia(
    media: Media,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<WordPressMediaUploadResult>>;

  abstract updateMediaMetadata(
    attachmentId: string | number,
    metadata: MediaMetadata,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<boolean>>;

  protected abstract mediaExists(
    attachmentId: string | number,
    certificate: WordPressAuthParams
  ): Promise<boolean | undefined>;

  protected needLogin(): boolean {
    return true;
  }

  protected getEditorialMetadataCapabilities(): EditorialMetadataCapabilities {
    return { focusKeyword: false, metaDescription: false, secondaryTitle: false };
  }

  private async getAuth(reuseSession = false): Promise<WordPressAuthParams> {
    if (reuseSession && this.sessionAuth) {
      return { ...this.sessionAuth };
    }
    let auth: WordPressAuthParams = {
      username: null,
      password: null
    };
    if (this.needLogin()) {
      let authenticated = false;
      if (this.profile.username && this.profile.password) {
        try {
          auth = {
            username: this.profile.username,
            password: this.profile.password
          };
          const authResult = await this.validateUser(auth);
          authenticated = authResult.code === WordPressClientReturnCode.OK;
          if (!authenticated) showError(this.plugin.i18n.t('error_invalidUser'));
        } catch (error) {
          showError(error);
        }
      }
      if (!authenticated) {
        const result = await openLoginModal(this.plugin, this.profile, async (auth) => {
          const authResult = await this.validateUser(auth);
          return authResult.code === WordPressClientReturnCode.OK;
        });
        if (!result) {
          throw new Error(this.plugin.i18n.t('error_loginCancelled'));
        }
        auth = result.auth;
      }
    }
    if (reuseSession) {
      this.sessionAuth = { ...auth };
    }
    return auth;
  }

  private async preparePublishTarget(
    target: PublishTarget
  ): Promise<{ postId?: string } | null> {
    if (target.mode === PublishTargetMode.Create) {
      return {};
    }
    if (target.mode === PublishTargetMode.Update) {
      return { postId: target.postId };
    }

    let message: string;
    let confirmText: string;
    if (target.mode === PublishTargetMode.ProfileMismatch) {
      message = this.plugin.i18n.t('publishTarget_confirmProfileMismatch', {
        storedProfileName: target.storedProfileName ?? '',
        selectedProfileName: target.selectedProfileName,
        postId: target.postId ?? ''
      });
      confirmText = this.plugin.i18n.t('publishTarget_confirmCreate', {
        profileName: target.selectedProfileName
      });
    } else if (target.mode === PublishTargetMode.MissingProfile) {
      message = this.plugin.i18n.t('publishTarget_confirmMissingProfile', {
        selectedProfileName: target.selectedProfileName,
        postId: target.postId ?? ''
      });
      confirmText = this.plugin.i18n.t('publishTarget_confirmUpdate', {
        postId: target.postId ?? ''
      });
    } else {
      message = this.plugin.i18n.t('publishTarget_confirmInvalidPostId', {
        selectedProfileName: target.selectedProfileName,
        postId: target.rawPostId ?? ''
      });
      confirmText = this.plugin.i18n.t('publishTarget_confirmCreate', {
        profileName: target.selectedProfileName
      });
    }

    const confirm = await openConfirmModal({ message, confirmText }, this.plugin);
    if (confirm.code !== ConfirmCode.Confirm) {
      return null;
    }
    return target.mode === PublishTargetMode.MissingProfile
      ? { postId: target.postId }
      : {};
  }

  private cancelledPublishResult(): WordPressClientResult<WordPressPublishResult> {
    return {
      code: WordPressClientReturnCode.Error,
      error: {
        code: WordPressClientReturnCode.Error,
        message: this.plugin.i18n.t('message_publishCancelled')
      }
    };
  }

  private ensureValidSchedule(postParams: WordPressPostParams): void {
    if (postParams.status !== PostStatus.Future) {
      return;
    }
    const scheduleValidation = validateScheduledPublishDate(postParams.datetime);
    if (!scheduleValidation.valid) {
      throw new Error(this.plugin.i18n.t(
        scheduledPublishErrorKey(scheduleValidation.code)
      ));
    }
    postParams.datetime = scheduleValidation.date;
  }

  private async prepareEditorialMetadata(
    postParams: WordPressPostParams,
    auth: WordPressAuthParams,
    sourceFile: TFile
  ): Promise<void> {
    const mergeUpdate = isMergeUpdate(postParams);
    const contentOnly = isContentOnlyUpdate(postParams);
    const reviewedFields = new Set(postParams.updateFields ?? []);
    const selected = (field: PullField): boolean => !mergeUpdate || reviewedFields.has(field);
    if (selected(PullField.Slug)) {
      postParams.slug = postParams.slug?.trim() || undefined;
    }
    if (selected(PullField.Excerpt)) {
      postParams.excerpt = postParams.excerpt?.trim() || undefined;
    }
    if (selected(PullField.FocusKeyword)) {
      postParams.focusKeyword = postParams.focusKeyword?.trim() || undefined;
    }
    if (selected(PullField.MetaDescription)) {
      postParams.metaDescription = postParams.metaDescription?.trim() || undefined;
    }
    if (selected(PullField.SecondaryTitle)
      && Object.prototype.hasOwnProperty.call(postParams, 'secondaryTitle')
    ) {
      postParams.secondaryTitle = postParams.secondaryTitle?.trim() ?? '';
    }

    const focusKeywordRequested = mergeUpdate
      ? reviewedFields.has(PullField.FocusKeyword)
      : !contentOnly && Boolean(postParams.focusKeyword);
    const metaDescriptionRequested = mergeUpdate
      ? reviewedFields.has(PullField.MetaDescription)
      : !contentOnly && Boolean(postParams.metaDescription);
    const secondaryTitleRequested = mergeUpdate
      ? reviewedFields.has(PullField.SecondaryTitle)
      : !contentOnly
        && Object.prototype.hasOwnProperty.call(postParams, 'secondaryTitle');
    if (focusKeywordRequested
      && !this.getEditorialMetadataCapabilities().focusKeyword
    ) {
      throw new Error(this.plugin.i18n.t('error_focusKeywordUnsupported'));
    }
    if (metaDescriptionRequested
      && !this.getEditorialMetadataCapabilities().metaDescription
    ) {
      throw new Error(this.plugin.i18n.t('error_metaDescriptionUnsupported'));
    }
    if (secondaryTitleRequested
      && !this.getEditorialMetadataCapabilities().secondaryTitle
    ) {
      throw new Error(this.plugin.i18n.t('error_secondaryTitleUnsupported'));
    }

    if (!selected(PullField.FeaturedMedia)) {
      return;
    }
    const reference = parseFeaturedImageReference(postParams.featuredImage ?? '');
    if (!reference) {
      delete postParams.featuredImage;
      if (mergeUpdate) {
        postParams.featuredMediaId = 0;
      } else {
        delete postParams.featuredMediaId;
      }
      return;
    }
    if (reference.type === 'attachment-id') {
      postParams.featuredMediaId = reference.id;
      return;
    }
    if (reference.type === 'remote-url') {
      if (postParams.featuredMediaId !== undefined) {
        return;
      }
      throw new Error(this.plugin.i18n.t('error_featuredImageRemoteUnsupported'));
    }

    const imageFile = this.plugin.app.metadataCache.getFirstLinkpathDest(
      reference.path,
      sourceFile.path
    );
    if (!(imageFile instanceof TFile)) {
      throw new Error(this.plugin.i18n.t('error_featuredImageNotFound', {
        path: reference.path
      }));
    }

    const content = await this.plugin.app.vault.readBinary(imageFile);
    const fileType = fileTypeChecker.detectFile(content);
    if (!fileType?.mimeType.startsWith('image/')) {
      throw new Error(this.plugin.i18n.t('error_featuredImageNotImage', {
        path: reference.path
      }));
    }
    const metadata = resolveMediaMetadata({
      metadataMap: postParams.mediaMetadata,
      sourcePath: reference.path,
      vaultPath: imageFile.path,
      fileName: imageFile.name
    });
    const result = await this.uploadVaultMedia(
      imageFile,
      content,
      fileType.mimeType,
      metadata,
      auth,
      true
    );
    if (result.code !== WordPressClientReturnCode.OK) {
      throw new Error(this.plugin.i18n.t('error_featuredImageUploadFailed', {
        message: result.error.message
      }));
    }

    const attachmentId = Number(result.data.id);
    if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) {
      throw new Error(this.plugin.i18n.t('error_featuredImageMissingId'));
    }
    postParams.featuredMediaId = attachmentId;
  }

  private showMediaMetadataWarning(fileName: string, message: string): void {
    const warning = this.plugin.i18n.t('warning_mediaMetadataUpdateFailed', {
      name: fileName,
      message
    });
    this.publishWarnings.add(warning);
  }

  private async applyMediaMetadata(
    attachmentId: string | number | undefined,
    metadata: MediaMetadata,
    auth: WordPressAuthParams,
    fileName: string
  ): Promise<boolean> {
    if (attachmentId === undefined || attachmentId === '') {
      this.showMediaMetadataWarning(
        fileName,
        this.plugin.i18n.t('error_mediaMetadataMissingId')
      );
      return false;
    }
    const result = await this.updateMediaMetadata(attachmentId, metadata, auth);
    if (result.code === WordPressClientReturnCode.Error) {
      this.showMediaMetadataWarning(fileName, result.error.message);
      return false;
    }
    return true;
  }

  private async uploadVaultMedia(
    file: TFile,
    content: ArrayBuffer,
    mimeType: string,
    metadata: MediaMetadata,
    auth: WordPressAuthParams,
    requireAttachmentId = false
  ): Promise<WordPressClientResult<WordPressMediaUploadResult>> {
    const contentHash = await mediaContentHash(content);
    let cached = findCachedMedia(
      this.profile.mediaCache,
      contentHash,
      requireAttachmentId
    );
    if (cached?.id !== undefined && cached.id !== ''
      && !this.checkedMediaHashes.has(contentHash)
    ) {
      const exists = await this.mediaExists(cached.id, auth);
      this.checkedMediaHashes.add(contentHash);
      if (exists === false) {
        this.profile.mediaCache = forgetCachedMedia(
          this.profile.mediaCache,
          contentHash
        );
        await this.plugin.saveSettings();
        cached = undefined;
      }
    }
    if (cached) {
      if (mediaMetadataNeedsUpdate(cached.metadata, metadata)) {
        const applied = await this.applyMediaMetadata(
          cached.id,
          metadata,
          auth,
          file.name
        );
        if (applied) {
          this.profile.mediaCache = rememberMediaMetadata(
            this.profile.mediaCache,
            contentHash,
            metadata
          );
          await this.plugin.saveSettings();
        }
      }
      return {
        code: WordPressClientReturnCode.OK,
        data: {
          url: cached.url,
          id: cached.id,
          metadataApplied: !mediaMetadataNeedsUpdate(
            this.profile.mediaCache?.[contentHash]?.metadata,
            metadata
          )
        }
      };
    }

    const result = await this.uploadMedia({
      mimeType,
      fileName: file.name,
      content,
      metadata
    }, auth);
    if (result.code === WordPressClientReturnCode.OK && result.data.url) {
      let metadataApplied = result.data.metadataApplied === true;
      if (!metadataApplied && mediaMetadataNeedsUpdate(undefined, metadata)) {
        metadataApplied = await this.applyMediaMetadata(
          result.data.id,
          metadata,
          auth,
          file.name
        );
      }
      this.profile.mediaCache = rememberMediaUpload(
        this.profile.mediaCache,
        contentHash,
        file.name,
        result.data,
        metadataApplied ? metadata : undefined,
        file.path
      );
      this.checkedMediaHashes.add(contentHash);
      // Persist successful uploads even if the later post publish fails.
      await this.plugin.saveSettings();
    }
    return result;
  }

  private async recordPublishHistory(
    input: PublishHistoryEntryInput
  ): Promise<void> {
    try {
      const entry = createPublishHistoryEntry(input);
      this.plugin.settings.publishHistory = addPublishHistoryEntry(
        this.plugin.settings.publishHistory,
        entry
      );
      await this.plugin.saveSettings();
    } catch (error) {
      console.error('Could not save WordPress publish history', error);
    }
  }

  private async rememberPublishedSyncBaseline(params: {
    postParams: WordPressPostParams;
    result: WordPressPublishResult;
    auth: WordPressAuthParams;
    categoryTerms: readonly Term[];
    notePath: string;
    noteTitle: string;
    localMatter: MatterData;
    syncContext: PublishSyncContext;
    execution: PublishExecutionContext;
    timestamp: string;
  }): Promise<boolean> {
    if ((params.result.warnings?.length ?? 0) > 0) {
      return false;
    }
    const previousCache = this.plugin.settings.syncBaselineCache;
    try {
      const contentOnly = isContentOnlyUpdate(params.postParams);
      const mergeUpdate = isMergeUpdate(params.postParams);
      const reviewedFields = new Set(params.postParams.updateFields ?? []);
      const remoteDocument = await this.fetchRemotePost({
        postId: params.result.postId,
        postType: params.postParams.postType
      }, params.auth);
      validateRemotePostIdentity(remoteDocument, {
        postId: params.result.postId,
        postType: params.postParams.postType
      });
      const conversion = convertWordPressToMarkdown(
        remoteDocument.content,
        remoteDocument.sourceFormat
      );
      const fields: PullField[] = contentOnly
        ? [ PullField.Body ]
        : PULL_FIELD_ORDER.filter(field => {
          if (mergeUpdate && !reviewedFields.has(field)) {
            return false;
          }
          switch (field) {
            case PullField.Slug:
              return remoteDocument.capabilities.slug;
            case PullField.Excerpt:
              return remoteDocument.capabilities.excerpt;
            case PullField.Status:
              return remoteDocument.capabilities.status;
            case PullField.CommentStatus:
              return remoteDocument.capabilities.commentStatus;
            case PullField.Categories:
              return params.postParams.postType === PostTypeConst.Post
                && remoteDocument.capabilities.categories;
            case PullField.Tags:
              return params.postParams.postType === PostTypeConst.Post
                && remoteDocument.capabilities.tags;
            case PullField.FeaturedMedia:
              return remoteDocument.capabilities.featuredMedia
                && (!remoteDocument.featuredMedia?.id
                  || Boolean(remoteDocument.featuredMedia.url));
            case PullField.FocusKeyword:
              return remoteDocument.capabilities.focusKeyword;
            case PullField.MetaDescription:
              return remoteDocument.capabilities.metaDescription;
            case PullField.SecondaryTitle:
              return remoteDocument.capabilities.secondaryTitle;
            default:
              return true;
          }
        });
      const categorySlugs = categorySlugsForIds(
        params.result.categories,
        params.categoryTerms
      );
      const localMatter = { ...params.localMatter };
      if (params.execution.writeBackToNote
        && !contentOnly
        && params.postParams.postType === PostTypeConst.Post
      ) {
        if (categorySlugs.length > 0) {
          localMatter.categories = categorySlugs;
        }
        if (params.syncContext.publishedTags !== undefined) {
          localMatter.wpTags = [ ...params.syncContext.publishedTags ];
        }
      }
      const local = createLocalSyncDocument({
        noteRaw: '',
        body: params.syncContext.localContent,
        matter: localMatter,
        fallbackTitle: params.noteTitle,
        fields
      });
      const remote = createRemoteSyncDocument({
        fields,
        remote: {
          title: remoteDocument.title,
          body: conversion.markdown,
          slug: remoteDocument.slug,
          excerpt: remoteDocument.excerpt,
          status: remoteDocument.status,
          commentStatus: remoteDocument.commentStatus,
          categoryIds: remoteDocument.categoryIds,
          tagIds: remoteDocument.tagIds,
          terms: remoteDocument.terms,
          featuredMedia: remoteDocument.featuredMedia,
          focusKeyword: remoteDocument.focusKeyword,
          metaDescription: remoteDocument.metaDescription,
          secondaryTitle: remoteDocument.secondaryTitle,
          capabilities: remoteDocument.capabilities
        }
      });
      const existing = getSyncBaseline(
        previousCache,
        params.notePath,
        this.profile.id
      );
      const baseline = createOrUpdateSyncBaseline({
        existing,
        identity: {
          notePath: params.notePath,
          profileId: this.profile.id,
          profileName: this.profile.name,
          profileEndpoint: this.profile.endpoint,
          postId: params.result.postId,
          postType: params.postParams.postType
        },
        local,
        remote,
        fields,
        remoteModifiedAt: remoteDocument.modifiedAt,
        now: params.timestamp
      });
      this.plugin.settings.syncBaselineCache = upsertSyncBaseline(
        previousCache,
        baseline
      ).cache;
      try {
        await this.plugin.saveSettings();
      } catch (error) {
        this.plugin.settings.syncBaselineCache = previousCache;
        throw error;
      }
      return true;
    } catch (error) {
      console.error('Could not save WordPress sync baseline after publish.', error);
      return false;
    }
  }

  private async publishWithHistory(params: {
    postParams: WordPressPostParams;
    auth: WordPressAuthParams;
    categoryTerms: readonly Term[];
    notePath: string;
    noteTitle: string;
    localSource: { content: string, matter: MatterData };
    execution: PublishExecutionContext;
  }): Promise<WordPressClientResult<WordPressPublishResult>> {
    const { postParams, notePath, noteTitle } = params;
    const action = params.execution.historyAction
      ?? resolvePublishHistoryAction(postParams);
    const publishDate = new Date();
    const timestamp = publishDate.toISOString();
    const lastPublishedAt = formatLocalPublishTimestamp(publishDate);
    const baseEntry = {
      timestamp,
      action,
      notePath,
      noteTitle,
      profileName: this.profile.name,
      profileId: this.profile.id,
      endpoint: this.profile.endpoint,
      postType: postParams.postType
    };
    const syncContext: PublishSyncContext = {
      localContent: params.localSource.content
    };
    try {
      const result = await this.tryToPublish({
        postParams,
        auth: params.auth,
        categoryTerms: params.categoryTerms,
        syncMetadata: {
          lastPublishedAt,
          lastPublishAction: action
        },
        execution: params.execution,
        syncContext
      });
      if (result.code !== WordPressClientReturnCode.OK) {
        throw new Error(result.error.message);
      }
      this.plugin.settings.multiSiteTargets = rememberMultiSiteTarget(
        this.plugin.settings.multiSiteTargets,
        notePath,
        {
          profileId: this.profile.id,
          profileName: this.profile.name,
          endpoint: this.profile.endpoint,
          postId: result.data.postId,
          postType: postParams.postType,
          updatedAt: timestamp
        }
      );
      result.data.syncBaselineUpdated = await this.rememberPublishedSyncBaseline({
        postParams,
        result: result.data,
        auth: params.auth,
        categoryTerms: params.categoryTerms,
        notePath,
        noteTitle,
        localMatter: params.localSource.matter,
        syncContext,
        execution: params.execution,
        timestamp
      });
      await this.recordPublishHistory({
        ...baseEntry,
        outcome: PublishHistoryOutcome.Success,
        postId: result.data.postId,
        warningCount: result.data.warnings?.length
      });
      return result;
    } catch (error) {
      await this.recordPublishHistory({
        ...baseEntry,
        outcome: PublishHistoryOutcome.Failure,
        postId: postParams.postId,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async tryToPublish(params: {
    postParams: WordPressPostParams,
    auth: WordPressAuthParams,
    categoryTerms: readonly Term[],
    syncMetadata: {
      lastPublishedAt: string;
      lastPublishAction: PublishHistoryAction;
    };
    execution: PublishExecutionContext;
    syncContext: PublishSyncContext;
  }): Promise<WordPressClientResult<WordPressPublishResult>> {
    const {
      postParams,
      auth,
      categoryTerms,
      syncMetadata,
      execution,
      syncContext
    } = params;
    this.publishWarnings.clear();
    if (!execution.reuseSession) {
      this.checkedMediaHashes.clear();
    }
    const contentOnly = isContentOnlyUpdate(postParams);
    const mergeUpdate = isMergeUpdate(postParams);
    const reviewedFields = new Set(postParams.updateFields ?? []);
    const updatesBody = !mergeUpdate || reviewedFields.has(PullField.Body);
    if (updatesBody) {
      const extractedMedia = extractMediaMetadataBlocks(postParams.content);
      postParams.content = extractedMedia.content;
      postParams.mediaMetadata = extractedMedia.metadataMap;
    }
    if (!contentOnly) {
      if (!mergeUpdate) {
        this.ensureValidSchedule(postParams);
      }
      await this.prepareEditorialMetadata(postParams, auth, execution.sourceFile);
      if (!mergeUpdate || reviewedFields.has(PullField.Tags)) {
        const tagTerms = await this.getTags(postParams.tags, auth);
        syncContext.publishedTags = tagTerms.map(term => term.name);
        postParams.tags = tagTerms.map(term => term.id);
      }
    }
    const imageCaptions = updatesBody
      ? await this.updatePostImages({
        auth,
        postParams,
        sourceFile: execution.sourceFile,
        replaceMediaLinks: execution.replaceMediaLinks,
        syncContext
      })
      : {};
    const html = updatesBody
      ? renderWordPressPostContent(
        postParams.content,
        AppState.markdownParser,
        this.plugin.settings.contentFormat,
        { imageCaptions }
      )
      : '';
    const result = await this.publish(
      postParams.title ?? 'A post from Obsidian!',
      html,
      postParams,
      auth);
    if (result.code === WordPressClientReturnCode.Error) {
      throw new Error(this.plugin.i18n.t('error_publishFailed', {
        code: result.error.code as string,
        message: result.error.message
      }));
    } else {
      if (this.publishWarnings.size > 0) {
        result.data.warnings = [ ...new Set([
          ...(result.data.warnings ?? []),
          ...this.publishWarnings
        ]) ];
      }
      if (execution.showNotices) {
        new Notice(this.plugin.i18n.t('message_publishSuccessfully'));
        result.data.warnings?.forEach(warning => {
          new Notice(warning, ERROR_NOTICE_TIMEOUT);
        });
      }
      // post id will be returned if creating, true if editing
      const postId = result.data.postId;
      if (postId) {
        // const modified = matter.stringify(postParams.content, matterData, matterOptions);
        // this.updateFrontMatter(modified);
        if (execution.writeBackToNote) {
          try {
            await this.plugin.app.fileManager.processFrontMatter(execution.sourceFile, fm => {
              const categorySlugs = contentOnly
                ? []
                : categorySlugsForIds(postParams.categories, categoryTerms);
              updatePublishFrontMatter(fm, {
                profileName: this.profile.name,
                postId,
                postType: postParams.postType,
                categories: !contentOnly && categorySlugs.length > 0
                  ? categorySlugs
                  : undefined,
                tags: !contentOnly
                  ? syncContext.publishedTags
                  : undefined,
                lastPublishedAt: syncMetadata.lastPublishedAt,
                lastPublishAction: syncMetadata.lastPublishAction
              });
            });
          } catch (error) {
            const warning = this.plugin.i18n.t('warning_frontMatterWriteBackFailed', {
              name: execution.sourceFile.name,
              message: error instanceof Error ? error.message : String(error)
            });
            result.data.warnings = [ ...new Set([
              ...(result.data.warnings ?? []),
              warning
            ]) ];
            if (execution.showNotices) {
              new Notice(warning, ERROR_NOTICE_TIMEOUT);
            }
          }
        }

        if (!contentOnly && this.plugin.settings.rememberLastSelectedCategories) {
          this.profile.lastSelectedCategories = resolveCategoryIds(result.data.categories, [], postParams.categories);
          await this.plugin.saveSettings();
        }

        if (execution.showEditConfirm) {
          openPostPublishedModal(this.plugin)
            .then(() => {
              openWithBrowser(`${this.profile.endpoint}/wp-admin/post.php`, {
                action: 'edit',
                post: postId
              });
            });
        }
      }
    }
    return result;
  }

  private async updatePostImages(params: {
    postParams: WordPressPostParams,
    auth: WordPressAuthParams,
    sourceFile: TFile,
    replaceMediaLinks: boolean,
    syncContext: PublishSyncContext;
  }): Promise<Record<string, ImageCaptionMetadata>> {
    const { postParams, auth, sourceFile } = params;
    const imageCaptions = imageCaptionsFromMetadata(postParams.mediaMetadata);
    const replacements: TextReplacement[] = [];

    const images = getMarkdownImages(postParams.content);
    for (const img of images) {
      if (img.srcIsUrl) {
        continue;
      }
      let sourcePath = img.src;
      try {
        sourcePath = decodeURI(sourcePath);
      } catch {
        // Keep the original path so WordPress can report a useful upload error.
      }
      const fileName = sourcePath.split('/').pop();
      if (fileName === undefined) {
        continue;
      }
      const imgFile = this.plugin.app.metadataCache.getFirstLinkpathDest(
        sourcePath,
        sourceFile.path
      );
      if (!(imgFile instanceof TFile)) {
        continue;
      }

      const content = await this.plugin.app.vault.readBinary(imgFile);
      const fileType = fileTypeChecker.detectFile(content);
      const metadata = resolveMediaMetadata({
        metadataMap: postParams.mediaMetadata,
        sourcePath,
        vaultPath: imgFile.path,
        fileName: imgFile.name,
        inlineAltText: img.altText,
        inlineTitle: img.markdownTitle
      });
      const result = await this.uploadVaultMedia(
        imgFile,
        content,
        fileType?.mimeType ?? 'application/octet-stream',
        metadata,
        auth
      );
      if (result.code === WordPressClientReturnCode.OK) {
        const imageCaption = resolveImageCaptionMetadata({
          metadata,
          metadataMap: postParams.mediaMetadata,
          sourcePath,
          vaultPath: imgFile.path,
          fileName: imgFile.name,
          inlineTitle: img.markdownTitle
        });
        if (imageCaption) {
          imageCaptions[result.data.url] = imageCaption;
        }
        const replacement = buildUploadedImageReference(
          img,
          result.data.url,
          metadata
        );
        const noteReplacement = buildUploadedImageReference(
          img,
          result.data.url,
          metadata,
          true
        );
        postParams.content = postParams.content.replace(img.original, replacement);
        replacements.push({ original: img.original, replacement: noteReplacement });
      } else if (result.error.code === WordPressClientReturnCode.ServerInternalError) {
        this.publishWarnings.add(result.error.message);
      } else {
        this.publishWarnings.add(this.plugin.i18n.t('error_mediaUploadFailed', {
          name: imgFile.name,
        }));
      }
    }

    const activeFile = this.plugin.app.workspace.getActiveFile();
    const { activeEditor } = this.plugin.app.workspace;
    if (params.replaceMediaLinks
      && replacements.length > 0
      && activeFile?.path === sourceFile.path
      && activeEditor?.editor
    ) {
      const currentContent = activeEditor.editor.getValue();
      const updatedContent = applyTextReplacements(currentContent, replacements);
      if (updatedContent !== currentContent) {
        activeEditor.editor.setValue(updatedContent);
        params.syncContext.localContent = applyTextReplacements(
          params.syncContext.localContent,
          replacements
        );
      }
    }
    return imageCaptions;
  }

  async fetchPost(
    target: RemotePostTarget
  ): Promise<WordPressClientResult<RemotePostSnapshot>> {
    try {
      if (!this.profile.endpoint) {
        throw new RemotePostError(
          RemotePostErrorCode.InvalidTarget,
          this.plugin.i18n.t('error_noEndpoint')
        );
      }
      if (!/^[1-9]\d*$/.test(target.postId)
        || !/^[a-z0-9_-]+$/i.test(target.postType)
      ) {
        throw new RemotePostError(
          RemotePostErrorCode.InvalidTarget,
          this.plugin.i18n.t('remoteInspector_invalidTarget')
        );
      }
      const auth = await this.getAuth();
      const document = await this.fetchRemotePost(target, auth);
      validateRemotePostIdentity(document, target);
      return {
        code: WordPressClientReturnCode.OK,
        data: createRemotePostSnapshot(document, {
          profileId: this.profile.id,
          profileName: this.profile.name,
          endpoint: this.profile.endpoint
        })
      };
    } catch (error) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: error instanceof RemotePostError
            ? error.code
            : RemotePostErrorCode.Network,
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  async publishPost(
    defaultPostParams?: WordPressPostParams,
    options: WordPressPublishOptions = {}
  ): Promise<WordPressClientResult<WordPressPublishResult>> {
    const showNotices = options.showNotices !== false;
    try {
      if (!this.profile.endpoint || this.profile.endpoint.length === 0) {
        throw new Error(this.plugin.i18n.t('error_noEndpoint'));
      }
      const file = options.sourceFile ?? this.plugin.app.workspace.getActiveFile();
      if (file === null) {
        throw new Error(this.plugin.i18n.t('error_noActiveFile'));
      }
      if (options.target?.mode === 'update'
        && !/^[1-9]\d*$/.test(options.target.postId)
      ) {
        throw new Error('Invalid WordPress post ID: ' + options.target.postId);
      }
      const execution: PublishExecutionContext = {
        sourceFile: file,
        writeBackToNote: options.writeBackToNote !== false,
        replaceMediaLinks: options.replaceMediaLinks
          ?? this.plugin.settings.replaceMediaLinks,
        showNotices,
        showEditConfirm: options.showEditConfirm
          ?? this.plugin.settings.showWordPressEditConfirm,
        reuseSession: options.reuseSession === true,
        ...(options.historyAction ? { historyAction: options.historyAction } : {})
      };

      const auth = await this.getAuth(execution.reuseSession);
      const source = options.sourceSnapshot
        ?? await processFile(file, this.plugin.app);
      const title = options.sourceSnapshot?.title ?? file.basename;
      const content = source.content;
      const matterData = source.matter;
      const publishMetadata = readPublishFrontMatter(matterData);
      const inferredTarget = determinePublishTarget(publishMetadata, this.profile.name);
      const publishTarget: PublishTarget = options.target
        ? options.target.mode === 'update'
          ? {
            mode: PublishTargetMode.Update,
            selectedProfileName: this.profile.name,
            storedProfileName: this.profile.name,
            postId: options.target.postId
          }
          : {
            mode: PublishTargetMode.Create,
            selectedProfileName: this.profile.name
          }
        : inferredTarget;
      const prepareTarget = async (): Promise<{ postId?: string } | null> => {
        if (!options.target) {
          return this.preparePublishTarget(publishTarget);
        }
        return options.target.mode === 'update'
          ? { postId: options.target.postId }
          : {};
      };
      const profileDefaults = resolveProfilePublishingDefaults(this.profile, {
        status: this.plugin.settings.defaultPostStatus,
        commentStatus: this.plugin.settings.defaultCommentStatus
      });

      const categories = await this.getCategories(auth);
      const selectedCategories = resolveCategoryIds(
        matterData.categories
          ?? defaultPostParams?.categories
          ?? this.profile.lastSelectedCategories,
        categories
      );
      let postParams: WordPressPostParams;
      let result: WordPressClientResult<WordPressPublishResult> | undefined;
      if (defaultPostParams) {
        const preparedTarget = await prepareTarget();
        if (!preparedTarget) {
          return this.cancelledPublishResult();
        }
        postParams = this.readFromFrontMatter(
          title,
          matterData,
          defaultPostParams,
          {
            targetPostId: preparedTarget.postId,
            targetPostType: options.target?.mode === 'update'
              ? options.target.postType
              : undefined,
            useEditorialFrontMatter: true,
            usePublishingControlFrontMatter: true,
            useNoteTags: true
          }
        );
        postParams.categories = selectedCategories;
        postParams.content = content;
        if (!isContentOnlyUpdate(postParams)) {
          this.ensureValidSchedule(postParams);
        }
        if (showNotices) {
          new Notice(preparedTarget.postId
            ? this.plugin.i18n.t('message_updatingPost', { postId: preparedTarget.postId })
            : this.plugin.i18n.t('message_creatingPost'));
        }
        result = await this.publishWithHistory({
          auth,
          postParams,
          categoryTerms: categories,
          notePath: file.path,
          noteTitle: title,
          localSource: { content, matter: matterData },
          execution
        });
      } else {
        const postTypes = await this.getPostTypes(auth);
        if (postTypes.length === 0) {
          postTypes.push(PostTypeConst.Post);
        }
        const selectedPostType = selectAvailablePostType(
          publishMetadata.postType ?? profileDefaults.postType,
          postTypes
        );
        result = await new Promise(resolve => {
          const publishModal = new WpPublishModal(
            this.plugin,
            { items: categories, selected: selectedCategories },
            { items: postTypes, selected: selectedPostType },
            publishTarget,
            this.getEditorialMetadataCapabilities(),
            profileDefaults,
            {
              title: typeof matterData.title === 'string'
                ? matterData.title
                : title,
              content,
              sourcePath: file.path
            },
            async (postParams: WordPressPostParams) => {
              const preparedTarget = await prepareTarget();
              if (!preparedTarget) {
                return false;
              }
              postParams = this.readFromFrontMatter(
                title,
                matterData,
                postParams,
                { targetPostId: preparedTarget.postId }
              );
              postParams.content = content;
              try {
                const r = await this.publishWithHistory({
                  auth,
                  postParams,
                  categoryTerms: categories,
                  notePath: file.path,
                  noteTitle: title,
                  localSource: { content, matter: matterData },
                  execution
                });
                if (r.code === WordPressClientReturnCode.OK) {
                  publishModal.close();
                  resolve(r);
                  return true;
                }
              } catch (error) {
                if (error instanceof Error) {
                  if (showNotices) {
                    showError(error);
                  }
                  return false;
                }
                throw error;
              }
              return false;
            },
            matterData);
          publishModal.open();
        });
      }
      if (result) {
        return result;
      }
      throw new Error(this.plugin.i18n.t('message_publishFailed'));
    } catch (error) {
      if (showNotices) {
        return showError(error);
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: WordPressClientReturnCode.Error,
          message
        }
      };
    }
  }

  private async getTags(tags: string[], certificate: WordPressAuthParams): Promise<Term[]> {
    const results = await Promise.allSettled(tags.map(name => this.getTag(name, certificate)));
    const terms: Term[] = [];
    results
      .forEach(result => {
        if (isPromiseFulfilledResult<Term>(result)) {
          terms.push(result.value);
        }
      });
    return terms;
  }

  private readFromFrontMatter(
    noteTitle: string,
    matterData: MatterData,
    params: WordPressPostParams,
    options: {
      targetPostId?: string;
      targetPostType?: PostType;
      useEditorialFrontMatter?: boolean;
      usePublishingControlFrontMatter?: boolean;
      useNoteTags?: boolean;
    } = {}
  ): WordPressPostParams {
    const postParams = { ...params };
    const publishMetadata = readPublishFrontMatter(matterData);
    if (options.usePublishingControlFrontMatter) {
      Object.assign(postParams, readPublishingControlFrontMatter(matterData));
    }
    if (options.useEditorialFrontMatter) {
      Object.assign(
        postParams,
        fillExcerptFromMetaDescription(readEditorialFrontMatter(matterData))
      );
    }
    postParams.title = resolveWordPressTitle(matterData, noteTitle);
    delete postParams.postId;
    if (options.targetPostId) {
      postParams.postId = options.targetPostId;
    }
    postParams.profileName = this.profile.name;
    if (options.targetPostType) {
      postParams.postType = options.targetPostType;
    } else if (publishMetadata.postType) {
      postParams.postType = publishMetadata.postType;
    } else if (!postParams.postType) {
      postParams.postType = PostTypeConst.Post;
    }
    if (postParams.postType === PostTypeConst.Post) {
      if (options.useNoteTags) {
        postParams.tags = resolvePublishingTags(matterData, postParams.tags);
      }
    } else {
      postParams.tags = [];
    }
    return postParams;
  }

}
