/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@erc20-build/db',
    '@erc20-build/shared',
    '@erc20-build/contracts',
  ],
}

export default nextConfig
