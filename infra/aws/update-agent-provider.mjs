import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { MongoClient } = require("mongodb");

const [snapshotPath, region = "eu-west-1"] = process.argv.slice(2);
if (!snapshotPath || !process.env.MONGODB_URI) {
  throw new Error("Usage: MONGODB_URI=... node update-agent-provider.mjs <pods.json> [region]");
}

const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const agentIds = snapshot.items
  .map((pod) => pod.metadata?.labels?.["agent-id"])
  .filter(Boolean);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const result = await client.db("commonos").collection("agents").updateMany(
    { _id: { $in: agentIds } },
    {
      $set: {
        "pod.provider": "aws",
        "pod.region": region,
        updatedAt: new Date(),
      },
    },
  );

  if (result.matchedCount !== agentIds.length) {
    throw new Error(`Expected ${agentIds.length} agents, matched ${result.matchedCount}`);
  }
  let terminatedCount = 0;
  if (process.env.RETAIN_FLEET_ID) {
    const terminated = await client.db("commonos").collection("agents").updateMany(
      { "pod.provider": "gcp", fleetId: { $ne: process.env.RETAIN_FLEET_ID } },
      { $set: { status: "terminated", updatedAt: new Date() } },
    );
    terminatedCount = terminated.modifiedCount;
  }
  console.log(`Updated ${result.modifiedCount} agents to AWS EKS in ${region}; terminated ${terminatedCount} legacy test agents.`);
} finally {
  await client.close();
}
