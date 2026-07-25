const LEGACY_IMAGE_PATH = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

export function legacyImageParagraphSource(value: string): string | undefined {
  const unescaped = value.trim().replace(/\\([\[\]])/g, '$1');
  const match = unescaped.match(/^!\[\]\[(https?:\/\/[^\]\s]+)\]$/i);
  if (!match) return undefined;

  try {
    const source = new URL(match[1]);
    if ((source.protocol !== 'http:' && source.protocol !== 'https:')
      || !LEGACY_IMAGE_PATH.test(source.pathname)
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return match[1];
}
