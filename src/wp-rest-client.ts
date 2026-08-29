import {
  WordPressAuthParams,
  WordPressClientResult,
  WordPressClientReturnCode,
  WordPressMediaUploadResult,
  WordPressPostParams,
  WordPressPublishResult
} from './wp-client';
import { AbstractWordPressClient } from './abstract-wp-client';
import WordpressPlugin from './main';
import { PostStatus, PostType, Term } from './wp-api';
import { RestClient, type RestResponse } from './rest-client';
import { isFunction, isString, template } from 'lodash-es';
import { WpProfile } from './wp-profile';
import { FormItemNameMapper, FormItems, Media } from './types';
import { formatISO } from 'date-fns';
import {
  buildRankMathSeoMetadata,
  buildRestEditorialMetadata,
  buildSecondaryTitleMetadata,
  buildWpComEditorialMetadata,
  EditorialMetadataCapabilities
} from './editorial-metadata';
import {
  buildRestMediaMetadata,
  buildWpComMediaMetadata,
  type MediaMetadata
} from './media-metadata';
import { buildRestPublishPayload, isContentOnlyUpdate } from './publish-strategy';
import {
  buildCoreRestPostPath,
  parseCoreRestPostTypeRoute,
  parseCoreRestRemotePost,
  parseWpComRemotePost,
  RemotePostError,
  RemotePostErrorCode,
  withRemotePostCapabilities,
  withRemotePostSecondaryTitle,
  withRemotePostSeriesPlacement,
  withRemotePostSeoMetadata,
  type RemotePostDocument,
  type RemotePostTarget
} from './remote-post';
import { isUnknownRecord, requireUnknownRecord } from './unknown-value';
import {
  describeSeriesIntentForUi,
  nonEmptyRemoteSeriesMetadataFields,
  parseSeriesDefinition,
  portableSeriesFromRemote,
  resolveSeriesPlacement,
  seriesPlacementsEqual,
  WPTL_SEASON_KEY_META,
  WPTL_SEQUENCE_LABEL_META,
  WPTL_SERIES_ROLE_META,
  WPTL_SERIES_SCOPE_META,
  WPTL_SERIES_TAXONOMY,
  WPTL_SUBTITLE_META,
  type SeriesPublishingCatalog
} from './series';
import { PullField } from './sync-diff';


interface WpRestEndpoint {
  base: string | UrlGetter;
  newPost: string | UrlGetter;
  editPost: string | UrlGetter;
  getPost: string | UrlGetter;
  getPostType: string | UrlGetter;
  getCategories: string | UrlGetter;
  newTag: string | UrlGetter;
  getTag: string | UrlGetter;
  validateUser: string | UrlGetter;
  uploadFile: string | UrlGetter;
  editMedia: string | UrlGetter;
  getPostTypes: string | UrlGetter;
}

interface CorePostTypeCapabilities {
  route: { namespace: string, restBase: string };
  taxonomies: string[];
  wptlSubtitle: boolean;
  wptlSeriesMeta: boolean;
}

export class WpRestClient extends AbstractWordPressClient {

  private readonly client: RestClient;
  private supportsCompanionSeo = false;
  private supportsCompanionSecondaryTitle = false;
  private readonly corePostTypeCapabilities = new Map<
    string,
    CorePostTypeCapabilities
  >();

  constructor(
    readonly plugin: WordpressPlugin,
    readonly profile: WpProfile,
    private readonly context: WpRestClientContext
  ) {
    super(plugin, profile);
    this.name = 'WpRestClient';
    this.client = new RestClient({
      url: new URL(getUrl(this.context.endpoints?.base, profile.endpoint))
    });
  }

  protected getEditorialMetadataCapabilities(
    postType?: PostType
  ): EditorialMetadataCapabilities {
    const canonicalSubtitle = postType
      ? this.corePostTypeCapabilities.get(postType)?.wptlSubtitle === true
      : [ ...this.corePostTypeCapabilities.values() ]
        .some(item => item.wptlSubtitle);
    return {
      focusKeyword: this.context.editorialMetadataCapabilities.focusKeyword
        || this.supportsCompanionSeo,
      metaDescription: this.context.editorialMetadataCapabilities.metaDescription
        || this.supportsCompanionSeo,
      secondaryTitle: canonicalSubtitle
        || this.context.editorialMetadataCapabilities.secondaryTitle
        || this.supportsCompanionSecondaryTitle
    };
  }

  protected needLogin(): boolean {
    if (this.context.needLoginModal !== undefined) {
      return this.context.needLoginModal;
    }
    return  super.needLogin();
  }

  private async inspectCorePostType(
    postType: PostType,
    headers: Record<string, string>
  ): Promise<CorePostTypeCapabilities> {
    const cached = this.corePostTypeCapabilities.get(postType);
    if (cached) return cached;
    if (this.context.remotePostApi !== 'core-rest') {
      throw new Error('WP Title Layer integration requires WordPress core REST.');
    }
    const typeResponse = await this.client.httpGetResponse(
      getUrl(
        this.context.endpoints?.getPostType,
        'wp-json/wp/v2/types/<%= postType %>',
        { postType }
      ),
      { headers }
    );
    const typeData = this.remoteResponseData(
      typeResponse,
      RemotePostErrorCode.UnsupportedType
    );
    const route = parseCoreRestPostTypeRoute(typeData, postType);
    const schemaResponse = await this.client.httpOptionsResponse(
      'wp-json/' + route.namespace + '/' + route.restBase,
      { headers }
    );
    const schemaData = this.remoteResponseData(
      schemaResponse,
      RemotePostErrorCode.UnsupportedType
    );
    const metaProperties = restMetaSchemaProperties(schemaData);
    const taxonomies = postTypeTaxonomies(typeData);
    const capability: CorePostTypeCapabilities = {
      route,
      taxonomies,
      wptlSubtitle: Object.prototype.hasOwnProperty.call(
        metaProperties,
        WPTL_SUBTITLE_META
      ),
      wptlSeriesMeta: [
        WPTL_SEASON_KEY_META,
        WPTL_SERIES_ROLE_META,
        WPTL_SERIES_SCOPE_META,
        WPTL_SEQUENCE_LABEL_META
      ].every(key => Object.prototype.hasOwnProperty.call(metaProperties, key))
    };
    this.corePostTypeCapabilities.set(postType, capability);
    return capability;
  }

  protected async getSeriesPublishingCatalog(
    certificate: WordPressAuthParams,
    postTypes: readonly PostType[]
  ): Promise<SeriesPublishingCatalog> {
    if (this.context.remotePostApi !== 'core-rest') {
      return {
        transport: 'unsupported',
        definitions: [],
        supportedPostTypes: [],
        subtitlePostTypes: []
      };
    }
    const headers = this.context.getHeaders(certificate);
    const inspected = await Promise.allSettled(
      postTypes.map(async postType => ({
        postType,
        capability: await this.inspectCorePostType(postType, headers)
      }))
    );
    const available = inspected.flatMap(result => (
      result.status === 'fulfilled' ? [ result.value ] : []
    ));
    const supportedPostTypes = available
      .filter(item => item.capability.wptlSeriesMeta
        && item.capability.taxonomies.includes(WPTL_SERIES_TAXONOMY))
      .map(item => item.postType);
    const subtitlePostTypes = available
      .filter(item => item.capability.wptlSubtitle)
      .map(item => item.postType);
    if (supportedPostTypes.length === 0) {
      return {
        transport: 'rest',
        definitions: [],
        supportedPostTypes,
        subtitlePostTypes
      };
    }
    try {
      const definitions = [];
      for (let page = 1; page <= 1000; page += 1) {
        const response = await this.client.httpGetResponse(
          'wp-json/wp/v2/' + WPTL_SERIES_TAXONOMY
            + '?per_page=100&context=edit&page=' + page,
          { headers }
        );
        if (response.status < 200 || response.status >= 300) {
          const code = isUnknownRecord(response.json) && typeof response.json.code === 'string'
            ? response.json.code
            : '';
          if (page > 1 && code === 'rest_post_invalid_page_number') break;
        }
        const data = this.remoteResponseData(
          response,
          RemotePostErrorCode.UnsupportedType
        );
        if (!Array.isArray(data)) {
          throw new Error('WordPress returned an invalid Series catalog.');
        }
        definitions.push(...data.map(parseSeriesDefinition));
        const totalPages = Number(restResponseHeader(response, 'x-wp-totalpages'));
        if ((Number.isSafeInteger(totalPages) && page >= totalPages)
          || (!Number.isSafeInteger(totalPages) && data.length < 100)
        ) {
          break;
        }
      }
      return {
        transport: 'rest',
        definitions,
        supportedPostTypes,
        subtitlePostTypes
      };
    } catch (error) {
      return {
        transport: 'rest',
        definitions: [],
        supportedPostTypes,
        subtitlePostTypes,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  protected async prepareTransportMetadata(
    postParams: WordPressPostParams,
    certificate: WordPressAuthParams
  ): Promise<void> {
    delete postParams.resolvedSeriesPlacement;
    delete postParams.secondaryTitleOwner;
    if (isContentOnlyUpdate(postParams)) return;
    const reviewed = new Set(postParams.updateFields ?? []);
    const mergeUpdate = postParams.updateStrategy === 'merge' && Boolean(postParams.postId);
    const seriesSelected = !mergeUpdate || reviewed.has(PullField.Series);
    const subtitleSelected = !mergeUpdate || reviewed.has(PullField.SecondaryTitle);
    const headers = this.context.getHeaders(certificate);

    if (this.context.remotePostApi !== 'core-rest') {
      if (seriesSelected && postParams.seriesPlacement !== undefined) {
        throw new Error(this.plugin.i18n.t('error_seriesRequiresRestProfile'));
      }
      postParams.secondaryTitleOwner = this.context.editorialMetadataCapabilities.secondaryTitle
        ? 'legacy'
        : 'unsupported';
      return;
    }

    const capability = await this.inspectCorePostType(postParams.postType, headers);
    if (subtitleSelected) {
      postParams.secondaryTitleOwner = capability.wptlSubtitle
        ? 'wptl'
        : this.supportsCompanionSecondaryTitle
          ? 'legacy'
          : 'unsupported';
    }
    if (!seriesSelected || postParams.seriesPlacement === undefined) return;
    if (!capability.wptlSeriesMeta
      || !capability.taxonomies.includes(WPTL_SERIES_TAXONOMY)
    ) {
      throw new Error(this.plugin.i18n.t('error_seriesPostTypeUnsupported'));
    }
    if (postParams.seriesPlacement.kind === 'clear') {
      postParams.resolvedSeriesPlacement = resolveSeriesPlacement(
        postParams.seriesPlacement
      );
      return;
    }
    const slug = postParams.seriesPlacement.placement.series;
    const response = await this.client.httpGetResponse(
      'wp-json/wp/v2/' + WPTL_SERIES_TAXONOMY
        + '?slug=' + encodeURIComponent(slug) + '&context=edit',
      { headers }
    );
    const data = this.remoteResponseData(
      response,
      RemotePostErrorCode.UnsupportedType
    );
    if (!Array.isArray(data) || data.length !== 1) {
      throw new Error(
        data instanceof Array && data.length > 1
          ? 'WordPress returned more than one Series for the exact slug ' + slug + '.'
          : 'WordPress does not contain a Series with the exact slug ' + slug + '.'
      );
    }
    postParams.resolvedSeriesPlacement = resolveSeriesPlacement(
      postParams.seriesPlacement,
      parseSeriesDefinition(data[0])
    );
  }

  async publish(
    title: string,
    content: string,
    postParams: WordPressPostParams,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<WordPressPublishResult>> {
    let url: string;
    if (this.context.remotePostApi === 'core-rest') {
      const capability = await this.inspectCorePostType(
        postParams.postType,
        this.context.getHeaders(certificate)
      );
      url = 'wp-json/' + capability.route.namespace + '/'
        + capability.route.restBase
        + (postParams.postId ? '/' + encodeURIComponent(postParams.postId) : '');
    } else if (postParams.postId) {
      url = getUrl(this.context.endpoints?.editPost, 'wp-json/wp/v2/posts/<%= postId %>', {
        postId: postParams.postId
      });
    } else {
      url = getUrl(this.context.endpoints?.newPost, 'wp-json/wp/v2/posts');
    }
    const scheduledDate = postParams.status === PostStatus.Future
      ? formatISO(postParams.datetime ?? new Date())
      : undefined;
    const payload = buildRestPublishPayload({
      title,
      content,
      postParams,
      editorialMetadata: this.context.getEditorialMetadata(postParams),
      scheduledDate
    });
    const response = await this.client.httpPostResponse(
      url,
      payload,
      {
        headers: this.context.getHeaders(certificate)
      });
    if (response.status < 200 || response.status >= 300) {
      const error = isUnknownRecord(response.json) ? response.json : {};
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: typeof error.code === 'string'
            ? error.code
            : WordPressClientReturnCode.ServerInternalError,
          message: typeof error.message === 'string'
            ? error.message
            : 'WordPress returned HTTP ' + response.status + '.'
        },
        response: response.json
      };
    }
    const resp = response.json;
    try {
      const result = this.context.responseParser.toWordPressPublishResult(postParams, resp);
      if (this.context.remotePostApi === 'core-rest'
        && this.supportsCompanionSeo
        && !isContentOnlyUpdate(postParams)
      ) {
        const seoMetadata = buildRankMathSeoMetadata(postParams);
        if (Object.keys(seoMetadata).length > 0) {
          try {
            await this.client.httpPost(
              'wp-json/wp-publisher/v1/posts/' + encodeURIComponent(result.postId) + '/seo',
              seoMetadata,
              { headers: this.context.getHeaders(certificate) }
            );
          } catch (error) {
            result.warnings = [
              ...(result.warnings ?? []),
              this.plugin.i18n.t('warning_rankMathUpdateFailed', {
                message: error instanceof Error ? error.message : String(error)
              })
            ];
          }
        }
      }
      if (this.context.remotePostApi === 'core-rest'
        && this.supportsCompanionSecondaryTitle
        && postParams.secondaryTitleOwner === 'legacy'
        && !isContentOnlyUpdate(postParams)
      ) {
        const secondaryTitleMetadata = buildSecondaryTitleMetadata(postParams);
        if (Object.keys(secondaryTitleMetadata).length > 0) {
          try {
            await this.client.httpPost(
              'wp-json/wp-publisher/v1/posts/'
                + encodeURIComponent(result.postId)
                + '/secondary-title',
              secondaryTitleMetadata,
              { headers: this.context.getHeaders(certificate) }
            );
          } catch (error) {
            result.warnings = [
              ...(result.warnings ?? []),
              this.plugin.i18n.t('warning_secondaryTitleUpdateFailed', {
                message: error instanceof Error ? error.message : String(error)
              })
            ];
          }
        }
      }
      const verificationWarning = await this.verifyWptlPublish(
        postParams,
        result.postId,
        certificate
      );
      if (verificationWarning) {
        result.partialFailure = true;
        result.warnings = [
          ...(result.warnings ?? []),
          verificationWarning
        ];
      }
      return {
        code: WordPressClientReturnCode.OK,
        data: result,
        response: resp
      };
    } catch {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: WordPressClientReturnCode.ServerInternalError,
          message: this.plugin.i18n.t('error_cannotParseResponse')
        },
        response: resp
      };
    }
  }

  private async verifyWptlPublish(
    postParams: WordPressPostParams,
    postId: string,
    certificate: WordPressAuthParams
  ): Promise<string | undefined> {
    if (this.context.remotePostApi !== 'core-rest'
      || isContentOnlyUpdate(postParams)
    ) {
      return undefined;
    }
    const reviewed = new Set(postParams.updateFields ?? []);
    const mergeUpdate = postParams.updateStrategy === 'merge' && Boolean(postParams.postId);
    const verifySeries = Boolean(postParams.resolvedSeriesPlacement)
      && (!mergeUpdate || reviewed.has(PullField.Series));
    const verifySubtitle = postParams.secondaryTitleOwner === 'wptl'
      && Object.prototype.hasOwnProperty.call(postParams, 'secondaryTitle')
      && (!mergeUpdate || reviewed.has(PullField.SecondaryTitle));
    if (!verifySeries && !verifySubtitle) return undefined;
    try {
      const remote = await this.fetchRemotePost({
        postId,
        postType: postParams.postType
      }, certificate);
      if (verifySeries) {
        const resolved = postParams.resolvedSeriesPlacement!;
        const expected = resolved.kind === 'clear'
          ? { kind: 'clear' as const }
          : {
            kind: 'placement' as const,
            placement: resolved.portable!
          };
        const actual = remote.seriesPlacement
          ? { kind: 'placement' as const, placement: remote.seriesPlacement }
          : { kind: 'clear' as const };
        if (!remote.capabilities.series
          || !seriesPlacementsEqual(expected, actual)
        ) {
          throw new Error(this.plugin.i18n.t('warning_wptlSeriesMismatch', {
            expected: describeSeriesIntentForUi(
              expected,
              (key, vars) => this.plugin.i18n.t(key, vars)
            ),
            actual: describeSeriesIntentForUi(
              actual,
              (key, vars) => this.plugin.i18n.t(key, vars)
            )
          }));
        }
      }
      if (verifySubtitle
        && (!remote.capabilities.secondaryTitle
          || remote.secondaryTitleOwner !== 'wptl'
          || remote.secondaryTitle !== (postParams.secondaryTitle?.trim() ?? ''))
      ) {
        throw new Error(this.plugin.i18n.t('warning_wptlSubtitleMismatch', {
          expected: postParams.secondaryTitle?.trim() ?? '',
          actual: remote.secondaryTitle ?? ''
        }));
      }
      return undefined;
    } catch (error) {
      return this.plugin.i18n.t('warning_wptlReadbackFailed', {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  protected async fetchRemotePost(
    target: RemotePostTarget,
    certificate: WordPressAuthParams
  ): Promise<RemotePostDocument> {
    const headers = this.context.getHeaders(certificate);
    let data: unknown;
    if (this.context.remotePostApi === 'wp-com') {
      const response = await this.client.httpGetResponse(
        getUrl(
          this.context.endpoints?.getPost,
          'rest/v1.1/sites/<%= site %>/posts/<%= postId %>?context=edit',
          { site: '', postId: target.postId }
        ),
        { headers }
      );
      data = this.remoteResponseData(response, RemotePostErrorCode.Missing);
    } else {
      const typeResponse = await this.client.httpGetResponse(
        getUrl(
          this.context.endpoints?.getPostType,
          'wp-json/wp/v2/types/<%= postType %>',
          { postType: target.postType }
        ),
        { headers }
      );
      const typeData = this.remoteResponseData(
        typeResponse,
        RemotePostErrorCode.UnsupportedType
      );
      const route = parseCoreRestPostTypeRoute(typeData, target.postType);
      const postResponse = await this.client.httpGetResponse(
        buildCoreRestPostPath(route, target),
        { headers }
      );
      data = this.remoteResponseData(postResponse, RemotePostErrorCode.Missing);
    }
    let document = this.context.responseParser.toRemotePostDocument(data);
    if (this.context.remotePostApi === 'core-rest') {
      document = await this.enrichRemoteSeriesPlacement(document, headers);
      const seo = await this.fetchCompanionSeo(target.postId, headers);
      if (seo) document = withRemotePostSeoMetadata(document, seo);
      if (document.secondaryTitleOwner !== 'wptl') {
        const secondaryTitle = await this.fetchCompanionSecondaryTitle(
          target.postId,
          headers
        );
        if (secondaryTitle !== undefined) {
          document = withRemotePostSecondaryTitle(document, secondaryTitle);
        }
      }
    }
    return withRemotePostCapabilities(document, {
      focusKeyword: document.capabilities.focusKeyword
        || this.context.remoteEditorialMetadataCapabilities.focusKeyword,
      metaDescription: document.capabilities.metaDescription
        || this.context.remoteEditorialMetadataCapabilities.metaDescription,
      secondaryTitle: document.capabilities.secondaryTitle
        || this.context.remoteEditorialMetadataCapabilities.secondaryTitle
    });
  }

  private async enrichRemoteSeriesPlacement(
    document: RemotePostDocument,
    headers: Record<string, string>
  ): Promise<RemotePostDocument> {
    if (!document.capabilities.series || !document.seriesRaw) return document;
    if (document.seriesRaw.termIds.length === 0) {
      const staleFields = nonEmptyRemoteSeriesMetadataFields(document.seriesRaw);
      if (staleFields.length > 0) {
        throw new RemotePostError(
          RemotePostErrorCode.MalformedResponse,
          this.plugin.i18n.t('error_wptlOrphanedSeriesMetadata', {
            fields: staleFields.join(', ')
          })
        );
      }
      return withRemotePostSeriesPlacement(document, null);
    }
    if (document.seriesRaw.termIds.length !== 1) {
      throw new RemotePostError(
        RemotePostErrorCode.MalformedResponse,
        'WordPress returned more than one WP Title Layer Series for the post.'
      );
    }
    const response = await this.client.httpGetResponse(
      'wp-json/wp/v2/' + WPTL_SERIES_TAXONOMY + '/'
        + encodeURIComponent(document.seriesRaw.termIds[0]) + '?context=edit',
      { headers }
    );
    const definition = parseSeriesDefinition(this.remoteResponseData(
      response,
      RemotePostErrorCode.UnsupportedType
    ));
    return withRemotePostSeriesPlacement(
      document,
      portableSeriesFromRemote(document.seriesRaw, definition)
    );
  }

  private async detectCompanionCapabilities(
    headers: Record<string, string>
  ): Promise<void> {
    if (this.context.remotePostApi !== 'core-rest') return;
    this.supportsCompanionSeo = false;
    this.supportsCompanionSecondaryTitle = false;
    try {
      const response = await this.client.httpGetResponse(
        'wp-json/wp-publisher/v1/capabilities',
        { headers }
      );
      const data = isUnknownRecord(response.json) ? response.json : {};
      this.supportsCompanionSeo = response.status >= 200 && response.status < 300
        && data.rankMathSeo === true;
      this.supportsCompanionSecondaryTitle = response.status >= 200
        && response.status < 300
        && data.secondaryTitle === true
        && data.subtitleProvider !== 'wp-title-layer';
    } catch {
      this.supportsCompanionSeo = false;
      this.supportsCompanionSecondaryTitle = false;
    }
  }

  private async fetchCompanionSeo(
    postId: string,
    headers: Record<string, string>
  ): Promise<{ focusKeyword?: string, metaDescription?: string } | undefined> {
    try {
      const response = await this.client.httpGetResponse(
        'wp-json/wp-publisher/v1/posts/' + encodeURIComponent(postId) + '/seo',
        { headers }
      );
      if (response.status < 200
        || response.status >= 300
        || !isUnknownRecord(response.json)
      ) {
        return undefined;
      }
      this.supportsCompanionSeo = true;
      const data = response.json;
      return {
        ...(typeof data.focusKeyword === 'string' && data.focusKeyword
          ? { focusKeyword: data.focusKeyword }
          : {}),
        ...(typeof data.metaDescription === 'string' && data.metaDescription
          ? { metaDescription: data.metaDescription }
          : {})
      };
    } catch {
      return undefined;
    }
  }

  private async fetchCompanionSecondaryTitle(
    postId: string,
    headers: Record<string, string>
  ): Promise<string | undefined> {
    try {
      const response = await this.client.httpGetResponse(
        'wp-json/wp-publisher/v1/posts/'
          + encodeURIComponent(postId)
          + '/secondary-title',
        { headers }
      );
      if (response.status < 200
        || response.status >= 300
        || !isUnknownRecord(response.json)
      ) {
        return undefined;
      }
      const data = response.json;
      if (typeof data.secondaryTitle !== 'string') {
        return undefined;
      }
      this.supportsCompanionSecondaryTitle = true;
      return data.secondaryTitle;
    } catch {
      return undefined;
    }
  }

  private remoteResponseData(
    response: RestResponse,
    missingCode: RemotePostErrorCode
  ): unknown {
    if (response.status >= 200 && response.status < 300) {
      return response.json;
    }
    const payload = isUnknownRecord(response.json) ? response.json : undefined;
    const message = typeof payload?.message === 'string'
      ? payload.message
      : 'WordPress returned HTTP ' + response.status + '.';
    if (response.status === 401) {
      throw new RemotePostError(RemotePostErrorCode.Authentication, message);
    }
    if (response.status === 403) {
      throw new RemotePostError(RemotePostErrorCode.Permission, message);
    }
    if (response.status === 404 || response.status === 410) {
      throw new RemotePostError(missingCode, message);
    }
    throw new RemotePostError(RemotePostErrorCode.Network, message);
  }

  async getCategories(certificate: WordPressAuthParams): Promise<Term[]> {
    const data = await this.client.httpGet(
      getUrl(this.context.endpoints?.getCategories, 'wp-json/wp/v2/categories?per_page=100'),
      {
        headers: this.context.getHeaders(certificate)
      });
    return this.context.responseParser.toTerms(data);
  }

  async getPostTypes(certificate: WordPressAuthParams): Promise<PostType[]> {
    const data = await this.client.httpGet(
      getUrl(this.context.endpoints?.getPostTypes, 'wp-json/wp/v2/types'),
      {
        headers: this.context.getHeaders(certificate)
      });
    return this.context.responseParser.toPostTypes(data);
  }

  async validateUser(certificate: WordPressAuthParams): Promise<WordPressClientResult<boolean>> {
    try {
      const response = await this.client.httpGetResponse(
        getUrl(this.context.endpoints?.validateUser, `wp-json/wp/v2/users/me`),
        {
          headers: this.context.getHeaders(certificate)
        });
      if (response.status < 200 || response.status >= 300) {
        const payload = isUnknownRecord(response.json) ? response.json : {};
        const code = typeof payload.code === 'string' ? payload.code : 'unknown';
        const message = typeof payload.message === 'string'
          ? payload.message
          : this.plugin.i18n.t('error_invalidUser');
        const actionable = response.status === 401 || response.status === 403
          ? this.plugin.i18n.t('error_restAuthenticationRejected', {
            status: String(response.status),
            code,
            message
          })
          : this.plugin.i18n.t('error_restConnectionRejected', {
            status: String(response.status),
            code,
            message
          });
        return {
          code: WordPressClientReturnCode.Error,
          error: {
            code: WordPressClientReturnCode.Error,
            message: actionable
          },
          response: response.json
        };
      }
      const data = response.json;
      await this.detectCompanionCapabilities(this.context.getHeaders(certificate));
      return {
        code: WordPressClientReturnCode.OK,
        data: !!data,
        response: data
      };
    } catch(error) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: WordPressClientReturnCode.Error,
          message: error instanceof Error && error.message
            ? error.message
            : this.plugin.i18n.t('error_invalidUser'),
        },
        response: error
      };
    }
  }

  async getTag(name: string, certificate: WordPressAuthParams): Promise<Term> {
    const termResp = await this.client.httpGet(
      getUrl(this.context.endpoints?.getTag, 'wp-json/wp/v2/tags?number=1&search=<%= name %>', {
        name: encodeURIComponent(name)
      }),
      {
        headers: this.context.getHeaders(certificate)
      }
    );
    const exists = this.context.responseParser.toTerms(termResp);
    if (exists.length === 0) {
      const resp = await this.client.httpPost(
        getUrl(this.context.endpoints?.newTag, 'wp-json/wp/v2/tags'),
        {
          name
        },
        {
          headers: this.context.getHeaders(certificate)
        });
      return this.context.responseParser.toTerm(resp);
    } else {
      return exists[0];
    }
  }

  protected async mediaExists(
    attachmentId: string | number,
    certificate: WordPressAuthParams
  ): Promise<boolean | undefined> {
    try {
      const status = await this.client.httpStatus(
        getUrl(
          this.context.endpoints?.editMedia,
          'wp-json/wp/v2/media/<%= mediaId %>',
          { mediaId: attachmentId }
        ),
        { headers: this.context.getHeaders(certificate) }
      );
      if (status >= 200 && status < 300) {
        return true;
      }
      return [ 404, 410 ].includes(status) ? false : undefined;
    } catch {
      return undefined;
    }
  }

  async uploadMedia(media: Media, certificate: WordPressAuthParams): Promise<WordPressClientResult<WordPressMediaUploadResult>> {
    try {
      const formItems = new FormItems();
      formItems.append('file', media);
      Object.entries(this.context.getMediaUploadMetadata(media.metadata ?? {}))
        .forEach(([ name, value ]) => formItems.append(name, value));

      const response = await this.client.httpPost(
        getUrl(this.context.endpoints?.uploadFile, 'wp-json/wp/v2/media'),
        formItems,
        {
          headers: {
            ...this.context.getHeaders(certificate)
          },
          formItemNameMapper: this.context.formItemNameMapper
        });
      const result = this.context.responseParser.toWordPressMediaUploadResult(response);
      result.metadataApplied = true;
      return {
        code: WordPressClientReturnCode.OK,
        data: result,
        response
      };
    } catch (error) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: WordPressClientReturnCode.ServerInternalError,
          message: error instanceof Error ? error.message : String(error)
        },
        response: undefined
      };
    }
  }

  async updateMediaMetadata(
    attachmentId: string | number,
    metadata: MediaMetadata,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<boolean>> {
    try {
      const response = await this.client.httpPost(
        getUrl(
          this.context.endpoints?.editMedia,
          'wp-json/wp/v2/media/<%= mediaId %>',
          { mediaId: attachmentId }
        ),
        this.context.getMediaUpdateMetadata(metadata),
        { headers: this.context.getHeaders(certificate) }
      );
      return {
        code: WordPressClientReturnCode.OK,
        data: true,
        response
      };
    } catch (error) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: WordPressClientReturnCode.ServerInternalError,
          message: error instanceof Error ? error.message : String(error)
        },
        response: error
      };
    }
  }

}

type UrlGetter = () => string;

function getUrl(
  url: string | UrlGetter | undefined,
  defaultValue: string,
  params?: { [p: string]: string | number }
): string {
  let resultUrl: string;
  if (isString(url)) {
    resultUrl = url;
  } else if (isFunction(url)) {
    resultUrl = url();
  } else {
    resultUrl = defaultValue;
  }
  if (params) {
    const compiled = template(resultUrl);
    return compiled(params);
  } else {
    return resultUrl;
  }
}

interface WpRestClientContext {
  name: string;

  remotePostApi: 'core-rest' | 'wp-com';

  remoteEditorialMetadataCapabilities: EditorialMetadataCapabilities;

  responseParser: {
    toWordPressPublishResult: (
      postParams: WordPressPostParams,
      response: unknown
    ) => WordPressPublishResult;
    /**
     * Convert response to `WordPressMediaUploadResult`.
     *
     * If there is any error, throw new error directly.
     * @param response response from remote server
     */
    toWordPressMediaUploadResult: (response: unknown) => WordPressMediaUploadResult;
    toTerms: (response: unknown) => Term[];
    toTerm: (response: unknown) => Term;
    toPostTypes: (response: unknown) => PostType[];
    toRemotePostDocument: (response: unknown) => RemotePostDocument;
  };

  endpoints?: Partial<WpRestEndpoint>;

  needLoginModal?: boolean;

  formItemNameMapper?: FormItemNameMapper;

  editorialMetadataCapabilities: EditorialMetadataCapabilities;

  getEditorialMetadata(postParams: WordPressPostParams): Record<string, unknown>;

  getMediaUploadMetadata(metadata: MediaMetadata): Record<string, string>;

  getMediaUpdateMetadata(metadata: MediaMetadata): Record<string, string>;

  getHeaders(wp: WordPressAuthParams): Record<string, string>;

}

class WpRestClientCommonContext implements WpRestClientContext {
  name = 'WpRestClientCommonContext';

  remotePostApi = 'core-rest' as const;

  remoteEditorialMetadataCapabilities = {
    focusKeyword: false,
    metaDescription: false,
    secondaryTitle: false
  };

  editorialMetadataCapabilities = {
    focusKeyword: false,
    metaDescription: false,
    secondaryTitle: false
  };

  getEditorialMetadata(postParams: WordPressPostParams): Record<string, unknown> {
    return buildRestEditorialMetadata(postParams);
  }

  getMediaUploadMetadata(metadata: MediaMetadata): Record<string, string> {
    return buildRestMediaMetadata(metadata);
  }

  getMediaUpdateMetadata(metadata: MediaMetadata): Record<string, string> {
    return buildRestMediaMetadata(metadata);
  }

  getHeaders(wp: WordPressAuthParams): Record<string, string> {
    return {
      'authorization': `Basic ${btoa(`${wp.username}:${wp.password}`)}`
    };
  }

  responseParser = {
    toWordPressPublishResult: (
      postParams: WordPressPostParams,
      response: unknown
    ): WordPressPublishResult => {
      const data = requireUnknownRecord(response, 'WordPress REST response');
      if (isIdentifier(data.id)) {
        return {
          postId: postParams.postId ?? String(data.id),
          categories: postParams.categories
        };
      }
      throw new Error('WordPress REST response did not include a post ID.');
    },
    toWordPressMediaUploadResult: (response: unknown): WordPressMediaUploadResult => {
      const data = requireUnknownRecord(response, 'WordPress media response');
      if (typeof data.source_url !== 'string') {
        throw new Error('WordPress media response did not include a source URL.');
      }
      return {
        url: data.source_url,
        ...(isIdentifier(data.id) ? { id: data.id } : {})
      };
    },
    toTerms: (response: unknown): Term[] => {
      if (Array.isArray(response)) {
        return response.map(item => parseTerm(item, 'id'));
      }
      return [];
    },
    toTerm: (response: unknown): Term => parseTerm(response, 'id'),
    toPostTypes: (response: unknown): PostType[] => {
      if (isUnknownRecord(response)) {
        return Object.keys(response);
      }
      return [];
    },
    toRemotePostDocument: parseCoreRestRemotePost
  };
}

export class WpRestClientMiniOrangeContext extends WpRestClientCommonContext {
  name = 'WpRestClientMiniOrangeContext';
}

export class WpRestClientAppPasswordContext extends WpRestClientCommonContext {
  name = 'WpRestClientAppPasswordContext';
}

export class WpRestClientLegacyWpComContext implements WpRestClientContext {
  name = 'WpRestClientLegacyWpComContext';

  remotePostApi = 'wp-com' as const;

  remoteEditorialMetadataCapabilities = {
    focusKeyword: true,
    metaDescription: true,
    secondaryTitle: false
  };

  needLoginModal = false;

  editorialMetadataCapabilities = {
    focusKeyword: true,
    metaDescription: true,
    secondaryTitle: false
  };

  getEditorialMetadata(postParams: WordPressPostParams): Record<string, unknown> {
    return buildWpComEditorialMetadata(postParams);
  }

  endpoints: Partial<WpRestEndpoint> = {
    base: 'https://public-api.wordpress.com',
    newPost: () => `/rest/v1.1/sites/${this.site}/posts/new`,
    editPost: () => `/rest/v1.1/sites/${this.site}/posts/<%= postId %>`,
    getPost: () => `/rest/v1.1/sites/${this.site}/posts/<%= postId %>?context=edit`,
    getCategories: () => `/rest/v1.1/sites/${this.site}/categories`,
    newTag: () => `/rest/v1.1/sites/${this.site}/tags/new`,
    getTag: () => `/rest/v1.1/sites/${this.site}/tags?number=1&search=<%= name %>`,
    validateUser: () => `/rest/v1.1/sites/${this.site}/posts?number=1`,
    uploadFile: () => `/rest/v1.1/sites/${this.site}/media/new`,
    editMedia: () => `/rest/v1.1/sites/${this.site}/media/<%= mediaId %>`,
    getPostTypes: () => `/rest/v1.1/sites/${this.site}/post-types`,
  };

  constructor(
    private readonly site: string,
    private readonly accessToken: string
  ) { }

  formItemNameMapper(name: string, isArray: boolean): string {
    if (name === 'file' && !isArray) {
      return 'media[]';
    }
    return name;
  }

  getMediaUploadMetadata(metadata: MediaMetadata): Record<string, string> {
    return Object.fromEntries(
      Object.entries(buildWpComMediaMetadata(metadata))
        .map(([ name, value ]) => [ `attrs[0][${name}]`, value ])
    );
  }

  getMediaUpdateMetadata(metadata: MediaMetadata): Record<string, string> {
    return buildWpComMediaMetadata(metadata);
  }

  getHeaders(wp: WordPressAuthParams): Record<string, string> {
    return {
      'authorization': `BEARER ${this.accessToken}`
    };
  }

  responseParser = {
    toWordPressPublishResult: (
      postParams: WordPressPostParams,
      response: unknown
    ): WordPressPublishResult => {
      const data = requireUnknownRecord(response, 'WordPress.com response');
      if (isIdentifier(data.ID)) {
        return {
          postId: postParams.postId ?? String(data.ID),
          categories: postParams.categories
        };
      }
      throw new Error('WordPress.com response did not include a post ID.');
    },
    toWordPressMediaUploadResult: (response: unknown): WordPressMediaUploadResult => {
      const data = requireUnknownRecord(response, 'WordPress.com media response');
      if (Array.isArray(data.media) && data.media.length > 0) {
        const media = requireUnknownRecord(
          data.media[0],
          'WordPress.com uploaded media'
        );
        if (typeof media.link !== 'string') {
          throw new Error('WordPress.com media response did not include a URL.');
        }
        return {
          url: media.link,
          ...(isIdentifier(media.ID)
            ? { id: media.ID }
            : isIdentifier(media.id)
              ? { id: media.id }
              : {})
        };
      }
      const errors = isUnknownRecord(data.errors) ? data.errors : undefined;
      const uploadError = isUnknownRecord(errors?.error) ? errors.error : undefined;
      if (typeof uploadError?.message === 'string') {
        throw new Error(uploadError.message);
      }
      throw new Error('Upload failed');
    },
    toTerms: (response: unknown): Term[] => {
      if (isUnknownRecord(response)
        && typeof response.found === 'number'
        && Array.isArray(response.categories)
      ) {
        return response.categories.map(item => parseTerm(item, 'ID'));
      }
      return [];
    },
    toTerm: (response: unknown): Term => parseTerm(response, 'ID'),
    toPostTypes: (response: unknown): PostType[] => {
      if (isUnknownRecord(response)
        && typeof response.found === 'number'
        && Array.isArray(response.post_types)
      ) {
        return response.post_types.flatMap(item => {
          if (!isUnknownRecord(item) || typeof item.name !== 'string') return [];
          return [ item.name ];
        });
      }
      return [];
    },
    toRemotePostDocument: parseWpComRemotePost
  };
}

function isIdentifier(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

function postTypeTaxonomies(value: unknown): string[] {
  if (!isUnknownRecord(value) || !Array.isArray(value.taxonomies)) return [];
  return [ ...new Set(value.taxonomies.filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  )) ];
}

function restMetaSchemaProperties(value: unknown): Record<string, unknown> {
  if (!isUnknownRecord(value)
    || !isUnknownRecord(value.schema)
    || !isUnknownRecord(value.schema.properties)
    || !isUnknownRecord(value.schema.properties.meta)
    || !isUnknownRecord(value.schema.properties.meta.properties)
  ) {
    return {};
  }
  return value.schema.properties.meta.properties;
}

function restResponseHeader(response: RestResponse, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(response.headers ?? {}).find(
    ([ key ]) => key.toLowerCase() === target
  )?.[1];
}

function parseTerm(response: unknown, idKey: 'id' | 'ID'): Term {
  const data = requireUnknownRecord(response, 'WordPress term');
  const id = data[idKey];
  if (!isIdentifier(id)) {
    throw new Error(`WordPress term did not include ${idKey}.`);
  }
  const parent = data.parent;
  return {
    id: String(id),
    name: typeof data.name === 'string' ? data.name : '',
    slug: typeof data.slug === 'string' ? data.slug : '',
    taxonomy: typeof data.taxonomy === 'string' ? data.taxonomy : '',
    description: typeof data.description === 'string' ? data.description : '',
    ...(isIdentifier(parent) ? { parent } : {}),
    count: typeof data.count === 'number' ? data.count : 0
  };
}
