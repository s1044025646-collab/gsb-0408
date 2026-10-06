import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { berlekampMasseyBinary, enumerateLowerOrderSolutions, extendRecurrence, verifyRecurrence } from '../bm';
import { AppError, parseBits } from '../errors';
import { openDatabase } from '../db';
import { appendObservation, createAnalysis, independentMinimalityCheck } from '../service';

const tempDir = mkdtempSync(join(tmpdir(), 'bm2-'));
const db = openDatabase(join(tempDir, 'test.sqlite'));
after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function expectCode(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) => error instanceof AppError && error.code === code);
}

test('110110110 has shortest order two and recurrence C=[1,1,1]', () => {
  const bits = [1, 1, 0, 1, 1, 0, 1, 1, 0];
  const result = berlekampMasseyBinary(bits);
  assert.equal(result.order, 2);
  assert.deepEqual(result.coefficients, [1, 1, 1]);
  assert.deepEqual(result.steps.map((step) => step.discrepancy), [1, 0, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(verifyRecurrence(bits, result.order, result.coefficients).valid, true);
  assert.deepEqual(enumerateLowerOrderSolutions(bits, result.order), []);
});

test('wrong candidate reports first failing position and terms', () => {
  const bits = [1, 1, 0, 1, 1, 0, 1, 1, 0];
  const verification = verifyRecurrence(bits, 2, [1, 0, 1]);
  assert.equal(verification.valid, false);
  assert.equal(verification.firstFailurePosition, 2);
  assert.equal(verification.checks[0].predicted, 1);
  assert.equal(verification.checks[0].actual, 0);
});

test('zero, one, single one and short prefixes behave correctly', () => {
  const zeros = berlekampMasseyBinary([0, 0, 0, 0]);
  assert.equal(zeros.order, 0);
  assert.deepEqual(zeros.coefficients, [1]);

  const ones = berlekampMasseyBinary([1, 1, 1, 1]);
  assert.equal(ones.order, 1);
  assert.deepEqual(ones.coefficients, [1, 1]);

  const singleOne = berlekampMasseyBinary([1]);
  assert.equal(singleOne.order, 1);
  assert.deepEqual(singleOne.coefficients, [1, 1]);

  for (const bits of [[0, 0], [1, 1], [0, 1], [1, 0], [0, 1, 1, 0]]) {
    const result = berlekampMasseyBinary(bits);
    assert.equal(verifyRecurrence(bits, result.order, result.coefficients).valid, true);
    assert.equal(independentMinimalityCheck(bits, result.order).minimal, true);
  }
});

test('extension is explicitly generated from candidate recurrence', () => {
  const result = extendRecurrence([1, 1, 0, 1, 1, 0, 1, 1, 0], 2, [1, 1, 1], 6);
  assert.deepEqual(result.extension, [1, 1, 0, 1, 1, 0]);
  assert.deepEqual(result.combined, [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0]);
});

test('validation rejects empty, non-binary and bad array elements', () => {
  expectCode(() => parseBits(''), 'EMPTY_INPUT');
  expectCode(() => parseBits('102'), 'NON_BINARY_CHARACTER');
  expectCode(() => parseBits([1, '0', 2]), 'INVALID_ARRAY_ELEMENT');
  expectCode(() => parseBits(Array(10_001).fill(0)), 'INPUT_TOO_LONG');
});

test('append creates a new immutable version', () => {
  const first = createAnalysis(db, [1, 1, 0]);
  const second = appendObservation(db, first.analysisId, [1, 1, 0]);
  assert.equal(second.version, 2);
  assert.equal(second.basisVersionId, first.id);
  assert.equal(first.length, 3);
  assert.equal(second.length, 6);
  assert.notDeepEqual(first.report.steps.length, second.report.steps.length);
});
