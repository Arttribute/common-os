import Phaser from 'phaser'

// Phaser overlay scene for fixed-position UI elements (tooltips, notifications).
// Speech bubbles live on agent sprites in WorldScene since they follow camera movement.
export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene', active: false })
  }

  create(): void {
    // Reserved for fixed HUD overlays drawn in Phaser (e.g. minimap, notifications).
    // The primary HUD is React (FleetPanel, Inspector, CommandBar) sitting above the canvas.
  }
}
