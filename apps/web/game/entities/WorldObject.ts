import Phaser from 'phaser'
import type { PlacedObject, ThemeId } from '@/game/systems/worldThemes'
import { isoToScreen, isoDepth } from '@/game/systems/pathfinding'

// Agent-created object types (dynamic, persisted in worldState.objects)
const DYNAMIC_OBJECT_TYPES = new Set([
  'desk', 'server-rack', 'plant', 'treadmill', 'machine', 'barrel', 'bookshelf',
  'whiteboard', 'terminal', 'artifact', 'checkpoint', 'note',
])

export function drawDynamicObject(
  gfx: Phaser.GameObjects.Graphics,
  type: string,
  x: number,
  y: number,
  label?: string,
): void {
  switch (type) {
    case 'whiteboard': drawWhiteboard(gfx, x, y); break
    case 'terminal':   drawTerminal(gfx, x, y);   break
    case 'artifact':   drawArtifact(gfx, x, y);   break
    case 'checkpoint': drawCheckpoint(gfx, x, y); break
    case 'note':       drawNote(gfx, x, y);       break
    default:           drawArtifact(gfx, x, y);   break
  }

  if (label) {
    // Labels are drawn via text overlay in WorldScene; gfx can't render text
  }
}

function drawWhiteboard(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  gfx.fillStyle(0x000000, 0.2)
  gfx.fillEllipse(x + 2, y + 4, 44, 10)
  // Frame
  gfx.fillStyle(0x334155, 1)
  gfx.fillRoundedRect(x - 20, y - 28, 40, 32, 2)
  // Board surface
  gfx.fillStyle(0xf1f5f9, 1)
  gfx.fillRect(x - 17, y - 25, 34, 24)
  // Agent-written content lines
  gfx.fillStyle(0x3b82f6, 0.8)
  gfx.fillRect(x - 13, y - 20, 20, 2)
  gfx.fillRect(x - 13, y - 16, 14, 2)
  gfx.fillStyle(0x10b981, 0.8)
  gfx.fillRect(x - 13, y - 12, 18, 2)
  gfx.fillStyle(0xf59e0b, 0.8)
  gfx.fillRect(x - 13, y - 8, 10, 2)
  gfx.fillRect(x - 13, y - 4, 16, 2)
  // Marker tray
  gfx.fillStyle(0x1e293b, 1)
  gfx.fillRect(x - 17, y - 2, 34, 4)
  // Legs
  gfx.fillStyle(0x475569, 1)
  gfx.fillRect(x - 8, y + 2, 3, 8)
  gfx.fillRect(x + 5, y + 2, 3, 8)
}

function drawTerminal(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  gfx.fillStyle(0x000000, 0.25)
  gfx.fillEllipse(x, y + 4, 38, 10)
  // Body
  gfx.fillStyle(0x0f172a, 1)
  gfx.fillRoundedRect(x - 17, y - 24, 34, 28, 3)
  // Screen
  gfx.fillStyle(0x001a00, 1)
  gfx.fillRect(x - 14, y - 21, 28, 18)
  // Green terminal text
  gfx.fillStyle(0x00ff41, 0.9)
  gfx.fillRect(x - 12, y - 19, 8, 1)
  gfx.fillRect(x - 12, y - 17, 14, 1)
  gfx.fillRect(x - 12, y - 15, 10, 1)
  gfx.fillRect(x - 12, y - 13, 16, 1)
  gfx.fillRect(x - 12, y - 11, 6, 1)
  // Cursor blink
  gfx.fillStyle(0x00ff41, 1)
  gfx.fillRect(x - 12, y - 8, 4, 2)
  // Keyboard base
  gfx.fillStyle(0x1e293b, 1)
  gfx.fillRoundedRect(x - 15, y + 2, 30, 5, 1)
}

function drawArtifact(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // A glowing data crystal — represents a completed artifact/output
  gfx.fillStyle(0x000000, 0.15)
  gfx.fillEllipse(x, y + 6, 24, 8)
  // Outer glow
  gfx.fillStyle(0x6366f1, 0.2)
  gfx.fillCircle(x, y - 6, 16)
  // Crystal body
  gfx.fillStyle(0x818cf8, 1)
  const pts = [
    { x, y: y - 18 },
    { x: x + 10, y: y - 4 },
    { x: x + 6, y: y + 4 },
    { x: x - 6, y: y + 4 },
    { x: x - 10, y: y - 4 },
  ]
  gfx.fillPoints(pts, true)
  // Inner facet
  gfx.fillStyle(0xc7d2fe, 0.6)
  gfx.fillTriangle(x, y - 16, x + 7, y - 4, x - 7, y - 4)
  // Shine
  gfx.fillStyle(0xffffff, 0.4)
  gfx.fillCircle(x - 3, y - 12, 3)
}

function drawCheckpoint(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // A flag/marker — represents a task checkpoint or milestone
  gfx.fillStyle(0x000000, 0.2)
  gfx.fillEllipse(x, y + 4, 16, 6)
  // Pole
  gfx.fillStyle(0x64748b, 1)
  gfx.fillRect(x - 1, y - 20, 2, 24)
  // Flag
  gfx.fillStyle(0x10b981, 1)
  const flag = [
    { x: x + 1, y: y - 20 },
    { x: x + 16, y: y - 14 },
    { x: x + 1, y: y - 8 },
  ]
  gfx.fillPoints(flag, true)
  // Checkmark on flag
  gfx.lineStyle(1.5, 0xffffff, 1)
  gfx.beginPath()
  gfx.moveTo(x + 5, y - 14)
  gfx.lineTo(x + 8, y - 11)
  gfx.lineTo(x + 13, y - 18)
  gfx.strokePath()
}

function drawNote(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // Post-it style note
  gfx.fillStyle(0x000000, 0.15)
  gfx.fillEllipse(x, y + 4, 28, 8)
  // Paper shadow
  gfx.fillStyle(0xca8a04, 0.3)
  gfx.fillRect(x - 11, y - 14, 22, 18)
  // Paper
  gfx.fillStyle(0xfef08a, 1)
  gfx.fillRect(x - 12, y - 16, 22, 18)
  // Lines
  gfx.fillStyle(0xca8a04, 0.5)
  gfx.fillRect(x - 9, y - 12, 14, 1)
  gfx.fillRect(x - 9, y - 9, 10, 1)
  gfx.fillRect(x - 9, y - 6, 12, 1)
  gfx.fillRect(x - 9, y - 3, 8, 1)
  // Fold corner
  gfx.fillStyle(0xfde047, 1)
  gfx.fillTriangle(x + 4, y + 2, x + 10, y + 2, x + 10, y - 4)
  gfx.fillStyle(0xca8a04, 0.3)
  gfx.fillTriangle(x + 4, y + 2, x + 10, y + 2, x + 10, y - 4)
}

void DYNAMIC_OBJECT_TYPES

const TILE_W = 64
const TILE_H = 32

export function spawnWorldObjects(
  scene: Phaser.Scene,
  objects: PlacedObject[],
  rooms: Array<{ id: string; bounds: { x: number; y: number; w: number; h: number } }>,
  originX: number,
  originY: number,
  themeId: ThemeId,
): Phaser.GameObjects.Graphics[] {
  const spawned: Phaser.GameObjects.Graphics[] = []

  for (const obj of objects) {
    const room = rooms.find(r => r.id === obj.roomId)
    if (!room) continue

    const tileX = room.bounds.x + obj.relX
    const tileY = room.bounds.y + obj.relY
    if (
      tileX < room.bounds.x || tileX >= room.bounds.x + room.bounds.w ||
      tileY < room.bounds.y || tileY >= room.bounds.y + room.bounds.h
    ) continue

    const pos = isoToScreen(tileX, tileY, originX, originY, TILE_W, TILE_H)
    const gfx = scene.add.graphics()
    gfx.setDepth(isoDepth(tileX, tileY) + 20)

    drawObject(gfx, obj.type, pos.x, pos.y, themeId)
    spawned.push(gfx)
  }

  return spawned
}

function drawObject(
  gfx: Phaser.GameObjects.Graphics,
  type: PlacedObject['type'],
  x: number,
  y: number,
  _themeId: ThemeId,
): void {
  switch (type) {
    case 'desk':        drawDesk(gfx, x, y);       break
    case 'server-rack': drawServerRack(gfx, x, y); break
    case 'plant':       drawPlant(gfx, x, y);      break
    case 'treadmill':   drawTreadmill(gfx, x, y);  break
    case 'machine':     drawMachine(gfx, x, y);    break
    case 'barrel':      drawBarrel(gfx, x, y);     break
    case 'bookshelf':   drawBookshelf(gfx, x, y);  break
  }
}

function drawDesk(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // Shadow
  gfx.fillStyle(0x000000, 0.25)
  gfx.fillEllipse(x + 2, y + 4, 46, 12)

  // Desk legs
  gfx.fillStyle(0x4a3010, 1)
  gfx.fillRect(x - 17, y + 4, 4, 6)
  gfx.fillRect(x + 13, y + 4, 4, 6)

  // Desk surface
  gfx.fillStyle(0x8b6535, 1)
  gfx.fillRoundedRect(x - 20, y - 8, 40, 18, 3)
  gfx.fillStyle(0xa07840, 0.4)
  gfx.fillRoundedRect(x - 18, y - 7, 36, 6, 2)
  gfx.fillStyle(0x5c3d1a, 1)
  gfx.fillRoundedRect(x - 20, y + 7, 40, 4, 2)

  // Keyboard — top face
  gfx.fillStyle(0xdedad2, 1)
  gfx.fillRoundedRect(x - 9, y - 10, 18, 5, 1)
  // Keyboard — front edge
  gfx.fillStyle(0xb8b5ac, 1)
  gfx.fillRect(x - 9, y - 6, 18, 2)
  // Keys (two rows of small dots)
  gfx.fillStyle(0xc4c1b8, 1)
  for (let col = 0; col < 5; col++) {
    gfx.fillRect(x - 7 + col * 3, y - 9, 2, 1)
    gfx.fillRect(x - 6 + col * 3, y - 7, 2, 1)
  }

  // Monitor stand
  gfx.fillStyle(0x333338, 1)
  gfx.fillRect(x - 2, y - 8, 4, 7)
  gfx.fillRect(x - 5, y - 4, 10, 2)

  // Monitor bezel (larger)
  gfx.fillStyle(0x18181f, 1)
  gfx.fillRoundedRect(x - 13, y - 36, 26, 26, 3)

  // Screen background
  gfx.fillStyle(0x0d1b3e, 1)
  gfx.fillRect(x - 11, y - 34, 22, 21)

  // Code lines on screen
  gfx.fillStyle(0x00e676, 0.8)
  gfx.fillRect(x - 9, y - 32, 14, 1)
  gfx.fillRect(x - 9, y - 30, 9,  1)
  gfx.fillStyle(0x4fc3f7, 0.7)
  gfx.fillRect(x - 9, y - 28, 16, 1)
  gfx.fillRect(x - 9, y - 26, 11, 1)
  gfx.fillStyle(0xffd54f, 0.6)
  gfx.fillRect(x - 9, y - 24, 7,  1)
  gfx.fillRect(x - 9, y - 22, 13, 1)
  gfx.fillStyle(0xef9a9a, 0.6)
  gfx.fillRect(x - 9, y - 20, 10, 1)

  // Screen glare
  gfx.fillStyle(0xffffff, 0.06)
  gfx.fillRect(x - 11, y - 34, 7, 6)
}

function drawServerRack(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // Shadow
  gfx.fillStyle(0x000000, 0.3)
  gfx.fillEllipse(x + 2, y + 2, 28, 8)
  // Cabinet body
  gfx.fillStyle(0x111115, 1)
  gfx.fillRoundedRect(x - 12, y - 32, 24, 34, 3)
  // Door frame
  gfx.fillStyle(0x1e1e28, 1)
  gfx.fillRoundedRect(x - 10, y - 30, 20, 30, 2)
  // Rack units
  const ledColors = [0x00ff41, 0x00ff41, 0xff6600, 0x00ff41, 0xffff00]
  for (let i = 0; i < 5; i++) {
    gfx.fillStyle(0x252530, 1)
    gfx.fillRect(x - 9, y - 28 + i * 6, 18, 4)
    // LED
    gfx.fillStyle(ledColors[i]!, 1)
    gfx.fillCircle(x + 6, y - 26 + i * 6, 1.5)
    // Slot line
    gfx.fillStyle(0x333, 1)
    gfx.fillRect(x - 7, y - 26 + i * 6, 10, 1)
  }
  // Top handle
  gfx.fillStyle(0x333338, 1)
  gfx.fillRect(x - 10, y - 32, 20, 3)
}

function drawPlant(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // Shadow
  gfx.fillStyle(0x000000, 0.2)
  gfx.fillEllipse(x + 1, y + 4, 20, 7)
  // Pot
  gfx.fillStyle(0x8b4513, 1)
  gfx.fillRoundedRect(x - 7, y - 4, 14, 10, 2)
  gfx.fillStyle(0x6b3510, 1)
  gfx.fillRect(x - 5, y - 2, 10, 8)
  // Soil
  gfx.fillStyle(0x3d2010, 1)
  gfx.fillEllipse(x, y - 2, 12, 5)
  // Back leaves
  gfx.fillStyle(0x166534, 0.7)
  gfx.fillCircle(x - 5, y - 14, 7)
  gfx.fillCircle(x + 5, y - 14, 7)
  // Main foliage
  gfx.fillStyle(0x16a34a, 1)
  gfx.fillCircle(x, y - 18, 10)
  // Side foliage
  gfx.fillStyle(0x15803d, 0.9)
  gfx.fillCircle(x - 7, y - 13, 6)
  gfx.fillCircle(x + 7, y - 13, 6)
  // Highlight
  gfx.fillStyle(0x4ade80, 0.35)
  gfx.fillCircle(x - 3, y - 21, 4)
}

function drawTreadmill(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // Shadow
  gfx.fillStyle(0x000000, 0.25)
  gfx.fillEllipse(x, y + 6, 52, 12)
  // Handles
  gfx.fillStyle(0x666, 1)
  gfx.fillRect(x - 22, y - 26, 4, 24)
  gfx.fillRect(x + 18, y - 26, 4, 24)
  gfx.fillRoundedRect(x - 18, y - 26, 36, 4, 2)
  // Console
  gfx.fillStyle(0x1a1a22, 1)
  gfx.fillRoundedRect(x - 9, y - 34, 18, 12, 2)
  gfx.fillStyle(0x0055dd, 0.8)
  gfx.fillRect(x - 7, y - 32, 14, 7)
  gfx.fillStyle(0x88aaff, 0.5)
  gfx.fillRect(x - 7, y - 32, 5, 2)
  // Belt frame
  gfx.fillStyle(0x1a1a1a, 1)
  gfx.fillRoundedRect(x - 24, y - 8, 48, 16, 5)
  // Belt surface
  gfx.fillStyle(0x222, 1)
  gfx.fillRoundedRect(x - 20, y - 6, 40, 12, 4)
  // Belt lines
  for (let i = 0; i < 6; i++) {
    gfx.fillStyle(0x383838, 1)
    gfx.fillRect(x - 17 + i * 6, y - 5, 3, 10)
  }
}

function drawMachine(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // Shadow
  gfx.fillStyle(0x000000, 0.3)
  gfx.fillEllipse(x + 2, y + 4, 42, 12)
  // Base
  gfx.fillStyle(0x1a1a16, 1)
  gfx.fillRoundedRect(x - 19, y - 2, 38, 8, 2)
  // Main body
  gfx.fillStyle(0x28261e, 1)
  gfx.fillRoundedRect(x - 18, y - 30, 36, 32, 3)
  // Top panel
  gfx.fillStyle(0x38342a, 1)
  gfx.fillRect(x - 15, y - 28, 30, 8)
  // Vents
  for (let i = 0; i < 4; i++) {
    gfx.fillStyle(0x111, 1)
    gfx.fillRect(x - 12 + i * 7, y - 26, 5, 4)
  }
  // Warning stripe
  gfx.fillStyle(0xf59e0b, 1)
  gfx.fillRect(x - 18, y - 6, 36, 5)
  gfx.fillStyle(0x1a1a1a, 0.7)
  for (let i = 0; i < 5; i++) {
    gfx.fillRect(x - 15 + i * 7, y - 6, 4, 5)
  }
  // Bolt corners
  gfx.fillStyle(0x555, 1)
  gfx.fillCircle(x - 14, y - 24, 2.5)
  gfx.fillCircle(x + 14, y - 24, 2.5)
  gfx.fillCircle(x - 14, y - 8, 2.5)
  gfx.fillCircle(x + 14, y - 8, 2.5)
}

function drawBarrel(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // Shadow
  gfx.fillStyle(0x000000, 0.2)
  gfx.fillEllipse(x + 1, y + 4, 26, 9)
  // Main barrel
  gfx.fillStyle(0x7c5c14, 1)
  gfx.fillEllipse(x, y - 6, 22, 26)
  // Side shading
  gfx.fillStyle(0x5a4010, 0.5)
  gfx.fillEllipse(x + 5, y - 6, 8, 22)
  // Hoops
  gfx.fillStyle(0x888, 1)
  gfx.fillRoundedRect(x - 11, y - 16, 22, 3, 1)
  gfx.fillRoundedRect(x - 11, y - 2, 22, 3, 1)
  gfx.fillRoundedRect(x - 11, y + 4, 22, 3, 1)
  // Top
  gfx.fillStyle(0x9a7020, 1)
  gfx.fillEllipse(x, y - 17, 22, 8)
  // Top highlight
  gfx.fillStyle(0xcc9930, 0.4)
  gfx.fillEllipse(x - 3, y - 18, 10, 4)
}

function drawBookshelf(gfx: Phaser.GameObjects.Graphics, x: number, y: number): void {
  // Shadow
  gfx.fillStyle(0x000000, 0.25)
  gfx.fillEllipse(x + 2, y + 4, 42, 10)
  // Back panel
  gfx.fillStyle(0x4a3018, 1)
  gfx.fillRoundedRect(x - 20, y - 32, 40, 36, 2)
  // Shelf boards
  for (let i = 0; i < 3; i++) {
    gfx.fillStyle(0x6b4820, 1)
    gfx.fillRect(x - 18, y - 22 + i * 12, 36, 3)
  }
  // Books per shelf
  const bookColors = [
    [0xe05050, 0x4060d0, 0x50c050, 0xe0a030, 0xb050d0],
    [0xe06080, 0x50b0e0, 0xd0c030, 0x60d080, 0xe07030],
    [0x9060c0, 0xe08040, 0x50c0b0, 0xe04060, 0x70a0e0],
  ]
  for (let shelf = 0; shelf < 3; shelf++) {
    for (let b = 0; b < 5; b++) {
      const h = 7 + (b % 3)
      gfx.fillStyle(bookColors[shelf]![b]!, 0.9)
      gfx.fillRect(x - 16 + b * 7, y - 31 + shelf * 12, 5, h)
      // Book spine highlight
      gfx.fillStyle(0xffffff, 0.15)
      gfx.fillRect(x - 16 + b * 7, y - 31 + shelf * 12, 1, h)
    }
  }
  // Side panels
  gfx.fillStyle(0x5c3c1c, 1)
  gfx.fillRect(x - 20, y - 32, 3, 36)
  gfx.fillRect(x + 17, y - 32, 3, 36)
}
