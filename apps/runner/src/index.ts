import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: "*" }));

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }));

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
		const result = await Bun.$`agent-commons run --agent-id ${{ raw: body.agentId }}${body.sessionId ? ` --session-id ${{ raw: body.sessionId }}` : ""} --prompt ${{ raw: body.prompt }}`;
		const output = await result.text();
		return c.json({ agentId: body.agentId, sessionId: body.sessionId ?? null, output });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ error: "Command execution failed", details: message }, 500);
	}
});

const port = Number(process.env.PORT ?? 3002);
Bun.serve({ port, fetch: app.fetch });
console.log(`Runner listening on http://localhost:${port}`);

export default app;
