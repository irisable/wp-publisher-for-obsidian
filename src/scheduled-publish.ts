import { format, isValid, parse } from 'date-fns';

const DATE_FORMAT = 'yyyy-MM-dd';
const DATE_TIME_FORMAT = 'yyyy-MM-dd HH:mm:ss';
const SCHEDULE_PATTERN = /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/;

export const ScheduledPublishValidationCode = {
  Required: 'required',
  Format: 'format',
  InvalidDate: 'invalid-date',
  NotFuture: 'not-future'
} as const;

export type ScheduledPublishValidationCode =
  typeof ScheduledPublishValidationCode[keyof typeof ScheduledPublishValidationCode];

export type ScheduledPublishValidation =
  | { valid: true, date: Date }
  | { valid: false, code: ScheduledPublishValidationCode };

export type ScheduledPublishErrorKey =
  | 'publishModal_scheduleRequired'
  | 'publishModal_scheduleFormat'
  | 'publishModal_scheduleInvalidDate'
  | 'publishModal_scheduleNotFuture';

export function scheduledPublishErrorKey(
  code: ScheduledPublishValidationCode
): ScheduledPublishErrorKey {
  switch (code) {
    case ScheduledPublishValidationCode.Required:
      return 'publishModal_scheduleRequired';
    case ScheduledPublishValidationCode.Format:
      return 'publishModal_scheduleFormat';
    case ScheduledPublishValidationCode.InvalidDate:
      return 'publishModal_scheduleInvalidDate';
    default:
      return 'publishModal_scheduleNotFuture';
  }
}

/** Validate a parsed date immediately before publishing. */
export function validateScheduledPublishDate(
  value: unknown,
  now: Date = new Date()
): ScheduledPublishValidation {
  if (value === undefined || value === null) {
    return { valid: false, code: ScheduledPublishValidationCode.Required };
  }
  if (!(value instanceof Date) || !isValid(value)) {
    return { valid: false, code: ScheduledPublishValidationCode.InvalidDate };
  }
  if (value.getTime() <= now.getTime()) {
    return { valid: false, code: ScheduledPublishValidationCode.NotFuture };
  }
  return { valid: true, date: value };
}

/** Strictly parse either a local date or a local date and time. */
export function validateScheduledPublishInput(
  value: string,
  now: Date = new Date()
): ScheduledPublishValidation {
  const normalized = value.trim();
  if (!normalized) {
    return { valid: false, code: ScheduledPublishValidationCode.Required };
  }
  if (!SCHEDULE_PATTERN.test(normalized)) {
    return { valid: false, code: ScheduledPublishValidationCode.Format };
  }

  const inputFormat = normalized.length === DATE_FORMAT.length
    ? DATE_FORMAT
    : DATE_TIME_FORMAT;
  const date = parse(normalized, inputFormat, now);
  if (!isValid(date) || format(date, inputFormat) !== normalized) {
    return { valid: false, code: ScheduledPublishValidationCode.InvalidDate };
  }
  return validateScheduledPublishDate(date, now);
}
