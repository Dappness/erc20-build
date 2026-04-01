import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ERC20 Template',
  description: 'ERC-20 Token Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
