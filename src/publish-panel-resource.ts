/** Ignore late responses after a newer request or after the modal closes. */
export class PublishPanelResource<T> {
  value?: T;
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  error = '';
  onChange: () => void = () => {};
  private revision = 0;
  private closed = false;

  async load(loader: () => Promise<T>): Promise<void> {
    if (this.closed) return;
    const revision = ++this.revision;
    this.status = 'loading';
    this.error = '';
    this.onChange();
    try {
      const value = await loader();
      if (this.closed || revision !== this.revision) return;
      this.value = value;
      this.status = 'ready';
    } catch (error) {
      if (this.closed || revision !== this.revision) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
    }
    this.onChange();
  }

  close(): void {
    this.closed = true;
    this.revision += 1;
    this.onChange = () => {};
  }
}
