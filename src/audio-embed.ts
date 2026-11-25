export function isMp3Source(source: string): boolean {
  return /\.mp3$/i.test(source.split(/[?#]/, 1)[0]);
}

export function audioEmbedHtml(source: string, escapeHtml: (value: string) => string): string {
  return '<audio controls src="' + escapeHtml(source) + '" preload="none"></audio>';
}
