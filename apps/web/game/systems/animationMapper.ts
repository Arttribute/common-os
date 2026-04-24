import type { AgentStatus } from '@/store/agentStore'

export type AnimationState = 'idle' | 'working' | 'talking' | 'error' | 'offline'

export function statusToAnimation(status: AgentStatus): AnimationState {
  switch (status) {
    case 'working':    return 'working'
    case 'error':      return 'error'
    case 'offline':    return 'offline'
    default:           return 'idle'
  }
}

// Hex color for the status indicator dot
export function statusToColor(status: AgentStatus): number {
  switch (status) {
    case 'working':      return 0xf59e0b  // amber
    case 'online':
    case 'idle':         return 0x10b981  // green
    case 'error':        return 0xef4444  // red
    case 'provisioning': return 0x6366f1  // indigo
    default:             return 0x4b5563  // gray (offline)
  }
}

// Hex fill color for the agent body based on role/tier
export function roleToColor(role: string, tier: 'manager' | 'worker'): number {
  if (tier === 'manager') return 0xf59e0b  // gold

  const roleColors: Record<string, number> = {
    'backend-engineer':  0x06b6d4,   // cyan
    'frontend-engineer': 0xec4899,   // pink
    'devops-engineer':   0x22c55e,   // green
    'designer':          0xa855f7,   // purple
    'data-engineer':     0xf97316,   // orange
  }
  return roleColors[role] ?? 0x60a5fa  // default blue
}

// Bob animation amplitude per state (pixels)
export function animationBobAmplitude(state: AnimationState): number {
  switch (state) {
    case 'working': return 3
    case 'idle':    return 1
    default:        return 0
  }
}

export function animationBobDuration(state: AnimationState): number {
  switch (state) {
    case 'working': return 350
    case 'idle':    return 900
    default:        return 0
  }
}
