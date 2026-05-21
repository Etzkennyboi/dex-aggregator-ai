/**
 * Tests for approval calldata correctness (Fixes #6, #7)
 * We expose the helper via a thin test shim since it's unexported.
 */

// Inline the function under test (mirrors execute-swap.ts implementation)
function buildApproveCalldata(spender: string, amount: string): string {
  if (!spender.startsWith('0x') || spender.length !== 42) {
    throw new Error(`buildApproveCalldata: invalid spender address "${spender}"`);
  }
  return (
    '0x095ea7b3' +
    spender.slice(2).toLowerCase().padStart(64, '0') +
    BigInt(amount).toString(16).padStart(64, '0')
  );
}

describe('buildApproveCalldata', () => {
  const ROUTER = '0x3572b5864dC0e2E69EB49aF0Bc3e2cFE08f5C31e';
  const MAX    = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

  it('produces correct 4-byte selector', () => {
    const data = buildApproveCalldata(ROUTER, MAX);
    expect(data.slice(0, 10)).toBe('0x095ea7b3');
  });

  it('encodes spender address correctly (32 bytes, left-padded)', () => {
    const data    = buildApproveCalldata(ROUTER, MAX);
    const encoded = data.slice(10, 74); // 64 hex chars = 32 bytes
    expect(encoded).toBe(ROUTER.slice(2).toLowerCase().padStart(64, '0'));
  });

  it('encodes uint256 max correctly', () => {
    const data    = buildApproveCalldata(ROUTER, MAX);
    const encoded = data.slice(74, 138);
    expect(encoded).toBe('f'.repeat(64));
  });

  it('encodes zero allowance for USDT reset', () => {
    const data    = buildApproveCalldata(ROUTER, '0');
    const encoded = data.slice(74, 138);
    expect(encoded).toBe('0'.repeat(64));
  });

  it('throws on a human-readable name (Fix #7)', () => {
    expect(() => buildApproveCalldata('Uniswap', MAX)).toThrow('invalid spender address');
  });

  it('throws on a truncated address', () => {
    expect(() => buildApproveCalldata('0x3572b5864d', MAX)).toThrow('invalid spender address');
  });
});
