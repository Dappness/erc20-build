import { describe, it, expect, vi } from 'vitest';

let multicallResponse: Array<{ status: string; result?: unknown; error?: Error }> = [];

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      multicall: vi.fn().mockImplementation(() => Promise.resolve(multicallResponse)),
    }),
  };
});

describe('readTokenMetadata', () => {
  it('reads token metadata via multicall', async () => {
    multicallResponse = [
      { status: 'success', result: 'Test Token' },
      { status: 'success', result: 'TEST' },
      { status: 'success', result: 18 },
      { status: 'success', result: BigInt('1000000000000000000000000') },
    ];

    const { readTokenMetadata } = await import('@/lib/indexer');
    const metadata = await readTokenMetadata(
      'http://localhost:8545',
      '0x1234567890abcdef1234567890abcdef12345678',
      1
    );

    expect(metadata).toEqual({
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18,
      totalSupply: '1000000000000000000000000',
      contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: 1,
    });
  });

  it('throws on failed multicall result', async () => {
    multicallResponse = [
      { status: 'failure', error: new Error('revert') },
      { status: 'success', result: 'TEST' },
      { status: 'success', result: 18 },
      { status: 'success', result: BigInt('1000000') },
    ];

    const { readTokenMetadata } = await import('@/lib/indexer');
    await expect(
      readTokenMetadata(
        'http://localhost:8545',
        '0x1234567890abcdef1234567890abcdef12345678',
        1
      )
    ).rejects.toThrow('Failed to read name()');
  });
});
