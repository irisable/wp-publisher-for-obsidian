export const ApiType = {
  XML_RPC: 'xml-rpc',
  RestAPI_miniOrange: 'miniOrange',
  RestApi_ApplicationPasswords: 'application-passwords',
  Legacy_WpComOAuth2: 'WpComOAuth2'
} as const;

export type ApiType = typeof ApiType[keyof typeof ApiType];

export const SELECTABLE_API_TYPES: readonly ApiType[] = [
  ApiType.XML_RPC,
  ApiType.RestAPI_miniOrange,
  ApiType.RestApi_ApplicationPasswords
];

export function isLegacyWordPressComApiType(value: unknown): boolean {
  return value === ApiType.Legacy_WpComOAuth2;
}
