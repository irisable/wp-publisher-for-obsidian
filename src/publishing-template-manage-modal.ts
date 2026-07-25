import { Notice, Setting } from 'obsidian';
import WordpressPlugin from './main';
import { AbstractModal } from './abstract-modal';
import { CommentStatus, PostStatus } from './wp-api';
import { normalizeWordPressTags } from './front-matter';
import {
  createPublishingTemplate,
  normalizePublishingTemplate,
  normalizePublishingTemplates,
  PublishingTemplate
} from './publishing-templates';

export class PublishingTemplateManageModal extends AbstractModal {

  private readonly templates: PublishingTemplate[];

  constructor(readonly plugin: WordpressPlugin) {
    super(plugin);
    this.templates = normalizePublishingTemplates(
      plugin.settings.publishingTemplates
    );
  }

  onOpen(): void {
    this.modalEl.addClass('wp-publisher-template-manager');
    this.display();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private display(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.createHeader(this.t('templateManager_title'));
    contentEl.createEl('p', {
      cls: 'wp-publisher-template-manager-intro',
      text: this.t('templateManager_desc')
    });

    const toolbar = new Setting(contentEl)
      .setName(this.t('templateManager_add'))
      .setDesc(this.t('templateManager_addDesc'))
      .addButton(button => button
        .setButtonText(this.t('templateManager_addButton'))
        .setCta()
        .onClick(() => {
          this.templates.push(createPublishingTemplate(this.nextTemplateId()));
          this.display();
        }));
    toolbar.settingEl.addClass('wp-publisher-template-toolbar');

    const list = contentEl.createDiv({
      cls: 'wp-publisher-template-list'
    });
    if (this.templates.length === 0) {
      list.createDiv({
        cls: 'wp-publisher-template-empty',
        text: this.t('templateManager_empty')
      });
    }

    this.templates.forEach((template, index) => {
      const card = list.createDiv({
        cls: 'wp-publisher-template-card'
      });
      const header = new Setting(card)
        .setName(template.name || this.t('templateManager_untitled'))
        .setDesc(this.t('templateManager_templateDesc'))
        .addExtraButton(button => button
          .setIcon('lucide-trash')
          .setTooltip(this.t('templateManager_delete'))
          .onClick(() => {
            this.templates.splice(index, 1);
            this.display();
          }));
      header.settingEl.addClass('wp-publisher-template-card-header');

      new Setting(card)
        .setName(this.t('templateManager_name'))
        .setDesc(this.t('templateManager_nameDesc'))
        .addText(text => text
          .setPlaceholder(this.t('templateManager_namePlaceholder'))
          .setValue(template.name)
          .onChange(value => {
            template.name = value;
          }));

      new Setting(card)
        .setName(this.t('templateManager_status'))
        .addDropdown(dropdown => dropdown
          .addOption(PostStatus.Draft, this.t('publishModal_postStatusDraft'))
          .addOption(PostStatus.Publish, this.t('publishModal_postStatusPublish'))
          .addOption(PostStatus.Private, this.t('publishModal_postStatusPrivate'))
          .setValue(template.status)
          .onChange(value => {
            template.status = value as PostStatus;
          }));

      new Setting(card)
        .setName(this.t('templateManager_commentStatus'))
        .addDropdown(dropdown => dropdown
          .addOption(CommentStatus.Open, this.t('publishModal_commentStatusOpen'))
          .addOption(CommentStatus.Closed, this.t('publishModal_commentStatusClosed'))
          .setValue(template.commentStatus)
          .onChange(value => {
            template.commentStatus = value as CommentStatus;
          }));

      new Setting(card)
        .setName(this.t('templateManager_postType'))
        .setDesc(this.t('templateManager_postTypeDesc'))
        .addText(text => text
          .setPlaceholder('post')
          .setValue(template.postType)
          .onChange(value => {
            template.postType = value.trim() || 'post';
          }));

      new Setting(card)
        .setName(this.t('templateManager_tags'))
        .setDesc(this.t('templateManager_tagsDesc'))
        .addText(text => text
          .setPlaceholder(this.t('publishModal_tagsPlaceholder'))
          .setValue(template.tags.join(', '))
          .onChange(value => {
            template.tags = normalizeWordPressTags(value);
          }));
    });

    const footer = contentEl.createDiv({
      cls: 'wp-publisher-template-footer'
    });
    new Setting(footer)
      .setDesc(this.t('templateManager_saveHint'))
      .addButton(button => button
        .setButtonText(this.t('templateManager_save'))
        .setCta()
        .onClick(async () => {
          if (!this.validateTemplates()) {
            return;
          }
          this.plugin.settings.publishingTemplates = this.templates.map(
            (template, index) => normalizePublishingTemplate(
              template,
              `template-${index + 1}`
            )
          );
          await this.plugin.saveSettings();
          this.close();
        }));
  }

  private validateTemplates(): boolean {
    const names = this.templates.map(template => template.name.trim());
    if (names.some(name => name.length === 0)) {
      new Notice(this.t('templateManager_errorName'));
      return false;
    }
    const normalizedNames = names.map(name => name.toLocaleLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      new Notice(this.t('templateManager_errorDuplicate'));
      return false;
    }
    this.templates.forEach((template, index) => {
      template.name = names[index];
    });
    return true;
  }

  private nextTemplateId(): string {
    const existing = new Set(this.templates.map(template => template.id));
    const base = `template-${Date.now().toString(36)}`;
    let id = base;
    let suffix = 2;
    while (existing.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    return id;
  }
}
