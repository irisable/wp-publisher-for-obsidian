import { getFrontMatterInfo, parseYaml, TFile } from 'obsidian';
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
  type RemotePostFieldCapabilities,
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
import { openWithBrowser, showError } from './utils';
import {
  classifySyncState,
  createLocalSyncDocument,
  createRemoteSyncDocument,
  getSyncBaseline,
  observeSyncBaseline,
  SyncState,
  type SyncBaseline,
  type SyncStateResult
} from './sync-baseline';
import { renderSyncStatePanel } from './sync-state-panel';

type InspectorPhase = 'resolving' | 'choose' | 'loading' | 'ready' | 'empty' | 'error';

interface InspectorCandidate {
  profile: WpProfile;
  target: RemotePostTarget;
  linkedAt: string;
}

interface InspectorFailure {
  code: string;
  message: string;
}

const CAPABILITY_KEYS: Array<keyof RemotePostFieldCapabilities> = [
  'slug',
  'excerpt',
  'status',
  'commentStatus',
  'publishedAt',
  'modifiedAt',
  'categories',
  'tags',
  'featuredMedia',
  'focusKeyword',
  'metaDescription',
  'secondaryTitle'
];

export function openRemoteInspectorModal(plugin: WordpressPlugin): void {
  const file = plugin.app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    showError(plugin.i18n.t('error_noActiveFile'));
    return;
  }
  new WpRemoteInspectorModal(plugin, file).open();
}

class WpRemoteInspectorModal extends AbstractModal {
  private phase: InspectorPhase = 'resolving';
  private candidates: InspectorCandidate[] = [];
  private selected: InspectorCandidate | null = null;
  private snapshot: RemotePostSnapshot | null = null;
  private conversion: WordPressToMarkdownResult | null = null;
  private localRaw = '';
  private localMatter: MatterData = {};
  private syncBaseline: SyncBaseline | undefined;
  private syncResult: SyncStateResult | null = null;
  private failure: InspectorFailure | null = null;
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
      if (this.candidates.length === 1) {
        this.selectCandidate(this.candidates[0]);
        return;
      }
      this.phase = 'choose';
      this.render();
    } catch (error) {
      if (this.closed) {
        return;
      }
      this.failure = {
        code: RemotePostErrorCode.InvalidTarget,
        message: error instanceof Error ? error.message : String(error)
      };
      this.phase = 'error';
      this.render();
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

  private selectCandidate(candidate: InspectorCandidate): void {
    this.selected = {
      profile: candidate.profile,
      target: Object.freeze({ ...candidate.target }),
      linkedAt: candidate.linkedAt
    };
    this.syncBaseline = undefined;
    this.syncResult = null;
    void this.fetchSnapshot();
  }

  private async fetchSnapshot(): Promise<void> {
    if (!this.selected) {
      return;
    }
    const version = ++this.requestVersion;
    const frozenTarget = { ...this.selected.target };
    const profile = this.selected.profile;
    this.phase = 'loading';
    this.failure = null;
    this.snapshot = null;
    this.conversion = null;
    this.syncBaseline = undefined;
    this.syncResult = null;
    this.render();

    try {
      this.localRaw = await this.plugin.app.vault.read(this.sourceFile);
      this.localMatter = this.readMatter(this.localRaw);
    } catch (error) {
      this.finishWithError(version, {
        code: RemotePostErrorCode.InvalidTarget,
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    let client: WordPressClient | null;
    try {
      client = getWordPressClient(this.plugin, profile);
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
    if (result.code === WordPressClientReturnCode.OK) {
      this.snapshot = result.data;
      try {
        this.conversion = convertWordPressToMarkdown(
          result.data.content,
          result.data.sourceFormat
        );
      } catch {
        this.conversion = null;
      }
      this.calculateReadySyncState();
      this.phase = 'ready';
      this.render();
      void this.persistSyncObservation();
      return;
    }
    this.finishWithError(version, {
      code: String(result.error.code),
      message: result.error.message
    });
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
    if (!this.snapshot || !this.conversion) {
      this.syncResult = classifySyncState({ baseline: this.syncBaseline });
      return;
    }
    const local = createLocalSyncDocument({
      noteRaw: this.localRaw,
      matter: this.localMatter,
      fallbackTitle: this.sourceFile.basename
    });
    const remote = createRemoteSyncDocument({
      remote: {
        title: this.snapshot.title,
        body: this.conversion.markdown,
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
    this.syncResult = classifySyncState({
      baseline: this.syncBaseline,
      local,
      remote,
      remoteModifiedAt: this.snapshot.modifiedAt
    });
  }

  private async persistSyncObservation(): Promise<void> {
    if (!this.selected || !this.syncBaseline || !this.syncResult) {
      return;
    }
    const previous = this.plugin.settings.syncBaselineCache;
    const next = observeSyncBaseline(
      previous,
      this.sourceFile.path,
      this.selected.profile.id,
      this.syncResult.state
    );
    this.plugin.settings.syncBaselineCache = next;
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      if (this.plugin.settings.syncBaselineCache === next) {
        this.plugin.settings.syncBaselineCache = previous;
      }
      console.error('Could not save the latest WordPress sync observation.', error);
    }
  }

  private finishWithError(version: number, failure: InspectorFailure): void {
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
    if (this.syncResult.state === SyncState.RemoteMissing) {
      void this.persistSyncObservation();
    }
  }

  private render(): void {
    this.contentEl.empty();
    this.createHeader(this.t('remoteInspector_title'));
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
        if (this.snapshot) {
          this.renderSnapshot(this.snapshot);
        }
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
    const hero = this.contentEl.createDiv({ cls: 'wp-publisher-remote-hero' });
    const copy = hero.createDiv();
    copy.createDiv({
      cls: 'wp-publisher-remote-eyebrow',
      text: this.t('remoteInspector_eyebrow')
    });
    copy.createEl('p', { text: this.t('remoteInspector_description') });
    hero.createDiv({
      cls: 'wp-publisher-remote-seal',
      text: this.t('remoteInspector_readOnly')
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
    section.createEl('h2', { text: this.t('remoteInspector_chooseTitle') });
    section.createEl('p', {
      cls: 'wp-publisher-remote-section-copy',
      text: this.t('remoteInspector_chooseDescription')
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
        text: this.t('remoteInspector_selectTarget')
      });
      card.addEventListener('click', () => this.selectCandidate(candidate));
    });
  }

  private renderTargetContext(): void {
    if (!this.selected) {
      return;
    }
    const context = this.contentEl.createDiv({ cls: 'wp-publisher-remote-context' });
    const profile = context.createDiv();
    profile.createSpan({ text: this.t('remoteInspector_profile') });
    profile.createEl('strong', { text: this.selected.profile.name });
    const site = context.createDiv();
    site.createSpan({ text: this.t('remoteInspector_site') });
    site.createEl('strong', { text: this.siteLabel(this.selected.profile.endpoint) });
    const post = context.createDiv();
    post.createSpan({ text: this.t('remoteInspector_targetPost') });
    post.createEl('strong', {
      text: this.selected.target.postType + ' #' + this.selected.target.postId
    });
    if (this.candidates.length > 1 && this.phase !== 'loading') {
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
      text: this.t(resolving
        ? 'remoteInspector_resolvingTitle'
        : 'remoteInspector_loadingTitle')
    });
    state.createEl('p', {
      text: this.t(resolving
        ? 'remoteInspector_resolvingDescription'
        : 'remoteInspector_loadingDescription')
    });
  }

  private renderEmpty(): void {
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state is-empty' });
    state.createDiv({ cls: 'wp-publisher-remote-empty-mark', text: 'WP' });
    state.createEl('h2', { text: this.t('remoteInspector_noLinkedTitle') });
    state.createEl('p', { text: this.t('remoteInspector_noLinkedDescription') });
  }

  private renderError(): void {
    const failure = this.failure ?? {
      code: RemotePostErrorCode.Network,
      message: this.t('remoteInspector_errorNetwork')
    };
    const state = this.contentEl.createDiv({ cls: 'wp-publisher-remote-state is-error' });
    state.createDiv({ cls: 'wp-publisher-remote-error-code', text: failure.code });
    state.createEl('h2', { text: this.t('remoteInspector_errorTitle') });
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
        text: this.t('remoteInspector_retry'),
        attr: { type: 'button' }
      });
      retry.addEventListener('click', () => void this.fetchSnapshot());
    }
  }

  private renderSnapshot(snapshot: RemotePostSnapshot): void {
    const lead = this.contentEl.createEl('article', {
      cls: 'wp-publisher-remote-lead'
    });
    const heading = lead.createDiv({ cls: 'wp-publisher-remote-lead-heading' });
    const title = heading.createDiv();
    title.createDiv({
      cls: 'wp-publisher-remote-kicker',
      text: snapshot.postType + ' #' + snapshot.postId
    });
    title.createEl('h2', {
      text: snapshot.title || this.t('remoteInspector_emptyValue')
    });
    const badges = heading.createDiv({ cls: 'wp-publisher-remote-badges' });
    if (snapshot.status) {
      badges.createSpan({ text: snapshot.status });
    }
    badges.createSpan({
      cls: 'is-format',
      text: this.sourceFormatLabel(snapshot.sourceFormat)
    });

    const facts = lead.createDiv({ cls: 'wp-publisher-remote-facts' });
    this.createFact(facts, this.t('remoteInspector_modified'), this.dateLabel(snapshot.modifiedAt));
    this.createFact(facts, this.t('remoteInspector_published'), this.dateLabel(snapshot.publishedAt));
    this.createFact(facts, this.t('remoteInspector_fetched'), this.dateLabel(snapshot.fetchedAt));

    const metadata = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section'
    });
    metadata.createEl('h2', { text: this.t('remoteInspector_metadataTitle') });
    const metadataGrid = metadata.createDiv({ cls: 'wp-publisher-remote-metadata' });
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_slug'),
      snapshot.slug,
      snapshot.capabilities.slug
    );
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_excerpt'),
      snapshot.excerpt,
      snapshot.capabilities.excerpt
    );
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_comments'),
      snapshot.commentStatus,
      snapshot.capabilities.commentStatus
    );
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_categories'),
      this.termLabel(snapshot, 'category', snapshot.categoryIds),
      snapshot.capabilities.categories
    );
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_tags'),
      this.termLabel(snapshot, 'post_tag', snapshot.tagIds),
      snapshot.capabilities.tags
    );
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_featuredMedia'),
      this.featuredMediaLabel(snapshot),
      snapshot.capabilities.featuredMedia
    );
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_focusKeyword'),
      snapshot.focusKeyword,
      snapshot.capabilities.focusKeyword
    );
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_metaDescription'),
      snapshot.metaDescription,
      snapshot.capabilities.metaDescription
    );
    this.createMetadata(
      metadataGrid,
      this.t('remoteInspector_secondaryTitle'),
      snapshot.secondaryTitle,
      snapshot.capabilities.secondaryTitle
    );

    this.renderCapabilities(snapshot.capabilities);

    if (this.conversion) {
      this.renderConversion(this.conversion);
    } else {
      try {
        this.renderConversion(convertWordPressToMarkdown(
          snapshot.content,
          snapshot.sourceFormat
        ));
      } catch (error) {
        this.renderConversionFailure(error);
      }
    }

    const source = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-remote-source'
    });
    const sourceHeading = source.createDiv({ cls: 'wp-publisher-remote-source-heading' });
    const sourceCopy = sourceHeading.createDiv({ cls: 'wp-publisher-remote-source-copy' });
    sourceCopy.createEl('h2', { text: this.t('remoteInspector_sourceTitle') });
    sourceCopy.createEl('p', { text: this.t('remoteInspector_sourceDescription') });
    sourceHeading.createSpan({ text: this.sourceFormatLabel(snapshot.sourceFormat) });
    const pre = source.createEl('pre');
    pre.createEl('code', {
      text: snapshot.content || this.t('remoteInspector_emptySource')
    });

    const actions = this.contentEl.createDiv({ cls: 'wp-publisher-remote-actions' });
    const refresh = actions.createEl('button', {
      text: this.t('remoteInspector_refresh'),
      attr: { type: 'button' }
    });
    refresh.addEventListener('click', () => void this.fetchSnapshot());
    const open = actions.createEl('button', {
      cls: 'mod-cta',
      text: this.t('remoteInspector_openInWordPress'),
      attr: { type: 'button' }
    });
    open.addEventListener('click', () => {
      openWithBrowser(
        snapshot.endpoint.replace(/\/+$/, '') + '/wp-admin/post.php',
        { action: 'edit', post: snapshot.postId }
      );
    });
  }

  private renderConversion(result: WordPressToMarkdownResult): void {
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-remote-conversion'
    });
    const heading = section.createDiv({
      cls: 'wp-publisher-remote-conversion-heading'
    });
    const copy = heading.createDiv();
    copy.createEl('h2', { text: this.t('remoteInspector_conversionTitle') });
    copy.createEl('p', {
      text: this.t('remoteInspector_conversionDescription')
    });
    const identity = heading.createDiv({
      cls: 'wp-publisher-remote-conversion-identity'
    });
    identity.createSpan({
      cls: 'wp-publisher-remote-conversion-version',
      text: this.t('remoteInspector_conversionVersion', {
        version: result.converterVersion
      })
    });
    identity.createSpan({
      cls: 'wp-publisher-remote-conversion-fidelity is-' + result.fidelity,
      text: this.conversionKindLabel(result.fidelity),
      attr: { title: this.t('remoteInspector_conversionFidelity') }
    });

    const kinds = [
      WordPressConversionKind.Exact,
      WordPressConversionKind.Normalized,
      WordPressConversionKind.PreservedRaw,
      WordPressConversionKind.Blocking
    ];
    const summary = section.createDiv({
      cls: 'wp-publisher-remote-conversion-summary'
    });
    kinds.forEach(kind => {
      const count = result.diagnostics.filter(item => item.kind === kind).length;
      const item = summary.createDiv({
        cls: 'wp-publisher-remote-conversion-stat is-' + kind
          + (count === 0 ? ' is-empty' : '')
      });
      item.createEl('strong', { text: String(count) });
      item.createSpan({ text: this.conversionKindLabel(kind) });
    });

    const preview = section.createDiv({
      cls: 'wp-publisher-remote-conversion-preview'
    });
    preview.createEl('h3', {
      text: this.t('remoteInspector_conversionMarkdownTitle')
    });
    const pre = preview.createEl('pre');
    pre.createEl('code', {
      text: result.markdown || this.t('remoteInspector_conversionMarkdownEmpty')
    });

    const audit = section.createDiv({
      cls: 'wp-publisher-remote-conversion-audit'
    });
    audit.createEl('h3', {
      text: this.t('remoteInspector_conversionDiagnosticsTitle', {
        count: String(result.diagnostics.length)
      })
    });
    if (result.diagnostics.length === 0) {
      audit.createEl('p', {
        cls: 'wp-publisher-remote-conversion-empty',
        text: this.t('remoteInspector_conversionNoDiagnostics')
      });
      return;
    }
    const list = audit.createDiv({
      cls: 'wp-publisher-remote-conversion-diagnostics'
    });
    result.diagnostics.forEach(diagnostic => {
      const item = list.createDiv({
        cls: 'wp-publisher-remote-conversion-diagnostic is-' + diagnostic.kind
      });
      const itemHeading = item.createDiv({
        cls: 'wp-publisher-remote-conversion-diagnostic-heading'
      });
      const target = itemHeading.createDiv();
      target.createEl('strong', {
        text: diagnostic.blockName
          ?? this.t('remoteInspector_conversionDocument')
      });
      target.createEl('code', {
        text: this.conversionLocation(diagnostic)
      });
      itemHeading.createSpan({
        text: this.conversionKindLabel(diagnostic.kind)
      });
      item.createEl('p', { text: diagnostic.message });
      item.createEl('code', {
        cls: 'wp-publisher-remote-conversion-code',
        text: diagnostic.code
      });
    });
  }

  private renderConversionFailure(error: unknown): void {
    const section = this.contentEl.createEl('section', {
      cls: 'wp-publisher-remote-section wp-publisher-remote-conversion-failure'
    });
    section.createEl('h2', {
      text: this.t('remoteInspector_conversionFailureTitle')
    });
    section.createEl('p', {
      text: this.t('remoteInspector_conversionFailureDescription')
    });
    section.createEl('code', {
      text: error instanceof Error ? error.message : String(error)
    });
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
    return `L${start.line}:C${start.column} - L${end.line}:C${end.column}`;
  }

  private renderCapabilities(capabilities: RemotePostFieldCapabilities): void {
    const unsupported = CAPABILITY_KEYS.filter(key => !capabilities[key]);
    const panel = this.contentEl.createDiv({
      cls: 'wp-publisher-remote-capabilities'
        + (unsupported.length > 0 ? ' has-warning' : ' is-complete')
    });
    const copy = panel.createDiv();
    copy.createEl('strong', { text: this.t('remoteInspector_capabilityTitle') });
    copy.createSpan({
      text: this.t(unsupported.length > 0
        ? 'remoteInspector_capabilityWarning'
        : 'remoteInspector_capabilityComplete')
    });
    if (unsupported.length > 0) {
      const list = panel.createDiv({ cls: 'wp-publisher-remote-capability-list' });
      unsupported.forEach(key => {
        list.createSpan({ text: this.capabilityLabel(key) });
      });
    }
  }

  private createFact(parent: HTMLElement, label: string, value: string): void {
    const fact = parent.createDiv();
    fact.createSpan({ text: label });
    fact.createEl('strong', { text: value });
  }

  private createMetadata(
    parent: HTMLElement,
    label: string,
    value: string | undefined,
    supported: boolean
  ): void {
    const item = parent.createEl('dl', {
      cls: 'wp-publisher-remote-meta'
        + (!supported ? ' is-unsupported' : value === undefined ? ' is-empty' : '')
    });
    item.createEl('dt', { text: label });
    item.createEl('dd', {
      text: !supported
        ? this.t('remoteInspector_unavailable')
        : value === undefined || value === ''
          ? this.t('remoteInspector_emptyValue')
          : value
    });
  }

  private termLabel(
    snapshot: RemotePostSnapshot,
    taxonomy: string,
    ids: string[]
  ): string | undefined {
    const terms = snapshot.terms.filter(term => term.taxonomy === taxonomy);
    const labels = terms.map(term => term.name ?? term.slug ?? '#' + term.id);
    const knownIds = new Set(terms.map(term => term.id));
    ids.filter(id => !knownIds.has(id)).forEach(id => labels.push('#' + id));
    return labels.length > 0 ? [ ...new Set(labels) ].join(', ') : undefined;
  }

  private featuredMediaLabel(snapshot: RemotePostSnapshot): string | undefined {
    const media = snapshot.featuredMedia;
    if (!media) {
      return undefined;
    }
    const values = [
      media.title,
      media.altText,
      media.id ? '#' + media.id : undefined,
      media.url
    ].filter((value): value is string => Boolean(value));
    return values.length > 0 ? values.join(' · ') : undefined;
  }

  private capabilityLabel(key: keyof RemotePostFieldCapabilities): string {
    const labels: Record<keyof RemotePostFieldCapabilities, string> = {
      slug: this.t('remoteInspector_slug'),
      excerpt: this.t('remoteInspector_excerpt'),
      status: this.t('remoteInspector_status'),
      commentStatus: this.t('remoteInspector_comments'),
      publishedAt: this.t('remoteInspector_published'),
      modifiedAt: this.t('remoteInspector_modified'),
      categories: this.t('remoteInspector_categories'),
      tags: this.t('remoteInspector_tags'),
      featuredMedia: this.t('remoteInspector_featuredMedia'),
      focusKeyword: this.t('remoteInspector_focusKeyword'),
      metaDescription: this.t('remoteInspector_metaDescription'),
      secondaryTitle: this.t('remoteInspector_secondaryTitle')
    };
    return labels[key];
  }

  private sourceFormatLabel(sourceFormat: string): string {
    if (sourceFormat === 'block-editor') {
      return this.t('remoteInspector_sourceBlockEditor');
    }
    if (sourceFormat === 'empty') {
      return this.t('remoteInspector_sourceEmpty');
    }
    return this.t('remoteInspector_sourceClassicHtml');
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
