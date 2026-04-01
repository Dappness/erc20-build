'use client';

import { http, createConfig } from 'wagmi';
import { mainnet, base, arbitrum, optimism, polygon } from 'viem/chains';

export const supportedChains = [mainnet, base, arbitrum, optimism, polygon] as const;

export const wagmiConfig = createConfig({
  chains: supportedChains,
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
  },
  ssr: true,
});
