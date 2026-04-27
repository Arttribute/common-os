import Phaser from "phaser";
import type { Agent, AgentStatus } from "@/store/agentStore";
import type { AgentStyle } from "@/game/systems/worldThemes";
import {
  statusToColor,
  roleToColor,
  animationBobAmplitude,
  animationBobDuration,
} from "@/game/systems/animationMapper";
import { isoToScreen, isoDepth } from "@/game/systems/pathfinding";

const TILE_W = 64;
const TILE_H = 32;

// Lighten a hex color by a factor
function lighten(color: number, amount: number): number {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (color & 0xff) + amount));
  return (r << 16) | (g << 8) | b;
}

export class AgentSprite {
  readonly agentId: string;
  container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private charGfx: Phaser.GameObjects.Graphics;
  private selectedGfx: Phaser.GameObjects.Graphics;
  private nameLabel: Phaser.GameObjects.Text;
  private actionLabel: Phaser.GameObjects.Text;
  private bubbleContainer: Phaser.GameObjects.Container;
  private bubbleBg: Phaser.GameObjects.Graphics;
  private bubbleText: Phaser.GameObjects.Text;

  private bodyColor: number;
  private role: string;
  private tier: "manager" | "worker";
  private style: AgentStyle = "person";

  private bobTween: Phaser.Tweens.Tween | null = null;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private pulseTween: Phaser.Tweens.Tween | null = null;

  private lastStatus: AgentStatus = "idle";
  private lastTileX: number;
  private lastTileY: number;
  private lastSpeechText: string | undefined;
  private lastActionText: string | undefined;
  private isSelected = false;

  constructor(
    scene: Phaser.Scene,
    agentId: string,
    tileX: number,
    tileY: number,
    role: string,
    tier: "manager" | "worker",
    originX: number,
    originY: number,
    style: AgentStyle = "person",
  ) {
    this.scene = scene;
    this.agentId = agentId;
    this.role = role;
    this.tier = tier;
    this.style = style;
    this.bodyColor = roleToColor(role, tier);
    this.lastTileX = tileX;
    this.lastTileY = tileY;

    const pos = isoToScreen(tileX, tileY, originX, originY, TILE_W, TILE_H);

    this.selectedGfx = scene.add.graphics();
    this.charGfx = scene.add.graphics();

    const shortRole = role.replace("-engineer", "").replace(/-/g, " ");
    this.nameLabel = scene.add
      .text(0, 14, shortRole, {
        fontSize: "10px",
        color: "#f1f5f9",
        fontFamily: "monospace",
        fontStyle: "bold",
        stroke: "#00000099",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0);

    this.actionLabel = scene.add
      .text(0, 27, "", {
        fontSize: "8px",
        color: "#e2e8f0",
        fontFamily: "monospace",
        stroke: "#00000088",
        strokeThickness: 2,
        wordWrap: { width: 80 },
      })
      .setOrigin(0.5, 0);

    this.bubbleBg = scene.add.graphics();
    this.bubbleText = scene.add
      .text(0, -90, "", {
        fontSize: "9px",
        color: "#f1f5f9",
        fontFamily: "monospace",
        wordWrap: { width: 120 },
        align: "center",
      })
      .setOrigin(0.5, 0);

    this.bubbleContainer = scene.add.container(0, 0, [
      this.bubbleBg,
      this.bubbleText,
    ]);
    this.bubbleContainer.setVisible(false);

    this.container = scene.add.container(pos.x, pos.y, [
      this.selectedGfx,
      this.charGfx,
      this.nameLabel,
      this.actionLabel,
      this.bubbleContainer,
    ]);
    this.container.setDepth(isoDepth(tileX, tileY) + 200);

    this.drawCharacter();
    this.startBobAnimation("idle");
  }

  updateStyle(style: AgentStyle): void {
    this.style = style;
    this.drawCharacter();
  }

  sync(agent: Agent, originX: number, originY: number): void {
    if (agent.status !== this.lastStatus) {
      this.lastStatus = agent.status;
      const nextAnim =
        agent.status === "working"
          ? "working"
          : agent.status === "error"
          ? "error"
          : agent.status === "offline"
          ? "offline"
          : "idle";
      this.startBobAnimation(nextAnim);
      this.drawCharacter();

      const alpha = agent.status === "offline" ? 0.4 : 1;
      this.charGfx.setAlpha(alpha);
    }

    const { x: tileX, y: tileY } = agent.world;
    if (tileX !== this.lastTileX || tileY !== this.lastTileY) {
      this.lastTileX = tileX;
      this.lastTileY = tileY;
      const target = isoToScreen(
        tileX,
        tileY,
        originX,
        originY,
        TILE_W,
        TILE_H,
      );
      this.moveTo(target.x, target.y, isoDepth(tileX, tileY) + 200);
    }

    const actionText = agent.currentAction ?? "";
    if (actionText !== this.lastActionText) {
      this.lastActionText = actionText;
      this.actionLabel.setText(actionText ? `· ${actionText}` : "");
    }

    const bubbleText = agent.speechBubble?.text;
    if (bubbleText !== this.lastSpeechText) {
      this.lastSpeechText = bubbleText;
      bubbleText ? this.showBubble(bubbleText) : this.hideBubble();
    }
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────

  private drawCharacter(): void {
    this.charGfx.clear();
    const color = this.bodyColor;
    const statusColor = statusToColor(this.lastStatus);

    switch (this.style) {
      case "person":
        this.drawPixelPerson(color, statusColor);
        break;
      case "sketch-cube":
        this.drawSketchCube(color, statusColor);
        break;
      case "robot":
        this.drawRobot(color, statusColor);
        break;
      case "blob":
        this.drawBlob(color, statusColor);
        break;
      case "minimal":
        this.drawMinimal(color, statusColor);
        break;
    }

    this.drawSelectedRing();
  }

  private getHairColor(): number {
    if (this.tier === "manager") return 0x110a04;
    const map: Record<string, number> = {
      "backend-engineer": 0x0d0d0d,
      "frontend-engineer": 0x7c3b0f,
      "devops-engineer": 0x152e10,
      "designer": 0x350060,
      "data-engineer": 0x8b4400,
    };
    return map[this.role] ?? 0x222222;
  }

  private drawPixelPerson(bodyColor: number, statusColor: number): void {
    const g = this.charGfx;
    const skinColor = 0xf5c89a;
    const hairCol = this.getHairColor();

    // Shadow
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(0, 4, 14, 4);

    // Legs / pants
    g.fillStyle(0x334155, 1);
    g.fillRect(-5, -10, 4, 8);
    g.fillRect(2, -10, 4, 8);
    g.fillRect(-5, -3, 11, 3);

    // Shirt body (role color)
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-7, -26, 15, 16, 3);
    g.fillStyle(lighten(bodyColor, 50), 0.2);
    g.fillRoundedRect(-6, -25, 13, 5, 2);

    // Neck
    g.fillStyle(skinColor, 1);
    g.fillRect(-2, -27, 5, 3);

    // Head — squircle, one solid hair color
    g.fillStyle(hairCol, 1);
    g.fillRoundedRect(-8, -44, 16, 17, 5);

    // Face area (skin oval inside the squircle)
    g.fillStyle(skinColor, 1);
    g.fillEllipse(0, -35, 12, 11);

    // Eyes
    const eyeY = -35;
    if (this.lastStatus === "error") {
      g.lineStyle(1.5, 0x000000, 1);
      g.lineBetween(-4, eyeY - 2, -1, eyeY + 2);
      g.lineBetween(-4, eyeY + 2, -1, eyeY - 2);
      g.lineBetween(1, eyeY - 2, 4, eyeY + 2);
      g.lineBetween(1, eyeY + 2, 4, eyeY - 2);
    } else {
      g.fillStyle(0x1a1a1a, 1);
      g.fillCircle(-3, eyeY, 2);
      g.fillCircle(4, eyeY, 2);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(-2.5, eyeY - 0.5, 0.8);
      g.fillCircle(4.5, eyeY - 0.5, 0.8);
    }

    // Mouth
    if (this.lastStatus !== "error") {
      g.lineStyle(1, 0x994433, 0.8);
      g.beginPath();
      g.arc(0, -30, 3, 0.2, Math.PI - 0.2, false);
      g.strokePath();
    }

    // Role accessories
    if (this.tier === "manager") {
      // Red tie
      g.fillStyle(0xdc2626, 1);
      g.fillTriangle(0, -26, -2, -18, 3, -18);
      g.fillTriangle(0, -10, -2, -18, 3, -18);
    }

    // Status badge on shoulder
    g.fillStyle(statusColor, 1);
    g.fillCircle(-9, -22, 3);
    g.lineStyle(0.5, 0x000000, 0.5);
    g.strokeCircle(-9, -22, 3);
  }

  private drawSketchCube(bodyColor: number, statusColor: number): void {
    const g = this.charGfx;
    const strokeColor = 0x000000;
    const lightBody = lighten(bodyColor, 80);

    // Hand-drawn shadow
    g.fillStyle(0x000000, 0.15);
    g.fillEllipse(2, 6, 34, 10);

    // Side face (shaded)
    g.fillStyle(lighten(bodyColor, -20), 1);
    g.beginPath();
    g.moveTo(12, -45);
    g.lineTo(22, -55);
    g.lineTo(22, -15);
    g.lineTo(12, -5);
    g.closePath();
    g.fillPath();
    g.lineStyle(3, strokeColor, 1);
    g.strokePath();

    // Front face
    g.fillStyle(lightBody, 1);
    g.lineStyle(3, strokeColor, 1);
    g.fillRoundedRect(-15, -45, 27, 40, 4);
    g.strokeRoundedRect(-15, -45, 27, 40, 4);

    // Top face
    g.fillStyle(lighten(bodyColor, 20), 1);
    g.beginPath();
    g.moveTo(-15, -45);
    g.lineTo(-5, -55);
    g.lineTo(22, -55);
    g.lineTo(12, -45);
    g.closePath();
    g.fillPath();
    g.lineStyle(3, strokeColor, 1);
    g.strokePath();

    // Eyes
    const eyeY = -30;
    if (this.lastStatus === "error") {
      g.lineStyle(2, strokeColor, 1);
      g.lineBetween(-8, eyeY - 3, -2, eyeY + 3);
      g.lineBetween(-8, eyeY + 3, -2, eyeY - 3);
      g.lineBetween(2, eyeY - 3, 8, eyeY + 3);
      g.lineBetween(2, eyeY + 3, 8, eyeY - 3);
    } else {
      g.fillStyle(strokeColor, 1);
      g.fillCircle(-5, eyeY, 4);
      g.fillCircle(7, eyeY, 4);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(-4, eyeY - 1, 1.5);
      g.fillCircle(8, eyeY - 1, 1.5);
    }

    // Smile
    g.lineStyle(2, strokeColor, 1);
    g.beginPath();
    g.arc(1, -20, 5, 0.1, Math.PI - 0.1, false);
    g.strokePath();

    // Role accessories
    if (this.tier === "manager") {
      // Glasses bridge
      g.fillStyle(strokeColor, 1);
      g.fillRect(-10, eyeY - 1, 20, 2);
      // Tie (two triangles forming a tie shape)
      g.fillStyle(bodyColor, 1);
      g.fillTriangle(0, -5, -4, 5, 4, 5);
      g.fillTriangle(0, 15, -4, 5, 4, 5);
    } else {
      // Worker: wrench to the left
      g.lineStyle(3, strokeColor, 1);
      g.fillStyle(0xcbd5e1, 1);
      g.fillRect(-25, -25, 6, 20);
      g.beginPath();
      g.arc(-22, -28, 7, 0, Math.PI * 2);
      g.fillPath();
      g.strokePath();
      g.fillStyle(0xffffff, 1);
      g.fillRect(-24, -34, 4, 8);
    }

    // Status indicator dot on top-right corner
    g.fillStyle(statusColor, 1);
    g.fillCircle(12, -45, 4);
    g.lineStyle(1, strokeColor, 1);
    g.strokeCircle(12, -45, 4);
  }

  private drawRobot(bodyColor: number, statusColor: number): void {
    const g = this.charGfx;
    const hColor = lighten(bodyColor, 40);

    // Shadow
    g.fillStyle(0x000000, 0.28);
    g.fillEllipse(1, 4, 30, 10);

    // Status glow ring (behind body)
    g.fillStyle(statusColor, 0.12);
    g.fillCircle(0, -22, 22);

    // Body
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-11, -34, 22, 24, 4);
    // Body highlight stripe
    g.fillStyle(lighten(bodyColor, 50), 0.25);
    g.fillRoundedRect(-9, -32, 18, 7, 3);
    // Body detail line
    g.fillStyle(0x000000, 0.2);
    g.fillRect(-8, -18, 16, 2);

    // Neck
    g.fillStyle(lighten(bodyColor, 20), 1);
    g.fillRect(-4, -38, 8, 5);

    // Head
    g.fillStyle(hColor, 1);
    g.fillRoundedRect(-10, -56, 20, 20, 5);
    // Head top edge (darker)
    g.fillStyle(0x000000, 0.15);
    g.fillRoundedRect(-10, -56, 20, 5, 5);

    // Eyes (visor style)
    g.fillStyle(0xffffff, 0.95);
    g.fillRoundedRect(-7, -50, 5, 4, 1);
    g.fillRoundedRect(2, -50, 5, 4, 1);
    // Eye glow
    g.fillStyle(statusColor, 0.8);
    g.fillRoundedRect(-6, -49, 3, 2, 1);
    g.fillRoundedRect(3, -49, 3, 2, 1);

    // Antenna (manager: crown shape, worker: single spike)
    if (this.tier === "manager") {
      // Crown
      g.fillStyle(0xfbbf24, 1);
      g.fillRect(-8, -60, 16, 3);
      g.fillTriangle(-8, -60, -5, -66, -2, -60);
      g.fillTriangle(-1, -60, 2, -67, 5, -60);
      g.fillTriangle(4, -60, 7, -66, 10, -60);
      // Crown gems
      g.fillStyle(0xff4444, 1);
      g.fillCircle(-3, -63, 1.5);
      g.fillStyle(0x44ffff, 1);
      g.fillCircle(2, -64, 1.5);
      g.fillStyle(0xff4444, 1);
      g.fillCircle(7, -63, 1.5);
    } else {
      // Antenna
      g.fillStyle(hColor, 1);
      g.fillRect(-1, -58, 2, 5);
      g.fillStyle(statusColor, 1);
      g.fillCircle(0, -60, 2.5);
    }

    // Status ring outline
    g.lineStyle(1.5, statusColor, 0.7);
    g.strokeRoundedRect(-13, -36, 26, 28, 5);
  }

  private drawBlob(bodyColor: number, statusColor: number): void {
    const g = this.charGfx;

    // Shadow
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(1, 5, 36, 12);

    // Status glow (outer)
    g.fillStyle(statusColor, 0.15);
    g.fillCircle(0, -26, 26);

    // Main body (large rounded blob)
    g.fillStyle(bodyColor, 1);
    g.fillCircle(0, -30, 22);
    // Inner shine
    g.fillStyle(lighten(bodyColor, 60), 0.3);
    g.fillCircle(-6, -38, 10);

    // Small "feet" bumps
    g.fillStyle(lighten(bodyColor, 20), 1);
    g.fillCircle(-8, -10, 7);
    g.fillCircle(8, -10, 7);

    // Big cute eyes
    g.fillStyle(0xffffff, 1);
    g.fillCircle(-7, -30, 7);
    g.fillCircle(7, -30, 7);
    // Pupils
    g.fillStyle(0x1a1a2e, 1);
    g.fillCircle(-6, -30, 4);
    g.fillCircle(8, -30, 4);
    // Eye shine
    g.fillStyle(0xffffff, 1);
    g.fillCircle(-4, -33, 1.5);
    g.fillCircle(10, -33, 1.5);

    // Smile
    g.lineStyle(2, 0xffffff, 0.7);
    g.beginPath();
    g.arc(0, -23, 5, 0.2, Math.PI - 0.2, false);
    g.strokePath();

    // Manager: bow tie
    if (this.tier === "manager") {
      g.fillStyle(0xfbbf24, 1);
      g.fillTriangle(-10, -12, -4, -9, -10, -6);
      g.fillTriangle(4, -12, 10, -9, 4, -6);
      g.fillCircle(0, -9, 3);
      // Star above head (drawn as points)
      g.fillStyle(0xfbbf24, 1);
      g.fillTriangle(-4, -52, 0, -60, 4, -52);
      g.fillTriangle(-7, -57, 7, -57, 0, -50);
    } else {
      // Worker: role badge
      const roleInitial = this.role.charAt(0).toUpperCase();
      // Small circular badge
      g.fillStyle(lighten(bodyColor, 80), 0.9);
      g.fillCircle(14, -42, 7);
      g.fillStyle(bodyColor, 1);
      g.fillCircle(14, -42, 5);
    }

    // Outline
    g.lineStyle(1.5, statusColor, 0.5);
    g.strokeCircle(0, -30, 23);
  }

  private drawMinimal(bodyColor: number, statusColor: number): void {
    const g = this.charGfx;

    // Shadow
    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(1, 4, 28, 9);

    // Outer status ring (pulsing feel via opacity)
    g.fillStyle(statusColor, 0.18);
    g.fillCircle(0, -24, 22);
    g.lineStyle(2, statusColor, 0.8);
    g.strokeCircle(0, -24, 18);

    // Body circle
    g.fillStyle(bodyColor, 1);
    g.fillCircle(0, -24, 15);
    // Inner highlight
    g.fillStyle(0xffffff, 0.15);
    g.fillCircle(-4, -29, 7);

    // Manager: filled ring
    if (this.tier === "manager") {
      g.lineStyle(3, 0xfbbf24, 1);
      g.strokeCircle(0, -24, 15);
    }

    // Dot eyes
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(-5, -26, 2.5);
    g.fillCircle(5, -26, 2.5);
    g.fillStyle(0x1a1a2e, 1);
    g.fillCircle(-4, -26, 1.5);
    g.fillCircle(6, -26, 1.5);
  }

  private drawSelectedRing(): void {
    this.selectedGfx.clear();
    if (!this.isSelected) return;
    this.selectedGfx.lineStyle(2.5, 0xffffff, 0.9);
    this.selectedGfx.strokeCircle(0, -24, 26);
    this.selectedGfx.lineStyle(1, 0xffffff, 0.3);
    this.selectedGfx.strokeCircle(0, -24, 30);
  }

  // ─── Interaction ──────────────────────────────────────────────────────────

  enableInteraction(onSelect: (id: string) => void): void {
    this.charGfx.setInteractive(
      new Phaser.Geom.Circle(0, -24, 28),
      Phaser.Geom.Circle.Contains,
    );
    this.charGfx.on("pointerdown", () => onSelect(this.agentId));
    this.charGfx.on("pointerover", () => {
      this.scene.game.canvas.style.cursor = "pointer";
    });
    this.charGfx.on("pointerout", () => {
      this.scene.game.canvas.style.cursor = "default";
    });
  }

  setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.drawSelectedRing();

    if (selected) {
      this.pulseTween?.stop();
      this.pulseTween = this.scene.tweens.add({
        targets: this.selectedGfx,
        alpha: { from: 1, to: 0.4 },
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else {
      this.pulseTween?.stop();
      this.pulseTween = null;
      this.selectedGfx.setAlpha(1);
    }
  }

  // ─── Animation ────────────────────────────────────────────────────────────

  private moveTo(screenX: number, screenY: number, depth: number): void {
    this.moveTween?.stop();
    this.moveTween = this.scene.tweens.add({
      targets: this.container,
      x: screenX,
      y: screenY,
      duration: 800,
      ease: "Cubic.easeInOut",
      onComplete: () => {
        this.container.setDepth(depth);
        this.moveTween = null;
      },
    });
  }

  private startBobAnimation(
    state: "idle" | "working" | "talking" | "error" | "offline",
  ): void {
    this.bobTween?.stop();
    this.bobTween = null;

    const amp = animationBobAmplitude(state);
    const dur = animationBobDuration(state);
    if (amp === 0 || dur === 0) return;

    this.bobTween = this.scene.tweens.add({
      targets: this.charGfx,
      y: `+=${amp}`,
      duration: dur,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  // ─── Speech bubble ────────────────────────────────────────────────────────

  private showBubble(text: string): void {
    this.bubbleText.setText(text);
    const pad = 7;
    const bw = this.bubbleText.width + pad * 2;
    const bh = this.bubbleText.height + pad * 2;
    const bx = -bw / 2;
    const by = -90 - bh;

    this.bubbleBg.clear();
    this.bubbleBg.fillStyle(0x1e293b, 0.96);
    this.bubbleBg.fillRoundedRect(bx, by, bw, bh, 5);
    this.bubbleBg.lineStyle(1, 0x475569, 0.8);
    this.bubbleBg.strokeRoundedRect(bx, by, bw, bh, 5);
    this.bubbleBg.fillStyle(0x1e293b, 0.96);
    this.bubbleBg.fillTriangle(-4, -86, 4, -86, 0, -78);

    this.bubbleText.setPosition(0, by + pad);
    this.bubbleContainer.setVisible(true);
  }

  private hideBubble(): void {
    this.bubbleContainer.setVisible(false);
    this.bubbleBg.clear();
  }

  destroy(): void {
    this.bobTween?.stop();
    this.moveTween?.stop();
    this.pulseTween?.stop();
    this.container.destroy();
  }
}
