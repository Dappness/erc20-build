/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@erc20-build/db',
    '@erc20-build/shared',
    '@erc20-build/contracts',
  ],
  webpack: (config) => {
    // Stub optional peer dependencies of @wagmi/connectors that aren't installed
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'porto': false,
      'porto/internal': false,
      '@coinbase/wallet-sdk': false,
      '@walletconnect/ethereum-provider': false,
      '@metamask/connect-evm': false,
      '@safe-global/safe-apps-sdk': false,
      '@safe-global/safe-apps-provider': false,
    };
    // Mark as externals to avoid bundling errors for optional connectors
    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : config.externals ? [config.externals] : []),
    ];
    return config;
  },
}

export default nextConfig
