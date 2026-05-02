import type { Room } from '@/store/worldStore'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'

const MOCK_FLEET = {
  fleetId: 'flt_demo_01',
  name: 'Engineering Team',
  rooms: [
    { id: 'dev-room',     label: 'Dev Room',     bounds: { x: 0,  y: 0,  w: 10, h: 8  } },
    { id: 'design-room',  label: 'Design Room',  bounds: { x: 12, y: 0,  w: 8,  h: 8  } },
    { id: 'meeting-room', label: 'Meeting Room', bounds: { x: 0,  y: 10, w: 6,  h: 6  } },
  ] as Room[],
}

const MOCK_AGENTS = [
  {
    agentId: 'agt_mgr_01',
    role: 'engineering-manager',
    permissionTier: 'manager' as const,
    status: 'idle' as const,
    world: { room: 'meeting-room', x: 2, y: 11, facing: 'south' as const },
    ensName: 'engineering-manager.commonos.eth',
    ensRecords: {
      name: 'engineering-manager.commonos.eth',
      agentId: 'agt_mgr_01',
      fleetId: 'flt_demo_01',
      role: 'engineering-manager',
      status: 'online',
      peerId: '12D3KooWMgr01',
      multiaddr: '/ip4/10.0.1.5/tcp/9001/p2p/12D3KooWMgr01',
      commonsAgentId: null,
      walletAddress: '0x1234...',
      url: 'http://localhost:3000/world?fleet=flt_demo_01',
      description: 'CommonOS engineering-manager agent',
    },
    ensStatus: 'resolved' as const,
  },
  {
    agentId: 'agt_backend_01',
    role: 'backend-engineer',
    permissionTier: 'worker' as const,
    status: 'idle' as const,
    world: { room: 'dev-room', x: 4, y: 3, facing: 'south' as const },
    ensName: 'backend.commonos.eth',
    ensRecords: {
      name: 'backend.commonos.eth',
      agentId: 'agt_backend_01',
      fleetId: 'flt_demo_01',
      role: 'backend-engineer',
      status: 'online',
      peerId: '12D3KooWBack01',
      multiaddr: '/ip4/10.0.1.6/tcp/9001/p2p/12D3KooWBack01',
      commonsAgentId: null,
      walletAddress: '0x5678...',
      url: 'http://localhost:3000/world?fleet=flt_demo_01',
      description: 'CommonOS backend-engineer agent',
    },
    ensStatus: 'resolved' as const,
  },
  {
    agentId: 'agt_frontend_01',
    role: 'frontend-engineer',
    permissionTier: 'worker' as const,
    status: 'idle' as const,
    world: { room: 'dev-room', x: 7, y: 3, facing: 'south' as const },
    ensName: 'frontend.commonos.eth',
    ensRecords: {
      name: 'frontend.commonos.eth',
      agentId: 'agt_frontend_01',
      fleetId: 'flt_demo_01',
      role: 'frontend-engineer',
      status: 'online',
      peerId: '12D3KooWFront01',
      multiaddr: '/ip4/10.0.1.7/tcp/9001/p2p/12D3KooWFront01',
      commonsAgentId: null,
      walletAddress: '0x90ab...',
      url: 'http://localhost:3000/world?fleet=flt_demo_01',
      description: 'CommonOS frontend-engineer agent',
    },
    ensStatus: 'resolved' as const,
  },
]

export function startMockSimulation(): () => void {
  const world = useWorldStore.getState()
  const agents = useAgentStore.getState()

  world.setFleet(MOCK_FLEET.fleetId, MOCK_FLEET.name, MOCK_FLEET.rooms)
  for (const a of MOCK_AGENTS) {
    const { ensName, ensRecords, ensStatus, ...agent } = a
    agents.upsertAgent(agent)
    agents.setEnsInfo(a.agentId, a.ensName ?? null, a.ensRecords ?? null, a.ensStatus ?? null)
  }

  const timers: ReturnType<typeof setTimeout>[] = []
  const t = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

  function runCycle(offset = 0) {
    const {
      updateStatus,
      setCurrentAction,
      setSpeechBubble,
      clearSpeechBubble,
      setCurrentTask,
      completeTask,
      updatePosition,
    } = useAgentStore.getState()

    // All agents come online
    t(offset + 500, () => {
      updateStatus('agt_mgr_01', 'online')
      updateStatus('agt_backend_01', 'online')
      updateStatus('agt_frontend_01', 'online')
    })

    // Manager starts reviewing sprint backlog
    t(offset + 2000, () => {
      updateStatus('agt_mgr_01', 'working')
      setCurrentAction('agt_mgr_01', 'reviewing sprint backlog')
    })

    // Backend engineer receives task
    t(offset + 4000, () => {
      setCurrentTask('agt_backend_01', {
        taskId: 'tsk_auth_01',
        description: 'Build user authentication module with JWT and refresh tokens',
      })
      updateStatus('agt_backend_01', 'working')
      setCurrentAction('agt_backend_01', 'setting up auth module')
    })

    // Frontend engineer gets task
    t(offset + 6000, () => {
      setCurrentTask('agt_frontend_01', {
        taskId: 'tsk_ui_01',
        description: 'Build login and registration forms',
      })
      updateStatus('agt_frontend_01', 'working')
      setCurrentAction('agt_frontend_01', 'creating component library')
    })

    // Manager asks about progress
    t(offset + 9000, () => {
      setSpeechBubble('agt_mgr_01', "How's the auth module coming?")
    })
    t(offset + 13000, () => clearSpeechBubble('agt_mgr_01'))

    // Backend replies and makes progress
    t(offset + 11000, () => {
      setSpeechBubble('agt_backend_01', 'JWT done, writing refresh tokens now')
      setCurrentAction('agt_backend_01', 'writing refresh token logic')
    })
    t(offset + 15000, () => clearSpeechBubble('agt_backend_01'))

    // Backend engineer moves deeper in dev room
    t(offset + 14000, () => updatePosition('agt_backend_01', 'dev-room', 3, 5))

    // Frontend makes more progress
    t(offset + 16000, () => setCurrentAction('agt_frontend_01', 'building login form'))

    // Backend completes task, moves back
    t(offset + 19000, () => {
      completeTask('agt_backend_01')
      setSpeechBubble('agt_backend_01', 'Auth module complete! ✓')
      setCurrentAction('agt_backend_01', undefined)
    })
    t(offset + 20000, () => updatePosition('agt_backend_01', 'dev-room', 4, 3))
    t(offset + 23000, () => clearSpeechBubble('agt_backend_01'))

    // Manager moves to dev room to review
    t(offset + 21000, () => {
      updatePosition('agt_mgr_01', 'dev-room', 2, 4)
      setCurrentAction('agt_mgr_01', 'reviewing completed work')
    })

    // Manager praises backend
    t(offset + 24000, () => setSpeechBubble('agt_mgr_01', 'Great work! Reviewing now...'))
    t(offset + 28000, () => clearSpeechBubble('agt_mgr_01'))

    // Frontend completes
    t(offset + 27000, () => {
      completeTask('agt_frontend_01')
      setSpeechBubble('agt_frontend_01', 'Forms ready for review! ✓')
      setCurrentAction('agt_frontend_01', undefined)
    })
    t(offset + 31000, () => clearSpeechBubble('agt_frontend_01'))

    // Manager returns to meeting room
    t(offset + 30000, () => {
      updatePosition('agt_mgr_01', 'meeting-room', 2, 11)
      updateStatus('agt_mgr_01', 'idle')
      setCurrentAction('agt_mgr_01', undefined)
    })

    // Reset agent positions and loop
    t(offset + 33000, () => {
      updateStatus('agt_backend_01', 'idle')
      updateStatus('agt_frontend_01', 'idle')
      runCycle()
    })
  }

  runCycle()
  return () => timers.forEach(clearTimeout)
}
