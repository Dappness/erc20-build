import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ERC20.Build — Open Source Token Builder',
  description:
    'Deploy your own ERC20 token in 60 seconds. Open-source builder with live dashboard.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
