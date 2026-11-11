export function isMp3Source(source: string): boolean {
  return /\.mp3(?:[?#]|$)/i.test(source);
}

export function audioEmbedHtml(source: string, escapeHtml: (value: string) => string): string {
  return '<audio controls src="' + escapeHtml(source) + '" preload="none"></audio>';
}
