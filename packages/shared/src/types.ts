export type TokenSource = 'created' | 'imported';

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  contractAddress: string;
  chainId: number;
}
