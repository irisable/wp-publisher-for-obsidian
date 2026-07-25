export type UnknownRecord = Record<string, unknown>;

export function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireUnknownRecord(
  value: unknown,
  label = 'Value'
): UnknownRecord {
  if (!isUnknownRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}
