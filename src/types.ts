import { isString } from 'lodash-es';
import type { MediaMetadata } from './media-metadata';

export interface MarkdownItPlugin {
  updateOptions: (opts: unknown) => void;
}

export type MatterData = Record<string, unknown>;

export interface Media {
  mimeType: string;
  fileName: string;
  content: ArrayBuffer;
  metadata?: MediaMetadata;
}

export function isMedia(obj: unknown): obj is Media {
  return (
    typeof obj === 'object'
    && obj !== null
    && 'mimeType' in obj && typeof obj.mimeType === 'string'
    && 'fileName' in obj && typeof obj.fileName === 'string'
    && 'content' in obj && obj.content instanceof ArrayBuffer
  );
}

/**
 * Convert original item name to custom one.
 *
 * @param name original item name. If `isArray` is `true`, which means is in an array, the `name` will be appended by `[]`
 * @param isArray whether this item is in an array
 */
export type FormItemNameMapper = (name: string, isArray: boolean) => string;

type FormItemValue = string | Media;

export class FormItems {
  #formData: Record<string, FormItemValue | FormItemValue[]> = {};

  append(name: string, data: string): FormItems;
  append(name: string, data: Media): FormItems;
  append(name: string, data: string | Media): FormItems {
    const existing = this.#formData[name];
    if (existing !== undefined) {
      this.#formData[name] = Array.isArray(existing)
        ? [ ...existing, data ]
        : [ existing, data ];
    } else {
      this.#formData[name] = data;
    }
    return this;
  }

  toArrayBuffer(option: {
    boundary: string;
    nameMapper?: FormItemNameMapper;
  }): Promise<ArrayBuffer> {
    const CRLF = '\r\n';
    const itemPart = (name: string, data: string | Media, isArray: boolean) => {
      let itemName = name;
      if (option.nameMapper) {
        itemName = option.nameMapper(name, isArray);
      }

      body.push(encodedItemStart);
      if (isString(data)) {
        body.push(encoder.encode(`Content-Disposition: form-data; name="${itemName}"${CRLF}${CRLF}`));
        body.push(encoder.encode(data));
      } else {
        const media = data;
        body.push(encoder.encode(`Content-Disposition: form-data; name="${itemName}"; filename="${media.fileName}"${CRLF}Content-Type: ${media.mimeType}${CRLF}${CRLF}`));
        body.push(media.content);
      }
      body.push(encoder.encode(CRLF));
    };

    const encoder = new TextEncoder();
    const encodedItemStart = encoder.encode(`--${option.boundary}${CRLF}`);
    const body: ArrayBuffer[] = [];
    Object.entries(this.#formData).forEach(([ name, data ]) => {
      if (Array.isArray(data)) {
        data.forEach(item => {
          itemPart(`${name}[]`, item, true);
        });
      } else {
        itemPart(name, data, false);
      }
    });
    body.push(encoder.encode(`--${option.boundary}--`));
    return new Blob(body).arrayBuffer();
  }
}
