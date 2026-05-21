/**
 * Tests for token-decimals utility (Fix #4)
 */
import { toRawAmount } from '../src/skills/dex-aggregator-ai/lib/token-decimals';

describe('toRawAmount', () => {
  it('converts 1 USDC correctly (6 decimals)', () => {
    expect(toRawAmount('1', 6)).toBe('1000000');
  });

  it('converts 1 WBTC correctly (8 decimals)', () => {
    expect(toRawAmount('1', 8)).toBe('100000000');
  });

  it('converts 1.5 ETH correctly (18 decimals)', () => {
    expect(toRawAmount('1.5', 18)).toBe('1500000000000000000');
  });

  it('handles fractional amounts shorter than decimals', () => {
    expect(toRawAmount('0.001', 6)).toBe('1000');
  });

  it('clamps fraction to decimal precision', () => {
    // 1.123456789 with 6 decimals → truncates at 6 places
    expect(toRawAmount('1.123456789', 6)).toBe('1123456');
  });

  it('handles whole numbers with no decimal', () => {
    expect(toRawAmount('100', 18)).toBe('100' + '0'.repeat(18));
  });

  it('returns 0 for zero input', () => {
    expect(toRawAmount('0', 18)).toBe('0');
  });
});
