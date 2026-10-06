import { MAX_EXTENSION_BITS } from './errors';

export interface StepRecord {
  position: number;
  inputBit: number;
  discrepancy: number;
  orderBefore: number;
  orderAfter: number;
  coefficientsBefore: number[];
  coefficientsAfter: number[];
  backupBefore: number[];
  backupAfter: number[];
  shift: number;
  orderAndBackupUpdated: boolean;
  prediction: number;
  participants: Array<{ coefficientIndex: number; sequenceIndex: number; coefficient: number; bit: number }>;
}

export interface AnalysisResult {
  sequence: number[];
  length: number;
  order: number;
  coefficients: number[];
  steps: StepRecord[];
  convention: string;
  semantics: {
    zeroOrder: string;
    prefixOnly: string;
  };
}

export interface VerificationResult {
  valid: boolean;
  firstFailurePosition: number | null;
  checkedRange: { from: number; toExclusive: number };
  checks: Array<{
    position: number;
    actual: number;
    predicted: number;
    xorTerms: number[];
    participants: Array<{ coefficientIndex: number; sequenceIndex: number; coefficient: number; bit: number }>;
  }>;
}

function fixedLength(poly: number[], length: number): number[] {
  return Array.from({ length }, (_, index) => poly[index] ?? 0);
}

function xorPoly(left: number[], right: number[], shift: number): number[] {
  const result = [...left];
  for (let j = 0; j < right.length; j += 1) {
    const target = j + shift;
    result[target] = (result[target] ?? 0) ^ right[j];
  }
  return result;
}

export function predictBit(sequence: number[], coefficients: number[], order: number, position: number): {
  prediction: number;
  participants: StepRecord['participants'];
} {
  const participants = [];
  let prediction = 0;
  for (let i = 1; i <= order; i += 1) {
    const coefficient = coefficients[i] ?? 0;
    const bit = sequence[position - i];
    participants.push({ coefficientIndex: i, sequenceIndex: position - i, coefficient, bit });
    prediction ^= coefficient * bit;
  }
  return { prediction, participants };
}

export function berlekampMasseyBinary(sequence: number[]): AnalysisResult {
  let connection = [1];
  let backup = [1];
  let order = 0;
  let shift = 1;
  const steps: StepRecord[] = [];

  for (let position = 0; position < sequence.length; position += 1) {
    const beforeConnection = fixedLength(connection, order + 1);
    const beforeBackup = [...backup];
    const orderBefore = order;
    const { prediction, participants } = predictBit(sequence, connection, order, position);
    const discrepancy = sequence[position] ^ prediction;

    const tentative = discrepancy === 1 ? xorPoly(connection, backup, shift) : connection;
    const updateOrderAndBackup = discrepancy === 1 && 2 * order <= position;
    let afterBackup = beforeBackup;

    if (discrepancy === 1) {
      const oldConnection = connection;
      connection = tentative;
      if (updateOrderAndBackup) {
        order = position + 1 - order;
        backup = oldConnection;
        shift = 1;
      } else {
        shift += 1;
      }
      afterBackup = [...backup];
    } else {
      shift += 1;
    }

    steps.push({
      position,
      inputBit: sequence[position],
      discrepancy,
      orderBefore,
      orderAfter: order,
      coefficientsBefore: beforeConnection,
      coefficientsAfter: fixedLength(connection, order + 1),
      backupBefore: beforeBackup,
      backupAfter: afterBackup,
      shift,
      orderAndBackupUpdated: updateOrderAndBackup,
      prediction,
      participants,
    });
  }

  return {
    sequence: [...sequence],
    length: sequence.length,
    order,
    coefficients: fixedLength(connection, order + 1),
    steps,
    convention: '下标从 0 开始；C[0]=1；对每个 n>=L，s[n] = XOR(C[i]*s[n-i], i=1..L)。',
    semantics: {
      zeroOrder: 'L=0 表示此前缀满足 s[n]=0（从 n=0 开始检查），典型情况是全零前缀。',
      prefixOnly: 'L 是解释给定有限前缀的最短阶数，不证明真实生成器来源，也不保证未来唯一。',
    },
  };
}

export function verifyRecurrence(sequence: number[], order: number, coefficients: number[]): VerificationResult {
  const checks = [];
  let firstFailurePosition: number | null = null;

  for (let position = order; position < sequence.length; position += 1) {
    const terms: number[] = [];
    const participants = [];
    let predicted = 0;
    for (let i = 1; i <= order; i += 1) {
      const coefficient = coefficients[i] ?? 0;
      const bit = sequence[position - i];
      const term = coefficient * bit;
      terms.push(term);
      predicted ^= term;
      participants.push({ coefficientIndex: i, sequenceIndex: position - i, coefficient, bit });
    }
    const actual = sequence[position];
    if (firstFailurePosition === null && actual !== predicted) {
      firstFailurePosition = position;
    }
    checks.push({ position, actual, predicted, xorTerms: terms, participants });
  }

  return {
    valid: firstFailurePosition === null,
    firstFailurePosition,
    checkedRange: { from: order, toExclusive: sequence.length },
    checks,
  };
}

export function extendRecurrence(
  seed: number[],
  order: number,
  coefficients: number[],
  count: number,
): { extension: number[]; combined: number[]; basisReport: { seedLength: number; order: number; coefficients: number[] } } {
  if (!Number.isInteger(count) || count < 0 || count > MAX_EXTENSION_BITS) {
    throw new RangeError(`延伸位数必须是 0 到 ${MAX_EXTENSION_BITS} 的整数。`);
  }
  if (seed.length < order) {
    throw new RangeError('序列长度小于候选阶数，缺少起始条件。');
  }
  const combined = [...seed];
  for (let step = 0; step < count; step += 1) {
    const position = combined.length;
    const { prediction } = predictBit(combined, coefficients, order, position);
    combined.push(prediction);
  }
  return {
    extension: combined.slice(seed.length),
    combined,
    basisReport: { seedLength: seed.length, order, coefficients: [...coefficients] },
  };
}

export function enumerateLowerOrderSolutions(sequence: number[], bestOrder: number): Array<{ order: number; coefficients: number[] }> {
  const found: Array<{ order: number; coefficients: number[] }> = [];
  for (let order = 0; order < bestOrder; order += 1) {
    const total = 2 ** order;
    for (let mask = 0; mask < total; mask += 1) {
      const coefficients = [1];
      for (let bitIndex = 0; bitIndex < order; bitIndex += 1) {
        coefficients.push((mask >> bitIndex) & 1);
      }
      if (verifyRecurrence(sequence, order, coefficients).valid) {
        found.push({ order, coefficients });
      }
    }
  }
  return found;
}
