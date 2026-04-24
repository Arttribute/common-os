import Phaser from 'phaser'
import type { Agent, AgentStatus } from '@/store/agentStore'
import {
  statusToColor,
  roleToColor,
  animationBobAmplitude,
  animationBobDuration,
  type AnimationState,
} from '@/game/systems/animationMapper'
import { isoToScreen, isoDepth } from '@/game/systems/pathfinding'

const TILE_W = 64
const TILE_H = 32

export class AgentSprite {
  readonly agentId: string
  container: Phaser.GameObjects.Container

  private scene: Phaser.Scene
  private body: Phaser.GameObjects.Rectangle
  private head: Phaser.GameObjects.Ellipse
  private statusDot: Phaser.GameObjects.Arc
  private nameLabel: Phaser.GameObjects.Text
  private actionLabel: Phaser.GameObjects.Text
  private bubbleContainer: Phaser.GameObjects.Container
  private bubbleBg: Phaser.GameObjects.Graphics
  private bubbleText: Phaser.GameObjects.Text

  private bodyColor: number
  private bobTween: Phaser.Tweens.Tween | null = null
  private currentAnimState: AnimationState = 'idle'
  private moveTween: Phaser.Tweens.Tween | null = null

  private lastStatus: AgentStatus = 'idle'
  private lastTileX: number
  private lastTileY: number
  private lastSpeechText: string | undefined
  private lastActionText: string | undefined

  constructor(
    scene: Phaser.Scene,
    agentId: string,
    tileX: number,
    tileY: number,
    role: string,
    tier: 'manager' | 'worker',
    originX: number,
    originY: number,
  ) {
    this.scene = scene
    this.agentId = agentId
    this.bodyColor = roleToColor(role, tier)
    this.lastTileX = tileX
    this.lastTileY = tileY

    const pos = isoToScreen(tileX, tileY, originX, originY, TILE_W, TILE_H)

    // Body (rectangle, character body)
    this.body = scene.add.rectangle(0, -18, 24, 32, this.bodyColor).setOrigin(0.5, 0.5)

    // Head (ellipse, on top of body)
    this.head = scene.add.ellipse(0, -44, 20, 20, this.bodyColor)

    // Status dot (small circle above head)
    this.statusDot = scene.add.arc(0, -60, 5, 0, 360, false, 0x10b981)

    // Name label (below feet)
    const shortRole = role.replace('-engineer', '').replace('-', ' ')
    this.nameLabel = scene.add.text(0, 10, shortRole, {
      fontSize: '9px',
      color: '#ffffff',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 0).setAlpha(0.7)

    // Action label (below name)
    this.actionLabel = scene.add.text(0, 22, '', {
      fontSize: '8px',
      color: '#94a3b8',
      fontFamily: 'monospace',
      wordWrap: { width: 80 },
    }).setOrigin(0.5, 0)

    // Speech bubble (above agent, initially hidden)
    this.bubbleBg = scene.add.graphics()
    this.bubbleText = scene.add.text(0, -95, '', {
      fontSize: '9px',
      color: '#ffffff',
      fontFamily: 'monospace',
      wordWrap: { width: 100 },
      align: 'center',
    }).setOrigin(0.5, 1)

    this.bubbleContainer = scene.add.container(0, 0, [this.bubbleBg, this.bubbleText])
    this.bubbleContainer.setVisible(false)

    // Assemble container
    this.container = scene.add.container(pos.x, pos.y, [
      this.body,
      this.head,
      this.statusDot,
      this.nameLabel,
      this.actionLabel,
      this.bubbleContainer,
    ])

    this.container.setDepth(isoDepth(tileX, tileY) + 200)
    this.startBobAnimation('idle')
  }

  sync(agent: Agent, originX: number, originY: number): void {
    // Status change
    if (agent.status !== this.lastStatus) {
      this.lastStatus = agent.status
      const dotColor = statusToColor(agent.status)
      this.statusDot.setFillStyle(dotColor)

      const nextAnim: AnimationState =
        agent.status === 'working' ? 'working'
        : agent.status === 'error' ? 'error'
        : agent.status === 'offline' ? 'offline'
        : 'idle'

      if (nextAnim !== this.currentAnimState) {
        this.startBobAnimation(nextAnim)
      }

      // Dim body when offline
      const alpha = agent.status === 'offline' ? 0.4 : 1
      this.body.setAlpha(alpha)
      this.head.setAlpha(alpha)
    }

    // Position change
    const { x: tileX, y: tileY } = agent.world
    if (tileX !== this.lastTileX || tileY !== this.lastTileY) {
      this.lastTileX = tileX
      this.lastTileY = tileY
      const target = isoToScreen(tileX, tileY, originX, originY, TILE_W, TILE_H)
      this.moveTo(target.x, target.y, isoDepth(tileX, tileY) + 200)
    }

    // Action label
    const actionText = agent.currentAction ?? ''
    if (actionText !== this.lastActionText) {
      this.lastActionText = actionText
      this.actionLabel.setText(actionText ? `· ${actionText}` : '')
    }

    // Speech bubble
    const bubbleText = agent.speechBubble?.text
    if (bubbleText !== this.lastSpeechText) {
      this.lastSpeechText = bubbleText
      if (bubbleText) {
        this.showBubble(bubbleText)
      } else {
        this.hideBubble()
      }
    }
  }

  private moveTo(screenX: number, screenY: number, depth: number): void {
    if (this.moveTween) {
      this.moveTween.stop()
      this.moveTween = null
    }
    this.moveTween = this.scene.tweens.add({
      targets: this.container,
      x: screenX,
      y: screenY,
      duration: 800,
      ease: 'Cubic.easeInOut',
      onComplete: () => {
        this.container.setDepth(depth)
        this.moveTween = null
      },
    })
  }

  private startBobAnimation(state: AnimationState): void {
    this.currentAnimState = state
    if (this.bobTween) {
      this.bobTween.stop()
      this.bobTween = null
    }

    const amp = animationBobAmplitude(state)
    const dur = animationBobDuration(state)
    if (amp === 0 || dur === 0) return

    this.bobTween = this.scene.tweens.add({
      targets: [this.body, this.head],
      y: `+=${amp}`,
      duration: dur,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  private showBubble(text: string): void {
    this.bubbleText.setText(text)

    const padding = 6
    const bw = this.bubbleText.width + padding * 2
    const bh = this.bubbleText.height + padding * 2
    const bx = -bw / 2
    const by = -95 - bh

    this.bubbleBg.clear()
    this.bubbleBg.fillStyle(0x1e293b, 0.95)
    this.bubbleBg.fillRoundedRect(bx, by, bw, bh, 4)
    this.bubbleBg.lineStyle(1, 0x475569, 0.8)
    this.bubbleBg.strokeRoundedRect(bx, by, bw, bh, 4)

    // Tail
    this.bubbleBg.fillStyle(0x1e293b, 0.95)
    this.bubbleBg.fillTriangle(-4, -91, 4, -91, 0, -84)

    this.bubbleText.setY(by + padding)
    this.bubbleContainer.setVisible(true)
  }

  private hideBubble(): void {
    this.bubbleContainer.setVisible(false)
    this.bubbleBg.clear()
  }

  enableInteraction(onSelect: (agentId: string) => void): void {
    this.body.setInteractive({ useHandCursor: true })
    this.body.on('pointerdown', () => onSelect(this.agentId))
    this.head.setInteractive({ useHandCursor: true })
    this.head.on('pointerdown', () => onSelect(this.agentId))
  }

  setSelected(selected: boolean): void {
    const outline = selected ? this.bodyColor : 0x000000
    this.body.setStrokeStyle(selected ? 2 : 0, outline)
  }

  destroy(): void {
    this.bobTween?.stop()
    this.moveTween?.stop()
    this.container.destroy()
  }
}
