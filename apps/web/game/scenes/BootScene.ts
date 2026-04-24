import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload(): void {
    // No external assets yet — world is rendered programmatically.
    // When Kenney tileset is added, preload here:
    // this.load.image('tileset', '/assets/tileset.png')
    // this.load.spritesheet('agent', '/assets/agent.png', { frameWidth: 32, frameHeight: 48 })
  }

  create(): void {
    this.scene.start('WorldScene')
  }
}
