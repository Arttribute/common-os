import { agents, fleets, telemetryUsage } from "../db/mongo.js";
import type { AgentDoc } from "../types.js";

const HOURS_PER_MONTH = 730;
const DEFAULT_MARKUP_RATE = Number(process.env.COST_MARKUP_RATE ?? "0.3");

type ProviderId = "openai" | "anthropic" | "google" | "openrouter" | "groq" | "agent-commons" | "unknown";

interface ModelRate {
	provider: ProviderId;
	model: string;
	inputPerMillion: number;
	cachedInputPerMillion?: number;
	outputPerMillion: number;
	source: string;
}

interface ResourceProfile {
	cpuRequestCores: number;
	memoryRequestGiB: number;
	cpuLimitCores: number;
	memoryLimitGiB: number;
	storageGiB: number;
	gpuCount: number;
}

interface InfraRates {
	cpuCoreHour: number;
	memoryGiBHour: number;
	storageGiBMonth: number;
	gpuHour: number;
	source: string;
}

const MODEL_RATES: ModelRate[] = [
	{ provider: "openai", model: "gpt-5.5", inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30, source: "openai-api-pricing" },
	{ provider: "openai", model: "gpt-5.4", inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15, source: "openai-api-pricing" },
	{ provider: "openai", model: "gpt-5.4-mini", inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5, source: "openai-api-pricing" },
	{ provider: "openai", model: "gpt-4o", inputPerMillion: 2.5, cachedInputPerMillion: 1.25, outputPerMillion: 10, source: "openai-api-pricing" },
	{ provider: "openai", model: "gpt-4o-mini", inputPerMillion: 0.15, cachedInputPerMillion: 0.075, outputPerMillion: 0.6, source: "openai-api-pricing" },
	{ provider: "anthropic", model: "claude-fable-5", inputPerMillion: 10, cachedInputPerMillion: 1, outputPerMillion: 50, source: "anthropic-api-pricing" },
	{ provider: "anthropic", model: "claude-opus-4-8", inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 25, source: "anthropic-api-pricing" },
	{ provider: "anthropic", model: "claude-sonnet-4-6", inputPerMillion: 3, cachedInputPerMillion: 0.3, outputPerMillion: 15, source: "anthropic-api-pricing" },
	{ provider: "anthropic", model: "claude-haiku-4-5", inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 5, source: "anthropic-api-pricing" },
	{ provider: "google", model: "gemini-3-pro", inputPerMillion: 2.7, cachedInputPerMillion: 0.27, outputPerMillion: 16.2, source: "gemini-api-pricing" },
	{ provider: "google", model: "gemini-3-flash", inputPerMillion: 0.5, cachedInputPerMillion: 0.05, outputPerMillion: 3, source: "gemini-api-pricing" },
	{ provider: "google", model: "gemini-2.5-flash-lite", inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.4, source: "gemini-api-pricing" },
];

const DEFAULT_INFRA_RATES: Record<"gcp" | "aws", InfraRates> = {
	gcp: {
		cpuCoreHour: Number(process.env.GCP_CPU_CORE_HOUR_USD ?? "0.0316"),
		memoryGiBHour: Number(process.env.GCP_MEMORY_GIB_HOUR_USD ?? "0.0042"),
		storageGiBMonth: Number(process.env.GCP_STORAGE_GIB_MONTH_USD ?? "0.026"),
		gpuHour: Number(process.env.GCP_GPU_HOUR_USD ?? "0.7"),
		source: "env:gcp-rates",
	},
	aws: {
		cpuCoreHour: Number(process.env.AWS_CPU_CORE_HOUR_USD ?? "0.0316"),
		memoryGiBHour: Number(process.env.AWS_MEMORY_GIB_HOUR_USD ?? "0.0035"),
		storageGiBMonth: Number(process.env.AWS_STORAGE_GIB_MONTH_USD ?? "0.08"),
		gpuHour: Number(process.env.AWS_GPU_HOUR_USD ?? "0.8"),
		source: "env:aws-rates",
	},
};

function normalizeProvider(value: string | null | undefined, integrationPath?: string): ProviderId {
	const raw = (value ?? "").toLowerCase();
	if (raw.includes("anthropic") || raw.includes("claude")) return "anthropic";
	if (raw.includes("google") || raw.includes("gemini")) return "google";
	if (raw.includes("openrouter")) return "openrouter";
	if (raw.includes("groq")) return "groq";
	if (raw.includes("openai") || raw.includes("gpt")) return "openai";
	if (integrationPath === "native") return "agent-commons";
	return "unknown";
}

function defaultModel(provider: ProviderId, integrationPath: AgentDoc["config"]["integrationPath"]): string {
	if (integrationPath === "native") return process.env.AGENTCOMMONS_MODEL_ID ?? "gpt-5.4-mini";
	if (integrationPath === "openclaw") return (process.env.OPENCLAW_MODEL_ID ?? "openai/gpt-5.4-mini").replace(/^openai\//, "").replace(/^anthropic\//, "").replace(/^google\//, "");
	if (provider === "anthropic") return "claude-sonnet-4-6";
	if (provider === "google") return "gemini-2.5-flash-lite";
	if (provider === "openai") return "gpt-5.4-mini";
	return "unknown";
}

function normalizeModel(value: string | null | undefined, provider: ProviderId, integrationPath: AgentDoc["config"]["integrationPath"]): string {
	const raw = (value ?? "").trim().toLowerCase();
	if (!raw) return defaultModel(provider, integrationPath);
	return raw.replace(/^openai\//, "").replace(/^anthropic\//, "").replace(/^google\//, "");
}

function rateFor(provider: ProviderId, model: string): ModelRate | null {
	return MODEL_RATES.find((rate) => rate.provider === provider && rate.model === model)
		?? MODEL_RATES.find((rate) => rate.model === model)
		?? (provider === "agent-commons" ? MODEL_RATES.find((rate) => rate.provider === "openai" && rate.model === "gpt-5.4-mini") ?? null : null);
}

function resourceProfile(agent: AgentDoc): ResourceProfile {
	if (agent.kind === "computer" && agent.resourceSpec) {
		return {
			cpuRequestCores: Number.parseFloat(agent.resourceSpec.cpuRequest) /
				(agent.resourceSpec.cpuRequest.endsWith("m") ? 1000 : 1),
			memoryRequestGiB: agent.resourceSpec.memoryRequest.endsWith("Mi")
				? Number.parseFloat(agent.resourceSpec.memoryRequest) / 1024
				: Number.parseFloat(agent.resourceSpec.memoryRequest),
			cpuLimitCores: agent.resourceSpec.vcpu,
			memoryLimitGiB: agent.resourceSpec.memoryGiB,
			storageGiB: agent.resourceSpec.storageGiB,
			gpuCount: agent.resourceSpec.gpu.count,
		};
	}
	const integration = agent.config.integrationPath;
	const hasOpenClawRuntime = integration === "openclaw" && !process.env.OPENCLAW_GATEWAY_URL;
	const hasHermesRuntime = integration === "hermes" && !process.env.HERMES_GATEWAY_URL;
	const hasGuestRuntime = integration === "guest";
	const sidecarCpu = hasOpenClawRuntime || hasHermesRuntime || hasGuestRuntime ? 0.25 : 0;
	const sidecarMem = hasOpenClawRuntime || hasHermesRuntime || hasGuestRuntime ? 0.25 : 0;
	const sidecarCpuLimit = hasOpenClawRuntime || hasHermesRuntime || hasGuestRuntime ? 2 : 0;
	const sidecarMemLimit = hasOpenClawRuntime || hasHermesRuntime || hasGuestRuntime ? 2 : 0;
	const bridgeRuntime = integration === "openclaw" || integration === "hermes";

	return {
		cpuRequestCores: 0.1 + sidecarCpu,
		memoryRequestGiB: (bridgeRuntime ? 0.25 : 0.125) + sidecarMem,
		cpuLimitCores: 1 + sidecarCpuLimit,
		memoryLimitGiB: (bridgeRuntime ? 1 : 0.5) + sidecarMemLimit,
		storageGiB: agent.pod.provider === "aws" && process.env.EFS_FILE_SYSTEM_ID ? 5 : Number(process.env.AGENT_STORAGE_GIB ?? "1"),
		gpuCount: 0,
	};
}

function activeHours(agent: AgentDoc, since: Date, until: Date): number {
	if (agent.kind === "computer" && agent.compute?.activeIntervals?.length) {
		const milliseconds = agent.compute.activeIntervals.reduce((sum, interval) => {
			const start = Math.max(new Date(interval.startedAt).getTime(), since.getTime());
			const end = Math.min(
				interval.endedAt ? new Date(interval.endedAt).getTime() : until.getTime(),
				until.getTime(),
			);
			return sum + Math.max(0, end - start);
		}, 0);
		return milliseconds / 3_600_000;
	}
	if (agent.status === "terminated" || agent.status === "failed") {
		const end = agent.updatedAt && agent.updatedAt < until ? agent.updatedAt : until;
		return Math.max(0, (end.getTime() - Math.max(agent.createdAt.getTime(), since.getTime())) / 3_600_000);
	}
	return Math.max(0, (until.getTime() - Math.max(agent.createdAt.getTime(), since.getTime())) / 3_600_000);
}

function storageHours(agent: AgentDoc, since: Date, until: Date): number {
	const end = agent.status === "terminated" && agent.updatedAt < until
		? agent.updatedAt
		: until;
	return Math.max(
		0,
		(end.getTime() - Math.max(agent.createdAt.getTime(), since.getTime())) /
			3_600_000,
	);
}

function usageCost(tokens: { inputTokens: number; cachedInputTokens: number; outputTokens: number }, rate: ModelRate | null) {
	if (!rate) return 0;
	const billableInput = Math.max(0, tokens.inputTokens - tokens.cachedInputTokens);
	return (
		(billableInput / 1_000_000) * rate.inputPerMillion
		+ (tokens.cachedInputTokens / 1_000_000) * (rate.cachedInputPerMillion ?? rate.inputPerMillion)
		+ (tokens.outputTokens / 1_000_000) * rate.outputPerMillion
	);
}

function estimateTokens(agent: AgentDoc, hours: number) {
	const intensityByPath: Record<AgentDoc["config"]["integrationPath"], number> = {
		native: 18_000,
		openclaw: 26_000,
		hermes: 22_000,
		guest: 12_000,
	};
	const multiplier = agent.permissionTier === "manager" ? 1.35 : 1;
	const total = Math.round((intensityByPath[agent.config.integrationPath] ?? 14_000) * hours * multiplier);
	return {
		inputTokens: Math.round(total * 0.72),
		cachedInputTokens: Math.round(total * 0.12),
		outputTokens: Math.round(total * 0.28),
		requestCount: Math.max(1, Math.round(hours * (agent.permissionTier === "manager" ? 7 : 4))),
	};
}

function emptyTokens() {
	return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, requestCount: 0 };
}

function addTokens<T extends { inputTokens: number; cachedInputTokens: number; outputTokens: number; requestCount: number }>(target: T, tokens: T): T {
	target.inputTokens += tokens.inputTokens;
	target.cachedInputTokens += tokens.cachedInputTokens;
	target.outputTokens += tokens.outputTokens;
	target.requestCount += tokens.requestCount;
	return target;
}

function roundTokenSummary(tokens: { inputTokens: number; cachedInputTokens: number; outputTokens: number; requestCount: number }) {
	return {
		inputTokens: Math.round(tokens.inputTokens),
		cachedInputTokens: Math.round(tokens.cachedInputTokens),
		outputTokens: Math.round(tokens.outputTokens),
		requestCount: Math.round(tokens.requestCount),
		totalTokens: Math.round(tokens.inputTokens + tokens.outputTokens),
	};
}

function startOfUtcMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfUtcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfNextUtcMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export async function fleetCostReport(opts: { fleetId: string; tenantId: string; periodDays?: number; billingPeriod?: "month_to_date" | "rolling" }) {
	const billingPeriod = opts.billingPeriod ?? "rolling";
	const until = new Date();
	const since = billingPeriod === "month_to_date"
		? startOfUtcMonth(until)
		: new Date(until.getTime() - Math.max(1, Math.min(90, opts.periodDays ?? 30)) * 86_400_000);
	const estimateUntil = billingPeriod === "month_to_date" ? startOfNextUtcMonth(until) : until;
	const periodDays = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000));
	const estimateDays = Math.max(1, Math.ceil((estimateUntil.getTime() - since.getTime()) / 86_400_000));

	const fleet = await (await fleets()).findOne({ _id: opts.fleetId, tenantId: opts.tenantId }).lean();
	if (!fleet) return null;

	const agentList = await (await agents()).find({ fleetId: opts.fleetId, tenantId: opts.tenantId }).lean();
	const usageRows = await (await telemetryUsage()).find({
		fleetId: opts.fleetId,
		tenantId: opts.tenantId,
		bucketStart: { $gte: startOfUtcDay(since), $lte: until },
	}).lean();

	const usageByAgent = new Map<string, { inputTokens: number; cachedInputTokens: number; outputTokens: number; requestCount: number; provider?: string; model?: string }>();
	for (const row of usageRows) {
		const current = usageByAgent.get(row.agentId) ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, requestCount: 0 };
		current.inputTokens += Number(row.inputTokens ?? 0);
		current.cachedInputTokens += Number(row.cachedInputTokens ?? 0);
		current.outputTokens += Number(row.outputTokens ?? 0);
		current.requestCount += Number(row.requestCount ?? 0);
		if (row.provider) current.provider = row.provider;
		if (row.model) current.model = row.model;
		usageByAgent.set(row.agentId, current);
	}

	const actualTokenTotals = emptyTokens();
	const estimatedTokenTotals = emptyTokens();

	const agentsWithCosts = agentList.map((agent) => {
		const hours = activeHours(agent, since, until);
		const estimateHours = activeHours(agent, since, estimateUntil);
		const provider = normalizeProvider(
			usageByAgent.get(agent._id)?.provider ?? agent.config.nativeConfig?.modelProvider ?? agent.config.hermesConfig?.modelProvider ?? agent.config.openclawConfig?.modelProvider,
			agent.config.integrationPath,
		);
		const model = normalizeModel(
			usageByAgent.get(agent._id)?.model
				?? agent.config.hermesConfig?.modelId
				?? agent.config.openclawConfig?.modelId
				?? agent.config.nativeConfig?.modelId
				?? (agent.config.integrationPath === "openclaw" ? process.env.OPENCLAW_MODEL_ID : undefined),
			provider,
			agent.config.integrationPath,
		);
		const rate = rateFor(provider, model);
		const usage = usageByAgent.get(agent._id);
		const elapsedEstimatedTokens = estimateTokens(agent, hours);
		const estimatedTokens = estimateTokens(agent, estimateHours);
		const actualTokens = usage ?? emptyTokens();
		addTokens(actualTokenTotals, actualTokens);
		addTokens(estimatedTokenTotals, estimatedTokens);
		const tokens = usage ?? elapsedEstimatedTokens;
		const profile = resourceProfile(agent);
		const persistedHours = storageHours(agent, since, until);
		const cloudProvider = agent.pod.provider === "aws" ? "aws" : "gcp";
		const infraRates = DEFAULT_INFRA_RATES[cloudProvider];
		const computeCost = hours * (
			profile.cpuRequestCores * infraRates.cpuCoreHour
			+ profile.memoryRequestGiB * infraRates.memoryGiBHour
			+ profile.gpuCount * infraRates.gpuHour
		);
		const storageCost = (profile.storageGiB * infraRates.storageGiBMonth) * (persistedHours / HOURS_PER_MONTH);
		const tokenCost = usageCost(tokens, rate);
		const rawCost = tokenCost + computeCost + storageCost;
		const billedCost = rawCost * (1 + DEFAULT_MARKUP_RATE);

		return {
			agentId: agent._id,
			role: agent.config.role,
			status: agent.status,
			integrationPath: agent.config.integrationPath,
			provider,
			model,
			rateSource: rate?.source ?? "unknown-model-rate",
			confidence: usage ? "actual" : "estimated",
			activeHours: Number(hours.toFixed(2)),
			storageHours: Number(persistedHours.toFixed(2)),
			tokens,
			actualTokens: roundTokenSummary(actualTokens),
			estimatedTokens: roundTokenSummary(estimatedTokens),
			usageComparison: {
				actualTokens: Math.round(actualTokens.inputTokens + actualTokens.outputTokens),
				estimatedTokens: Math.round(estimatedTokens.inputTokens + estimatedTokens.outputTokens),
				ratio: estimatedTokens.inputTokens + estimatedTokens.outputTokens > 0
					? Number(((actualTokens.inputTokens + actualTokens.outputTokens) / (estimatedTokens.inputTokens + estimatedTokens.outputTokens)).toFixed(4))
					: null,
			},
			resources: profile,
			cost: {
				tokens: Number(tokenCost.toFixed(4)),
				compute: Number(computeCost.toFixed(4)),
				storage: Number(storageCost.toFixed(4)),
				raw: Number(rawCost.toFixed(4)),
				markup: Number((billedCost - rawCost).toFixed(4)),
				billed: Number(billedCost.toFixed(4)),
			},
		};
	});

	const totals = agentsWithCosts.reduce((acc, agent) => {
		acc.tokens += agent.cost.tokens;
		acc.compute += agent.cost.compute;
		acc.storage += agent.cost.storage;
		acc.raw += agent.cost.raw;
		acc.markup += agent.cost.markup;
		acc.billed += agent.cost.billed;
		acc.inputTokens += agent.tokens.inputTokens;
		acc.cachedInputTokens += agent.tokens.cachedInputTokens;
		acc.outputTokens += agent.tokens.outputTokens;
		acc.requestCount += agent.tokens.requestCount;
		return acc;
	}, { tokens: 0, compute: 0, storage: 0, raw: 0, markup: 0, billed: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, requestCount: 0 });

	return {
		fleetId: fleet._id,
		fleetName: fleet.name,
		period: { since: since.toISOString(), until: until.toISOString(), days: periodDays },
		billingPeriod,
		estimatePeriod: { since: since.toISOString(), until: estimateUntil.toISOString(), days: estimateDays },
		markupRate: DEFAULT_MARKUP_RATE,
		confidence: usageRows.length > 0 ? "mixed" : "estimated",
		usageComparison: {
			actual: roundTokenSummary(actualTokenTotals),
			estimated: roundTokenSummary(estimatedTokenTotals),
			ratio: estimatedTokenTotals.inputTokens + estimatedTokenTotals.outputTokens > 0
				? Number(((actualTokenTotals.inputTokens + actualTokenTotals.outputTokens) / (estimatedTokenTotals.inputTokens + estimatedTokenTotals.outputTokens)).toFixed(4))
				: null,
		},
		totals: {
			...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value.toFixed(key.endsWith("Tokens") || key === "requestCount" ? 0 : 4))])),
		},
		agents: agentsWithCosts,
		sources: {
			tokenPricing: ["openai-api-pricing", "anthropic-api-pricing", "gemini-api-pricing"],
			tokenUsage: ["telemetry_usage:daily-rollups"],
			computePricing: ["env:gcp-rates", "env:aws-rates", "recommended:opencost-or-kubecost-for-actual-allocation"],
		},
	};
}
