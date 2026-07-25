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
import { isArray, isFunction, isNumber, isObject, isString, template } from 'lodash-es';
import { SafeAny } from './utils';
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
  withRemotePostSeoMetadata,
  type RemotePostDocument,
  type RemotePostTarget
} from './remote-post';


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

export class WpRestClient extends AbstractWordPressClient {

  private readonly client: RestClient;
  private supportsCompanionSeo = false;
  private supportsCompanionSecondaryTitle = false;

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

  protected getEditorialMetadataCapabilities(): EditorialMetadataCapabilities {
    return {
      focusKeyword: this.context.editorialMetadataCapabilities.focusKeyword
        || this.supportsCompanionSeo,
      metaDescription: this.context.editorialMetadataCapabilities.metaDescription
        || this.supportsCompanionSeo,
      secondaryTitle: this.context.editorialMetadataCapabilities.secondaryTitle
        || this.supportsCompanionSecondaryTitle
    };
  }

  protected needLogin(): boolean {
    if (this.context.needLoginModal !== undefined) {
      return this.context.needLoginModal;
    }
    return  super.needLogin();
  }

  async publish(
    title: string,
    content: string,
    postParams: WordPressPostParams,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<WordPressPublishResult>> {
    let url: string;
    if (postParams.postId) {
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
    const resp: SafeAny = await this.client.httpPost(
      url,
      payload,
      {
        headers: this.context.getHeaders(certificate)
      });
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
      const seo = await this.fetchCompanionSeo(target.postId, headers);
      if (seo) document = withRemotePostSeoMetadata(document, seo);
      const secondaryTitle = await this.fetchCompanionSecondaryTitle(target.postId, headers);
      if (secondaryTitle !== undefined) {
        document = withRemotePostSecondaryTitle(document, secondaryTitle);
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
      const data = response.json as SafeAny;
      this.supportsCompanionSeo = response.status >= 200 && response.status < 300
        && data?.rankMathSeo === true;
      this.supportsCompanionSecondaryTitle = response.status >= 200
        && response.status < 300
        && data?.secondaryTitle === true;
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
      if (response.status < 200 || response.status >= 300 || !isObject(response.json)) {
        return undefined;
      }
      this.supportsCompanionSeo = true;
      const data = response.json as SafeAny;
      return {
        ...(isString(data.focusKeyword) && data.focusKeyword
          ? { focusKeyword: data.focusKeyword }
          : {}),
        ...(isString(data.metaDescription) && data.metaDescription
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
      if (response.status < 200 || response.status >= 300 || !isObject(response.json)) {
        return undefined;
      }
      const data = response.json as SafeAny;
      if (!isString(data.secondaryTitle)) {
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
    const payload = response.json as SafeAny;
    const message = isString(payload?.message)
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
    const data: SafeAny = await this.client.httpGet(
      getUrl(this.context.endpoints?.getPostTypes, 'wp-json/wp/v2/types'),
      {
        headers: this.context.getHeaders(certificate)
      });
    return this.context.responseParser.toPostTypes(data);
  }

  async validateUser(certificate: WordPressAuthParams): Promise<WordPressClientResult<boolean>> {
    try {
      const data = await this.client.httpGet(
        getUrl(this.context.endpoints?.validateUser, `wp-json/wp/v2/users/me`),
        {
          headers: this.context.getHeaders(certificate)
        });
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
          message: this.plugin.i18n.t('error_invalidUser'),
        },
        response: error
      };
    }
  }

  async getTag(name: string, certificate: WordPressAuthParams): Promise<Term> {
    const termResp: SafeAny = await this.client.httpGet(
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

      const response: SafeAny = await this.client.httpPost(
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
    } catch (e: SafeAny) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: WordPressClientReturnCode.ServerInternalError,
          message: e.toString()
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
    toWordPressPublishResult: (postParams: WordPressPostParams, response: SafeAny) => WordPressPublishResult;
    /**
     * Convert response to `WordPressMediaUploadResult`.
     *
     * If there is any error, throw new error directly.
     * @param response response from remote server
     */
    toWordPressMediaUploadResult: (response: SafeAny) => WordPressMediaUploadResult;
    toTerms: (response: SafeAny) => Term[];
    toTerm: (response: SafeAny) => Term;
    toPostTypes: (response: SafeAny) => PostType[];
    toRemotePostDocument: (response: SafeAny) => RemotePostDocument;
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
    toWordPressPublishResult: (postParams: WordPressPostParams, response: SafeAny): WordPressPublishResult => {
      if (response.id) {
        return {
          postId: postParams.postId ?? response.id,
          categories: postParams.categories ?? response.categories
        }
      }
      throw new Error('WordPress REST response did not include a post ID.');
    },
    toWordPressMediaUploadResult: (response: SafeAny): WordPressMediaUploadResult => {
      return {
        url: response.source_url,
        id: response.id
      };
    },
    toTerms: (response: SafeAny): Term[] => {
      if (isArray(response)) {
        return response as Term[];
      }
      return [];
    },
    toTerm: (response: SafeAny): Term => ({
      ...response,
      id: response.id
    }),
    toPostTypes: (response: SafeAny): PostType[] => {
      if (isObject(response)) {
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
    toWordPressPublishResult: (postParams: WordPressPostParams, response: SafeAny): WordPressPublishResult => {
      if (response.ID) {
        return {
          postId: postParams.postId ?? response.ID,
          categories: postParams.categories ?? Object.values(response.categories).map((cat: SafeAny) => cat.ID)
        };
      }
      throw new Error('WordPress.com response did not include a post ID.');
    },
    toWordPressMediaUploadResult: (response: SafeAny): WordPressMediaUploadResult => {
      if (response.media.length > 0) {
        const media = response.media[0];
        return {
          url: media.link,
          id: media.ID ?? media.id
        };
      } else if (response.errors) {
        throw new Error(response.errors.error.message);
      }
      throw new Error('Upload failed');
    },
    toTerms: (response: SafeAny): Term[] => {
      if (isNumber(response.found)) {
        return response
          .categories
          .map((it: Term & { ID: number; }) => ({
            ...it,
            id: String(it.ID)
          }));
      }
      return [];
    },
    toTerm: (response: SafeAny): Term => ({
      ...response,
      id: response.ID
    }),
    toPostTypes: (response: SafeAny): PostType[] => {
      if (isNumber(response.found)) {
        return response
          .post_types
          .map((it: { name: string }) => (it.name));
      }
      return [];
    },
    toRemotePostDocument: parseWpComRemotePost
  };
}
