export const chainMeta: Record<number, { name: string; explorer: string; explorerApi: string }> = {
  1:     { name: 'Ethereum',  explorer: 'https://etherscan.io',            explorerApi: 'https://api.etherscan.io/api' },
  8453:  { name: 'Base',      explorer: 'https://basescan.org',            explorerApi: 'https://api.basescan.org/api' },
  42161: { name: 'Arbitrum',  explorer: 'https://arbiscan.io',             explorerApi: 'https://api.arbiscan.io/api' },
  10:    { name: 'Optimism',  explorer: 'https://optimistic.etherscan.io', explorerApi: 'https://api-optimistic.etherscan.io/api' },
  137:   { name: 'Polygon',   explorer: 'https://polygonscan.com',         explorerApi: 'https://api.polygonscan.com/api' },
};

export type SupportedChainId = keyof typeof chainMeta;
