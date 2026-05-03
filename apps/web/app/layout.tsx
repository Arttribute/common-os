import type { Metadata } from 'next'
import { Press_Start_2P } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

const pixelFont = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'CommonOS',
  description: 'Deploy and manage persistent AI agent fleets',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={pixelFont.variable}>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
