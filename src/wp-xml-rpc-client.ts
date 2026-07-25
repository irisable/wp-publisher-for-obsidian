import WordpressPlugin from './main';
import {
  WordPressAuthParams,
  WordPressClientResult,
  WordPressClientReturnCode,
  WordPressMediaUploadResult,
  WordPressPostParams,
  WordPressPublishResult
} from './wp-client';
import { XmlRpcClient } from './xmlrpc-client';
import { AbstractWordPressClient } from './abstract-wp-client';
import { PostType, Term } from './wp-api';
import { showError } from './utils';
import { WpProfile } from './wp-profile';
import { Media } from './types';
import {
  buildRankMathSeoMetadata,
  buildSecondaryTitleMetadata,
  buildXmlRpcEditorialMetadata,
  EditorialMetadataCapabilities
} from './editorial-metadata';
import type { MediaMetadata } from './media-metadata';
import {
  buildXmlRpcPublishPayload,
  isContentOnlyUpdate
} from './publish-strategy';
import {
  parseXmlRpcRemotePost,
  RemotePostError,
  withRemotePostSecondaryTitle,
  withRemotePostSeoMetadata,
  RemotePostErrorCode,
  type RemotePostDocument,
  type RemotePostTarget
} from './remote-post';
import { isUnknownRecord, requireUnknownRecord } from './unknown-value';

interface FaultResponse {
  faultCode: string;
  faultString: string;
}

function isFaultResponse(response: unknown): response is FaultResponse {
  return isUnknownRecord(response)
    && typeof response.faultCode === 'string'
    && typeof response.faultString === 'string';
}

export class WpXmlRpcClient extends AbstractWordPressClient {

  private readonly client: XmlRpcClient;
  private supportsRankMathSeo = false;
  private supportsRankMathSeoRead = false;
  private supportsMediaMetadata = false;
  private supportsSecondaryTitle = false;
  private supportsSecondaryTitleRead = false;

  constructor(
    readonly plugin: WordpressPlugin,
    readonly profile: WpProfile
  ) {
    super(plugin, profile);
    this.name = 'WpXmlRpcClient';
    this.client = new XmlRpcClient({
      url: new URL(profile.endpoint),
      xmlRpcPath: profile.xmlRpcPath ?? ''
    });
  }

  protected getEditorialMetadataCapabilities(): EditorialMetadataCapabilities {
    return {
      focusKeyword: this.supportsRankMathSeo,
      metaDescription: this.supportsRankMathSeo,
      secondaryTitle: this.supportsSecondaryTitle
    };
  }

  async publish(
    title: string,
    content: string,
    postParams: WordPressPostParams,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<WordPressPublishResult>> {
    const contentOnly = isContentOnlyUpdate(postParams);
    const publishContent = buildXmlRpcPublishPayload({
      title,
      content,
      postParams,
      editorialMetadata: buildXmlRpcEditorialMetadata(postParams)
    });
    let publishPromise;
    if (postParams.postId) {
      publishPromise = this.client.methodCall('wp.editPost', [
        0,
        certificate.username,
        certificate.password,
        postParams.postId,
        publishContent
      ]);
    } else {
      publishPromise = this.client.methodCall('wp.newPost', [
        0,
        certificate.username,
        certificate.password,
        publishContent
      ]);
    }
    const response = await publishPromise;
    if (isFaultResponse(response)) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: response.faultCode,
          message: response.faultString
        },
        response
      };
    }
    const postId = String(postParams.postId ?? response);
    const warnings: string[] = [];
    const seoMetadata = contentOnly
      ? {}
      : buildRankMathSeoMetadata(postParams);
    if (this.supportsRankMathSeo && Object.keys(seoMetadata).length > 0) {
      const seoResponse = await this.client.methodCall('wpPublisher.updateSeoMeta', [
        0,
        certificate.username,
        certificate.password,
        postId,
        seoMetadata
      ]);
      if (isFaultResponse(seoResponse)) {
        warnings.push(this.plugin.i18n.t('warning_rankMathUpdateFailed', {
          message: seoResponse.faultString
        }));
      }
    }
    const secondaryTitleMetadata = contentOnly
      ? {}
      : buildSecondaryTitleMetadata(postParams);
    if (this.supportsSecondaryTitle && Object.keys(secondaryTitleMetadata).length > 0) {
      const secondaryTitleResponse = await this.client.methodCall(
        'wpPublisher.updateSecondaryTitle',
        [
          0,
          certificate.username,
          certificate.password,
          postId,
          secondaryTitleMetadata
        ]
      );
      if (isFaultResponse(secondaryTitleResponse)) {
        warnings.push(this.plugin.i18n.t('warning_secondaryTitleUpdateFailed', {
          message: secondaryTitleResponse.faultString
        }));
      }
    }
    return {
      code: WordPressClientReturnCode.OK,
      data: {
        postId,
        categories: postParams.categories,
        ...(warnings.length > 0 ? { warnings } : {})
      },
      response
    };
  }

  protected async fetchRemotePost(
    target: RemotePostTarget,
    certificate: WordPressAuthParams
  ): Promise<RemotePostDocument> {
    const response = await this.client.methodCall('wp.getPost', [
      0,
      certificate.username,
      certificate.password,
      target.postId,
      [ 'post', 'terms', 'custom_fields' ]
    ]);
    if (isFaultResponse(response)) {
      const status = Number(response.faultCode);
      const authenticationFailed = status === 401
        || /authentication|incorrect.+(?:username|password)|invalid.+(?:username|password)/i
          .test(response.faultString);
      const code = authenticationFailed
        ? RemotePostErrorCode.Authentication
        : status === 403
          ? RemotePostErrorCode.Permission
          : [ 404, 410 ].includes(status)
            ? RemotePostErrorCode.Missing
            : RemotePostErrorCode.Network;
      throw new RemotePostError(code, response.faultString);
    }
    let document = parseXmlRpcRemotePost(response);
    if (this.supportsRankMathSeoRead) {
      const seoResponse = await this.client.methodCall('wpPublisher.getSeoMeta', [
        0,
        certificate.username,
        certificate.password,
        target.postId
      ]);
      if (!isFaultResponse(seoResponse) && isUnknownRecord(seoResponse)) {
        const seo = seoResponse;
        document = withRemotePostSeoMetadata(document, {
          ...(typeof seo.focusKeyword === 'string' && seo.focusKeyword
            ? { focusKeyword: seo.focusKeyword }
            : {}),
          ...(typeof seo.metaDescription === 'string' && seo.metaDescription
            ? { metaDescription: seo.metaDescription }
            : {})
        });
      }
    }
    if (this.supportsSecondaryTitleRead) {
      const secondaryTitleResponse = await this.client.methodCall(
        'wpPublisher.getSecondaryTitle',
        [
          0,
          certificate.username,
          certificate.password,
          target.postId
        ]
      );
      if (!isFaultResponse(secondaryTitleResponse)
        && isUnknownRecord(secondaryTitleResponse)
      ) {
        const value = secondaryTitleResponse.secondaryTitle;
        if (typeof value === 'string') {
          document = withRemotePostSecondaryTitle(document, value);
        }
      }
    }
    return document;
  }

  async getCategories(certificate: WordPressAuthParams): Promise<Term[]> {
    const response = await this.client.methodCall('wp.getTerms', [
      0,
      certificate.username,
      certificate.password,
      'category'
    ]);
    if (isFaultResponse(response)) {
      const fault = `${response.faultCode}: ${response.faultString}`;
      showError(fault);
      throw new Error(fault);
    }
    if (!Array.isArray(response)) {
      throw new Error('WordPress XML-RPC terms response was not an array.');
    }
    return response.map(parseXmlRpcTerm);
  }

  async getPostTypes(certificate: WordPressAuthParams): Promise<PostType[]> {
    const response = await this.client.methodCall('wp.getPostTypes', [
      0,
      certificate.username,
      certificate.password,
    ]);
    if (isFaultResponse(response)) {
      const fault = `${response.faultCode}: ${response.faultString}`;
      showError(fault);
      throw new Error(fault);
    }
    return isUnknownRecord(response) ? Object.keys(response) : [];
  }

  async validateUser(certificate: WordPressAuthParams): Promise<WordPressClientResult<boolean>> {
    this.supportsRankMathSeo = false;
    this.supportsRankMathSeoRead = false;
    this.supportsMediaMetadata = false;
    this.supportsSecondaryTitle = false;
    this.supportsSecondaryTitleRead = false;
    const response = await this.client.methodCall('wp.getProfile', [
      0,
      certificate.username,
      certificate.password
    ]);
    if (isFaultResponse(response)) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: response.faultCode,
          message: `${response.faultCode}: ${response.faultString}`
        },
        response
      };
    } else {
      const capabilities = await this.client.methodCall('wpPublisher.getCapabilities', [
        0,
        certificate.username,
        certificate.password
      ]);
      if (!isFaultResponse(capabilities) && isUnknownRecord(capabilities)) {
        this.supportsRankMathSeo = capabilities.rankMathSeo === true;
        this.supportsRankMathSeoRead = capabilities.rankMathSeoRead === true;
        this.supportsMediaMetadata = capabilities.mediaMetadata === true;
        this.supportsSecondaryTitle = capabilities.secondaryTitle === true;
        this.supportsSecondaryTitleRead = capabilities.secondaryTitleRead === true;
      }
      return {
        code: WordPressClientReturnCode.OK,
        data: !!response,
        response
      };
    }
  }

  getTag(name: string, certificate: WordPressAuthParams): Promise<Term> {
    return Promise.resolve({
      id: name,
      name,
      slug: name,
      taxonomy: 'post_tag',
      description: name,
      count: 0
    });
  }

  protected async mediaExists(
    attachmentId: string | number,
    certificate: WordPressAuthParams
  ): Promise<boolean | undefined> {
    try {
      const response = await this.client.methodCall('wp.getMediaItem', [
        0,
        certificate.username,
        certificate.password,
        attachmentId
      ]);
      if (!isFaultResponse(response)) {
        return true;
      }
      return [ 404, 410 ].includes(Number(response.faultCode)) ? false : undefined;
    } catch {
      return undefined;
    }
  }

  async uploadMedia(media: Media, certificate: WordPressAuthParams): Promise<WordPressClientResult<WordPressMediaUploadResult>> {
    const wpMedia = {
      name: media.fileName,
      type: media.mimeType,
      bits: media.content,
    };
    const response = await this.client.methodCall('wp.uploadFile', [
      0,
      certificate.username,
      certificate.password,
      wpMedia,
    ]);
    if (isFaultResponse(response)) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: response.faultCode,
          message: `${response.faultCode}: ${response.faultString}`
        },
        response
      };
    } else {
      const data = requireUnknownRecord(response, 'WordPress XML-RPC media response');
      if (typeof data.url !== 'string') {
        return {
          code: WordPressClientReturnCode.Error,
          error: {
            code: WordPressClientReturnCode.ServerInternalError,
            message: 'WordPress XML-RPC media response did not include a URL.'
          },
          response
        };
      }
      return {
        code: WordPressClientReturnCode.OK,
        data: {
          url: data.url,
          ...(isIdentifier(data.id) ? { id: data.id } : {}),
          metadataApplied: false
        },
        response
      };
    }
  }

  async updateMediaMetadata(
    attachmentId: string | number,
    metadata: MediaMetadata,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<boolean>> {
    if (!this.supportsMediaMetadata) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: 'media_metadata_unsupported',
          message: this.plugin.i18n.t('error_mediaMetadataUnsupported')
        }
      };
    }
    const response = await this.client.methodCall('wpPublisher.updateMediaMetadata', [
      0,
      certificate.username,
      certificate.password,
      attachmentId,
      {
        ...(metadata.title ? { title: metadata.title } : {}),
        ...(metadata.altText ? { alt: metadata.altText } : {}),
        ...(metadata.caption ? { caption: metadata.caption } : {}),
        ...(metadata.description ? { description: metadata.description } : {})
      }
    ]);
    if (isFaultResponse(response)) {
      return {
        code: WordPressClientReturnCode.Error,
        error: {
          code: response.faultCode,
          message: response.faultString
        },
        response
      };
    }
    return {
      code: WordPressClientReturnCode.OK,
      data: true,
      response
    };
  }

}

function isIdentifier(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

function parseXmlRpcTerm(response: unknown): Term {
  const data = requireUnknownRecord(response, 'WordPress XML-RPC term');
  if (!isIdentifier(data.term_id)) {
    throw new Error('WordPress XML-RPC term did not include term_id.');
  }
  const parent = data.parent;
  const count = Number(data.count);
  return {
    id: String(data.term_id),
    name: typeof data.name === 'string' ? data.name : '',
    slug: typeof data.slug === 'string' ? data.slug : '',
    taxonomy: typeof data.taxonomy === 'string' ? data.taxonomy : '',
    description: typeof data.description === 'string' ? data.description : '',
    ...(isIdentifier(parent) ? { parent } : {}),
    count: Number.isFinite(count) ? count : 0
  };
}
