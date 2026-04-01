import { describe, it, expect } from 'vitest';
import { chainMeta } from '../src/chains.js';

describe('chainMeta', () => {
  const expectedChains = [
    { id: 1, name: 'Ethereum' },
    { id: 8453, name: 'Base' },
    { id: 42161, name: 'Arbitrum' },
    { id: 10, name: 'Optimism' },
    { id: 137, name: 'Polygon' },
  ];

  it('should define all 5 supported chains', () => {
    const chainIds = Object.keys(chainMeta).map(Number);
    expect(chainIds).toHaveLength(5);
    for (const chain of expectedChains) {
      expect(chainIds).toContain(chain.id);
    }
  });

  it.each(expectedChains)('chain $id ($name) should have name, explorer, and explorerApi', ({ id, name }) => {
    const chain = chainMeta[id];
    expect(chain).toBeDefined();
    expect(chain!.name).toBe(name);
    expect(chain!.explorer).toMatch(/^https:\/\//);
    expect(chain!.explorerApi).toMatch(/^https:\/\//);
  });

  it('should have correct chain IDs', () => {
    expect(chainMeta[1]!.name).toBe('Ethereum');
    expect(chainMeta[8453]!.name).toBe('Base');
    expect(chainMeta[42161]!.name).toBe('Arbitrum');
    expect(chainMeta[10]!.name).toBe('Optimism');
    expect(chainMeta[137]!.name).toBe('Polygon');
  });
});
