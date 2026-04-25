import Phaser from 'phaser'
import type { PlacedObject, ThemeId } from '@/game/systems/worldThemes'
import { isoToScreen, isoDepth } from '@/game/systems/pathfinding'

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
  // Surface shadow
  gfx.fillStyle(0x000000, 0.25)
  gfx.fillEllipse(x + 2, y + 4, 44, 12)
  // Desk legs
  gfx.fillStyle(0x4a3010, 1)
  gfx.fillRect(x - 17, y + 4, 4, 6)
  gfx.fillRect(x + 13, y + 4, 4, 6)
  // Desk surface
  gfx.fillStyle(0x8b6535, 1)
  gfx.fillRoundedRect(x - 20, y - 8, 40, 18, 3)
  // Surface highlight
  gfx.fillStyle(0xa07840, 0.4)
  gfx.fillRoundedRect(x - 18, y - 7, 36, 6, 2)
  // Edge
  gfx.fillStyle(0x5c3d1a, 1)
  gfx.fillRoundedRect(x - 20, y + 7, 40, 4, 2)
  // Monitor
  gfx.fillStyle(0x111118, 1)
  gfx.fillRoundedRect(x - 7, y - 22, 14, 14, 2)
  // Screen glow
  gfx.fillStyle(0x2050e0, 0.7)
  gfx.fillRect(x - 5, y - 20, 10, 9)
  gfx.fillStyle(0x6090ff, 0.3)
  gfx.fillRect(x - 5, y - 20, 4, 3)
  // Stand
  gfx.fillStyle(0x444, 1)
  gfx.fillRect(x - 1, y - 8, 2, 5)
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
