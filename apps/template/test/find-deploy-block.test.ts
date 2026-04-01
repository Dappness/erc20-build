import { describe, it, expect, vi } from 'vitest';

const DEPLOY_BLOCK = 1000;
const LATEST_BLOCK = 2000;

const mockGetBlockNumber = vi.fn().mockResolvedValue(BigInt(LATEST_BLOCK));
const mockGetCode = vi.fn().mockImplementation(
  ({ blockNumber }: { address: string; blockNumber: bigint }) => {
    if (Number(blockNumber) >= DEPLOY_BLOCK) {
      return Promise.resolve('0x6060604052');
    }
    return Promise.resolve('0x');
  }
);

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      getBlockNumber: mockGetBlockNumber,
      getCode: mockGetCode,
    }),
  };
});

describe('findDeployBlockBinarySearch', () => {
  it('finds deploy block via binary search', async () => {
    const { findDeployBlockBinarySearch } = await import('@/lib/indexer');
    const result = await findDeployBlockBinarySearch(
      'http://localhost:8545',
      '0x1234567890abcdef1234567890abcdef12345678'
    );
    expect(result).toBe(DEPLOY_BLOCK);

    // Binary search should make roughly log2(2000) ~= 11 calls
    expect(mockGetCode.mock.calls.length).toBeLessThanOrEqual(25);
    expect(mockGetCode.mock.calls.length).toBeGreaterThan(0);
  });
});
