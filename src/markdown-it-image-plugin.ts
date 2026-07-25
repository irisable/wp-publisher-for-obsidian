import MarkdownIt from 'markdown-it';
import Token from 'markdown-it/lib/token.mjs';
import { trim } from 'lodash-es';


const tokenType = 'ob_img';

export interface MarkdownItImageActionParams {
  src: string;
  width?: string;
  height?: string;
}

interface MarkdownItImagePluginOptions {
  doWithImage: (img: MarkdownItImageActionParams) => void;
}

const pluginOptions: MarkdownItImagePluginOptions = {
  doWithImage: () => {},
}

export const MarkdownItImagePluginInstance = {
  plugin: plugin,
  doWithImage: (action: (img: MarkdownItImageActionParams) => void) => {
    pluginOptions.doWithImage = action;
  },
}

function applyStandardImageDimensions(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'ob_img_standard_dimensions', state => {
    state.tokens.forEach(blockToken => {
      blockToken.children?.forEach(token => {
        if (token.type !== 'image') {
          return;
        }
        const size = token.content.match(/^(.*?)(?:\|(\d+)(?:x(\d+))?|^(\d+)(?:x(\d+))?)$/);
        if (!size) {
          return;
        }
        const altText = size[1] ?? '';
        const width = size[2] ?? size[4];
        const height = size[3] ?? size[5];
        token.content = altText;
        const altToken = new Token('text', '', 0);
        altToken.content = altText;
        token.children = [ altToken ];
        token.attrSet('width', width);
        if (height) token.attrSet('height', height);
      });
    });
  });
}

function plugin(md: MarkdownIt): void {
  applyStandardImageDimensions(md);
  md.inline.ruler.after('image', tokenType, (state, silent) => {
    const regex = /^!\[\[([^|\]\n]+)(\|([^\]\n]+))?\]\]/;
    const match = state.src.slice(state.pos).match(regex);
    if (match) {
      if (silent) {
        return true;
      }
      const token = state.push(tokenType, 'img', 0);
      const matched = match[0];
      const src = match[1];
      const size = match[3];
      let width: string | undefined;
      let height: string | undefined;
      if (size) {
        const sepIndex = size.indexOf('x'); // width x height
        if (sepIndex > 0) {
          width = trim(size.substring(0, sepIndex));
          height = trim(size.substring(sepIndex + 1));
          token.attrs = [
            [ 'src', src ],
            [ 'width', width ],
            [ 'height', height ],
          ];
        } else {
          width = trim(size);
          token.attrs = [
            [ 'src', src ],
            [ 'width', width ],
          ];
        }
      } else {
        token.attrs = [
          [ 'src', src ],
        ];
      }
      if (pluginOptions.doWithImage) {
        pluginOptions.doWithImage({
          src: token.attrs?.[0]?.[1],
          width: token.attrs?.[1]?.[1],
          height: token.attrs?.[2]?.[1],
        });
      }
      state.pos += matched.length;
      return true;
    } else {
      return false;
    }
  });
  md.renderer.rules.ob_img = (tokens: Token[], idx: number) => {
    const token = tokens[idx];
    const src = token.attrs?.[0]?.[1];
    const width = token.attrs?.[1]?.[1];
    const height = token.attrs?.[2]?.[1];
    if (width) {
      if (height) {
        return `<img src="${src}" width="${width}" height="${height}" alt="">`;
      }
      return `<img src="${src}" width="${width}" alt="">`;
    } else {
      return `<img src="${src}" alt="">`;
    }
  };
}
