// A small Obsidian UI adapter for testing the real modal with delayed data sources.
export class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    this.children = [];
    this.events = {};
    this.attributes = options.attr ?? {};
    this.type = options.type;
    this.text = options.text ?? '';
    const classes = new Set((options.cls ?? '').split(' ').filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, value = !classes.has(name)) => value ? classes.add(name) : classes.delete(name)
    };
  }
  createEl(tag, options) {
    const child = new Element(tag, options);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addClass(...names) { this.classList.add(...names); }
  setText(text) { this.text = text; }
  empty() { this.children.forEach(child => { child.parent = undefined; }); this.children = []; }
  addEventListener(event, fn) { (this.events[event] ??= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  get isConnected() { return this.root === true || this.parent?.isConnected === true; }
  async fire(event = 'click') {
    if (this.disabled) return;
    for (const handler of this.events[event] ?? []) await handler();
  }
}

export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = new Element();
    this.contentEl = this.modalEl.createDiv();
  }
  open() { this.modalEl.root = true; this.onOpen(); }
  close() { this.modalEl.root = false; this.onClose(); }
}

class Text {
  constructor(parent, tag = 'input') { this.inputEl = parent.createEl(tag); }
  setValue(value) { this.inputEl.value = value; return this; }
  getValue() { return this.inputEl.value ?? ''; }
  setPlaceholder(value) { this.inputEl.placeholder = value; return this; }
  setDisabled(value) { this.inputEl.disabled = value; return this; }
  onChange(fn) { this.inputEl.change = fn; return this; }
}
export class SearchComponent extends Text {}

class Dropdown {
  constructor(parent) { this.selectEl = parent.createEl('select'); }
  addOption(value, text) { this.selectEl.createEl('option', { text, attr: { value } }); return this; }
  setValue(value) { this.selectEl.value = value; return this; }
  setDisabled(value) { this.selectEl.disabled = value; return this; }
  onChange(fn) { this.selectEl.change = fn; return this; }
}
class Button {
  constructor(parent) { this.buttonEl = parent.createEl('button'); }
  setButtonText(value) { this.buttonEl.text = value; return this; }
  setClass(value) { this.buttonEl.addClass(value); return this; }
  setCta() { return this; }
  setDisabled(value) { this.buttonEl.disabled = value; return this; }
  onClick(fn) { this.buttonEl.addEventListener('click', fn); return this; }
}
export class Setting {
  constructor(parent) {
    this.settingEl = parent.createDiv();
    this.controlEl = this.settingEl.createDiv();
  }
  setName(value) { this.settingEl.name = value; return this; }
  setDesc(value) { this.settingEl.description = value; return this; }
  addText(fn) { fn(new Text(this.controlEl)); return this; }
  addTextArea(fn) { fn(new Text(this.controlEl, 'textarea')); return this; }
  addDropdown(fn) { fn(new Dropdown(this.controlEl)); return this; }
  addButton(fn) { fn(new Button(this.controlEl)); return this; }
}
export class Notice { constructor(message) { this.message = message; } }
export const Platform = { isMobile: false };

export function descendants(root) {
  return root.children.flatMap(child => [child, ...descendants(child)]);
}
export function input(element, value) {
  element.value = value;
  element.change(value);
}
