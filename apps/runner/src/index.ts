import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: "*" }));

app.get("/health", (c) =>
	c.json({ status: "ok", ts: new Date().toISOString() }),
);

app.post("/run", async (c) => {
	const body = await c.req.json<{
		agentId: string;
		sessionId?: string;
		prompt: string;
	}>();

	if (!body.agentId || !body.prompt) {
		return c.json({ error: "agentId and prompt are required" }, 400);
	}

	try {
		const args = ["run", "--agent-id", body.agentId, "--prompt", body.prompt];
		if (body.sessionId) args.push("--session-id", body.sessionId);
		const result = await Bun.$`agent-commons ${args}`;
		const output = await result.text();
		return c.json({
			agentId: body.agentId,
			sessionId: body.sessionId ?? null,
			output,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ error: "Command execution failed", details: message }, 500);
	}
});

const port = Number(process.env.PORT ?? 3002);
Bun.serve({ port, hostname: process.env.HOST, fetch: app.fetch });
console.log(
	`Runner listening on http://${process.env.HOST || "localhost"}:${port}`,
);
