import Phaser from 'phaser'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import { AgentSprite } from '@/game/entities/AgentSprite'
import { spawnWorldObjects } from '@/game/entities/WorldObject'
import { isoToScreen } from '@/game/systems/pathfinding'
import { THEMES } from '@/game/systems/worldThemes'
import type { ThemeId, AgentStyle } from '@/game/systems/worldThemes'

const TILE_W = 64
const TILE_H = 32
const WORLD_W = 22
const WORLD_H = 18

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
  private prevTheme: ThemeId = 'office'
  private prevAgentStyle: AgentStyle = 'robot'

  private bgGraphics!: Phaser.GameObjects.Graphics
  private labelGroup!: Phaser.GameObjects.Group
  private objectGfxList: Phaser.GameObjects.Graphics[] = []

  constructor() {
    super({ key: 'WorldScene' })
  }

  create(): void {
    const { width, height } = this.scale
    this.originX = width / 2 - 80
    this.originY = height * 0.14

    const { rooms, theme, agentStyle } = useWorldStore.getState()
    this.prevTheme = theme
    this.prevAgentStyle = agentStyle

    this.bgGraphics = this.add.graphics()
    this.labelGroup = this.add.group()

    this.buildBackground(rooms, theme)
    this.buildObjects(rooms, theme)
    this.spawnAgentsFromStore()
    this.setupCamera(theme)

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.downElement !== this.game.canvas) return
      useAgentStore.getState().selectAgent(null)
    })
  }

  update(_time: number, delta: number): void {
    this.controls.update(delta)

    const { theme, agentStyle, rooms } = useWorldStore.getState()
    const agentState = useAgentStore.getState()
    const { agents, selectedAgentId } = agentState

    // Rebuild world visuals on theme change
    if (theme !== this.prevTheme) {
      this.prevTheme = theme
      this.cameras.main.setBackgroundColor(THEMES[theme].bgColor)
      this.buildBackground(rooms, theme)
      this.buildObjects(rooms, theme)
    }

    // Rebuild agent visuals on style change
    if (agentStyle !== this.prevAgentStyle) {
      this.prevAgentStyle = agentStyle
      for (const sprite of this.sprites.values()) {
        sprite.updateStyle(agentStyle)
      }
    }

    // Sync selection ring
    if (selectedAgentId !== this.prevSelectedId) {
      if (this.prevSelectedId) this.sprites.get(this.prevSelectedId)?.setSelected(false)
      if (selectedAgentId) this.sprites.get(selectedAgentId)?.setSelected(true)
      this.prevSelectedId = selectedAgentId
    }

    // Spawn new sprites or sync existing
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
          agentStyle,
        )
        sprite.enableInteraction((id) => agentState.selectAgent(id))
        this.sprites.set(agent.agentId, sprite)
      }
      sprite.sync(agent, this.originX, this.originY)
    }
  }

  // ─── Background ───────────────────────────────────────────────────────────

  private buildBackground(rooms: RoomDef[], themeId: ThemeId): void {
    const theme = THEMES[themeId]
    this.bgGraphics.clear()
    this.bgGraphics.setDepth(0)

    for (let tx = 0; tx < WORLD_W; tx++) {
      for (let ty = 0; ty < WORLD_H; ty++) {
        const room = rooms.find(
          r => tx >= r.bounds.x && tx < r.bounds.x + r.bounds.w &&
               ty >= r.bounds.y && ty < r.bounds.y + r.bounds.h,
        )

        let fill: number
        let gridLine: number
        let gridAlpha: number

        if (room) {
          const rt = theme.rooms[room.id] ?? Object.values(theme.rooms)[0]!
          fill = rt.fill
          gridLine = rt.gridLine
          gridAlpha = theme.gridAlpha + 0.15
        } else {
          const checker = (tx + ty) % 2 === 0
          fill = checker ? theme.floorA : theme.floorB
          gridLine = theme.gridLine
          gridAlpha = theme.gridAlpha
        }

        const pos = isoToScreen(tx, ty, this.originX, this.originY, TILE_W, TILE_H)
        this.drawTile(this.bgGraphics, Math.round(pos.x), Math.round(pos.y), fill, gridLine, gridAlpha)
      }
    }

    // Room border outlines — drawn on top of floor tiles for crisp separation
    for (const room of rooms) {
      const rt = theme.rooms[room.id]
      if (!rt) continue
      const { x: rx, y: ry, w: rw, h: rh } = room.bounds
      const hw = TILE_W / 2
      const hh = TILE_H / 2

      const tl = isoToScreen(rx,          ry,          this.originX, this.originY, TILE_W, TILE_H)
      const tr = isoToScreen(rx + rw - 1, ry,          this.originX, this.originY, TILE_W, TILE_H)
      const br = isoToScreen(rx + rw - 1, ry + rh - 1, this.originX, this.originY, TILE_W, TILE_H)
      const bl = isoToScreen(rx,          ry + rh - 1, this.originX, this.originY, TILE_W, TILE_H)

      this.bgGraphics.lineStyle(1.5, rt.gridLine, 0.9)
      this.bgGraphics.beginPath()
      this.bgGraphics.moveTo(Math.round(tl.x),      Math.round(tl.y - hh))
      this.bgGraphics.lineTo(Math.round(tr.x + hw), Math.round(tr.y))
      this.bgGraphics.lineTo(Math.round(br.x),      Math.round(br.y + hh))
      this.bgGraphics.lineTo(Math.round(bl.x - hw), Math.round(bl.y))
      this.bgGraphics.closePath()
      this.bgGraphics.strokePath()
    }

    // Room labels
    this.labelGroup.clear(true, true)
    for (const room of rooms) {
      const rt = theme.rooms[room.id]
      if (!rt) continue
      const cx = room.bounds.x + room.bounds.w / 2
      const cy = room.bounds.y + room.bounds.h / 2
      const pos = isoToScreen(cx, cy, this.originX, this.originY, TILE_W, TILE_H)
      const labelText = theme.roomLabels[room.id] ?? room.label
      const hex = '#' + rt.labelColor.toString(16).padStart(6, '0')

      const lbl = this.add.text(Math.round(pos.x), Math.round(pos.y + TILE_H * 1.5), labelText.toUpperCase(), {
        fontSize: '10px',
        color: hex,
        fontFamily: 'monospace',
        letterSpacing: 2,
        stroke: '#00000088',
        strokeThickness: 2,
      }).setOrigin(0.5, 0.5).setDepth(1).setAlpha(0.7)

      this.labelGroup.add(lbl)
    }
  }

  private drawTile(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    fillColor: number,
    lineColor: number,
    lineAlpha: number,
  ): void {
    const hw = TILE_W / 2
    const hh = TILE_H / 2
    const pts = [
      { x: cx,      y: cy - hh },
      { x: cx + hw, y: cy      },
      { x: cx,      y: cy + hh },
      { x: cx - hw, y: cy      },
    ]

    g.fillStyle(fillColor, 1)
    g.fillPoints(pts, true)

    g.lineStyle(1, lineColor, lineAlpha)
    g.strokePoints(pts, true)
  }

  // ─── Objects ──────────────────────────────────────────────────────────────

  private buildObjects(rooms: RoomDef[], themeId: ThemeId): void {
    for (const gfx of this.objectGfxList) gfx.destroy()
    this.objectGfxList = []

    const theme = THEMES[themeId]
    this.objectGfxList = spawnWorldObjects(
      this,
      theme.objects,
      rooms,
      this.originX,
      this.originY,
      themeId,
    )
  }

  // ─── Agents ───────────────────────────────────────────────────────────────

  private spawnAgentsFromStore(): void {
    const { agents } = useAgentStore.getState()
    const { agentStyle } = useWorldStore.getState()
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
          agentStyle,
        )
        sprite.enableInteraction((id) => useAgentStore.getState().selectAgent(id))
        this.sprites.set(agent.agentId, sprite)
      }
    }
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

  private setupCamera(themeId: ThemeId): void {
    this.cameras.main.setBackgroundColor(THEMES[themeId].bgColor)

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
      zoomIn:       keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      zoomOut:      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      acceleration: 0.06,
      drag:         0.003,
      maxSpeed:     0.5,
    })

    // Mouse wheel zoom
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, deltaY: number) => {
      const zoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.35, 2.2)
      this.cameras.main.setZoom(zoom)
    })

    // WASD also works
    void wasd
  }
}
