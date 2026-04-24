import Phaser from 'phaser'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import { AgentSprite } from '@/game/entities/AgentSprite'
import { isoToScreen } from '@/game/systems/pathfinding'

const TILE_W = 64
const TILE_H = 32

// Room color palette
const ROOM_COLORS: Record<string, { fill: number; line: number; label: number }> = {
  'dev-room':     { fill: 0x0d1b2a, line: 0x1a3a5c, label: 0x38bdf8 },
  'design-room':  { fill: 0x0d2016, line: 0x1a4a2e, label: 0x4ade80 },
  'meeting-room': { fill: 0x1e0d2a, line: 0x3a1a5c, label: 0xa78bfa },
}
const FLOOR_COLOR  = { fill: 0x0a0f1a, line: 0x151e2e }

interface RoomDef {
  id: string
  label: string
  bounds: { x: number; y: number; w: number; h: number }
}

export class WorldScene extends Phaser.Scene {
  private sprites = new Map<string, AgentSprite>()
  private originX = 0
  private originY = 0
  private controls!: Phaser.Cameras.Controls.SmoothedKeyControl
  private prevSelectedId: string | null = null

  constructor() {
    super({ key: 'WorldScene' })
  }

  create(): void {
    const { width, height } = this.scale
    // Center the ~20×16 tile world (1088×544px screen footprint)
    this.originX = width / 2 - 64
    this.originY = height * 0.12

    const { rooms } = useWorldStore.getState()

    this.drawBackground(rooms)
    this.drawRoomLabels(rooms)
    this.spawnAgentsFromStore()
    this.setupCamera()

    // Click on empty space deselects
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.downElement) return
      const canvas = this.game.canvas
      if (pointer.downElement !== canvas) return
      useAgentStore.getState().selectAgent(null)
    })
  }

  update(_time: number, delta: number): void {
    this.controls.update(delta)

    const agentState = useAgentStore.getState()
    const { agents, selectedAgentId } = agentState

    // Sync selection visual
    if (selectedAgentId !== this.prevSelectedId) {
      if (this.prevSelectedId) this.sprites.get(this.prevSelectedId)?.setSelected(false)
      if (selectedAgentId) this.sprites.get(selectedAgentId)?.setSelected(true)
      this.prevSelectedId = selectedAgentId
    }

    // Spawn new sprites or sync existing ones
    for (const agent of Object.values(agents)) {
      let sprite = this.sprites.get(agent.agentId)
      if (!sprite) {
        sprite = new AgentSprite(
          this,
          agent.agentId,
          agent.world.x,
          agent.world.y,
          agent.role,
          agent.permissionTier,
          this.originX,
          this.originY,
        )
        sprite.enableInteraction((id) => agentState.selectAgent(id))
        this.sprites.set(agent.agentId, sprite)
      }
      sprite.sync(agent, this.originX, this.originY)
    }
  }

  private drawBackground(rooms: RoomDef[]): void {
    const g = this.add.graphics()
    g.setDepth(0)

    // Draw world floor (20×16 background tiles)
    for (let tx = 0; tx < 20; tx++) {
      for (let ty = 0; ty < 16; ty++) {
        const room = rooms.find(
          (r) =>
            tx >= r.bounds.x &&
            tx < r.bounds.x + r.bounds.w &&
            ty >= r.bounds.y &&
            ty < r.bounds.y + r.bounds.h,
        )
        const colors = room
          ? (ROOM_COLORS[room.id] ?? ROOM_COLORS['dev-room'])
          : FLOOR_COLOR

        const pos = isoToScreen(tx, ty, this.originX, this.originY, TILE_W, TILE_H)
        this.drawTile(g, pos.x, pos.y, colors.fill, colors.line)
      }
    }
  }

  private drawTile(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    fillColor: number,
    lineColor: number,
  ): void {
    const hw = TILE_W / 2
    const hh = TILE_H / 2

    g.fillStyle(fillColor, 1)
    g.fillPoints(
      [
        { x: cx,      y: cy - hh },
        { x: cx + hw, y: cy      },
        { x: cx,      y: cy + hh },
        { x: cx - hw, y: cy      },
      ],
      true,
    )

    g.lineStyle(0.5, lineColor, 0.6)
    g.strokePoints(
      [
        { x: cx,      y: cy - hh },
        { x: cx + hw, y: cy      },
        { x: cx,      y: cy + hh },
        { x: cx - hw, y: cy      },
      ],
      true,
    )
  }

  private drawRoomLabels(rooms: RoomDef[]): void {
    for (const room of rooms) {
      const { bounds } = room
      // Center tile of the room
      const cx = bounds.x + bounds.w / 2
      const cy = bounds.y + bounds.h / 2
      const pos = isoToScreen(cx, cy, this.originX, this.originY, TILE_W, TILE_H)

      const colors = ROOM_COLORS[room.id] ?? { label: 0xffffff }
      const hex = '#' + colors.label.toString(16).padStart(6, '0')

      this.add
        .text(pos.x, pos.y + TILE_H * 1.5, room.label.toUpperCase(), {
          fontSize: '9px',
          color: hex,
          fontFamily: 'monospace',
          letterSpacing: 2,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(1)
        .setAlpha(0.4)
    }
  }

  private spawnAgentsFromStore(): void {
    const { agents } = useAgentStore.getState()
    for (const agent of Object.values(agents)) {
      if (!this.sprites.has(agent.agentId)) {
        const sprite = new AgentSprite(
          this,
          agent.agentId,
          agent.world.x,
          agent.world.y,
          agent.role,
          agent.permissionTier,
          this.originX,
          this.originY,
        )
        sprite.enableInteraction((id) => useAgentStore.getState().selectAgent(id))
        this.sprites.set(agent.agentId, sprite)
      }
    }
  }

  private setupCamera(): void {
    this.cameras.main.setBackgroundColor(0x060b14)

    const keyboard = this.input.keyboard!
    const cursors = keyboard.createCursorKeys()
    const wasd = keyboard.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.W,
      down:  Phaser.Input.Keyboard.KeyCodes.S,
      left:  Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Phaser.Types.Input.Keyboard.CursorKeys

    this.controls = new Phaser.Cameras.Controls.SmoothedKeyControl({
      camera:       this.cameras.main,
      left:         cursors.left,
      right:        cursors.right,
      up:           cursors.up,
      down:         cursors.down,
      acceleration: 0.06,
      drag:         0.003,
      maxSpeed:     0.5,
    })

    // Mouse wheel zoom
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, deltaY: number) => {
      const zoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.4, 2.0)
      this.cameras.main.setZoom(zoom)
    })
  }
}
