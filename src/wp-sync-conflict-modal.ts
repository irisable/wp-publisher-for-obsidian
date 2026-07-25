import {
  getFrontMatterInfo,
  Notice,
  parseYaml,
  stringifyYaml,
  TFile
} from 'obsidian';
import WordpressPlugin from './main';
import { AbstractModal } from './abstract-modal';
import { ConfirmCode, openConfirmModal } from './confirm-modal';
import { getWordPressClient } from './wp-clients';
import {
  WordPressClientReturnCode,
  type WordPressClient
} from './wp-client';
import type { MatterData } from './types';
import type { WpProfile } from './wp-profile';
import type {
  RemotePostSnapshot,
  RemotePostTarget
} from './remote-post';
import { RemotePostErrorCode } from './remote-post';
import { resolveStableProfileNoteTargets } from './profile-note-target';
import {
  convertWordPressToMarkdown,
  WordPressConversionKind,
  type WordPressToMarkdownResult
} from './wordpress-to-markdown';
import {
  composePulledNoteRevision,
  PullField,
  type PullFieldValue
} from './sync-diff';
import {
  addPullRestoreSnapshot,
  applyGuardedNoteRevision,
  createPullRestoreSnapshot,
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
  classifySyncState,
  createLocalSyncDocument,
  createRemoteSyncDocument,
  getSyncBaseline,
  hashSyncField,
  observeSyncBaseline,
  SyncState,
  type SyncBaseline,
  type SyncDocument,
  type SyncStateResult
} from './sync-baseline';
import { renderSyncStatePanel } from './sync-state-panel';
import {
  normalizeRemoteMediaUrl,
  rewriteMarkdownMediaSources,
  type MediaSourceReplacement
} from './sync-media';
import { restoreCachedRemoteMedia } from './sync-media-runtime';
import {
  applyResolvedMergeToMatter,
  createThreeWayMergePlan,
  MergeChoice,
  mergeConflictId,
  mergePlanFields,
  resolveThreeWayMergePlan,
  syncDocumentsMatch,
  ThreeWayFieldKind,
  type BodyMergeConflict,
  type MergeConflictResolution,
  type ThreeWayFieldPlan,
  type ThreeWayMergePlan
} from './three-way-merge';
import { renderWordPressPostContent } from './wordpress-blocks';
import { AppState } from './app-state';
import { buildCoordinatedPostParams } from './coordinated-publish';
import { PublishUpdateStrategy } from './publish-strategy';
import {
  addPublishHistoryEntry,
  createPublishHistoryEntry,
  PublishHistoryAction,
  PublishHistoryOutcome
} from './publish-history';
import { openWithBrowser, showError } from './utils';

type MergePhase =
  | 'resolving'
  | 'choose'
  | 'loading'
  | 'review'
  | 'blocked'
  | 'success'
  | 'partial'
  | 'undone'
  | 'empty'
  | 'error';

interface MergeCandidate {
  profile: WpProfile;
  target: RemotePostTarget;
  linkedAt: string;
}

interface MergeFailure {
  code: string;
  message: string;
}

interface BuiltMerge {
  raw: string;
  matter: MatterData;
  body: string;
  document: SyncDocument;
  fields: PullField[];
  outbound: string;
}

export interface SyncConflictOptions {
  profileId?: string;
}

export function openSyncConflictModal(
  plugin: WordpressPlugin,
  options: SyncConflictOptions = {}
): void {
  const file = plugin.app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    showError(plugin.i18n.t('error_noActiveFile'));
    return;
  }
  new WpSyncConflictModal(plugin, file, options).open();
}

class WpSyncConflictModal extends AbstractModal {
  private phase: MergePhase = 'resolving';
  private candidates: MergeCandidate[] = [];
  private selected: MergeCandidate | null = null;
  private client: WordPressClient | null = null;
  private frozen: FrozenNoteRevision | null = null;
  private matter: MatterData = {};
  private baseline: SyncBaseline | undefined;
  private baselineSignature = '';
  private snapshot: RemotePostSnapshot | null = null;
  private conversion: WordPressToMarkdownResult | null = null;
  private localDocument: SyncDocument | null = null;
  private remoteDocument: SyncDocument | null = null;
  private syncResult: SyncStateResult | null = null;
  private plan: ThreeWayMergePlan | null = null;
  private resolutions: Record<string, MergeConflictResolution> = {};
  private failure: MergeFailure | null = null;
  private reviewMessage = '';
  private applying = false;
  private stale = false;
  private requestVersion = 0;
  private closed = false;
  private mergedPreviewEl: HTMLTextAreaElement | null = null;
  private outboundPreviewEl: HTMLTextAreaElement | null = null;
  private previewMessageEl: HTMLElement | null = null;
  private applyButtonEl: HTMLButtonElement | null = null;
  private restoreSnapshot: PullRestoreSnapshot | null = null;
  private appliedMerge: BuiltMerge | null = null;
  private remoteCommitted = false;
  private resultMessage = '';
  private partialSyncState: SyncState | null = null;

  constructor(
    plugin: WordpressPlugin,
    private readonly sourceFile: TFile,
    private readonly options: SyncConflictOptions = {}
  ) {
    super(plugin);
  }

  onOpen(): void {
    this.modalEl.addClass('wp-publisher-remote-modal');
    this.modalEl.addClass('wp-publisher-pull-modal');
    this.modalEl.addClass('wp-publisher-merge-modal');
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
      const profiles = new Map(
        this.plugin.settings.profiles.map(profile => [ profile.id, profile ])
      );
      this.candidates = targets.flatMap(target => {
        const profile = profiles.get(target.profileId);
        return profile ? [ {
          profile,
          target: {
            postId: target.postId,
            postType: target.postType
          },
          linkedAt: target.updatedAt
        } ] : [];
      });
      if (this.closed) return;
      if (this.candidates.length === 0) {
        this.phase = 'empty';
        this.render();
      } else {
        const preferred = this.options.profileId
          ? this.candidates.find(candidate => candidate.profile.id === this.options.profileId)
          : undefined;
        if (preferred) {
          this.selectCandidate(preferred);
        } else if (this.candidates.length === 1) {
          this.selectCandidate(this.candidates[0]);
        } else {
          this.phase = 'choose';
          this.render();
        }
      }
    } catch (error) {
      this.finishWithError({
        code: RemotePostErrorCode.InvalidTarget,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private readMatter(raw: string): MatterData {
    const info = getFrontMatterInfo(raw);
    if (!info.exists || !info.frontmatter.trim()) return {};
    const parsed = parseYaml(info.frontmatter);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as MatterData
      : {};
  }

  private selectCandidate(candidate: MergeCandidate): void {
    this.selected = {
      profile: candidate.profile,
      target: Object.freeze({ ...candidate.target }),
      linkedAt: candidate.linkedAt
    };
    void this.prepareReview();
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

  private signatureForBaseline(baseline: SyncBaseline): string {
    return JSON.stringify({
      converterVersion: baseline.converterVersion,
      lastAgreedAt: baseline.lastAgreedAt,
      postId: baseline.postId,
      postType: baseline.postType,
      fields: baseline.fields
    });
  }

  private async prepareReview(): Promise<void> {
    if (!this.selected) return;
    const version = ++this.requestVersion;
    this.phase = 'loading';
    this.failure = null;
    this.reviewMessage = '';
    this.stale = false;
    this.applying = false;
    this.plan = null;
    this.resolutions = {};
    this.appliedMerge = null;
    this.restoreSnapshot = null;
    this.remoteCommitted = false;
    this.resultMessage = '';
    this.partialSyncState = null;
    this.render();
    try {
      const raw = await this.plugin.app.vault.read(this.sourceFile);
      const matter = this.readMatter(raw);
      if (!this.candidateStillLinked(matter)) {
        this.finishWithError({
          code: RemotePostErrorCode.InvalidTarget,
          message: this.t('mergeModal_linkChanged')
        });
        return;
      }
      this.frozen = await freezeNoteRevision(raw);
      this.matter = matter;
      this.baseline = this.matchingBaseline();
      if (!this.baseline) {
        this.phase = 'blocked';
        this.reviewMessage = this.t('mergeModal_noBaseline');
        this.render();
        return;
      }
      this.baselineSignature = this.signatureForBaseline(this.baseline);
      this.client = getWordPressClient(this.plugin, this.selected.profile);
      if (!this.client) {
        throw new Error(this.t('remoteInspector_clientUnavailable'));
      }
      const fetched = await this.client.fetchPost(this.selected.target);
      if (this.closed || version !== this.requestVersion) return;
      if (fetched.code !== WordPressClientReturnCode.OK) {
        this.finishWithError({
          code: String(fetched.error.code),
          message: fetched.error.message
        });
        return;
      }
      const conversion = convertWordPressToMarkdown(
        fetched.data.content,
        fetched.data.sourceFormat
      );
      if (conversion.diagnostics.some(
        diagnostic => diagnostic.kind === WordPressConversionKind.Blocking
      )) {
        this.snapshot = fetched.data;
        this.conversion = conversion;
        this.phase = 'blocked';
        this.reviewMessage = this.t('mergeModal_conversionBlocked');
        this.render();
        return;
      }
      const mediaPlan = await restoreCachedRemoteMedia({
        app: this.plugin.app,
        notePath: this.sourceFile.path,
        cache: this.selected.profile.mediaCache,
        markdown: conversion.markdown,
        featuredMedia: fetched.data.featuredMedia
      });
      if (this.closed || version !== this.requestVersion) return;
      const mergeConversion = { ...conversion, markdown: mediaPlan.markdown };
      this.snapshot = fetched.data;
      this.conversion = mergeConversion;
      this.localDocument = createLocalSyncDocument({
        noteRaw: raw,
        matter,
        fallbackTitle: this.sourceFile.basename
      });
      this.remoteDocument = this.createRemoteDocument(fetched.data, conversion);
      this.syncResult = classifySyncState({
        baseline: this.baseline,
        local: this.localDocument,
        remote: this.remoteDocument,
        remoteModifiedAt: fetched.data.modifiedAt
      });
      if (this.syncResult.state !== SyncState.Diverged
        && this.syncResult.state !== SyncState.LocalOnly
      ) {
        this.phase = 'blocked';
        this.reviewMessage = this.t('mergeModal_stateNotMergeable');
        this.render();
        return;
      }
      this.plan = createThreeWayMergePlan({
        baseline: this.baselineWithMediaPaths(
          this.baseline,
          mediaPlan.replacements
        ),
        local: this.localDocument,
        remote: this.createRemoteDocument(
          fetched.data,
          mergeConversion,
          mediaPlan.featuredImage
        )
      });
      this.phase = 'review';
      this.render();
    } catch (error) {
      this.finishWithError({
        code: 'merge_review_failed',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private baselineWithMediaPaths(
    baseline: SyncBaseline,
    replacements: readonly MediaSourceReplacement[]
  ): SyncBaseline {
    const fields = { ...baseline.fields };
    const body = fields[PullField.Body];
    if (body && typeof body.remote.value === 'string') {
      fields[PullField.Body] = {
        ...body,
        remote: {
          ...body.remote,
          value: rewriteMarkdownMediaSources(body.remote.value, replacements)
        }
      };
    }
    const featured = fields[PullField.FeaturedMedia];
    if (featured && typeof featured.remote.value === 'string') {
      const replacement = replacements.find(item => (
        normalizeRemoteMediaUrl(item.sourceUrl)
          === normalizeRemoteMediaUrl(String(featured.remote.value))
      ));
      if (replacement) {
        fields[PullField.FeaturedMedia] = {
          ...featured,
          remote: { ...featured.remote, value: replacement.vaultPath }
        };
      }
    }
    return { ...baseline, fields };
  }

  private createRemoteDocument(
    snapshot: RemotePostSnapshot,
    conversion: WordPressToMarkdownResult,
    featuredImage?: string
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
        featuredMedia: snapshot.featuredMedia
          ? { ...snapshot.featuredMedia, url: featuredImage ?? snapshot.featuredMedia.url }
          : undefined,
        focusKeyword: snapshot.focusKeyword,
        metaDescription: snapshot.metaDescription,
        secondaryTitle: snapshot.secondaryTitle,
        capabilities: snapshot.capabilities
      }
    });
  }

  private finishWithError(failure: MergeFailure): void {
    this.failure = failure;
    this.phase = 'error';
    this.applying = false;
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.mergedPreviewEl = null;
    this.outboundPreviewEl = null;
    this.previewMessageEl = null;
    this.applyButtonEl = null;
    this.createHeader(this.t('mergeModal_title'));
    this.renderHero();
    switch (this.phase) {
      case 'resolving':
      case 'loading':
        this.renderLoading();
        break;
      case 'choose':
        this.renderCandidates();
        break;
      case 'review':
        this.renderReview();
        break;
      case 'blocked':
        this.renderBlocked();
        break;
      case 'success':
      case 'partial':
      case 'undone':
        this.renderResult();
        break;
      case 'empty':
        this.renderEmpty();
        break;
      default:
        this.renderError();
    }
  }

  private renderHero(): void {
    const hero = this.contentEl.createDiv({ cls: 'wp-publisher-merge-hero' });
    const copy = hero.createDiv();
    copy.createDiv({
      cls: 'wp-publisher-merge-eyebrow',
      text: this.t('mergeModal_eyebrow')
    });
    copy.createEl('p', { text: this.t('mergeModal_description') });
    hero.createSpan({
      cls: 'wp-publisher-merge-review-badge',
      text: this.t('mergeModal_reviewFirst')
    });
  }

  private renderLoading(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state is-loading' });
    state.createDiv({ cls: 'wp-publisher-remote-spinner' });
    state.createEl('h2', {
      text: this.t(this.phase === 'resolving'
        ? 'mergeModal_resolvingTitle'
        : 'mergeModal_loadingTitle')
    });
    state.createEl('p', {
      text: this.t(this.phase === 'resolving'
        ? 'mergeModal_resolvingDescription'
        : 'mergeModal_loadingDescription')
    });
  }

  private renderCandidates(): void {
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section'
    });
    section.createEl('h2', { text: this.t('mergeModal_chooseTitle') });
    section.createEl('p', { text: this.t('mergeModal_chooseDescription') });
    const list = section.createDiv({ cls: 'wp-publisher-remote-target-grid' });
    this.candidates.forEach(candidate => {
      const card = list.createEl('button', {
        cls: 'wp-publisher-remote-target-card',
        attr: { type: 'button' }
      });
      const identity = card.createDiv({
        cls: 'wp-publisher-remote-target-identity'
      });
      identity.createEl('strong', { text: candidate.profile.name });
      identity.createSpan({ text: this.siteLabel(candidate.profile.endpoint) });
      const post = card.createDiv({ cls: 'wp-publisher-remote-target-post' });
      post.createSpan({ text: candidate.target.postType });
      post.createEl('strong', { text: '#' + candidate.target.postId });
      card.createDiv({
        cls: 'wp-publisher-remote-target-action',
        text: this.t('mergeModal_selectTarget')
      });
      card.addEventListener('click', () => this.selectCandidate(candidate));
    });
  }

  private renderEmpty(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state is-empty' });
    state.createDiv({ cls: 'wp-publisher-remote-empty-mark', text: 'WP' });
    state.createEl('h2', { text: this.t('mergeModal_noLinkedTitle') });
    state.createEl('p', { text: this.t('mergeModal_noLinkedDescription') });
  }

  private renderError(): void {
    const failure = this.failure ?? {
      code: 'merge_error',
      message: this.t('remoteInspector_errorNetwork')
    };
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state is-error' });
    state.createDiv({ cls: 'wp-publisher-remote-error-code', text: failure.code });
    state.createEl('h2', { text: this.t('mergeModal_errorTitle') });
    state.createEl('p', { text: failure.message });
    if (this.selected) {
      const retry = state.createEl('button', {
        cls: 'mod-cta',
        text: this.t('mergeModal_reloadReview')
      });
      retry.addEventListener('click', () => void this.prepareReview());
    }
  }

  private renderBlocked(): void {
    if (this.syncResult) {
      renderSyncStatePanel({
        parent: this.contentEl,
        result: this.syncResult,
        baseline: this.baseline,
        t: (key, vars) => this.t(key, vars),
        dateLabel: value => this.dateLabel(value)
      });
    }
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-merge-blocked' });
    state.createDiv({ cls: 'wp-publisher-merge-blocked-mark', text: '!' });
    const copy = state.createDiv();
    copy.createEl('h2', { text: this.t('mergeModal_blockedTitle') });
    copy.createEl('p', { text: this.reviewMessage });
    const actions = state.createDiv({ cls: 'wp-publisher-merge-result-actions' });
    if (this.selected) {
      const reload = actions.createEl('button', {
        cls: 'mod-cta',
        text: this.t('mergeModal_reloadReview')
      });
      reload.addEventListener('click', () => void this.prepareReview());
      this.renderWordPressEditButton(actions);
    }
  }

  private renderReview(): void {
    if (!this.plan || !this.syncResult) return;
    renderSyncStatePanel({
      parent: this.contentEl,
      result: this.syncResult,
      baseline: this.baseline,
      t: (key, vars) => this.t(key, vars),
      dateLabel: value => this.dateLabel(value)
    });
    if (this.reviewMessage) {
      this.contentEl.createDiv({
        cls: 'wp-publisher-merge-review-warning',
        text: this.reviewMessage
      });
    }
    this.renderMergeSummary();
    this.renderMetadataPlans();
    this.renderBodyPlan();
    this.renderCompletePreview();
    this.renderReviewActions();
    this.updatePreview();
  }

  private renderMergeSummary(): void {
    if (!this.plan) return;
    const automaticKinds = new Set<ThreeWayFieldKind>([
      ThreeWayFieldKind.LocalOnly,
      ThreeWayFieldKind.RemoteOnly,
      ThreeWayFieldKind.BothSame,
      ThreeWayFieldKind.AutoMerged
    ]);
    const automatic = this.plan.fields.filter(
      field => automaticKinds.has(field.kind)
    ).length;
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-merge-summary'
    });
    const copy = section.createDiv();
    copy.createDiv({
      cls: 'wp-publisher-merge-kicker',
      text: this.t('mergeModal_snapshotReady')
    });
    copy.createEl('h2', {
      text: this.snapshot?.title || this.sourceFile.basename
    });
    const facts = section.createDiv({ cls: 'wp-publisher-merge-summary-facts' });
    this.createSummaryFact(facts, String(automatic), this.t('mergeModal_autoDecisions'));
    this.createSummaryFact(
      facts,
      String(this.plan.conflictCount),
      this.t('mergeModal_trueConflicts')
    );
    this.createSummaryFact(
      facts,
      String(this.plan.excludedFields.length),
      this.t('mergeModal_excludedFields')
    );
  }

  private createSummaryFact(parent: HTMLElement, value: string, label: string): void {
    const fact = parent.createDiv();
    fact.createEl('strong', { text: value });
    fact.createSpan({ text: label });
  }

  private renderMetadataPlans(): void {
    if (!this.plan) return;
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-merge-section'
    });
    section.createEl('h2', { text: this.t('mergeModal_metadataTitle') });
    section.createEl('p', {
      cls: 'wp-publisher-remote-section-copy',
      text: this.t('mergeModal_metadataDescription')
    });
    const list = section.createDiv({ cls: 'wp-publisher-merge-fields' });
    this.plan.fields
      .filter(field => field.field !== PullField.Body)
      .forEach(field => this.renderMetadataPlan(list, field));
  }

  private renderMetadataPlan(parent: HTMLElement, plan: ThreeWayFieldPlan): void {
    const card = parent.createEl('article', {
      cls: 'wp-publisher-merge-field is-' + plan.kind
    });
    const heading = card.createDiv({ cls: 'wp-publisher-merge-field-heading' });
    heading.createEl('h3', { text: this.fieldLabel(plan.field) });
    heading.createSpan({ text: this.kindLabel(plan.kind) });
    if (plan.kind === ThreeWayFieldKind.Excluded) {
      card.createEl('p', { text: this.t('mergeModal_fieldExcluded') });
      return;
    }
    const values = card.createDiv({ cls: 'wp-publisher-merge-values' });
    this.renderMergeValue(values, this.t('mergeModal_baseValue'), plan.baseLocal?.value ?? '');
    this.renderMergeValue(values, this.t('pullModal_localValue'), plan.local?.value ?? '');
    this.renderMergeValue(values, this.t('pullModal_wordPressValue'), plan.remote?.value ?? '');
    if (plan.kind === ThreeWayFieldKind.Conflict) {
      this.renderResolutionControls(
        card,
        mergeConflictId(plan.field),
        plan.local?.value ?? '',
        plan.remote?.value ?? '',
        plan.field
      );
    } else if (plan.merged) {
      const outcome = card.createDiv({ cls: 'wp-publisher-merge-auto-result' });
      outcome.createSpan({ text: this.t('mergeModal_resultValue') });
      outcome.createEl('code', {
        text: this.displayValue(plan.merged.value) || this.t('pullModal_emptyValue')
      });
    }
  }

  private renderMergeValue(
    parent: HTMLElement,
    label: string,
    value: PullFieldValue
  ): void {
    const item = parent.createDiv();
    item.createSpan({ text: label });
    item.createEl('code', {
      text: this.displayValue(value) || this.t('pullModal_emptyValue')
    });
  }

  private renderBodyPlan(): void {
    const field = this.plan?.fields.find(plan => plan.field === PullField.Body);
    if (!field || field.kind === ThreeWayFieldKind.Excluded) return;
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-merge-section wp-publisher-merge-body'
    });
    section.createEl('h2', { text: this.t('mergeModal_bodyTitle') });
    section.createEl('p', {
      cls: 'wp-publisher-remote-section-copy',
      text: this.t('mergeModal_bodyDescription')
    });
    if (!field.body || field.body.conflictCount === 0) {
      const automatic = section.createDiv({ cls: 'wp-publisher-merge-body-auto' });
      automatic.createEl('strong', { text: this.t('mergeModal_bodyAutoTitle') });
      automatic.createSpan({
        text: this.t('mergeModal_bodyAutoDescription', {
          count: String(field.body?.autoMergedChangeCount ?? 0)
        })
      });
      return;
    }
    field.body.parts.forEach(part => {
      if (part.kind === 'conflict') {
        this.renderBodyConflict(section, part.conflict);
      }
    });
  }

  private renderBodyConflict(parent: HTMLElement, conflict: BodyMergeConflict): void {
    const card = parent.createEl('article', {
      cls: 'wp-publisher-merge-hunk'
        + (conflict.containsProtectedSource ? ' has-protected-source' : '')
    });
    const heading = card.createDiv({ cls: 'wp-publisher-merge-hunk-heading' });
    heading.createEl('h3', {
      text: this.t('mergeModal_hunkTitle', {
        number: conflict.id.replace('body-', '')
      })
    });
    heading.createSpan({
      text: conflict.containsProtectedSource
        ? this.t('mergeModal_protectedUnit')
        : this.t('mergeModal_overlappingLines')
    });
    if (conflict.reason !== 'overlap') {
      card.createEl('p', {
        cls: 'wp-publisher-merge-hunk-reason',
        text: this.t(conflict.reason === 'different-baselines'
          ? 'mergeModal_differentBodyBases'
          : 'mergeModal_bodyTooLarge')
      });
    }
    const columns = card.createDiv({ cls: 'wp-publisher-merge-hunk-values' });
    this.renderBodyValue(columns, this.t('pullModal_localValue'), conflict.local);
    this.renderBodyValue(columns, this.t('pullModal_wordPressValue'), conflict.remote);
    this.renderResolutionControls(
      card,
      conflict.id,
      conflict.local,
      conflict.remote,
      PullField.Body
    );
  }

  private renderBodyValue(parent: HTMLElement, label: string, value: string): void {
    const item = parent.createDiv();
    item.createSpan({ text: label });
    item.createEl('pre').createEl('code', {
      text: value || this.t('pullModal_emptyValue')
    });
  }

  private renderResolutionControls(
    parent: HTMLElement,
    id: string,
    local: PullFieldValue,
    remote: PullFieldValue,
    field: PullField
  ): void {
    const current = this.resolutions[id];
    const controls = parent.createDiv({ cls: 'wp-publisher-merge-resolution' });
    const choices = controls.createDiv({ cls: 'wp-publisher-merge-choices' });
    [
      { choice: MergeChoice.Local, label: this.t('mergeModal_keepObsidian') },
      { choice: MergeChoice.Remote, label: this.t('mergeModal_useWordPress') },
      { choice: MergeChoice.Edited, label: this.t('mergeModal_useEdited') }
    ].forEach(item => {
      const button = choices.createEl('button', {
        cls: current?.choice === item.choice ? 'is-selected' : '',
        text: item.label,
        attr: { type: 'button' }
      });
      button.disabled = this.applying;
      button.addEventListener('click', () => {
        const initial = item.choice === MergeChoice.Edited
          ? current?.editedValue ?? this.cloneFieldValue(local)
          : undefined;
        this.resolutions[id] = {
          choice: item.choice,
          ...(initial !== undefined ? { editedValue: initial } : {})
        };
        this.render();
      });
    });
    if (current?.choice !== MergeChoice.Edited) return;
    const label = controls.createEl('label', {
      cls: 'wp-publisher-merge-edited-label'
    });
    label.createSpan({ text: this.t('mergeModal_editedResult') });
    const textarea = label.createEl('textarea', {
      attr: {
        rows: field === PullField.Body ? '8' : '3',
        spellcheck: field === PullField.Body ? 'true' : 'false'
      }
    });
    textarea.value = this.displayEditableValue(current.editedValue ?? local);
    textarea.disabled = this.applying;
    textarea.addEventListener('input', () => {
      this.resolutions[id] = {
        choice: MergeChoice.Edited,
        editedValue: this.editedFieldValue(field, textarea.value)
      };
      this.updatePreview();
    });
    if (Array.isArray(local) || Array.isArray(remote)) {
      label.createEl('small', { text: this.t('mergeModal_listEditHint') });
    }
  }

  private renderCompletePreview(): void {
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-merge-section wp-publisher-merge-preview'
    });
    section.createEl('h2', { text: this.t('mergeModal_previewTitle') });
    section.createEl('p', {
      cls: 'wp-publisher-remote-section-copy',
      text: this.t('mergeModal_previewDescription')
    });
    this.previewMessageEl = section.createDiv({ cls: 'wp-publisher-merge-preview-message' });
    const tabs = section.createDiv({ cls: 'wp-publisher-merge-preview-grid' });
    const markdown = tabs.createEl('label');
    markdown.createSpan({ text: this.t('mergeModal_markdownPreview') });
    this.mergedPreviewEl = markdown.createEl('textarea', {
      attr: { readonly: 'readonly', rows: '14', spellcheck: 'false' }
    });
    const outbound = tabs.createEl('label');
    outbound.createSpan({ text: this.t('mergeModal_wordPressPreview') });
    this.outboundPreviewEl = outbound.createEl('textarea', {
      attr: { readonly: 'readonly', rows: '14', spellcheck: 'false' }
    });
  }

  private renderReviewActions(): void {
    const actions = this.contentEl.createDiv({ cls: 'wp-publisher-pull-actions' });
    const hint = actions.createSpan({
      text: this.stale
        ? this.t('mergeModal_actionStale')
        : this.t('mergeModal_actionUnresolved')
    });
    hint.addClass('wp-publisher-merge-action-hint');
    const reload = actions.createEl('button', {
      text: this.t('mergeModal_reloadReview'),
      attr: { type: 'button' }
    });
    reload.disabled = this.applying;
    reload.addEventListener('click', () => void this.prepareReview());
    const cancel = actions.createEl('button', {
      text: this.t('pullModal_cancel'),
      attr: { type: 'button' }
    });
    cancel.disabled = this.applying;
    cancel.addEventListener('click', () => this.close());
    this.applyButtonEl = actions.createEl('button', {
      cls: 'mod-cta wp-publisher-pull-apply',
      text: this.t(this.applying ? 'mergeModal_applying' : 'mergeModal_apply'),
      attr: { type: 'button' }
    });
    this.applyButtonEl.addEventListener('click', () => void this.confirmAndApply());
  }

  private buildMerge(): { built?: BuiltMerge, unresolved: string[], error?: string } {
    if (!this.plan || !this.frozen || !this.localDocument) {
      return { unresolved: [], error: this.t('mergeModal_previewUnavailable') };
    }
    try {
      const resolved = resolveThreeWayMergePlan(this.plan, this.resolutions);
      if (resolved.unresolvedConflictIds.length > 0) {
        return { unresolved: resolved.unresolvedConflictIds };
      }
      const bodySnapshot = resolved.document.fields[PullField.Body]
        ?? this.localDocument.fields[PullField.Body];
      if (!bodySnapshot || typeof bodySnapshot.value !== 'string') {
        return { unresolved: [], error: this.t('mergeModal_previewUnavailable') };
      }
      const appliedMatter = applyResolvedMergeToMatter(
        this.matter,
        this.plan,
        resolved.document
      );
      const localBody = this.localDocument.fields[PullField.Body];
      const bodyChanged = Boolean(localBody
        && hashSyncField(PullField.Body, localBody)
          !== hashSyncField(PullField.Body, bodySnapshot));
      const raw = composePulledNoteRevision({
        raw: this.frozen.content,
        ...(appliedMatter.changedFields.length > 0
          ? { serializedMatter: stringifyYaml(appliedMatter.matter) }
          : {}),
        ...(bodyChanged ? { pulledBody: bodySnapshot.value } : {})
      });
      const outbound = renderWordPressPostContent(
        bodySnapshot.value,
        AppState.markdownParser,
        this.plugin.settings.contentFormat
      );
      return {
        unresolved: [],
        built: {
          raw,
          matter: appliedMatter.matter,
          body: bodySnapshot.value,
          document: resolved.document,
          fields: mergePlanFields(this.plan),
          outbound
        }
      };
    } catch (error) {
      return {
        unresolved: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private updatePreview(): void {
    const result = this.buildMerge();
    const unresolved = result.unresolved.length;
    if (this.mergedPreviewEl) {
      this.mergedPreviewEl.value = result.built?.raw ?? '';
    }
    if (this.outboundPreviewEl) {
      this.outboundPreviewEl.value = result.built?.outbound ?? '';
    }
    if (this.previewMessageEl) {
      this.previewMessageEl.setText(result.error
        ? this.t('mergeModal_previewError', { message: result.error })
        : unresolved > 0
          ? this.t('mergeModal_previewUnresolved', { count: String(unresolved) })
          : this.t('mergeModal_previewReady'));
      this.previewMessageEl.classList.toggle('is-ready', Boolean(result.built));
      this.previewMessageEl.classList.toggle('is-error', Boolean(result.error));
    }
    if (this.applyButtonEl) {
      this.applyButtonEl.disabled = this.applying || this.stale || !result.built;
      this.applyButtonEl.classList.toggle('is-loading', this.applying);
    }
    const hint = this.contentEl.querySelector('.wp-publisher-merge-action-hint');
    if (hint) {
      hint.setText(this.stale
        ? this.t('mergeModal_actionStale')
        : result.error
          ? this.t('mergeModal_actionInvalid')
          : unresolved > 0
            ? this.t('mergeModal_actionUnresolved')
            : this.t('mergeModal_actionReady', {
              fields: String(result.built?.fields.length ?? 0)
            }));
    }
  }

  private async confirmAndApply(): Promise<void> {
    if (this.applying || this.stale) return;
    const result = this.buildMerge();
    if (!result.built) {
      this.updatePreview();
      return;
    }
    const confirmation = await openConfirmModal({
      message: this.t('mergeModal_confirm', {
        profile: this.selected?.profile.name ?? '',
        postId: this.selected?.target.postId ?? ''
      }),
      confirmText: this.t('mergeModal_confirmButton')
    }, this.plugin);
    if (confirmation.code !== ConfirmCode.Confirm) return;
    await this.applyMerge(result.built);
  }

  private async applyMerge(built: BuiltMerge): Promise<void> {
    if (!this.selected || !this.client || !this.frozen || !this.snapshot
      || !this.remoteDocument || !this.baseline || !this.conversion || !this.plan
      || this.applying
    ) return;
    this.applying = true;
    this.reviewMessage = '';
    this.render();
    let staged: PullRestoreSnapshot | null = null;
    let committed = false;
    let publishStarted = false;
    try {
      const latest = await this.plugin.app.vault.read(this.sourceFile);
      if (await hashNoteRevision(latest) !== this.frozen.hash) {
        throw new PullTransactionError(
          PullTransactionErrorCode.StaleLocalRevision,
          this.t('mergeModal_localChanged')
        );
      }
      const latestMatter = this.readMatter(latest);
      if (!this.candidateStillLinked(latestMatter)) {
        throw new Error(this.t('mergeModal_linkChanged'));
      }
      const currentBaseline = this.matchingBaseline();
      if (!currentBaseline
        || this.signatureForBaseline(currentBaseline) !== this.baselineSignature
      ) {
        throw new Error(this.t('mergeModal_baselineChanged'));
      }

      const fresh = await this.client.fetchPost(this.selected.target);
      if (fresh.code !== WordPressClientReturnCode.OK) {
        throw new Error(fresh.error.message);
      }
      const freshConversion = convertWordPressToMarkdown(
        fresh.data.content,
        fresh.data.sourceFormat
      );
      if (freshConversion.diagnostics.some(
        diagnostic => diagnostic.kind === WordPressConversionKind.Blocking
      )) {
        throw new Error(this.t('mergeModal_conversionBlocked'));
      }
      const freshRemote = this.createRemoteDocument(fresh.data, freshConversion);
      const freshMediaPlan = await restoreCachedRemoteMedia({
        app: this.plugin.app,
        notePath: this.sourceFile.path,
        cache: this.selected.profile.mediaCache,
        markdown: freshConversion.markdown,
        featuredMedia: fresh.data.featuredMedia
      });
      const reviewsBody = this.plan.fields.some(field => (
        field.field === PullField.Body
          && field.kind !== ThreeWayFieldKind.Excluded
      ));
      const reviewsFeaturedMedia = this.plan.fields.some(field => (
        field.field === PullField.FeaturedMedia
          && field.kind !== ThreeWayFieldKind.Excluded
      ));
      if ((reviewsBody && freshMediaPlan.markdown !== this.conversion.markdown)
        || (reviewsFeaturedMedia
          && (freshMediaPlan.featuredImage ?? '') !== (this.planFeaturedImage() ?? ''))
      ) {
        throw new Error(this.t('mergeModal_remoteChanged'));
      }
      const markerChanged = this.snapshot.modifiedAt !== fresh.data.modifiedAt
        && Boolean(this.snapshot.modifiedAt || fresh.data.modifiedAt);
      if (markerChanged
        || !syncDocumentsMatch(this.remoteDocument, freshRemote, built.fields)
      ) {
        throw new Error(this.t('mergeModal_remoteChanged'));
      }

      staged = await createPullRestoreSnapshot({
        notePath: this.sourceFile.path,
        profileId: this.selected.profile.id,
        profileName: this.selected.profile.name,
        endpoint: this.selected.profile.endpoint,
        postId: this.selected.target.postId,
        postType: this.selected.target.postType,
        beforeContent: this.frozen.content,
        appliedContent: built.raw
      });
      const previousSnapshots = this.plugin.settings.pullRestoreSnapshots;
      try {
        this.plugin.settings.pullRestoreSnapshots = addPullRestoreSnapshot(
          previousSnapshots,
          staged
        );
        await this.plugin.saveSettings();
      } catch (error) {
        this.plugin.settings.pullRestoreSnapshots = previousSnapshots;
        throw error;
      }

      await applyGuardedNoteRevision(
        this.plugin.app.vault,
        this.sourceFile,
        this.frozen,
        built.raw
      );
      committed = true;
      this.restoreSnapshot = staged;
      this.appliedMerge = built;
      this.frozen = await freezeNoteRevision(built.raw);
      publishStarted = true;
      const publishResult = await this.publishBuiltMerge(built);
      await this.finishPublishResult(publishResult, built);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!committed && staged) {
        this.plugin.settings.pullRestoreSnapshots = removePullRestoreSnapshot(
          this.plugin.settings.pullRestoreSnapshots,
          staged.id
        );
        try {
          await this.plugin.saveSettings();
        } catch (saveError) {
          console.error('Could not remove a staged merge restore snapshot.', saveError);
        }
      }
      if (!publishStarted) {
        await this.recordMergeHistory(PublishHistoryOutcome.Failure, message, built.fields.length);
      }
      this.applying = false;
      if (!committed) {
        this.stale = true;
        this.reviewMessage = message;
        this.phase = 'review';
      } else {
        this.phase = 'partial';
        this.resultMessage = this.t('mergeModal_partialDescription', { message });
      }
      this.render();
    }
  }

  private planFeaturedImage(): string | undefined {
    const field = this.plan?.fields.find(item => item.field === PullField.FeaturedMedia);
    const value = field?.remote?.value;
    return typeof value === 'string' ? value : undefined;
  }

  private async publishBuiltMerge(
    built: BuiltMerge
  ): Promise<ReturnType<WordPressClient['publishPost']> extends Promise<infer T> ? T : never> {
    if (!this.selected || !this.client) {
      throw new Error(this.t('mergeModal_previewUnavailable'));
    }
    const postParams = buildCoordinatedPostParams({
      profile: this.selected.profile,
      globalDefaults: {
        status: this.plugin.settings.defaultPostStatus,
        commentStatus: this.plugin.settings.defaultCommentStatus
      },
      matter: built.matter,
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
    postParams.updateFields = [ ...built.fields ];
    return this.client.publishPost(postParams, {
      sourceFile: this.sourceFile,
      sourceSnapshot: {
        title: this.sourceFile.basename,
        content: built.body,
        matter: built.matter
      },
      target: {
        mode: 'update',
        postId: this.selected.target.postId,
        postType: this.selected.target.postType
      },
      writeBackToNote: false,
      replaceMediaLinks: false,
      showNotices: false,
      showEditConfirm: false,
      reuseSession: true,
      historyAction: PublishHistoryAction.Merge
    });
  }

  private async finishPublishResult(
    result: Awaited<ReturnType<WordPressClient['publishPost']>>,
    built: BuiltMerge
  ): Promise<void> {
    this.applying = false;
    if (result.code !== WordPressClientReturnCode.OK) {
      this.remoteCommitted = false;
      this.phase = 'partial';
      this.resultMessage = this.t('mergeModal_partialDescription', {
        message: result.error.message
      });
      await this.observePartialFailure(built);
      this.render();
      return;
    }
    this.remoteCommitted = true;
    const warnings = result.data.warnings ?? [];
    if (result.data.syncBaselineUpdated !== true) {
      this.phase = 'partial';
      this.resultMessage = this.t('mergeModal_baselineRefreshFailed');
    } else {
      this.phase = 'success';
      this.resultMessage = warnings.length > 0
        ? this.t('mergeModal_successWarnings', { count: String(warnings.length) })
        : this.t('mergeModal_successDescription');
    }
    this.baseline = this.matchingBaseline();
    this.render();
  }

  private async observePartialFailure(built: BuiltMerge): Promise<void> {
    if (!this.selected || !this.client) return;
    try {
      const fetched = await this.client.fetchPost(this.selected.target);
      if (fetched.code !== WordPressClientReturnCode.OK) return;
      const conversion = convertWordPressToMarkdown(
        fetched.data.content,
        fetched.data.sourceFormat
      );
      if (conversion.diagnostics.some(
        diagnostic => diagnostic.kind === WordPressConversionKind.Blocking
      )) return;
      const baseline = this.matchingBaseline();
      if (!baseline) return;
      const state = classifySyncState({
        baseline,
        local: createLocalSyncDocument({
          noteRaw: built.raw,
          body: built.body,
          matter: built.matter,
          fallbackTitle: this.sourceFile.basename
        }),
        remote: this.createRemoteDocument(fetched.data, conversion),
        remoteModifiedAt: fetched.data.modifiedAt
      });
      this.partialSyncState = state.state;
      this.plugin.settings.syncBaselineCache = observeSyncBaseline(
        this.plugin.settings.syncBaselineCache,
        this.sourceFile.path,
        this.selected.profile.id,
        state.state
      );
      await this.plugin.saveSettings();
    } catch (error) {
      console.error('Could not classify the partial merge result.', error);
    }
  }

  private async retryRemotePush(): Promise<void> {
    if (!this.appliedMerge || !this.frozen || !this.client || !this.selected
      || !this.snapshot || !this.remoteDocument || this.applying
    ) return;
    this.applying = true;
    this.render();
    try {
      const raw = await this.plugin.app.vault.read(this.sourceFile);
      if (await hashNoteRevision(raw) !== this.frozen.hash) {
        throw new Error(this.t('mergeModal_retryLocalChanged'));
      }
      const fresh = await this.client.fetchPost(this.selected.target);
      if (fresh.code !== WordPressClientReturnCode.OK) {
        throw new Error(fresh.error.message);
      }
      const conversion = convertWordPressToMarkdown(
        fresh.data.content,
        fresh.data.sourceFormat
      );
      const freshRemote = this.createRemoteDocument(fresh.data, conversion);
      const markerChanged = this.snapshot.modifiedAt !== fresh.data.modifiedAt
        && Boolean(this.snapshot.modifiedAt || fresh.data.modifiedAt);
      if (markerChanged
        || !syncDocumentsMatch(
          this.remoteDocument,
          freshRemote,
          this.appliedMerge.fields
        )
      ) {
        throw new Error(this.t('mergeModal_retryRemoteChanged'));
      }
      const result = await this.publishBuiltMerge(this.appliedMerge);
      await this.finishPublishResult(result, this.appliedMerge);
    } catch (error) {
      this.applying = false;
      this.phase = 'partial';
      this.resultMessage = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  private async undoLocalMerge(): Promise<void> {
    if (!this.restoreSnapshot || this.applying || !this.selected) return;
    this.applying = true;
    this.render();
    try {
      await undoGuardedPull(
        this.plugin.app.vault,
        this.sourceFile,
        this.restoreSnapshot
      );
      this.plugin.settings.pullRestoreSnapshots = removePullRestoreSnapshot(
        this.plugin.settings.pullRestoreSnapshots,
        this.restoreSnapshot.id
      );
      const observed = this.remoteCommitted ? SyncState.LocalOnly : SyncState.InSync;
      this.plugin.settings.syncBaselineCache = observeSyncBaseline(
        this.plugin.settings.syncBaselineCache,
        this.sourceFile.path,
        this.selected.profile.id,
        observed
      );
      await this.plugin.saveSettings();
      this.phase = 'undone';
      this.resultMessage = this.remoteCommitted
        ? this.t('mergeModal_undoRemoteKept')
        : this.t('mergeModal_undoDescription');
      this.restoreSnapshot = null;
      this.applying = false;
      this.render();
    } catch (error) {
      this.applying = false;
      new Notice(this.t('mergeModal_undoFailed', {
        message: error instanceof Error ? error.message : String(error)
      }));
      this.render();
    }
  }

  private renderResult(): void {
    const success = this.phase === 'success';
    const undone = this.phase === 'undone';
    const state = this.contentEl.createDiv({
      cls: 'wp-publisher-merge-result '
        + (success ? 'is-success' : undone ? 'is-undone' : 'is-partial')
    });
    state.createDiv({
      cls: 'wp-publisher-merge-result-mark',
      text: success ? '✓' : undone ? '↶' : '!'
    });
    state.createEl('h2', {
      text: this.t(success
        ? 'mergeModal_successTitle'
        : undone
          ? 'mergeModal_undoneTitle'
          : 'mergeModal_partialTitle')
    });
    state.createEl('p', { text: this.resultMessage });
    if (this.phase === 'partial' && this.partialSyncState) {
      state.createDiv({
        cls: 'wp-publisher-merge-partial-state',
        text: this.t('mergeModal_partialState', {
          state: this.t(this.partialSyncState === SyncState.LocalOnly
            ? 'syncState_localOnly'
            : this.partialSyncState === SyncState.Diverged
              ? 'syncState_diverged'
              : this.partialSyncState === SyncState.InSync
                ? 'syncState_inSync'
                : 'syncState_unknown')
        })
      });
    }
    const actions = state.createDiv({ cls: 'wp-publisher-merge-result-actions' });
    if (this.phase === 'partial' && !this.remoteCommitted && this.appliedMerge) {
      const retry = actions.createEl('button', {
        cls: 'mod-cta' + (this.applying ? ' is-loading' : ''),
        text: this.t(this.applying ? 'mergeModal_retrying' : 'mergeModal_retryPush')
      });
      retry.disabled = this.applying;
      retry.addEventListener('click', () => void this.retryRemotePush());
    }
    if (!undone && this.restoreSnapshot) {
      const undo = actions.createEl('button', {
        text: this.t('mergeModal_undoLocal')
      });
      undo.disabled = this.applying;
      undo.addEventListener('click', () => void this.undoLocalMerge());
    }
    if (!undone && this.phase === 'partial') {
      const reload = actions.createEl('button', {
        text: this.t('mergeModal_reloadReview')
      });
      reload.disabled = this.applying;
      reload.addEventListener('click', () => void this.prepareReview());
    }
    this.renderWordPressEditButton(actions);
    const close = actions.createEl('button', {
      text: this.t('pullModal_close')
    });
    close.disabled = this.applying;
    close.addEventListener('click', () => this.close());
  }

  private renderWordPressEditButton(parent: HTMLElement): void {
    if (!this.selected) return;
    const button = parent.createEl('button', {
      text: this.t('remoteInspector_openInWordPress')
    });
    button.addEventListener('click', () => {
      openWithBrowser(
        this.selected!.profile.endpoint.replace(/\/+$/, '') + '/wp-admin/post.php',
        { action: 'edit', post: this.selected!.target.postId }
      );
    });
  }

  private async recordMergeHistory(
    outcome: typeof PublishHistoryOutcome[keyof typeof PublishHistoryOutcome],
    message: string | undefined,
    selectedFieldCount: number
  ): Promise<void> {
    if (!this.selected) return;
    try {
      const entry = createPublishHistoryEntry({
        outcome,
        action: PublishHistoryAction.Merge,
        notePath: this.sourceFile.path,
        noteTitle: this.sourceFile.basename,
        profileName: this.selected.profile.name,
        profileId: this.selected.profile.id,
        endpoint: this.selected.profile.endpoint,
        postType: this.selected.target.postType,
        postId: this.selected.target.postId,
        selectedFieldCount,
        ...(message ? { message } : {})
      });
      this.plugin.settings.publishHistory = addPublishHistoryEntry(
        this.plugin.settings.publishHistory,
        entry
      );
      await this.plugin.saveSettings();
    } catch (error) {
      console.error('Could not save WordPress merge history.', error);
    }
  }

  private cloneFieldValue(value: PullFieldValue): PullFieldValue {
    return Array.isArray(value) ? [ ...value ] : value;
  }

  private editedFieldValue(field: PullField, value: string): PullFieldValue {
    return field === PullField.Categories || field === PullField.Tags
      ? [ ...new Set(value.split(/[,，\n]/u).map(item => item.trim()).filter(Boolean)) ]
      : value;
  }

  private displayEditableValue(value: PullFieldValue): string {
    return Array.isArray(value) ? value.join('\n') : value;
  }

  private displayValue(value: PullFieldValue): string {
    return Array.isArray(value) ? value.join(', ') : value;
  }

  private fieldLabel(field: PullField): string {
    switch (field) {
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

  private kindLabel(kind: ThreeWayFieldKind): string {
    switch (kind) {
      case ThreeWayFieldKind.LocalOnly:
        return this.t('mergeModal_kindLocal');
      case ThreeWayFieldKind.RemoteOnly:
        return this.t('mergeModal_kindRemote');
      case ThreeWayFieldKind.BothSame:
        return this.t('mergeModal_kindBothSame');
      case ThreeWayFieldKind.AutoMerged:
        return this.t('mergeModal_kindAuto');
      case ThreeWayFieldKind.Conflict:
        return this.t('mergeModal_kindConflict');
      case ThreeWayFieldKind.Excluded:
        return this.t('mergeModal_kindExcluded');
      default:
        return this.t('mergeModal_kindUnchanged');
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
