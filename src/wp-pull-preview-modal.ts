import {
  getFrontMatterInfo,
  Notice,
  parseYaml,
  stringifyYaml,
  TFile
} from 'obsidian';
import WordpressPlugin from './main';
import { AbstractModal } from './abstract-modal';
import { getWordPressClient } from './wp-clients';
import {
  WordPressClientReturnCode,
  type WordPressClient,
  type WordPressClientResult
} from './wp-client';
import type { MatterData } from './types';
import type { WpProfile } from './wp-profile';
import {
  RemotePostErrorCode,
  type RemotePostSnapshot,
  type RemotePostTarget
} from './remote-post';
import { resolveStableProfileNoteTargets } from './profile-note-target';
import {
  convertWordPressToMarkdown,
  WordPressConversionKind,
  type WordPressConversionDiagnostic,
  type WordPressToMarkdownResult
} from './wordpress-to-markdown';
import {
  applySelectedPullFields,
  buildPullFieldDiffs,
  composePulledNoteRevision,
  createUnifiedLineDiff,
  PullField,
  type PullFieldDiff,
  type PullFieldValue
} from './sync-diff';
import {
  addPullRestoreSnapshot,
  applyGuardedNoteRevision,
  createPullRestoreSnapshot,
  findLatestPullRestoreSnapshot,
  freezeNoteRevision,
  hashNoteRevision,
  PullTransactionError,
  PullTransactionErrorCode,
  removePullRestoreSnapshot,
  undoGuardedPull,
  type FrozenNoteRevision,
  type PullRestoreSnapshot
} from './note-sync-transaction';
import {
  addPublishHistoryEntry,
  createPublishHistoryEntry,
  PublishHistoryAction,
  PublishHistoryOutcome,
  type PublishHistoryOutcome as PublishHistoryOutcomeValue
} from './publish-history';
import { showError } from './utils';
import {
  classifySyncState,
  createLocalSyncDocument,
  createOrUpdateSyncBaseline,
  createRemoteSyncDocument,
  getSyncBaseline,
  upsertSyncBaseline,
  type SyncBaseline,
  type SyncStateResult
} from './sync-baseline';
import { renderSyncStatePanel } from './sync-state-panel';
import { remoteMarkdownImageUrls, validSyncMediaFolder } from './sync-media';
import {
  commitPreparedMediaDownloads,
  prepareRemoteMediaDownloads,
  removeDownloadedMediaAfterUndo,
  restoreCachedRemoteMedia,
  rollbackCreatedMediaDownloads,
  type PreparedMediaRoundTrip
} from './sync-media-runtime';

type PullPhase =
  | 'resolving'
  | 'choose'
  | 'loading'
  | 'ready'
  | 'applied'
  | 'undone'
  | 'empty'
  | 'error';

interface PullCandidate {
  profile: WpProfile;
  target: RemotePostTarget;
  linkedAt: string;
}

interface PullFailure {
  code: string;
  message: string;
}

export interface PullPreviewOptions {
  profileId?: string;
}

export function openPullPreviewModal(
  plugin: WordpressPlugin,
  options: PullPreviewOptions = {}
): void {
  const file = plugin.app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    showError(plugin.i18n.t('error_noActiveFile'));
    return;
  }
  new WpPullPreviewModal(plugin, file, options).open();
}

export async function undoLastWordPressPull(plugin: WordpressPlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    showError(plugin.i18n.t('error_noActiveFile'));
    return;
  }
  const snapshot = findLatestPullRestoreSnapshot(
    plugin.settings.pullRestoreSnapshots,
    file.path
  );
  if (!snapshot) {
    new Notice(plugin.i18n.t('pullModal_undoNone'));
    return;
  }
  try {
    await undoGuardedPull(plugin.app.vault, file, snapshot);
  } catch (error) {
    new Notice(plugin.i18n.t(
      error instanceof PullTransactionError
        && error.code === PullTransactionErrorCode.StaleUndoRevision
        ? 'pullModal_undoStale'
        : 'pullModal_undoFailed',
      { message: error instanceof Error ? error.message : String(error) }
    ));
    return;
  }

  await removeDownloadedMediaAfterUndo(
    plugin.app,
    snapshot.createdMedia ?? []
  );
  plugin.settings.pullRestoreSnapshots = removePullRestoreSnapshot(
    plugin.settings.pullRestoreSnapshots,
    snapshot.id
  );
  try {
    await plugin.saveSettings();
  } catch (error) {
    console.error('The pulled note was restored, but Undo cleanup could not be saved.', error);
    new Notice(plugin.i18n.t('pullModal_undoCleanupWarning'));
    return;
  }
  new Notice(plugin.i18n.t('pullModal_undoSuccess'));
}

class WpPullPreviewModal extends AbstractModal {
  private phase: PullPhase = 'resolving';
  private candidates: PullCandidate[] = [];
  private selected: PullCandidate | null = null;
  private snapshot: RemotePostSnapshot | null = null;
  private conversion: WordPressToMarkdownResult | null = null;
  private canonicalConversion: WordPressToMarkdownResult | null = null;
  private cachedMediaPlan: PreparedMediaRoundTrip | null = null;
  private mediaPlan: PreparedMediaRoundTrip | null = null;
  private downloadRemoteMedia = false;
  private preparingMedia = false;
  private mediaError = '';
  private createdMediaPaths: string[] = [];
  private syncBaseline: SyncBaseline | undefined;
  private syncResult: SyncStateResult | null = null;
  private diffs: PullFieldDiff[] = [];
  private selectedFields = new Set<PullField>();
  private matter: MatterData = {};
  private frozen: FrozenNoteRevision | null = null;
  private restoreSnapshot: PullRestoreSnapshot | null = null;
  private failure: PullFailure | null = null;
  private reviewMessage = '';
  private stale = false;
  private applying = false;
  private requestVersion = 0;
  private closed = false;
  private selectedCountEl: HTMLElement | null = null;
  private actionHintEl: HTMLElement | null = null;
  private applyButtonEl: HTMLButtonElement | null = null;

  constructor(
    plugin: WordpressPlugin,
    private readonly sourceFile: TFile,
    private readonly options: PullPreviewOptions = {}
  ) {
    super(plugin);
  }

  onOpen(): void {
    this.modalEl.addClass('wp-publisher-remote-modal');
    this.modalEl.addClass('wp-publisher-pull-modal');
    this.render();
    void this.resolveTargets();
  }

  onClose(): void {
    this.closed = true;
    this.requestVersion += 1;
    this.contentEl.empty();
  }

  private async resolveTargets(): Promise<void> {
    try {
      const raw = await this.plugin.app.vault.read(this.sourceFile);
      const matter = this.readMatter(raw);
      const targets = resolveStableProfileNoteTargets({
        store: this.plugin.settings.multiSiteTargets,
        notePath: this.sourceFile.path,
        profiles: this.plugin.settings.profiles,
        matter
      });
      const profilesById = new Map(
        this.plugin.settings.profiles.map(profile => [ profile.id, profile ])
      );
      this.candidates = targets.flatMap(target => {
        const profile = profilesById.get(target.profileId);
        return profile
          ? [ {
            profile,
            target: {
              postId: target.postId,
              postType: target.postType
            },
            linkedAt: target.updatedAt
          } ]
          : [];
      });
      if (this.closed) {
        return;
      }
      if (this.candidates.length === 0) {
        this.phase = 'empty';
        this.render();
        return;
      }
      const preferred = this.options.profileId
        ? this.candidates.find(candidate => candidate.profile.id === this.options.profileId)
        : undefined;
      if (preferred) {
        this.selectCandidate(preferred);
        return;
      }
      if (this.candidates.length === 1) {
        this.selectCandidate(this.candidates[0]);
        return;
      }
      this.phase = 'choose';
      this.render();
    } catch (error) {
      this.finishWithError(this.requestVersion, {
        code: RemotePostErrorCode.InvalidTarget,
        message: error instanceof Error ? error.message : String(error)
      }, false);
    }
  }

  private readMatter(raw: string): MatterData {
    const info = getFrontMatterInfo(raw);
    if (!info.exists || !info.frontmatter.trim()) {
      return {};
    }
    const parsed = parseYaml(info.frontmatter);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as MatterData
      : {};
  }

  private selectCandidate(candidate: PullCandidate): void {
    this.selected = {
      profile: candidate.profile,
      target: Object.freeze({ ...candidate.target }),
      linkedAt: candidate.linkedAt
    };
    void this.prepareLocalAndFetch();
  }

  private async prepareLocalAndFetch(): Promise<void> {
    if (!this.selected) {
      return;
    }
    const version = ++this.requestVersion;
    this.phase = 'loading';
    this.failure = null;
    this.reviewMessage = '';
    this.stale = false;
    this.syncBaseline = undefined;
    this.syncResult = null;
    this.canonicalConversion = null;
    this.cachedMediaPlan = null;
    this.mediaPlan = null;
    this.downloadRemoteMedia = false;
    this.preparingMedia = false;
    this.mediaError = '';
    this.render();
    try {
      const raw = await this.plugin.app.vault.read(this.sourceFile);
      const matter = this.readMatter(raw);
      if (!this.candidateStillLinked(matter)) {
        this.finishWithError(version, {
          code: RemotePostErrorCode.InvalidTarget,
          message: this.t('pullModal_linkChanged')
        }, false);
        return;
      }
      this.matter = matter;
      this.frozen = await freezeNoteRevision(raw);
    } catch (error) {
      this.finishWithError(version, {
        code: RemotePostErrorCode.InvalidTarget,
        message: error instanceof Error ? error.message : String(error)
      }, false);
      return;
    }
    await this.fetchSnapshot(version);
  }

  private candidateStillLinked(matter: MatterData): boolean {
    if (!this.selected) {
      return false;
    }
    return resolveStableProfileNoteTargets({
      store: this.plugin.settings.multiSiteTargets,
      notePath: this.sourceFile.path,
      profiles: this.plugin.settings.profiles,
      matter
    }).some(target =>
      target.profileId === this.selected?.profile.id
      && target.postId === this.selected.target.postId
      && target.postType === this.selected.target.postType
    );
  }

  private async fetchSnapshot(version: number): Promise<void> {
    if (!this.selected || !this.frozen) {
      return;
    }
    const frozenTarget = { ...this.selected.target };
    let client: WordPressClient | null;
    try {
      client = getWordPressClient(this.plugin, this.selected.profile);
    } catch (error) {
      this.finishWithError(version, {
        code: RemotePostErrorCode.Network,
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    if (!client) {
      this.finishWithError(version, {
        code: RemotePostErrorCode.InvalidTarget,
        message: this.t('remoteInspector_clientUnavailable')
      });
      return;
    }

    let result: WordPressClientResult<RemotePostSnapshot>;
    try {
      result = await client.fetchPost(frozenTarget);
    } catch (error) {
      this.finishWithError(version, {
        code: RemotePostErrorCode.Network,
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    if (this.closed || version !== this.requestVersion) {
      return;
    }
    if (result.code !== WordPressClientReturnCode.OK) {
      this.finishWithError(version, {
        code: String(result.error.code),
        message: result.error.message
      });
      return;
    }

    try {
      const canonicalConversion = convertWordPressToMarkdown(
        result.data.content,
        result.data.sourceFormat
      );
      const mediaPlan = await restoreCachedRemoteMedia({
        app: this.plugin.app,
        notePath: this.sourceFile.path,
        cache: this.selected.profile.mediaCache,
        markdown: canonicalConversion.markdown,
        featuredMedia: result.data.featuredMedia
      });
      if (this.closed || version !== this.requestVersion) return;
      const conversion = { ...canonicalConversion, markdown: mediaPlan.markdown };
      this.snapshot = result.data;
      this.canonicalConversion = canonicalConversion;
      this.cachedMediaPlan = mediaPlan;
      this.mediaPlan = mediaPlan;
      this.conversion = conversion;
      this.diffs = buildPullFieldDiffs({
        noteRaw: this.frozen.content,
        matter: this.matter,
        fallbackTitle: this.sourceFile.basename,
        remote: {
          title: result.data.title,
          body: conversion.markdown,
          slug: result.data.slug,
          excerpt: result.data.excerpt,
          status: result.data.status,
          commentStatus: result.data.commentStatus,
          categoryIds: result.data.categoryIds,
          tagIds: result.data.tagIds,
          terms: result.data.terms,
          featuredMedia: result.data.featuredMedia
            ? { ...result.data.featuredMedia, url: mediaPlan.featuredImage }
            : undefined,
          focusKeyword: result.data.focusKeyword,
          metaDescription: result.data.metaDescription,
          secondaryTitle: result.data.secondaryTitle,
          capabilities: result.data.capabilities
        }
      });
      this.calculateReadySyncState();
      this.selectedFields = new Set(
        this.diffs
          .filter(diff => diff.available && diff.changed)
          .map(diff => diff.key)
      );
      this.phase = 'ready';
      this.render();
    } catch (error) {
      this.finishWithError(version, {
        code: 'remote_conversion_failed',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private rebuildDiffsForMediaPlan(preserveSelection: boolean): void {
    if (!this.snapshot || !this.canonicalConversion || !this.mediaPlan || !this.frozen) {
      return;
    }
    this.conversion = {
      ...this.canonicalConversion,
      markdown: this.mediaPlan.markdown
    };
    this.diffs = buildPullFieldDiffs({
      noteRaw: this.frozen.content,
      matter: this.matter,
      fallbackTitle: this.sourceFile.basename,
      remote: {
        title: this.snapshot.title,
        body: this.mediaPlan.markdown,
        slug: this.snapshot.slug,
        excerpt: this.snapshot.excerpt,
        status: this.snapshot.status,
        commentStatus: this.snapshot.commentStatus,
        categoryIds: this.snapshot.categoryIds,
        tagIds: this.snapshot.tagIds,
        terms: this.snapshot.terms,
        featuredMedia: this.snapshot.featuredMedia
          ? { ...this.snapshot.featuredMedia, url: this.mediaPlan.featuredImage }
          : undefined,
        focusKeyword: this.snapshot.focusKeyword,
        metaDescription: this.snapshot.metaDescription,
        secondaryTitle: this.snapshot.secondaryTitle,
        capabilities: this.snapshot.capabilities
      }
    });
    const selectable = new Set(this.diffs
      .filter(diff => diff.available && diff.changed)
      .map(diff => diff.key));
    this.selectedFields = preserveSelection
      ? new Set([ ...this.selectedFields ].filter(field => selectable.has(field)))
      : selectable;
  }

  private async setDownloadRemoteMedia(enabled: boolean): Promise<void> {
    if (!this.selected || !this.snapshot || !this.canonicalConversion
      || !this.cachedMediaPlan || this.preparingMedia || this.applying
    ) return;
    const version = ++this.requestVersion;
    this.downloadRemoteMedia = enabled;
    this.preparingMedia = true;
    this.mediaError = '';
    this.render();
    try {
      if (!enabled) {
        this.mediaPlan = this.cachedMediaPlan;
      } else {
        const folder = validSyncMediaFolder(this.selected.profile.syncMediaFolder);
        if (!folder) throw new Error(this.t('pullModal_mediaFolderRequired'));
        this.mediaPlan = await prepareRemoteMediaDownloads({
          app: this.plugin.app,
          notePath: this.sourceFile.path,
          cache: this.selected.profile.mediaCache,
          folder,
          markdown: this.canonicalConversion.markdown,
          featuredMedia: this.snapshot.featuredMedia
        });
      }
      if (this.closed || version !== this.requestVersion) return;
      this.rebuildDiffsForMediaPlan(true);
    } catch (error) {
      if (this.closed || version !== this.requestVersion) return;
      this.downloadRemoteMedia = false;
      this.mediaPlan = this.cachedMediaPlan;
      this.rebuildDiffsForMediaPlan(true);
      this.mediaError = error instanceof Error ? error.message : String(error);
    } finally {
      if (!this.closed && version === this.requestVersion) {
        this.preparingMedia = false;
        this.render();
      }
    }
  }

  private selectedMediaCommitPlan(): PreparedMediaRoundTrip | null {
    if (!this.mediaPlan || !this.canonicalConversion || !this.snapshot) return null;
    const urls = new Set<string>();
    if (this.selectedFields.has(PullField.Body)) {
      remoteMarkdownImageUrls(this.canonicalConversion.markdown)
        .forEach(url => urls.add(url));
    }
    if (this.selectedFields.has(PullField.FeaturedMedia)
      && this.snapshot.featuredMedia?.url
    ) {
      urls.add(this.snapshot.featuredMedia.url);
    }
    return {
      ...this.mediaPlan,
      downloads: this.mediaPlan.downloads.filter(item => urls.has(item.sourceUrl))
    };
  }

  private matchingBaseline(): SyncBaseline | undefined {
    if (!this.selected) {
      return undefined;
    }
    const baseline = getSyncBaseline(
      this.plugin.settings.syncBaselineCache,
      this.sourceFile.path,
      this.selected.profile.id
    );
    return baseline
      && baseline.profileEndpoint === this.selected.profile.endpoint
      && baseline.postId === this.selected.target.postId
      && baseline.postType === this.selected.target.postType
      ? baseline
      : undefined;
  }

  private calculateReadySyncState(): void {
    this.syncBaseline = this.matchingBaseline();
    if (!this.snapshot || !this.canonicalConversion || !this.frozen) {
      this.syncResult = classifySyncState({ baseline: this.syncBaseline });
      return;
    }
    this.syncResult = classifySyncState({
      baseline: this.syncBaseline,
      local: createLocalSyncDocument({
        noteRaw: this.frozen.content,
        matter: this.matter,
        fallbackTitle: this.sourceFile.basename
      }),
      remote: createRemoteSyncDocument({
        remote: {
          title: this.snapshot.title,
          body: this.canonicalConversion.markdown,
          slug: this.snapshot.slug,
          excerpt: this.snapshot.excerpt,
          status: this.snapshot.status,
          commentStatus: this.snapshot.commentStatus,
          categoryIds: this.snapshot.categoryIds,
          tagIds: this.snapshot.tagIds,
          terms: this.snapshot.terms,
          featuredMedia: this.snapshot.featuredMedia,
          focusKeyword: this.snapshot.focusKeyword,
          metaDescription: this.snapshot.metaDescription,
          secondaryTitle: this.snapshot.secondaryTitle,
          capabilities: this.snapshot.capabilities
        }
      }),
      remoteModifiedAt: this.snapshot.modifiedAt
    });
  }

  private finishWithError(
    version: number,
    failure: PullFailure,
    record = true
  ): void {
    if (this.closed || version !== this.requestVersion) {
      return;
    }
    this.syncBaseline = this.matchingBaseline();
    this.syncResult = classifySyncState({
      baseline: this.syncBaseline,
      remoteMissing: failure.code === RemotePostErrorCode.Missing
    });
    this.failure = failure;
    this.phase = 'error';
    this.render();
    if (record && this.selected) {
      void this.recordHistory(PublishHistoryOutcome.Failure, 0, failure.message);
    }
  }

  private render(): void {
    this.selectedCountEl = null;
    this.actionHintEl = null;
    this.applyButtonEl = null;
    this.contentEl.empty();
    this.createHeader(this.t('pullModal_title'));
    this.renderHero();

    switch (this.phase) {
      case 'choose':
        this.renderChooser();
        break;
      case 'loading':
        this.renderTargetContext();
        this.renderLoading();
        break;
      case 'ready':
        this.renderTargetContext();
        this.renderSyncState();
        this.renderReview();
        break;
      case 'applied':
        this.renderTargetContext();
        this.renderSyncState();
        this.renderApplied();
        break;
      case 'undone':
        this.renderTargetContext();
        this.renderUndone();
        break;
      case 'empty':
        this.renderEmpty();
        break;
      case 'error':
        this.renderTargetContext();
        this.renderSyncState();
        this.renderError();
        break;
      default:
        this.renderLoading(true);
        break;
    }
  }

  private renderHero(): void {
    const hero = this.contentEl.createDiv({ cls: 'wp-publisher-remote-hero wp-publisher-pull-hero' });
    const copy = hero.createDiv();
    copy.createDiv({
      cls: 'wp-publisher-remote-eyebrow',
      text: this.t('pullModal_eyebrow')
    });
    copy.createEl('p', { text: this.t('pullModal_description') });
    hero.createDiv({
      cls: 'wp-publisher-remote-seal wp-publisher-pull-seal',
      text: this.t('pullModal_reviewFirst')
    });
    hero.createDiv({
      cls: 'wp-publisher-remote-note',
      text: this.sourceFile.path,
      attr: { title: this.sourceFile.path }
    });
  }

  private renderChooser(): void {
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section'
    });
    section.createEl('h2', { text: this.t('pullModal_chooseTitle') });
    section.createEl('p', {
      cls: 'wp-publisher-remote-section-copy',
      text: this.t('pullModal_chooseDescription')
    });
    const grid = section.createDiv({ cls: 'wp-publisher-remote-target-grid' });
    this.candidates.forEach(candidate => {
      const card = grid.createEl('button', {
        cls: 'wp-publisher-remote-target-card',
        attr: { type: 'button' }
      });
      const identity = card.createDiv({ cls: 'wp-publisher-remote-target-identity' });
      identity.createEl('strong', { text: candidate.profile.name });
      identity.createSpan({ text: this.siteLabel(candidate.profile.endpoint) });
      const post = card.createDiv({ cls: 'wp-publisher-remote-target-post' });
      post.createSpan({ text: candidate.target.postType });
      post.createEl('strong', { text: '#' + candidate.target.postId });
      card.createDiv({
        cls: 'wp-publisher-remote-target-action',
        text: this.t('pullModal_selectTarget')
      });
      card.addEventListener('click', () => this.selectCandidate(candidate));
    });
  }

  private renderTargetContext(): void {
    if (!this.selected) {
      return;
    }
    const context = this.contentEl.createDiv({ cls: 'wp-publisher-remote-context' });
    this.createContextFact(context, this.t('remoteInspector_profile'), this.selected.profile.name);
    this.createContextFact(
      context,
      this.t('remoteInspector_site'),
      this.siteLabel(this.selected.profile.endpoint)
    );
    this.createContextFact(
      context,
      this.t('remoteInspector_targetPost'),
      this.selected.target.postType + ' #' + this.selected.target.postId
    );
    if (this.candidates.length > 1
      && this.phase !== 'loading'
      && this.phase !== 'applied'
      && !this.applying
    ) {
      const changeButton = context.createEl('button', {
        text: this.t('remoteInspector_chooseAnother'),
        attr: { type: 'button' }
      });
      changeButton.addEventListener('click', () => {
        this.phase = 'choose';
        this.render();
      });
    }
  }

  private createContextFact(parent: HTMLElement, label: string, value: string): void {
    const fact = parent.createDiv();
    fact.createSpan({ text: label });
    fact.createEl('strong', { text: value });
  }

  private renderSyncState(): void {
    if (!this.syncResult) {
      return;
    }
    renderSyncStatePanel({
      parent: this.contentEl,
      result: this.syncResult,
      baseline: this.syncBaseline,
      t: (key, vars) => this.t(key, vars),
      dateLabel: value => this.dateLabel(value)
    });
  }

  private renderLoading(resolving = false): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state is-loading' });
    state.createDiv({ cls: 'wp-publisher-remote-spinner' });
    state.createEl('h2', {
      text: this.t(resolving ? 'pullModal_resolvingTitle' : 'pullModal_loadingTitle')
    });
    state.createEl('p', {
      text: this.t(resolving
        ? 'pullModal_resolvingDescription'
        : 'pullModal_loadingDescription')
    });
  }

  private renderEmpty(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state is-empty' });
    state.createDiv({ cls: 'wp-publisher-remote-empty-mark', text: 'WP' });
    state.createEl('h2', { text: this.t('pullModal_noLinkedTitle') });
    state.createEl('p', { text: this.t('pullModal_noLinkedDescription') });
  }

  private renderError(): void {
    const failure = this.failure ?? {
      code: RemotePostErrorCode.Network,
      message: this.t('remoteInspector_errorNetwork')
    };
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state is-error' });
    state.createDiv({ cls: 'wp-publisher-remote-error-code', text: failure.code });
    state.createEl('h2', { text: this.t('pullModal_errorTitle') });
    state.createEl('p', { text: this.errorSummary(failure.code) });
    if (failure.message && failure.message !== this.errorSummary(failure.code)) {
      state.createDiv({
        cls: 'wp-publisher-remote-error-detail',
        text: failure.message
      });
    }
    if (this.selected) {
      const retry = state.createEl('button', {
        cls: 'mod-cta',
        text: this.t('pullModal_retry'),
        attr: { type: 'button' }
      });
      retry.addEventListener('click', () => void this.prepareLocalAndFetch());
    }
  }

  private renderReview(): void {
    if (!this.snapshot || !this.conversion || !this.frozen) {
      return;
    }
    this.renderReviewSummary();
    this.renderMetadataDiffs();
    this.renderBodyDiff();
    this.renderMediaRoundTrip();
    this.renderConversionWarnings();
    this.renderSafetyPanel();
    this.renderReviewActions();
  }

  private renderReviewSummary(): void {
    if (!this.conversion) {
      return;
    }
    const changed = this.diffs.filter(diff => diff.changed).length;
    const panel = this.contentEl.createEl('section', {
      cls: 'wp-publisher-pull-summary'
    });
    const heading = panel.createDiv({ cls: 'wp-publisher-pull-summary-heading' });
    const copy = heading.createDiv();
    copy.createDiv({ cls: 'wp-publisher-pull-kicker', text: this.t('pullModal_snapshotReady') });
    copy.createEl('h2', {
      text: this.snapshot?.title || this.t('remoteInspector_emptyValue')
    });
    heading.createSpan({
      cls: 'wp-publisher-pull-fidelity is-' + this.conversion.fidelity,
      text: this.conversionKindLabel(this.conversion.fidelity)
    });
    const stats = panel.createDiv({ cls: 'wp-publisher-pull-stats' });
    this.createPullStat(stats, String(changed), this.t('pullModal_changedFields'));
    this.selectedCountEl = this.createPullStat(
      stats,
      String(this.selectedFields.size),
      this.t('pullModal_selectedFields')
    ).querySelector('strong');
    this.createPullStat(
      stats,
      String(this.warningCount()),
      this.t('pullModal_conversionWarnings')
    );
    this.createPullStat(
      stats,
      this.dateLabel(this.snapshot?.modifiedAt),
      this.t('remoteInspector_modified')
    );
  }

  private createPullStat(parent: HTMLElement, value: string, label: string): HTMLElement {
    const stat = parent.createDiv();
    stat.createEl('strong', { text: value });
    stat.createSpan({ text: label });
    return stat;
  }

  private renderMetadataDiffs(): void {
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-pull-section'
    });
    section.createEl('h2', { text: this.t('pullModal_metadataTitle') });
    section.createEl('p', {
      cls: 'wp-publisher-remote-section-copy',
      text: this.t('pullModal_metadataDescription')
    });
    const list = section.createDiv({ cls: 'wp-publisher-pull-fields' });
    this.diffs
      .filter(diff => diff.key !== PullField.Body)
      .forEach(diff => this.renderFieldDiff(list, diff));
  }

  private renderFieldDiff(parent: HTMLElement, diff: PullFieldDiff): void {
    const card = parent.createEl('article', {
      cls: 'wp-publisher-pull-field'
        + (diff.changed ? ' is-changed' : ' is-same')
        + (!diff.available ? ' is-unavailable' : '')
        + (this.selectedFields.has(diff.key) ? ' is-selected' : '')
    });
    const heading = card.createDiv({ cls: 'wp-publisher-pull-field-heading' });
    const label = heading.createEl('label');
    const checkbox = label.createEl('input', {
      attr: { type: 'checkbox' }
    }) as HTMLInputElement;
    checkbox.checked = this.selectedFields.has(diff.key);
    checkbox.disabled = !diff.available || !diff.changed || this.applying;
    label.createSpan({ text: this.fieldLabel(diff.key) });
    heading.createSpan({
      cls: 'wp-publisher-pull-change-state',
      text: this.t(!diff.available
        ? 'pullModal_unavailable'
        : diff.changed
          ? 'pullModal_changed'
          : 'pullModal_same')
    });
    checkbox.addEventListener('change', () => {
      this.toggleField(diff.key, checkbox.checked, card);
    });

    const values = card.createDiv({ cls: 'wp-publisher-pull-values' });
    this.renderValue(values, this.t('pullModal_localValue'), diff.localValue);
    this.renderValue(values, this.t('pullModal_wordPressValue'), diff.remoteValue);
    if (!diff.available) {
      card.createDiv({
        cls: 'wp-publisher-pull-field-issue',
        text: this.fieldIssue(diff)
      });
    }
  }

  private renderValue(parent: HTMLElement, label: string, value: PullFieldValue): void {
    const item = parent.createDiv();
    item.createSpan({ text: label });
    const display = Array.isArray(value) ? value.join(', ') : value;
    item.createEl('code', {
      text: display || this.t('pullModal_emptyValue')
    });
  }

  private renderBodyDiff(): void {
    const diff = this.diffs.find(item => item.key === PullField.Body);
    if (!diff) {
      return;
    }
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-pull-section wp-publisher-pull-body'
        + (this.selectedFields.has(PullField.Body) ? ' is-selected' : '')
    });
    const heading = section.createDiv({ cls: 'wp-publisher-pull-body-heading' });
    const copy = heading.createDiv();
    const label = copy.createEl('label');
    const checkbox = label.createEl('input', {
      attr: { type: 'checkbox' }
    }) as HTMLInputElement;
    checkbox.checked = this.selectedFields.has(PullField.Body);
    checkbox.disabled = !diff.changed || this.applying;
    label.createEl('h2', { text: this.t('pullModal_bodyTitle') });
    copy.createEl('p', { text: this.t('pullModal_bodyDescription') });
    heading.createSpan({
      cls: 'wp-publisher-pull-change-state',
      text: this.t(diff.changed ? 'pullModal_changed' : 'pullModal_same')
    });
    checkbox.addEventListener('change', () => {
      this.toggleField(PullField.Body, checkbox.checked, section);
    });

    if (!diff.changed) {
      section.createDiv({
        cls: 'wp-publisher-pull-no-diff',
        text: this.t('pullModal_bodySame')
      });
      return;
    }
    const unified = createUnifiedLineDiff(
      String(diff.localValue),
      String(diff.remoteValue)
    );
    const diffEl = section.createDiv({ cls: 'wp-publisher-pull-unified-diff' });
    unified.rows.forEach(row => {
      const line = diffEl.createDiv({ cls: 'is-' + row.kind });
      line.createSpan({
        cls: 'wp-publisher-pull-line-number',
        text: (row.localLine ?? '') + ' ' + (row.remoteLine ?? '')
      });
      line.createSpan({
        cls: 'wp-publisher-pull-line-marker',
        text: row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' '
      });
      line.createEl('code', { text: row.line || ' ' });
    });
    if (unified.omittedRows > 0) {
      diffEl.createDiv({
        cls: 'wp-publisher-pull-diff-omitted',
        text: this.t('pullModal_diffOmitted', {
          count: String(unified.omittedRows)
        })
      });
    }
  }

  private renderConversionWarnings(): void {
    if (!this.conversion) {
      return;
    }
    const diagnostics = this.conversion.diagnostics.filter(
      item => item.kind !== WordPressConversionKind.Exact
    );
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-pull-section wp-publisher-pull-audit'
    });
    const heading = section.createDiv({ cls: 'wp-publisher-pull-audit-heading' });
    const copy = heading.createDiv();
    copy.createEl('h2', { text: this.t('pullModal_conversionTitle') });
    copy.createEl('p', { text: this.t('pullModal_conversionDescription') });
    heading.createSpan({
      cls: 'wp-publisher-pull-fidelity is-' + this.conversion.fidelity,
      text: this.conversionKindLabel(this.conversion.fidelity)
    });
    if (diagnostics.length === 0) {
      section.createDiv({
        cls: 'wp-publisher-pull-no-diff',
        text: this.t('pullModal_noWarnings')
      });
      return;
    }
    const list = section.createDiv({ cls: 'wp-publisher-pull-diagnostics' });
    diagnostics.forEach(diagnostic => this.renderDiagnostic(list, diagnostic));
  }

  private renderDiagnostic(
    parent: HTMLElement,
    diagnostic: WordPressConversionDiagnostic
  ): void {
    const item = parent.createDiv({
      cls: 'wp-publisher-pull-diagnostic is-' + diagnostic.kind
    });
    const heading = item.createDiv();
    heading.createEl('strong', {
      text: diagnostic.blockName ?? this.t('remoteInspector_conversionDocument')
    });
    heading.createEl('code', { text: this.conversionLocation(diagnostic) });
    item.createEl('p', { text: diagnostic.message });
    item.createEl('code', { text: diagnostic.code });
  }

  private renderMediaRoundTrip(): void {
    if (!this.snapshot || !this.canonicalConversion || !this.mediaPlan) return;
    const bodyUrls = remoteMarkdownImageUrls(this.canonicalConversion.markdown);
    const remoteCount = new Set([
      ...bodyUrls,
      ...(this.snapshot.featuredMedia?.url ? [ this.snapshot.featuredMedia.url ] : [])
    ]).size;
    if (remoteCount === 0) return;
    const folder = validSyncMediaFolder(this.selected?.profile.syncMediaFolder);
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-pull-section wp-publisher-sync-media'
    });
    section.createEl('h2', { text: this.t('pullModal_mediaTitle') });
    section.createEl('p', {
      cls: 'wp-publisher-remote-section-copy',
      text: this.t('pullModal_mediaDescription', {
        remote: String(remoteCount),
        restored: String(this.mediaPlan.restoredCount)
      })
    });
    const facts = section.createDiv({ cls: 'wp-publisher-sync-media-facts' });
    facts.createSpan({
      text: folder
        ? this.t('pullModal_mediaFolder', { folder })
        : this.t('pullModal_mediaFolderMissing')
    });
    if (this.mediaPlan.downloads.length > 0) {
      facts.createSpan({
        text: this.t('pullModal_mediaPrepared', {
          count: String(this.mediaPlan.downloads.length)
        })
      });
    }
    const label = section.createEl('label', { cls: 'wp-publisher-sync-media-toggle' });
    const toggle = label.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
    toggle.checked = this.downloadRemoteMedia;
    toggle.disabled = !folder || this.preparingMedia || this.applying;
    label.createSpan({
      text: this.t(this.preparingMedia
        ? 'pullModal_mediaPreparing'
        : 'pullModal_mediaDownload')
    });
    toggle.addEventListener('change', () => {
      void this.setDownloadRemoteMedia(toggle.checked);
    });
    if (this.mediaError) {
      section.createDiv({ cls: 'wp-publisher-pull-field-issue', text: this.mediaError });
    }
  }

  private renderSafetyPanel(): void {
    const blocking = this.hasBlockingConversion();
    const panel = this.contentEl.createDiv({
      cls: 'wp-publisher-pull-safety'
        + (blocking || this.stale ? ' is-blocked' : ' is-safe')
    });
    panel.createDiv({
      cls: 'wp-publisher-pull-safety-mark',
      text: blocking || this.stale ? '!' : '✓'
    });
    const copy = panel.createDiv();
    copy.createEl('strong', {
      text: this.t(blocking
        ? 'pullModal_blockingTitle'
        : this.stale
          ? 'pullModal_staleTitle'
          : 'pullModal_safeTitle')
    });
    copy.createEl('p', {
      text: blocking
        ? this.t('pullModal_blockingDescription')
        : this.stale
          ? this.t('pullModal_staleDescription')
          : this.t('pullModal_safeDescription')
    });
    if (this.reviewMessage) {
      panel.createDiv({ cls: 'wp-publisher-pull-safety-detail', text: this.reviewMessage });
    }
  }

  private renderReviewActions(): void {
    const actions = this.contentEl.createDiv({ cls: 'wp-publisher-pull-actions' });
    this.actionHintEl = actions.createSpan();
    const refresh = actions.createEl('button', {
      text: this.t('pullModal_reloadReview'),
      attr: { type: 'button' }
    });
    refresh.disabled = this.applying;
    refresh.addEventListener('click', () => void this.prepareLocalAndFetch());
    const cancel = actions.createEl('button', {
      text: this.t('pullModal_cancel'),
      attr: { type: 'button' }
    });
    cancel.disabled = this.applying;
    cancel.addEventListener('click', () => this.close());
    this.applyButtonEl = actions.createEl('button', {
      cls: 'mod-cta wp-publisher-pull-apply',
      text: this.t(this.applying ? 'pullModal_applying' : 'pullModal_apply'),
      attr: { type: 'button' }
    });
    this.applyButtonEl.addEventListener('click', () => void this.applyPull());
    this.updateSelectionState();
  }

  private toggleField(key: PullField, selected: boolean, card: HTMLElement): void {
    if (selected) {
      this.selectedFields.add(key);
    } else {
      this.selectedFields.delete(key);
    }
    card.classList.toggle('is-selected', selected);
    this.updateSelectionState();
  }

  private updateSelectionState(): void {
    this.selectedCountEl?.setText(String(this.selectedFields.size));
    if (this.actionHintEl) {
      this.actionHintEl.setText(this.t(
        this.hasBlockingConversion()
          ? 'pullModal_actionBlocked'
          : this.stale
            ? 'pullModal_actionStale'
            : this.selectedFields.size === 0
              ? 'pullModal_actionNone'
              : 'pullModal_actionReady',
        { count: String(this.selectedFields.size) }
      ));
    }
    if (this.applyButtonEl) {
      this.applyButtonEl.disabled = this.applying
        || this.preparingMedia
        || this.stale
        || this.hasBlockingConversion()
        || this.selectedFields.size === 0;
      this.applyButtonEl.classList.toggle('is-loading', this.applying);
    }
  }

  private async rememberPullSyncBaseline(
    nextContent: string,
    nextMatter: MatterData
  ): Promise<void> {
    if (!this.selected || !this.snapshot || !this.canonicalConversion) {
      return;
    }
    const previousCache = this.plugin.settings.syncBaselineCache;
    try {
      const fields = [ ...this.selectedFields ];
      const local = createLocalSyncDocument({
        noteRaw: nextContent,
        matter: nextMatter,
        fallbackTitle: this.sourceFile.basename
      });
      const remote = createRemoteSyncDocument({
        remote: {
          title: this.snapshot.title,
          body: this.canonicalConversion.markdown,
          slug: this.snapshot.slug,
          excerpt: this.snapshot.excerpt,
          status: this.snapshot.status,
          commentStatus: this.snapshot.commentStatus,
          categoryIds: this.snapshot.categoryIds,
          tagIds: this.snapshot.tagIds,
          terms: this.snapshot.terms,
          featuredMedia: this.snapshot.featuredMedia,
          focusKeyword: this.snapshot.focusKeyword,
          metaDescription: this.snapshot.metaDescription,
          secondaryTitle: this.snapshot.secondaryTitle,
          capabilities: this.snapshot.capabilities
        }
      });
      const now = new Date().toISOString();
      let baseline = createOrUpdateSyncBaseline({
        existing: getSyncBaseline(
          previousCache,
          this.sourceFile.path,
          this.selected.profile.id
        ),
        identity: {
          notePath: this.sourceFile.path,
          profileId: this.selected.profile.id,
          profileName: this.selected.profile.name,
          profileEndpoint: this.selected.profile.endpoint,
          postId: this.selected.target.postId,
          postType: this.selected.target.postType
        },
        local,
        remote,
        fields,
        remoteModifiedAt: this.snapshot.modifiedAt,
        now
      });
      const observation = classifySyncState({
        baseline,
        local,
        remote,
        remoteModifiedAt: this.snapshot.modifiedAt
      });
      baseline = {
        ...baseline,
        lastObservedState: observation.state,
        lastObservedAt: now
      };
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
      this.syncBaseline = baseline;
      this.syncResult = observation;
    } catch (error) {
      console.error('Could not save WordPress sync baseline after pull.', error);
    }
  }

  private async applyPull(): Promise<void> {
    if (!this.selected || !this.snapshot || !this.conversion || !this.frozen
      || this.applying || this.preparingMedia || this.stale
      || this.hasBlockingConversion() || this.selectedFields.size === 0
    ) return;
    this.applying = true;
    this.reviewMessage = '';
    this.render();
    let stagedSnapshot: PullRestoreSnapshot | null = null;
    let committed = false;
    const selectedCount = this.selectedFields.size;
    const previousSnapshots = this.plugin.settings.pullRestoreSnapshots;
    const previousMediaCache = this.selected.profile.mediaCache;
    let createdPaths: string[] = [];
    try {
      const latest = await this.plugin.app.vault.read(this.sourceFile);
      if (await hashNoteRevision(latest) !== this.frozen.hash) {
        throw new PullTransactionError(
          PullTransactionErrorCode.StaleLocalRevision,
          this.t('pullModal_staleDescription')
        );
      }

      const mediaPlan = this.selectedMediaCommitPlan();
      if (mediaPlan && mediaPlan.downloads.length > 0) {
        const mediaCommit = await commitPreparedMediaDownloads({
          app: this.plugin.app,
          cache: previousMediaCache,
          plan: mediaPlan
        });
        this.selected.profile.mediaCache = mediaCommit.cache;
        createdPaths = mediaCommit.createdPaths;
      }

      const metadataSelected = new Set(
        [ ...this.selectedFields ].filter(key => key !== PullField.Body)
      );
      const nextMatter = applySelectedPullFields(
        this.matter,
        this.diffs,
        this.selectedFields
      );
      const bodyDiff = this.diffs.find(item => item.key === PullField.Body);
      const nextContent = composePulledNoteRevision({
        raw: this.frozen.content,
        ...(metadataSelected.size > 0
          ? { serializedMatter: stringifyYaml(nextMatter) }
          : {}),
        ...(this.selectedFields.has(PullField.Body) && bodyDiff
          ? { pulledBody: String(bodyDiff.remoteValue) }
          : {})
      });
      const selectedPlan = this.selectedMediaCommitPlan();
      const createdMedia = selectedPlan?.downloads
        .filter(item => createdPaths.includes(item.vaultPath))
        .map(item => ({ vaultPath: item.vaultPath, contentHash: item.contentHash })) ?? [];
      stagedSnapshot = await createPullRestoreSnapshot({
        notePath: this.sourceFile.path,
        profileId: this.selected.profile.id,
        profileName: this.selected.profile.name,
        endpoint: this.selected.profile.endpoint,
        postId: this.selected.target.postId,
        postType: this.selected.target.postType,
        beforeContent: this.frozen.content,
        appliedContent: nextContent,
        ...(createdMedia.length > 0 ? { createdMedia } : {})
      });

      this.plugin.settings.pullRestoreSnapshots = addPullRestoreSnapshot(
        previousSnapshots,
        stagedSnapshot
      );
      await this.plugin.saveSettings();

      await applyGuardedNoteRevision(
        this.plugin.app.vault,
        this.sourceFile,
        this.frozen,
        nextContent
      );
      committed = true;
      this.createdMediaPaths = createdPaths;
      this.restoreSnapshot = stagedSnapshot;
      await this.rememberPullSyncBaseline(nextContent, nextMatter);
      await this.recordHistory(PublishHistoryOutcome.Success, selectedCount);
      this.phase = 'applied';
      this.applying = false;
      this.render();
    } catch (error) {
      if (committed) {
        console.error('The pull committed, but its completion view failed.', error);
        this.applying = false;
        this.phase = 'applied';
        return;
      }
      this.selected.profile.mediaCache = previousMediaCache;
      await rollbackCreatedMediaDownloads(this.plugin.app, createdPaths);
      this.plugin.settings.pullRestoreSnapshots = stagedSnapshot
        ? removePullRestoreSnapshot(
          this.plugin.settings.pullRestoreSnapshots,
          stagedSnapshot.id
        )
        : previousSnapshots;
      try {
        await this.plugin.saveSettings();
      } catch (saveError) {
        console.error('Could not roll back staged pull settings.', saveError);
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.recordHistory(PublishHistoryOutcome.Failure, selectedCount, message);
      this.applying = false;
      if (error instanceof PullTransactionError
        && error.code === PullTransactionErrorCode.StaleLocalRevision
      ) {
        this.stale = true;
        this.reviewMessage = message;
      } else {
        this.reviewMessage = this.t('pullModal_applyFailed', { message });
      }
      this.phase = 'ready';
      this.render();
    }
  }

  private async recordHistory(
    outcome: PublishHistoryOutcomeValue,
    selectedFieldCount: number,
    message?: string
  ): Promise<void> {
    if (!this.selected) {
      return;
    }
    try {
      const entry = createPublishHistoryEntry({
        outcome,
        action: PublishHistoryAction.Pull,
        notePath: this.sourceFile.path,
        noteTitle: this.sourceFile.basename,
        profileName: this.selected.profile.name,
        profileId: this.selected.profile.id,
        endpoint: this.selected.profile.endpoint,
        postType: this.selected.target.postType,
        postId: this.selected.target.postId,
        selectedFieldCount,
        warningCount: this.warningCount(),
        ...(message ? { message } : {})
      });
      this.plugin.settings.publishHistory = addPublishHistoryEntry(
        this.plugin.settings.publishHistory,
        entry
      );
      await this.plugin.saveSettings();
    } catch (error) {
      console.error('Could not save WordPress pull history.', error);
    }
  }

  private renderApplied(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-pull-result is-success' });
    state.createDiv({ cls: 'wp-publisher-pull-result-mark', text: '✓' });
    state.createEl('h2', { text: this.t('pullModal_appliedTitle') });
    state.createEl('p', {
      text: this.t('pullModal_appliedDescription', {
        count: String(this.selectedFields.size)
      })
    });
    const facts = state.createDiv({ cls: 'wp-publisher-pull-result-facts' });
    this.createPullStat(facts, String(this.selectedFields.size), this.t('pullModal_selectedFields'));
    this.createPullStat(facts, String(this.warningCount()), this.t('pullModal_conversionWarnings'));
    const actions = state.createDiv({ cls: 'wp-publisher-pull-result-actions' });
    const close = actions.createEl('button', {
      text: this.t('pullModal_close'),
      attr: { type: 'button' }
    });
    close.addEventListener('click', () => this.close());
    const undo = actions.createEl('button', {
      cls: 'mod-cta',
      text: this.t('pullModal_undoNow'),
      attr: { type: 'button' }
    });
    undo.disabled = !this.restoreSnapshot;
    undo.addEventListener('click', () => void this.undoAppliedPull(undo));
  }

  private async undoAppliedPull(button: HTMLButtonElement): Promise<void> {
    if (!this.restoreSnapshot) {
      return;
    }
    button.disabled = true;
    button.addClass('is-loading');
    try {
      await undoGuardedPull(
        this.plugin.app.vault,
        this.sourceFile,
        this.restoreSnapshot
      );
    } catch (error) {
      button.disabled = false;
      button.removeClass('is-loading');
      new Notice(this.t(
        error instanceof PullTransactionError
          && error.code === PullTransactionErrorCode.StaleUndoRevision
          ? 'pullModal_undoStale'
          : 'pullModal_undoFailed',
        { message: error instanceof Error ? error.message : String(error) }
      ));
      return;
    }

    await removeDownloadedMediaAfterUndo(
      this.plugin.app,
      this.restoreSnapshot.createdMedia ?? []
    );
    this.plugin.settings.pullRestoreSnapshots = removePullRestoreSnapshot(
      this.plugin.settings.pullRestoreSnapshots,
      this.restoreSnapshot.id
    );
    let cleanupFailed = false;
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      cleanupFailed = true;
      console.error('The pulled note was restored, but Undo cleanup could not be saved.', error);
    }
    this.restoreSnapshot = null;
    this.phase = 'undone';
    this.render();
    if (cleanupFailed) {
      new Notice(this.t('pullModal_undoCleanupWarning'));
    }
  }

  private renderUndone(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-pull-result is-undone' });
    state.createDiv({ cls: 'wp-publisher-pull-result-mark', text: '↶' });
    state.createEl('h2', { text: this.t('pullModal_undoneTitle') });
    state.createEl('p', { text: this.t('pullModal_undoneDescription') });
    const close = state.createEl('button', {
      cls: 'mod-cta',
      text: this.t('pullModal_close'),
      attr: { type: 'button' }
    });
    close.addEventListener('click', () => this.close());
  }

  private hasBlockingConversion(): boolean {
    return this.conversion?.diagnostics.some(
      item => item.kind === WordPressConversionKind.Blocking
    ) ?? false;
  }

  private warningCount(): number {
    return this.conversion?.diagnostics.filter(
      item => item.kind !== WordPressConversionKind.Exact
    ).length ?? 0;
  }

  private fieldLabel(key: PullField): string {
    switch (key) {
      case PullField.Title:
        return this.t('pullModal_fieldTitle');
      case PullField.Body:
        return this.t('pullModal_bodyTitle');
      case PullField.Slug:
        return this.t('remoteInspector_slug');
      case PullField.Excerpt:
        return this.t('remoteInspector_excerpt');
      case PullField.Status:
        return this.t('remoteInspector_status');
      case PullField.CommentStatus:
        return this.t('remoteInspector_comments');
      case PullField.Categories:
        return this.t('remoteInspector_categories');
      case PullField.Tags:
        return this.t('remoteInspector_tags');
      case PullField.FeaturedMedia:
        return this.t('pullModal_fieldFeaturedMedia');
      case PullField.FocusKeyword:
        return this.t('pullModal_fieldFocusKeyword');
      case PullField.MetaDescription:
        return this.t('pullModal_fieldMetaDescription');
      default:
        return this.t('pullModal_fieldSecondaryTitle');
    }
  }

  private fieldIssue(diff: PullFieldDiff): string {
    const ids = diff.missingIds?.map(id => '#' + id).join(', ') ?? '';
    if (diff.issue === 'missing-featured-media-url') {
      return this.t('pullModal_missingFeaturedMediaUrl');
    }
    return this.t(
      diff.issue === 'missing-category-slugs'
        ? 'pullModal_missingCategorySlugs'
        : 'pullModal_missingTagNames',
      { ids }
    );
  }

  private conversionKindLabel(kind: WordPressConversionKind): string {
    switch (kind) {
      case WordPressConversionKind.Normalized:
        return this.t('remoteInspector_conversionNormalized');
      case WordPressConversionKind.PreservedRaw:
        return this.t('remoteInspector_conversionPreserved');
      case WordPressConversionKind.Blocking:
        return this.t('remoteInspector_conversionBlocking');
      default:
        return this.t('remoteInspector_conversionExact');
    }
  }

  private conversionLocation(diagnostic: WordPressConversionDiagnostic): string {
    const { start, end } = diagnostic.range;
    return 'L' + start.line + ':C' + start.column
      + ' - L' + end.line + ':C' + end.column;
  }

  private errorSummary(code: string): string {
    switch (code) {
      case RemotePostErrorCode.Authentication:
        return this.t('remoteInspector_errorAuthentication');
      case RemotePostErrorCode.Permission:
        return this.t('remoteInspector_errorPermission');
      case RemotePostErrorCode.Missing:
        return this.t('remoteInspector_errorMissing');
      case RemotePostErrorCode.UnsupportedType:
        return this.t('remoteInspector_errorUnsupportedType');
      case RemotePostErrorCode.MalformedResponse:
        return this.t('remoteInspector_errorMalformed');
      case RemotePostErrorCode.IdentityMismatch:
        return this.t('remoteInspector_errorMismatch');
      case RemotePostErrorCode.InvalidTarget:
        return this.t('remoteInspector_invalidTarget');
      case 'remote_conversion_failed':
        return this.t('pullModal_conversionFailed');
      default:
        return this.t('remoteInspector_errorNetwork');
    }
  }

  private dateLabel(value: string | undefined): string {
    if (!value) {
      return this.t('remoteInspector_unavailable');
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  private siteLabel(endpoint: string): string {
    try {
      return new URL(endpoint).host || endpoint;
    } catch {
      return endpoint;
    }
  }
}
