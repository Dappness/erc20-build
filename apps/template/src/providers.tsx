'use client';

import { type ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { mainnet, base, arbitrum, optimism, polygon } from '@reown/appkit/networks';
import { wagmiConfig } from '@/lib/wagmi-config';

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? 'demo-project-id';

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [mainnet, base, arbitrum, optimism, polygon],
});

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [mainnet, base, arbitrum, optimism, polygon],
  metadata: {
    name: 'ERC20 Template',
    description: 'ERC-20 token dashboard',
    url: 'https://erc20.build',
    icons: [],
  },
  themeMode: 'dark',
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
