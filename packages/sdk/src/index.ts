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

	constructor(options: CommonOSClientOptions) {
		this.apiKey = options.apiKey;
		this.apiUrl = (options.apiUrl ?? "https://api.commonos.dev").replace(
			/\/$/,
			"",
		);
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

	readonly tasks = {
		send: (fleetId: string, agentId: string, body: { description: string }) =>
			this.post(`/fleets/${fleetId}/agents/${agentId}/task`, body),
		list: (fleetId: string, agentId: string) =>
			this.get(`/fleets/${fleetId}/agents/${agentId}/tasks`),
	};

	readonly world = {
		snapshot: (fleetId: string) => this.get(`/fleets/${fleetId}/world`),
		streamUrl: (fleetId: string): string =>
			`${this.apiUrl.replace(/^http/, "ws")}/fleets/${fleetId}/stream?token=${this.apiKey}`,
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
		const res = await fetch(`${this.apiUrl}${path}`, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
		});
		if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
		return res.json();
	}

	private async post(path: string, body: unknown) {
		const res = await fetch(`${this.apiUrl}${path}`, {
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
		const res = await fetch(`${this.apiUrl}${path}`, {
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
		const res = await fetch(`${this.apiUrl}${path}`, {
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

	constructor(options: CommonOSAgentClientOptions) {
		this.agentToken = options.agentToken;
		this.agentId = options.agentId;
		this.apiUrl = (options.apiUrl ?? "https://api.commonos.dev").replace(
			/\/$/,
			"",
		);
	}

	async emit(event: AgentEvent): Promise<void> {
		await fetch(`${this.apiUrl}/events`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.agentToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ agentId: this.agentId, ...event }),
		});
	}

	async nextTask(): Promise<{ id: string; description: string } | null> {
		const res = await fetch(
			`${this.apiUrl}/agents/${this.agentId}/tasks/next`,
			{ headers: { Authorization: `Bearer ${this.agentToken}` } },
		);
		if (res.status === 204) return null;
		return res.json();
	}

	async completeTask(taskId: string, output?: string): Promise<void> {
		await fetch(
			`${this.apiUrl}/agents/${this.agentId}/tasks/${taskId}/complete`,
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
}
