'use client'
import { useEffect, useRef } from 'react'

interface PhaserGameProps {
  className?: string
}

export default function PhaserGame({ className }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<import('phaser').Game | null>(null)

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return

    let game: import('phaser').Game | null = null

    async function initGame() {
      const Phaser = (await import('phaser')).default
      const { BootScene } = await import('@/game/scenes/BootScene')
      const { WorldScene } = await import('@/game/scenes/WorldScene')
      const { UIScene } = await import('@/game/scenes/UIScene')

      if (!containerRef.current) return

      const config: import('phaser').Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: containerRef.current,
        backgroundColor: '#060b14',
        scene: [BootScene, WorldScene, UIScene],
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: '100%',
          height: '100%',
        },
        render: {
          antialias: true,
          roundPixels: false,
        },
        input: {
          mouse: { preventDefaultWheel: false },
        },
      }

      game = new Phaser.Game(config)
      gameRef.current = game
    }

    initGame()

    return () => {
      game?.destroy(true)
      gameRef.current = null
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
    />
  )
}
