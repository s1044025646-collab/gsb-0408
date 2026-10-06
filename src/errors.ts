export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const MAX_BITS = 10_000;
export const MAX_EXTENSION_BITS = 1_024;

export function parseBits(value: unknown, field = 'bits'): number[] {
  if (typeof value === 'string') {
    if (value.length === 0) {
      throw new AppError('EMPTY_INPUT', `${field} 不能为空；空输入没有可推断的前缀。`, 400);
    }
    if (value.length > MAX_BITS) {
      throw new AppError('INPUT_TOO_LONG', `${field} 长度不能超过 ${MAX_BITS} 位。`, 400);
    }
    const bits: number[] = [];
    for (const ch of value) {
      if (ch !== '0' && ch !== '1') {
        throw new AppError('NON_BINARY_CHARACTER', `${field} 包含非二进制字符 ${JSON.stringify(ch)}；遇到坏字符不会继续计算。`, 400);
      }
      bits.push(Number(ch));
    }
    return bits;
  }

  if (!Array.isArray(value)) {
    throw new AppError('INVALID_BITS', `${field} 必须是只含 0/1 的数组或字符串。`, 400);
  }
  if (value.length === 0) {
    throw new AppError('EMPTY_INPUT', `${field} 不能为空；空输入没有可推断的前缀。`, 400);
  }
  if (value.length > MAX_BITS) {
    throw new AppError('INPUT_TOO_LONG', `${field} 长度不能超过 ${MAX_BITS} 位。`, 400);
  }
  return value.map((item, index) => {
    if (item !== 0 && item !== 1) {
      throw new AppError('INVALID_ARRAY_ELEMENT', `${field}[${index}]` +
        ` 必须是数字 0 或 1，不能是 ${JSON.stringify(item)}。`, 400);
    }
    return item;
  });
}

export function parseNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AppError('INVALID_INTEGER', `${field} 必须是非负整数。`, 400);
  }
  return value;
}

export function parseCoefficients(value: unknown, order: number): number[] {
  if (!Array.isArray(value) || value.some((item) => item !== 0 && item !== 1)) {
    throw new AppError('INVALID_COEFFICIENTS', 'coefficients 必须是只含 0/1 的数组。', 400);
  }
  if (value.length !== order + 1) {
    throw new AppError('INVALID_COEFFICIENT_LENGTH',
      `阶数为 ${order} 时 coefficients 必须恰好有 ${order + 1} 项，即 C[0] 到 C[${order}]。`, 400);
  }
  if (value[0] !== 1) {
    throw new AppError('C0_NOT_ONE', 'C[0] 固定为 1。', 400);
  }
  return [...value];
}
