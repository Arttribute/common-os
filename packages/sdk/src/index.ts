import type { AgentEvent } from "@common-os/events";

export interface CommonOSClientOptions {
	apiKey: string;
	apiUrl?: string;
}

export interface CommonOSAgentClientOptions {
	agentToken: string;
	agentId: string;
	apiUrl?: string;
}

export class CommonOSClient {
	private readonly apiKey: string;
	private readonly apiUrl: string;
	private readonly basePath: string;

	constructor(options: CommonOSClientOptions) {
		this.apiKey = options.apiKey;
		this.apiUrl = (
			options.apiUrl ??
			"https://api.agentcommons.io"
		).replace(/\/$/, "");
		this.basePath = this.apiUrl === "https://api.agentcommons.io" ? "/v1/compute" : "";
	}

	readonly fleets = {
		create: (body: {
			name: string;
			provider?: "aws" | "gcp";
			region?: string;
		}) => this.post("/fleets", body),
		list: () => this.get("/fleets"),
		get: (fleetId: string) => this.get(`/fleets/${fleetId}`),
	};

	readonly agents = {
		deploy: (fleetId: string, body: Record<string, unknown>) =>
			this.post(`/fleets/${fleetId}/agents`, body),
		list: (fleetId: string) => this.get(`/fleets/${fleetId}/agents`),
		get: (fleetId: string, agentId: string) =>
			this.get(`/fleets/${fleetId}/agents/${agentId}`),
		terminate: (fleetId: string, agentId: string) =>
			this.delete(`/fleets/${fleetId}/agents/${agentId}`),
		update: (fleetId: string, agentId: string, body: Record<string, unknown>) =>
			this.patch(`/fleets/${fleetId}/agents/${agentId}`, body),
	};

	readonly computers = {
		create: (body: {
			fleetId?: string;
			name?: string;
			role?: string;
			systemPrompt?: string;
			permissionTier?: "manager" | "worker";
			room?: string;
			integrationPath?: "native" | "openclaw" | "hermes" | "guest";
			dockerImage?: string | null;
			image?: string | null;
			agentCommonsId?: string;
			[key: string]: unknown;
		}) => this.post("/computers", body),
		list: (query: { fleetId?: string; includeTerminated?: boolean } = {}) => {
			const params = new URLSearchParams();
			if (query.fleetId) params.set("fleetId", query.fleetId);
			if (query.includeTerminated) params.set("includeTerminated", "true");
			const qs = params.toString();
			return this.get(`/computers${qs ? `?${qs}` : ""}`);
		},
		get: (computerId: string) => this.get(`/computers/${computerId}`),
		runtimeStatus: (computerId: string) =>
			this.get(`/computers/${computerId}/runtime-status`),
		readFile: (computerId: string, path: string) =>
			this.get(`/computers/${computerId}/workspace/read?path=${encodeURIComponent(path)}`),
		instruct: (computerId: string, body: { content: string; sessionId?: string }) =>
			this.post(`/computers/${computerId}/instructions`, body),
		instructions: (computerId: string) =>
			this.get(`/computers/${computerId}/instructions`),
		terminate: (computerId: string) => this.delete(`/computers/${computerId}`),
	};

	readonly tasks = {
		send: (fleetId: string, agentId: string, body: { description: string }) =>
			this.post(`/fleets/${fleetId}/agents/${agentId}/task`, body),
		list: (fleetId: string, agentId: string) =>
			this.get(`/fleets/${fleetId}/agents/${agentId}/tasks`),
	};

	readonly world = {
		snapshot: (fleetId: string) => this.get(`/fleets/${fleetId}/world`),
		streamUrl: (fleetId: string): string =>
			`${(
				this.basePath
					? "https://co-34acbf16a9a0464c8be79137d4f7bbd6.ecs.eu-west-1.on.aws"
					: this.apiUrl
			).replace(/^http/, "ws")}/fleets/${fleetId}/stream?token=${this.apiKey}`,
		peers: (fleetId: string) => this.get(`/fleets/${fleetId}/peers`),
	};

	readonly messages = {
		send: (
			fleetId: string,
			toAgentId: string,
			body: { content: string; fromAgentId?: string; axlMessageId?: string },
		) => this.post(`/fleets/${fleetId}/agents/${toAgentId}/message`, body),
	};

	readonly auth = {
		me: () => this.get("/auth/me"),
	};

	private async get(path: string) {
		const res = await fetch(`${this.apiUrl}${this.basePath}${path}`, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
		});
		if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
		return res.json();
	}

	private async post(path: string, body: unknown) {
		const res = await fetch(`${this.apiUrl}${this.basePath}${path}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
		return res.json();
	}

	private async patch(path: string, body: unknown) {
		const res = await fetch(`${this.apiUrl}${this.basePath}${path}`, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${res.statusText}`);
		return res.json();
	}

	private async delete(path: string) {
		const res = await fetch(`${this.apiUrl}${this.basePath}${path}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${this.apiKey}` },
		});
		if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText}`);
		return res.json();
	}
}

export class CommonOSAgentClient {
	private readonly agentToken: string;
	private readonly agentId: string;
	private readonly apiUrl: string;
	private readonly basePath: string;

	constructor(options: CommonOSAgentClientOptions) {
		this.agentToken = options.agentToken;
		this.agentId = options.agentId;
		this.apiUrl = (
			options.apiUrl ??
			"https://api.agentcommons.io"
		).replace(/\/$/, "");
		this.basePath = this.apiUrl === "https://api.agentcommons.io" ? "/v1/compute" : "";
	}

	async emit(event: AgentEvent): Promise<void> {
		const res = await fetch(`${this.apiUrl}${this.basePath}/events`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.agentToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ agentId: this.agentId, ...event }),
		});
		if (!res.ok) {
			throw new Error(`POST /events failed: ${res.status} ${res.statusText}`);
		}
	}

	async nextTask(): Promise<{ id: string; description: string } | null> {
		const res = await fetch(
			`${this.apiUrl}${this.basePath}/agents/${this.agentId}/tasks/next`,
			{ headers: { Authorization: `Bearer ${this.agentToken}` } },
		);
		if (res.status === 204) return null;
		if (!res.ok) return null;
		const data = await res.json() as { id?: string; description?: string };
		if (!data.id || !data.description) return null;
		return data as { id: string; description: string };
	}

	async completeTask(taskId: string, output?: string): Promise<void> {
		await fetch(
			`${this.apiUrl}${this.basePath}/agents/${this.agentId}/tasks/${taskId}/complete`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.agentToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ output }),
			},
		);
	}

	async failTask(taskId: string, error: string): Promise<void> {
		await fetch(
			`${this.apiUrl}${this.basePath}/agents/${this.agentId}/tasks/${taskId}/complete`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.agentToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ error }),
			},
		);
	}
}
