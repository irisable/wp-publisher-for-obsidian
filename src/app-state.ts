import MarkdownIt from 'markdown-it';
import { MarkdownItImagePluginInstance } from './markdown-it-image-plugin';
import { MarkdownItCommentPluginInstance } from './markdown-it-comment-plugin';
import { MarkdownItMathJax3PluginInstance } from './markdown-it-mathjax3-plugin';
import { markdownItWordPressBreakPlugin } from './markdown-it-wordpress-break-plugin';
import { markdownItWordPressListPlugin } from './markdown-it-wordpress-list-plugin';

class AppStore {

  markdownParser = new MarkdownIt();

}

export const AppState = new AppStore();

AppState.markdownParser
  .use(MarkdownItCommentPluginInstance.plugin)
  .use(MarkdownItMathJax3PluginInstance.plugin)
  .use(MarkdownItImagePluginInstance.plugin)
  .use(markdownItWordPressBreakPlugin)
  .use(markdownItWordPressListPlugin);
