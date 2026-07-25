import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ScheduledPublishValidationCode,
  validateScheduledPublishDate,
  validateScheduledPublishInput
} from '../src/scheduled-publish.ts';

const now = new Date(2026, 6, 19, 12, 0, 0);

test('accepts valid future dates with or without a time', () => {
  const dateOnly = validateScheduledPublishInput('2026-07-20', now);
  const dateTime = validateScheduledPublishInput('2026-07-19 12:00:01', now);

  assert.equal(dateOnly.valid, true);
  assert.equal(dateTime.valid, true);
  if (dateOnly.valid) {
    assert.deepEqual(dateOnly.date, new Date(2026, 6, 20, 0, 0, 0));
  }
  if (dateTime.valid) {
    assert.deepEqual(dateTime.date, new Date(2026, 6, 19, 12, 0, 1));
  }
});

test('requires a scheduled date', () => {
  assert.deepEqual(validateScheduledPublishInput('   ', now), {
    valid: false,
    code: ScheduledPublishValidationCode.Required
  });
  assert.deepEqual(validateScheduledPublishDate(undefined, now), {
    valid: false,
    code: ScheduledPublishValidationCode.Required
  });
});

test('rejects incomplete or incorrectly formatted input', () => {
  for (const value of [ '2026-07', '2026/07/20', '2026-07-20 12:00' ]) {
    assert.deepEqual(validateScheduledPublishInput(value, now), {
      valid: false,
      code: ScheduledPublishValidationCode.Format
    });
  }
});

test('rejects impossible calendar dates and times', () => {
  for (const value of [
    '2025-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-07-20 24:00:00',
    '2026-07-20 12:60:00'
  ]) {
    assert.deepEqual(validateScheduledPublishInput(value, now), {
      valid: false,
      code: ScheduledPublishValidationCode.InvalidDate
    });
  }
});

test('requires the scheduled value to be later than the current time', () => {
  for (const value of [ '2026-07-18', '2026-07-19 12:00:00' ]) {
    assert.deepEqual(validateScheduledPublishInput(value, now), {
      valid: false,
      code: ScheduledPublishValidationCode.NotFuture
    });
  }
  assert.deepEqual(validateScheduledPublishDate(new Date('invalid'), now), {
    valid: false,
    code: ScheduledPublishValidationCode.InvalidDate
  });
});
