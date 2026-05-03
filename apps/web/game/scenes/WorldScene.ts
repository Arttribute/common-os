import Phaser from 'phaser'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import type { WorldObject } from '@/store/worldStore'
import { AgentSprite } from '@/game/entities/AgentSprite'
import { spawnWorldObjects, drawDynamicObject } from '@/game/entities/WorldObject'
import { isoToScreen, isoDepth } from '@/game/systems/pathfinding'
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
  private heldKeys = new Set<string>()

  // Dynamic objects created by agents at runtime
  private dynamicObjectGfx = new Map<string, Phaser.GameObjects.Graphics>()
  private prevObjectIds: Set<string> = new Set()
  // Interaction flash graphics (auto-destroy after animation)
  private interactionFlashes = new Map<string, Phaser.GameObjects.Graphics>()
  // Per-agent wander timer: agentId → timestamp when next wander is allowed
  private wanderTimers = new Map<string, number>()

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

  private isInputFocused(): boolean {
    const el = document.activeElement
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
  }

  update(_time: number, delta: number): void {
    if (!this.isInputFocused()) this.controls.update(delta)
    this._applyWasdPan(delta)

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

    // Rebuild agent visuals on style change — also persist it to each agent record
    if (agentStyle !== this.prevAgentStyle) {
      this.prevAgentStyle = agentStyle
      for (const sprite of this.sprites.values()) {
        sprite.updateStyle(agentStyle)
      }
      agentState.setAllAgentStyles(agentStyle)
    }

    // Sync selection ring
    if (selectedAgentId !== this.prevSelectedId) {
      if (this.prevSelectedId) this.sprites.get(this.prevSelectedId)?.setSelected(false)
      if (selectedAgentId) this.sprites.get(selectedAgentId)?.setSelected(true)
      this.prevSelectedId = selectedAgentId
    }

    // Sync dynamic world objects (agent-created)
    const { objects } = useWorldStore.getState()
    const currentIds = new Set(objects.map(o => o.objectId))
    // Remove destroyed objects
    for (const [id, gfx] of this.dynamicObjectGfx) {
      const baseId = id.endsWith('_lbl') ? id.slice(0, -4) : id
      if (!currentIds.has(baseId)) {
        gfx.destroy()
        this.dynamicObjectGfx.delete(id)
      }
    }
    // Add new objects
    for (const obj of objects) {
      if (!this.dynamicObjectGfx.has(obj.objectId)) {
        this.spawnDynamicObject(obj, rooms)
      }
    }
    this.prevObjectIds = currentIds

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
          agent.style ?? agentStyle,
        )
        sprite.enableInteraction((id) => agentState.selectAgent(id))
        this.sprites.set(agent.agentId, sprite)
      }
      sprite.sync(agent, this.originX, this.originY)
    }

    // Idle wander — move non-busy agents randomly within their room
    const now = Date.now()
    for (const agent of Object.values(agents)) {
      if (agent.status !== 'idle' && agent.status !== 'online') continue
      const nextWander = this.wanderTimers.get(agent.agentId) ?? 0
      if (now < nextWander) continue

      // Schedule next wander: 6–14 s from now
      this.wanderTimers.set(agent.agentId, now + 6000 + Math.random() * 8000)

      const room = rooms.find(r => r.id === agent.world.room)
      if (!room) continue

      const { x: rx, y: ry, w: rw, h: rh } = room.bounds
      const newX = rx + Math.floor(Math.random() * rw)
      const newY = ry + Math.floor(Math.random() * rh)

      // Only wander if position actually changes to avoid spurious redraws
      if (newX !== agent.world.x || newY !== agent.world.y) {
        agentState.updatePosition(agent.agentId, agent.world.room, newX, newY)
      }
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
          agent.style ?? agentStyle,
        )
        sprite.enableInteraction((id) => useAgentStore.getState().selectAgent(id))
        this.sprites.set(agent.agentId, sprite)
      }
    }
  }

  // ─── Dynamic objects ──────────────────────────────────────────────────────

  private spawnDynamicObject(obj: WorldObject, rooms: RoomDef[]): void {
    const room = rooms.find(r => r.id === obj.room)
    if (!room) return

    const tileX = room.bounds.x + obj.x
    const tileY = room.bounds.y + obj.y
    const pos = isoToScreen(tileX, tileY, this.originX, this.originY, TILE_W, TILE_H)
    const gfx = this.add.graphics()
    gfx.setDepth(isoDepth(tileX, tileY) + 20)

    drawDynamicObject(gfx, obj.objectType, pos.x, pos.y)

    if (obj.label) {
      const lbl = this.add.text(pos.x, pos.y + 12, obj.label, {
        fontSize: '9px',
        color: '#a5f3fc',
        fontFamily: 'monospace',
        stroke: '#00000088',
        strokeThickness: 2,
      }).setOrigin(0.5, 0).setDepth(isoDepth(tileX, tileY) + 21).setAlpha(0.85)
      // Store label ref alongside graphics using same key (suffix)
      this.dynamicObjectGfx.set(`${obj.objectId}_lbl`, lbl as unknown as Phaser.GameObjects.Graphics)
    }

    // Spawn-in flash
    this.flashAt(pos.x, pos.y, 0x00ff88, 0.6)

    this.dynamicObjectGfx.set(obj.objectId, gfx)
  }

  flashInteractionAt(room: string, x: number, y: number, rooms: RoomDef[]): void {
    const roomDef = rooms.find(r => r.id === room)
    if (!roomDef) return
    const tileX = roomDef.bounds.x + x
    const tileY = roomDef.bounds.y + y
    const pos = isoToScreen(tileX, tileY, this.originX, this.originY, TILE_W, TILE_H)
    this.flashAt(pos.x, pos.y, 0xfbbf24, 0.7)
  }

  private flashAt(x: number, y: number, color: number, alpha: number): void {
    const flash = this.add.graphics()
    flash.fillStyle(color, alpha)
    flash.fillCircle(x, y, 18)
    flash.setDepth(999)
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 2.5,
      scaleY: 2.5,
      duration: 500,
      ease: 'Power2',
      onComplete: () => flash.destroy(),
    })
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

  private setupCamera(themeId: ThemeId): void {
    this.cameras.main.setBackgroundColor(THEMES[themeId].bgColor)

    const keyboard = this.input.keyboard!
    // Prevent Phaser calling preventDefault() on any key — characters must
    // reach DOM inputs unblocked. enableCapture=false on addKey ensures arrow
    // keys are not captured so text cursor movement works inside inputs.
    keyboard.disableGlobalCapture()

    const arrowUp    = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP,    false)
    const arrowDown  = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN,  false)
    const arrowLeft  = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT,  false)
    const arrowRight = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT, false)

    this.controls = new Phaser.Cameras.Controls.SmoothedKeyControl({
      camera:       this.cameras.main,
      left:         arrowLeft,
      right:        arrowRight,
      up:           arrowUp,
      down:         arrowDown,
      acceleration: 0.06,
      drag:         0.003,
      maxSpeed:     0.5,
    })

    // Mouse wheel zoom
    this.input.on('wheel', (_: unknown, __: unknown, ___: unknown, deltaY: number) => {
      const zoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.35, 2.2)
      this.cameras.main.setZoom(zoom)
    })

    // All letter-key camera controls go through DOM listeners so they are
    // never intercepted while the user is typing in an input field.
    const PAN_SPEED = 6
    const ZOOM_STEP = 0.1
    const PAN_KEYS = new Set(['w', 'a', 's', 'd'])

    const onKeyDown = (e: KeyboardEvent) => {
      if (this.isInputFocused()) return
      const k = e.key.toLowerCase()
      if (PAN_KEYS.has(k)) this.heldKeys.add(k)
      if (k === 'q') this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom + ZOOM_STEP, 0.35, 2.2))
      if (k === 'e') this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom - ZOOM_STEP, 0.35, 2.2))
    }
    const onKeyUp = (e: KeyboardEvent) => {
      this.heldKeys.delete(e.key.toLowerCase())
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    })

    // Apply WASD pan each frame (called from update)
    this._applyWasdPan = (delta: number) => {
      if (this.isInputFocused() || this.heldKeys.size === 0) return
      const cam = this.cameras.main
      const speed = PAN_SPEED * (delta / 16.67)
      if (this.heldKeys.has('w')) cam.scrollY -= speed
      if (this.heldKeys.has('s')) cam.scrollY += speed
      if (this.heldKeys.has('a')) cam.scrollX -= speed
      if (this.heldKeys.has('d')) cam.scrollX += speed
    }
  }

  private _applyWasdPan: (delta: number) => void = () => {}
}
