import {
  getFrontMatterInfo,
  parseYaml,
  TFile
} from 'obsidian';
import WordpressPlugin from './main';
import { AbstractModal } from './abstract-modal';
import type { MatterData } from './types';
import type { WpProfile } from './wp-profile';
import type { RemotePostSnapshot, RemotePostTarget } from './remote-post';
import { RemotePostErrorCode } from './remote-post';
import { resolveStableProfileNoteTargets } from './profile-note-target';
import { getWordPressClient } from './wp-clients';
import {
  WordPressClientReturnCode,
  type WordPressClient
} from './wp-client';
import {
  convertWordPressToMarkdown,
  WordPressConversionKind,
  type WordPressToMarkdownResult
} from './wordpress-to-markdown';
import {
  classifySyncState,
  createLocalSyncDocument,
  createRemoteSyncDocument,
  getSyncBaseline,
  observeSyncBaseline,
  SyncState,
  type SyncBaseline,
  type SyncDocument,
  type SyncStateResult
} from './sync-baseline';
import { renderSyncStatePanel } from './sync-state-panel';
import { PULL_FIELD_ORDER, PullField } from './sync-diff';
import { safeSyncActions, SyncWorkflowAction } from './sync-workflow';
import { openPullPreviewModal } from './wp-pull-preview-modal';
import { openSyncConflictModal } from './wp-sync-conflict-modal';
import { buildCoordinatedPostParams } from './coordinated-publish';
import { PublishUpdateStrategy } from './publish-strategy';
import { PublishHistoryAction } from './publish-history';
import { readEditorialFrontMatter } from './front-matter';
import {
  freezeNoteRevision,
  hashNoteRevision,
  type FrozenNoteRevision
} from './note-sync-transaction';
import { syncDocumentsMatch } from './three-way-merge';
import { ConfirmCode, openConfirmModal } from './confirm-modal';
import { openWithBrowser, showError } from './utils';

type SyncPhase = 'resolving' | 'choose' | 'loading' | 'ready' | 'empty'
  | 'error' | 'pushing' | 'success' | 'partial';

interface SyncCandidate {
  profile: WpProfile;
  target: RemotePostTarget;
  linkedAt: string;
}

interface SyncFailure {
  code: string;
  message: string;
}

export function openWordPressSyncModal(plugin: WordpressPlugin): void {
  const file = plugin.app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    showError(plugin.i18n.t('error_noActiveFile'));
    return;
  }
  new WpSyncModal(plugin, file).open();
}

class WpSyncModal extends AbstractModal {
  private phase: SyncPhase = 'resolving';
  private candidates: SyncCandidate[] = [];
  private selected: SyncCandidate | null = null;
  private client: WordPressClient | null = null;
  private snapshot: RemotePostSnapshot | null = null;
  private conversion: WordPressToMarkdownResult | null = null;
  private baseline: SyncBaseline | undefined;
  private baselineSignature = '';
  private localDocument: SyncDocument | null = null;
  private remoteDocument: SyncDocument | null = null;
  private syncResult: SyncStateResult | null = null;
  private frozen: FrozenNoteRevision | null = null;
  private matter: MatterData = {};
  private failure: SyncFailure | null = null;
  private resultMessage = '';
  private requestVersion = 0;
  private closed = false;

  constructor(
    plugin: WordpressPlugin,
    private readonly sourceFile: TFile
  ) {
    super(plugin);
  }

  onOpen(): void {
    this.modalEl.addClass('wp-publisher-remote-modal');
    this.modalEl.addClass('wp-publisher-sync-modal');
    this.render();
    void this.resolveTargets();
  }

  onClose(): void {
    this.closed = true;
    this.requestVersion += 1;
    this.contentEl.empty();
  }

  private readMatter(raw: string): MatterData {
    const info = getFrontMatterInfo(raw);
    if (!info.exists || !info.frontmatter.trim()) return {};
    const parsed = parseYaml(info.frontmatter);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as MatterData
      : {};
  }

  private async resolveTargets(): Promise<void> {
    try {
      const raw = await this.plugin.app.vault.read(this.sourceFile);
      const matter = this.readMatter(raw);
      const profiles = new Map(
        this.plugin.settings.profiles.map(profile => [ profile.id, profile ])
      );
      this.candidates = resolveStableProfileNoteTargets({
        store: this.plugin.settings.multiSiteTargets,
        notePath: this.sourceFile.path,
        profiles: this.plugin.settings.profiles,
        matter
      }).flatMap(target => {
        const profile = profiles.get(target.profileId);
        return profile ? [ {
          profile,
          target: { postId: target.postId, postType: target.postType },
          linkedAt: target.updatedAt
        } ] : [];
      });
      if (this.closed) return;
      if (this.candidates.length === 0) {
        this.phase = 'empty';
        this.render();
      } else if (this.candidates.length === 1) {
        this.selectCandidate(this.candidates[0]);
      } else {
        this.phase = 'choose';
        this.render();
      }
    } catch (error) {
      this.fail({
        code: RemotePostErrorCode.InvalidTarget,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private selectCandidate(candidate: SyncCandidate): void {
    this.selected = {
      profile: candidate.profile,
      target: Object.freeze({ ...candidate.target }),
      linkedAt: candidate.linkedAt
    };
    void this.refreshState();
  }

  private candidateStillLinked(matter: MatterData): boolean {
    if (!this.selected) return false;
    return resolveStableProfileNoteTargets({
      store: this.plugin.settings.multiSiteTargets,
      notePath: this.sourceFile.path,
      profiles: this.plugin.settings.profiles,
      matter
    }).some(target => target.profileId === this.selected?.profile.id
      && target.postId === this.selected.target.postId
      && target.postType === this.selected.target.postType);
  }

  private matchingBaseline(): SyncBaseline | undefined {
    if (!this.selected) return undefined;
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

  private baselineKey(baseline: SyncBaseline | undefined): string {
    return baseline ? JSON.stringify({
      converterVersion: baseline.converterVersion,
      lastAgreedAt: baseline.lastAgreedAt,
      postId: baseline.postId,
      postType: baseline.postType,
      fields: baseline.fields
    }) : '';
  }

  private remoteDocumentFor(
    snapshot: RemotePostSnapshot,
    conversion: WordPressToMarkdownResult
  ): SyncDocument {
    return createRemoteSyncDocument({
      remote: {
        title: snapshot.title,
        body: conversion.markdown,
        slug: snapshot.slug,
        excerpt: snapshot.excerpt,
        status: snapshot.status,
        commentStatus: snapshot.commentStatus,
        categoryIds: snapshot.categoryIds,
        tagIds: snapshot.tagIds,
        terms: snapshot.terms,
        featuredMedia: snapshot.featuredMedia,
        focusKeyword: snapshot.focusKeyword,
        metaDescription: snapshot.metaDescription,
        secondaryTitle: snapshot.secondaryTitle,
        capabilities: snapshot.capabilities
      }
    });
  }

  private async refreshState(): Promise<void> {
    if (!this.selected) return;
    const version = ++this.requestVersion;
    this.phase = 'loading';
    this.failure = null;
    this.resultMessage = '';
    this.snapshot = null;
    this.conversion = null;
    this.baseline = undefined;
    this.baselineSignature = '';
    this.localDocument = null;
    this.remoteDocument = null;
    this.syncResult = null;
    this.frozen = null;
    this.matter = {};
    this.client = null;
    this.render();
    try {
      const raw = await this.plugin.app.vault.read(this.sourceFile);
      const matter = this.readMatter(raw);
      if (!this.candidateStillLinked(matter)) {
        throw new Error(this.t('syncModal_linkChanged'));
      }
      this.frozen = await freezeNoteRevision(raw);
      this.matter = matter;
      this.baseline = this.matchingBaseline();
      this.baselineSignature = this.baselineKey(this.baseline);
      this.localDocument = createLocalSyncDocument({
        noteRaw: raw,
        matter,
        fallbackTitle: this.sourceFile.basename
      });
      this.client = getWordPressClient(this.plugin, this.selected.profile);
      if (!this.client) throw new Error(this.t('remoteInspector_clientUnavailable'));
      const fetched = await this.client.fetchPost(this.selected.target);
      if (this.closed || version !== this.requestVersion) return;
      if (fetched.code !== WordPressClientReturnCode.OK) {
        if (fetched.error.code === RemotePostErrorCode.Missing) {
          this.syncResult = classifySyncState({
            baseline: this.baseline,
            remoteMissing: true
          });
          this.failure = { code: String(fetched.error.code), message: fetched.error.message };
          this.phase = 'ready';
          this.render();
          return;
        }
        throw new Error(fetched.error.message);
      }
      const conversion = convertWordPressToMarkdown(
        fetched.data.content,
        fetched.data.sourceFormat
      );
      this.snapshot = fetched.data;
      this.conversion = conversion;
      this.remoteDocument = this.remoteDocumentFor(fetched.data, conversion);
      if (conversion.diagnostics.some(
        item => item.kind === WordPressConversionKind.Blocking
      )) {
        this.syncResult = classifySyncState({ baseline: this.baseline });
        this.failure = {
          code: 'blocking-conversion',
          message: this.t('syncModal_conversionBlocked')
        };
      } else {
        this.syncResult = classifySyncState({
          baseline: this.baseline,
          local: this.localDocument,
          remote: this.remoteDocument,
          remoteModifiedAt: fetched.data.modifiedAt
        });
      }
      this.phase = 'ready';
      this.render();
      void this.rememberObservation();
    } catch (error) {
      if (this.closed || version !== this.requestVersion) return;
      this.fail({
        code: RemotePostErrorCode.Network,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async rememberObservation(): Promise<void> {
    if (!this.selected || !this.syncResult || !this.baseline) return;
    const previous = this.plugin.settings.syncBaselineCache;
    this.plugin.settings.syncBaselineCache = observeSyncBaseline(
      previous,
      this.sourceFile.path,
      this.selected.profile.id,
      this.syncResult.state
    );
    try {
      await this.plugin.saveSettings();
    } catch {
      this.plugin.settings.syncBaselineCache = previous;
    }
  }

  private fail(failure: SyncFailure): void {
    this.failure = failure;
    this.phase = 'error';
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.createHeader(this.t('syncModal_title'));
    this.renderHero();
    switch (this.phase) {
      case 'choose':
        this.renderChooser();
        break;
      case 'ready':
        this.renderReady();
        break;
      case 'empty':
        this.renderEmpty();
        break;
      case 'error':
        this.renderError();
        break;
      case 'success':
      case 'partial':
        this.renderResult();
        break;
      default:
        this.renderLoading();
    }
  }

  private renderHero(): void {
    const hero = this.contentEl.createDiv({
      cls: 'wp-publisher-remote-hero wp-publisher-sync-hero'
    });
    const copy = hero.createDiv();
    copy.createDiv({ cls: 'wp-publisher-remote-eyebrow', text: this.t('syncModal_eyebrow') });
    copy.createEl('p', { text: this.t('syncModal_description') });
    hero.createDiv({ cls: 'wp-publisher-remote-seal', text: 'SYNC' });
  }

  private renderLoading(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state' });
    state.createDiv({ cls: 'wp-publisher-remote-spinner' });
    state.createEl('h2', {
      text: this.t(this.phase === 'pushing' ? 'syncModal_pushing' : 'syncModal_loading')
    });
  }

  private renderChooser(): void {
    const section = this.contentEl.createEl('section', { cls: 'wp-publisher-remote-section' });
    section.createEl('h2', { text: this.t('syncModal_chooseTitle') });
    section.createEl('p', { text: this.t('syncModal_chooseDescription') });
    const list = section.createDiv({ cls: 'wp-publisher-remote-target-grid' });
    this.candidates.forEach(candidate => {
      const button = list.createEl('button', {
        cls: 'wp-publisher-remote-target-card',
        attr: { type: 'button' }
      });
      const identity = button.createDiv({
        cls: 'wp-publisher-remote-target-identity'
      });
      identity.createEl('strong', { text: candidate.profile.name });
      identity.createSpan({ text: this.siteLabel(candidate.profile.endpoint) });
      const post = button.createDiv({ cls: 'wp-publisher-remote-target-post' });
      post.createSpan({ text: candidate.target.postType });
      post.createEl('strong', { text: '#' + candidate.target.postId });
      button.createDiv({
        cls: 'wp-publisher-remote-target-action',
        text: this.t('syncModal_selectTarget')
      });
      button.addEventListener('click', () => this.selectCandidate(candidate));
    });
  }

  private renderReady(): void {
    if (!this.syncResult) return;
    renderSyncStatePanel({
      parent: this.contentEl,
      result: this.syncResult,
      baseline: this.baseline,
      t: (key, vars) => this.t(key, vars),
      dateLabel: value => this.dateLabel(value)
    });
    this.renderCapabilities();
    if (this.failure) {
      this.contentEl.createDiv({
        cls: 'wp-publisher-sync-warning',
        text: this.failure.message
      });
    }
    this.renderActions();
  }

  private renderCapabilities(): void {
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-sync-capabilities'
    });
    section.createEl('h2', { text: this.t('syncModal_capabilitiesTitle') });
    section.createEl('p', { text: this.t('syncModal_capabilitiesDescription') });
    const grid = section.createDiv({ cls: 'wp-publisher-sync-capability-grid' });
    PULL_FIELD_ORDER.forEach(field => {
      const available = Boolean(this.remoteDocument?.fields[field]);
      const item = grid.createDiv({ cls: available ? 'is-available' : 'is-unavailable' });
      item.createSpan({ text: available ? '✓' : '–' });
      item.createEl('strong', { text: this.fieldLabel(field) });
      item.createEl('small', {
        text: this.t(available
          ? 'syncModal_capabilityAvailable'
          : 'syncModal_capabilityUnavailable')
      });
    });
  }

  private renderActions(): void {
    if (!this.syncResult) return;
    const actions = this.contentEl.createDiv({ cls: 'wp-publisher-pull-actions' });
    actions.createSpan({ text: this.actionDescription(this.syncResult.state) });
    const close = actions.createEl('button', {
      text: this.t('pullModal_close'),
      attr: { type: 'button' }
    });
    close.addEventListener('click', () => this.close());
    safeSyncActions(this.syncResult.state).forEach(action => {
      const button = actions.createEl('button', {
        cls: action === SyncWorkflowAction.Push
          || action === SyncWorkflowAction.Pull
          || action === SyncWorkflowAction.Merge
          ? 'mod-cta'
          : '',
        text: this.actionLabel(action),
        attr: { type: 'button' }
      });
      if (action === SyncWorkflowAction.Push) {
        button.disabled = Boolean(this.failure);
        button.addEventListener('click', () => void this.confirmPush());
      } else if (action === SyncWorkflowAction.Pull) {
        button.disabled = this.failure?.code === 'blocking-conversion';
        button.addEventListener('click', () => this.routeToPull());
      } else if (action === SyncWorkflowAction.Merge) {
        button.disabled = Boolean(this.failure);
        button.addEventListener('click', () => this.routeToMerge());
      } else if (action === SyncWorkflowAction.OpenWordPress) {
        button.addEventListener('click', () => this.openWordPress());
      } else {
        button.addEventListener('click', () => void this.refreshState());
      }
    });
  }

  private renderEmpty(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-empty' });
    state.createEl('h2', { text: this.t('syncModal_noTargetTitle') });
    state.createEl('p', { text: this.t('syncModal_noTargetDescription') });
    const close = state.createEl('button', {
      cls: 'mod-cta',
      text: this.t('pullModal_close'),
      attr: { type: 'button' }
    });
    close.addEventListener('click', () => this.close());
  }

  private renderError(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-error' });
    state.createEl('h2', { text: this.t('syncModal_errorTitle') });
    state.createEl('p', { text: this.failure?.message ?? '' });
    const retry = state.createEl('button', {
      cls: 'mod-cta',
      text: this.t('pullModal_retry'),
      attr: { type: 'button' }
    });
    retry.addEventListener('click', () => void this.refreshState());
  }

  private renderResult(): void {
    const state = this.contentEl.createDiv({
      cls: 'wp-publisher-pull-result ' + (this.phase === 'success' ? 'is-success' : 'is-warning')
    });
    state.createDiv({
      cls: 'wp-publisher-pull-result-mark',
      text: this.phase === 'success' ? '✓' : '!'
    });
    state.createEl('h2', {
      text: this.t(this.phase === 'success'
        ? 'syncModal_pushSuccessTitle'
        : 'syncModal_pushPartialTitle')
    });
    state.createEl('p', { text: this.resultMessage });
    const actions = state.createDiv({ cls: 'wp-publisher-pull-result-actions' });
    const close = actions.createEl('button', {
      text: this.t('pullModal_close'),
      attr: { type: 'button' }
    });
    close.addEventListener('click', () => this.close());
    const refresh = actions.createEl('button', {
      cls: 'mod-cta',
      text: this.t('syncModal_refresh'),
      attr: { type: 'button' }
    });
    refresh.addEventListener('click', () => void this.refreshState());
  }

  private async confirmPush(): Promise<void> {
    if (!this.selected || !this.syncResult
      || this.syncResult.state !== SyncState.LocalOnly
    ) return;
    const confirmation = await openConfirmModal({
      message: this.t('syncModal_pushConfirm', {
        profile: this.selected.profile.name,
        postId: this.selected.target.postId,
        count: String(this.syncResult.localChangedFields.length)
      }),
      confirmText: this.t('syncModal_pushConfirmButton')
    }, this.plugin);
    if (confirmation.code !== ConfirmCode.Confirm) return;
    await this.pushLocalChanges();
  }

  private async pushLocalChanges(): Promise<void> {
    if (!this.selected || !this.client || !this.snapshot || !this.conversion
      || !this.remoteDocument || !this.localDocument || !this.frozen
      || !this.syncResult || !this.baseline
    ) return;
    this.phase = 'pushing';
    this.render();
    try {
      const latest = await this.plugin.app.vault.read(this.sourceFile);
      if (await hashNoteRevision(latest) !== this.frozen.hash) {
        throw new Error(this.t('syncModal_localChanged'));
      }
      const latestMatter = this.readMatter(latest);
      if (!this.candidateStillLinked(latestMatter)) {
        throw new Error(this.t('syncModal_linkChanged'));
      }
      if (this.baselineKey(this.matchingBaseline()) !== this.baselineSignature) {
        throw new Error(this.t('syncModal_baselineChanged'));
      }

      const fetched = await this.client.fetchPost(this.selected.target);
      if (fetched.code !== WordPressClientReturnCode.OK) {
        throw new Error(fetched.error.message);
      }
      const freshConversion = convertWordPressToMarkdown(
        fetched.data.content,
        fetched.data.sourceFormat
      );
      if (freshConversion.diagnostics.some(
        item => item.kind === WordPressConversionKind.Blocking
      )) {
        throw new Error(this.t('syncModal_conversionBlocked'));
      }
      const freshRemote = this.remoteDocumentFor(fetched.data, freshConversion);
      const baselineFields = Object.keys(this.baseline.fields) as PullField[];
      const markerChanged = this.snapshot.modifiedAt !== fetched.data.modifiedAt
        && Boolean(this.snapshot.modifiedAt || fetched.data.modifiedAt);
      if (markerChanged
        || !syncDocumentsMatch(this.remoteDocument, freshRemote, baselineFields)
      ) {
        throw new Error(this.t('syncModal_remoteChanged'));
      }
      const freshState = classifySyncState({
        baseline: this.baseline,
        local: this.localDocument,
        remote: freshRemote,
        remoteModifiedAt: fetched.data.modifiedAt
      });
      if (freshState.state !== SyncState.LocalOnly) {
        throw new Error(this.t('syncModal_stateChanged'));
      }

      const postParams = buildCoordinatedPostParams({
        profile: this.selected.profile,
        globalDefaults: {
          status: this.plugin.settings.defaultPostStatus,
          commentStatus: this.plugin.settings.defaultCommentStatus
        },
        matter: this.matter,
        target: {
          profileId: this.selected.profile.id,
          profileName: this.selected.profile.name,
          endpoint: this.selected.profile.endpoint,
          postId: this.selected.target.postId,
          postType: this.selected.target.postType,
          updatedAt: this.selected.linkedAt
        },
        updateStrategy: PublishUpdateStrategy.Merge
      });
      postParams.updateFields = [ ...freshState.localChangedFields ];
      const editorial = readEditorialFrontMatter(this.matter);
      if (postParams.updateFields.includes(PullField.FeaturedMedia)
        && editorial.featuredImage
        && editorial.featuredImage === this.snapshot.featuredMedia?.url
        && this.snapshot.featuredMedia.id
      ) {
        postParams.featuredMediaId = Number(this.snapshot.featuredMedia.id);
      }
      const result = await this.client.publishPost(postParams, {
        sourceFile: this.sourceFile,
        sourceSnapshot: {
          title: this.sourceFile.basename,
          content: this.localBody(),
          matter: this.matter
        },
        target: {
          mode: 'update',
          postId: this.selected.target.postId,
          postType: this.selected.target.postType
        },
        writeBackToNote: true,
        replaceMediaLinks: false,
        showNotices: false,
        showEditConfirm: false,
        reuseSession: true,
        historyAction: PublishHistoryAction.FullUpdate
      });
      if (result.code !== WordPressClientReturnCode.OK) {
        throw new Error(result.error.message);
      }
      if (result.data.syncBaselineUpdated !== true) {
        this.phase = 'partial';
        this.resultMessage = this.t('syncModal_pushBaselineWarning');
      } else {
        this.phase = 'success';
        this.resultMessage = result.data.warnings?.length
          ? this.t('syncModal_pushWarnings', {
            count: String(result.data.warnings.length)
          })
          : this.t('syncModal_pushSuccess');
      }
      this.render();
    } catch (error) {
      this.phase = 'partial';
      this.resultMessage = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  private localBody(): string {
    const body = this.localDocument?.fields[PullField.Body]?.value;
    return typeof body === 'string' ? body : '';
  }

  private routeToPull(): void {
    const profileId = this.selected?.profile.id;
    this.close();
    openPullPreviewModal(this.plugin, { profileId });
  }

  private routeToMerge(): void {
    const profileId = this.selected?.profile.id;
    this.close();
    openSyncConflictModal(this.plugin, { profileId });
  }

  private openWordPress(): void {
    if (this.snapshot?.editUrl) {
      openWithBrowser(this.snapshot.editUrl);
      return;
    }
    if (!this.selected) return;
    openWithBrowser(this.selected.profile.endpoint + '/wp-admin/post.php', {
      action: 'edit',
      post: this.selected.target.postId
    });
  }

  private actionLabel(action: SyncWorkflowAction): string {
    switch (action) {
      case SyncWorkflowAction.Push:
        return this.t('syncModal_push');
      case SyncWorkflowAction.Pull:
        return this.t('syncModal_reviewPull');
      case SyncWorkflowAction.Merge:
        return this.t('syncModal_reviewMerge');
      case SyncWorkflowAction.OpenWordPress:
        return this.t('remoteInspector_openInWordPress');
      default:
        return this.t('syncModal_refresh');
    }
  }

  private actionDescription(state: SyncState): string {
    switch (state) {
      case SyncState.LocalOnly:
        return this.t('syncModal_actionLocalOnly');
      case SyncState.RemoteOnly:
        return this.t('syncModal_actionRemoteOnly');
      case SyncState.Diverged:
        return this.t('syncModal_actionDiverged');
      case SyncState.Unknown:
        return this.t('syncModal_actionUnknown');
      case SyncState.RemoteMissing:
        return this.t('syncModal_actionMissing');
      default:
        return this.t('syncModal_actionInSync');
    }
  }

  private fieldLabel(field: PullField): string {
    switch (field) {
      case PullField.Title: return this.t('pullModal_fieldTitle');
      case PullField.Body: return this.t('pullModal_bodyTitle');
      case PullField.Slug: return this.t('remoteInspector_slug');
      case PullField.Excerpt: return this.t('remoteInspector_excerpt');
      case PullField.Status: return this.t('remoteInspector_status');
      case PullField.CommentStatus: return this.t('remoteInspector_comments');
      case PullField.Categories: return this.t('remoteInspector_categories');
      case PullField.Tags: return this.t('remoteInspector_tags');
      case PullField.FeaturedMedia: return this.t('pullModal_fieldFeaturedMedia');
      case PullField.FocusKeyword: return this.t('pullModal_fieldFocusKeyword');
      case PullField.MetaDescription: return this.t('pullModal_fieldMetaDescription');
      default: return this.t('pullModal_fieldSecondaryTitle');
    }
  }

  private dateLabel(value: string | undefined): string {
    if (!value) return this.t('syncState_notEstablished');
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
