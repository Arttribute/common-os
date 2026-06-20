'use client'
import { Suspense, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@/hooks/useAuth'
import { HUD } from '@/components/hud/HUD'
import { useWorldStore } from '@/store/worldStore'
import { useWorldConnection } from '@/hooks/useWorldConnection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Cpu, Database, DollarSign, Gauge, Loader2 } from 'lucide-react'

const PhaserGame = dynamic(() => import('@/components/PhaserGame'), { ssr: false })

type WorldTab = 'world' | 'expenses'
type CostPeriodDays = 7 | 30 | 90

interface TokenSummary {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  requestCount: number
  totalTokens: number
}

interface AgentCost {
  agentId: string
  role: string
  status: string
  integrationPath: 'native' | 'openclaw' | 'hermes' | 'guest'
  provider: string
  model: string
  confidence: 'actual' | 'estimated'
  activeHours: number
  tokens: {
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    requestCount: number
  }
  usageComparison: {
    actualTokens: number
    estimatedTokens: number
    ratio: number | null
  }
  resources: {
    cpuRequestCores: number
    memoryRequestGiB: number
    storageGiB: number
  }
  cost: {
    tokens: number
    compute: number
    storage: number
    raw: number
    markup: number
    billed: number
  }
}

interface FleetCostReport {
  fleetId: string
  fleetName: string
  period: { since: string; until: string; days: number }
  markupRate: number
  confidence: 'actual' | 'mixed' | 'estimated'
  usageComparison: {
    actual: TokenSummary
    estimated: TokenSummary
    ratio: number | null
  }
  totals: {
    tokens: number
    compute: number
    storage: number
    raw: number
    markup: number
    billed: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    requestCount: number
  }
  agents: AgentCost[]
}

const costPeriodOptions: CostPeriodDays[] = [7, 30, 90]

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

// Inner component uses useSearchParams — must be inside <Suspense>
function WorldContent() {
  const { ready } = usePrivy()
  const { authenticated, getAccessToken, apiFetch } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fleetId = searchParams.get('fleet') ?? undefined
  const [tab, setTab] = useState<WorldTab>((searchParams.get('view') === 'expenses' ? 'expenses' : 'world'))
  const [periodDays, setPeriodDays] = useState<CostPeriodDays>(30)
  const [costReport, setCostReport] = useState<FleetCostReport | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [costError, setCostError] = useState<string | null>(null)
  const initialized = useWorldStore((s) => s.initialized)

  const privyEnabled = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID
  useEffect(() => {
    if (privyEnabled && ready && !authenticated) {
      router.replace('/auth')
    }
  }, [privyEnabled, ready, authenticated, router])

  const { isLive } = useWorldConnection(
    fleetId,
    privyEnabled ? getAccessToken : undefined,
  )

  useEffect(() => {
    if (tab !== 'expenses' || !fleetId || !authenticated) return
    let cancelled = false
    setCostLoading(true)
    setCostError(null)
    void apiFetch(`/fleets/${fleetId}/costs?periodDays=${periodDays}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load expenses (${res.status})`)
        const report = await res.json() as FleetCostReport
        if (!cancelled) setCostReport(report)
      })
      .catch((err) => {
        if (!cancelled) setCostError(err instanceof Error ? err.message : 'Could not load expenses')
      })
      .finally(() => {
        if (!cancelled) setCostLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apiFetch, authenticated, fleetId, periodDays, tab])

  if (privyEnabled && (!ready || !authenticated)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {ready ? 'Redirecting...' : 'Loading world...'}
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#060b14] text-foreground">
      <WorldTabs active={tab} onChange={setTab} />

      {tab === 'world' ? (
        <>
          {initialized && <PhaserGame />}
          <HUD />
        </>
      ) : (
        <ExpensesView
          fleetId={fleetId}
          report={costReport}
          loading={costLoading}
          error={costError}
          periodDays={periodDays}
          onPeriodChange={setPeriodDays}
          onBack={() => setTab('world')}
        />
      )}

      {tab === 'world' && !initialized && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          <div className="rounded-lg border border-white/10 bg-background/80 px-4 py-3 shadow-xl shadow-black/30 backdrop-blur-xl">
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            {isLive ? 'Connecting to team...' : 'Initializing world...'}
          </div>
        </div>
      )}
    </div>
  )
}

function WorldTabs({ active, onChange }: { active: WorldTab; onChange: (tab: WorldTab) => void }) {
  return (
    <div className="absolute left-1/2 top-4 z-50 flex -translate-x-1/2 rounded-md border border-white/10 bg-background/85 p-1 shadow-xl shadow-black/30 backdrop-blur-xl">
      {(['world', 'expenses'] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          className={cn(
            'h-9 min-w-24 rounded px-4 text-sm font-medium capitalize text-muted-foreground transition',
            active === tab && 'bg-primary text-primary-foreground',
          )}
          onClick={() => onChange(tab)}
        >
          {tab === 'world' ? 'World' : 'Expenses'}
        </button>
      ))}
    </div>
  )
}

function ExpensesView({
  fleetId,
  report,
  loading,
  error,
  periodDays,
  onPeriodChange,
  onBack,
}: {
  fleetId?: string
  report: FleetCostReport | null
  loading: boolean
  error: string | null
  periodDays: CostPeriodDays
  onPeriodChange: (days: CostPeriodDays) => void
  onBack: () => void
}) {
  if (!fleetId) {
    return (
      <div className="flex h-full items-center justify-center px-6 pt-20">
        <div className="max-w-md rounded-md border border-white/10 bg-background/90 p-6 text-center shadow-xl shadow-black/30">
          <h1 className="text-lg font-semibold">Choose a team first</h1>
          <p className="mt-2 text-sm text-muted-foreground">Open a team from the dashboard to view its expenses.</p>
          <Button className="mt-5" onClick={onBack}>Back to world</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 pb-10 pt-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge variant="outline" className="bg-background/80">Team expenses</Badge>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              {report?.fleetName ?? 'Expenses'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Actual token consumption, estimated plan usage, infrastructure allocation, and customer price.
            </p>
          </div>
          <select
            className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
            value={periodDays}
            onChange={(e) => onPeriodChange(Number(e.target.value) as CostPeriodDays)}
            aria-label="Expense period"
          >
            {costPeriodOptions.map((days) => (
              <option key={days} value={days}>{days} days</option>
            ))}
          </select>
        </div>

        {loading && (
          <div className="rounded-md border border-white/10 bg-background/85 p-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            Loading expenses...
          </div>
        )}

        {error && !loading && (
          <div className="rounded-md border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
        )}

        {report && !loading && <ExpensesPanel report={report} />}
      </div>
    </div>
  )
}

function ExpensesPanel({ report }: { report: FleetCostReport }) {
  const actualTotal = report.usageComparison.actual.totalTokens
  const estimatedTotal = report.usageComparison.estimated.totalTokens
  const actualPercent = estimatedTotal > 0 ? Math.min(100, (actualTotal / estimatedTotal) * 100) : 0
  const overage = estimatedTotal > 0 && actualTotal > estimatedTotal
  const costBreakdown = [
    { label: 'Model', value: report.totals.tokens, icon: Gauge },
    { label: 'Compute', value: report.totals.compute, icon: Cpu },
    { label: 'Storage', value: report.totals.storage, icon: Database },
    { label: 'Markup', value: report.totals.markup, icon: DollarSign },
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-white/10 bg-background/90">
        <div className="grid gap-5 border-b border-white/10 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Usage against estimate</h2>
              <Badge variant={report.confidence === 'estimated' ? 'warning' : 'success'}>{report.confidence}</Badge>
              <Badge variant="outline">{report.period.days} days</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatCompact(actualTotal)} actual tokens of {formatCompact(estimatedTotal)} estimated.
            </p>
          </div>
          <div className="min-w-44 rounded-md border border-white/10 bg-muted/20 px-4 py-3">
            <div className="text-xs text-muted-foreground">Customer price</div>
            <div className="mt-1 text-2xl font-semibold">{formatCurrency(report.totals.billed)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Raw {formatCurrency(report.totals.raw)} + {Math.round(report.markupRate * 100)}%
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>Actual usage</span>
            <span className={overage ? 'font-medium text-amber-300' : 'text-muted-foreground'}>
              {estimatedTotal > 0 ? `${Math.round((actualTotal / estimatedTotal) * 100)}% of estimate` : 'No estimate baseline'}
            </span>
          </div>
          <div className="relative h-5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${actualPercent}%` }} />
            {overage && <div className="absolute inset-y-0 right-0 w-1 bg-amber-300" />}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>0</span>
            <span>Estimate cap: {formatCompact(estimatedTotal)}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {costBreakdown.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.label} className="rounded-md border border-white/10 bg-background/90 p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{item.label}</span>
                <Icon className="size-4" />
              </div>
              <div className="mt-2 text-xl font-semibold">{formatCurrency(item.value)}</div>
            </div>
          )
        })}
      </div>

      <div className="overflow-x-auto rounded-md border border-white/10 bg-background/90">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[1.1fr_0.9fr_1fr_1fr_0.8fr_0.8fr] gap-3 border-b border-white/10 bg-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Agent</span>
            <span>Model</span>
            <span>Usage</span>
            <span>Actual vs estimate</span>
            <span>Infra</span>
            <span className="text-right">Price</span>
          </div>
          {report.agents.map((agent) => (
            <AgentExpenseRow key={agent.agentId} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentExpenseRow({ agent }: { agent: AgentCost }) {
  const actual = agent.usageComparison.actualTokens
  const estimated = agent.usageComparison.estimatedTokens
  const percent = estimated > 0 ? Math.min(100, (actual / estimated) * 100) : 0
  return (
    <div className="grid grid-cols-[1.1fr_0.9fr_1fr_1fr_0.8fr_0.8fr] items-center gap-3 border-b border-white/10 px-4 py-3 text-sm last:border-b-0">
      <div className="min-w-0">
        <div className="truncate font-medium capitalize">{agent.role}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={agent.confidence === 'actual' ? 'success' : 'warning'} className="px-1.5 py-0">
            {agent.confidence}
          </Badge>
          {agent.integrationPath}
        </div>
      </div>
      <div className="min-w-0 text-xs">
        <div className="truncate font-mono">{agent.model}</div>
        <div className="mt-1 text-muted-foreground">{agent.provider}</div>
      </div>
      <div className="text-xs">
        <div>{formatCompact(agent.tokens.inputTokens)} in / {formatCompact(agent.tokens.outputTokens)} out</div>
        <div className="mt-1 text-muted-foreground">{formatCompact(agent.tokens.requestCount)} requests</div>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{formatCompact(actual)} / {formatCompact(estimated)}</div>
      </div>
      <div className="text-xs">
        <div>{agent.resources.cpuRequestCores} CPU</div>
        <div className="mt-1 text-muted-foreground">{agent.resources.memoryRequestGiB} GiB</div>
      </div>
      <div className="text-right font-medium">{formatCurrency(agent.cost.billed)}</div>
    </div>
  )
}

export default function WorldPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading world...
        </div>
      }
    >
      <WorldContent />
    </Suspense>
  )
}
