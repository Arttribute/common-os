'use client'
import dynamic from 'next/dynamic'

// WorldClient contains Phaser + HUD — must be client-only (no SSR)
const WorldClient = dynamic(() => import('@/components/WorldClient'), { ssr: false })

export default function WorldPage() {
  return <WorldClient />
}
