import { Command } from "commander";
import { CommonOSClient } from "@common-os/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import chalk from "chalk";
import ora from "ora";

const CONFIG_DIR  = join(homedir(), ".commonos");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface CLIConfig {
  apiKey?: string;
  apiUrl?: string;
}

function loadCLIConfig(): CLIConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")); }
  catch { return {}; }
}

function saveCLIConfig(cfg: CLIConfig) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function getClient(): CommonOSClient {
  const cfg    = loadCLIConfig();
  const apiKey = process.env.COMMONOS_API_KEY ?? cfg.apiKey;
  if (!apiKey) {
    console.error(chalk.red("Not authenticated. Run:  commonos auth login --key <api-key>"));
    process.exit(1);
  }
  return new CommonOSClient({
    apiKey,
    apiUrl: process.env.COMMONOS_API_URL ?? cfg.apiUrl,
  });
}

function print(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

// ─── Root ───────────────────────────────────────────────────────────────────

const program = new Command();
program
  .name("commonos")
  .description("CommonOS CLI — deploy and manage AI agent fleets")
  .version("0.1.0");

// ─── auth ───────────────────────────────────────────────────────────────────

const authCmd = new Command("auth").description("Authentication commands");

authCmd.addCommand(
  new Command("login")
    .description("Authenticate with CommonOS")
    .requiredOption("--key <api-key>", "API key (cos_live_...)")
    .option("--url <api-url>", "API base URL (defaults to the CommonOS AWS API)")
    .action(async (opts: { key: string; url?: string }) => {
      const spinner = ora("Verifying API key…").start();
      try {
        const client = new CommonOSClient({ apiKey: opts.key, apiUrl: opts.url });
        const me = await client.auth.me();
        saveCLIConfig({ apiKey: opts.key, apiUrl: opts.url });
        spinner.succeed(chalk.green(`Authenticated  ${JSON.stringify(me)}`));
      } catch {
        spinner.fail(chalk.red("Invalid API key or API unreachable"));
        process.exit(1);
      }
    }),
);

authCmd.addCommand(
  new Command("whoami")
    .description("Show current authenticated user")
    .action(async () => {
      print(await getClient().auth.me());
    }),
);

authCmd.addCommand(
  new Command("logout")
    .description("Clear stored credentials")
    .action(() => {
      const cfg = loadCLIConfig();
      delete cfg.apiKey;
      saveCLIConfig(cfg);
      console.log(chalk.gray("Logged out."));
    }),
);

program.addCommand(authCmd);

// ─── fleet ──────────────────────────────────────────────────────────────────

const fleetCmd = new Command("fleet").description("Fleet management commands");

fleetCmd.addCommand(
  new Command("create")
    .description("Create a new fleet")
    .requiredOption("--name <name>", "Fleet name")
    .option("--provider <provider>", "Cloud provider (production: aws)", "aws")
    .option("--region <region>", "Cloud region", "us-east-1")
    .action(async (opts: { name: string; provider: string; region: string }) => {
      const spinner = ora("Creating fleet…").start();
      try {
        const fleet = await getClient().fleets.create({
          name: opts.name,
          provider: opts.provider as "aws" | "gcp",
          region: opts.region,
        });
        spinner.succeed(chalk.green("Fleet created"));
        print(fleet);
      } catch (err) {
        spinner.fail(chalk.red("Failed to create fleet"));
        console.error(err);
        process.exit(1);
      }
    }),
);

fleetCmd.addCommand(
  new Command("ls")
    .description("List all fleets")
    .action(async () => {
      const spinner = ora("Loading fleets…").start();
      try {
        const fleets = await getClient().fleets.list();
        spinner.stop();
        print(fleets);
      } catch (err) {
        spinner.fail(chalk.red("Failed to list fleets"));
        console.error(err);
        process.exit(1);
      }
    }),
);

fleetCmd.addCommand(
  new Command("status")
    .description("Show fleet status")
    .argument("<fleet-id>", "Fleet ID")
    .action(async (fleetId: string) => {
      print(await getClient().fleets.get(fleetId));
    }),
);

program.addCommand(fleetCmd);

// ─── agent ──────────────────────────────────────────────────────────────────

const agentCmd = new Command("agent").description("Agent management commands");

agentCmd.addCommand(
  new Command("deploy")
    .description("Deploy an agent to a fleet")
    .requiredOption("--fleet <fleet-id>", "Fleet ID")
    .requiredOption("--role <role>",      "Agent role (e.g. backend-engineer)")
    .option("--prompt <prompt>",  "System prompt string")
    .option("--image <image>",    "Docker image URI (enables guest path)")
    .option("--runtime <runtime>", "Runtime: native, openclaw, hermes, or guest")
    .option("--model-provider <provider>", "Model provider", "openai")
    .option("--model <model>", "Model ID (native default: gpt-5.4-mini)")
    .option("--model-api-key <key>", "Model provider API key")
    .option("--gateway-api-key <key>", "Gateway API key for Hermes")
    .option("--plugins <plugins>", "Comma-separated OpenClaw plugins")
    .option("--tier <tier>",      "Permission tier: manager or worker", "worker")
    .option("--room <room>",      "Room to place agent in",             "dev-room")
    .option("--type <type>",      "Cloud instance type",                "t3.medium")
    .action(async (opts: {
      fleet: string; role: string; prompt?: string; image?: string;
      runtime?: "native" | "openclaw" | "hermes" | "guest";
      modelProvider: string; model?: string; modelApiKey?: string; gatewayApiKey?: string; plugins?: string;
      tier: string; room: string; type: string;
    }) => {
      const spinner = ora(`Deploying ${opts.role}…`).start();
      try {
        const integrationPath = opts.runtime ?? (opts.image ? "guest" : "native");
        if (!["native", "openclaw", "hermes", "guest"].includes(integrationPath)) {
          throw new Error(`Unsupported runtime "${integrationPath}"`);
        }
        const result = await getClient().agents.deploy(opts.fleet, {
          role:            opts.role,
          systemPrompt:    opts.prompt ?? `You are a ${opts.role} in a software team.`,
          permissionTier:  opts.tier,
          room:            opts.room,
          dockerImage:     opts.image ?? null,
          integrationPath,
          instanceType:    opts.type,
          ...(integrationPath === "native"
            ? {
                nativeConfig: {
                  modelProvider: opts.modelProvider,
                  modelId: opts.model,
                  modelApiKey: opts.modelApiKey,
                },
              }
            : {}),
          ...(integrationPath === "openclaw"
            ? {
                openclawConfig: {
                  modelProvider: opts.modelProvider,
                  modelId: opts.model,
                  modelApiKey: opts.modelApiKey,
                  plugins: opts.plugins?.split(",").map((plugin) => plugin.trim()).filter(Boolean) ?? [],
                },
              }
            : {}),
          ...(integrationPath === "hermes"
            ? {
                hermesConfig: {
                  modelProvider: opts.modelProvider,
                  modelId: opts.model,
                  modelApiKey: opts.modelApiKey,
                  gatewayApiKey: opts.gatewayApiKey,
                },
              }
            : {}),
        });
        const id = (result as { agentId?: string })?.agentId ?? "";
        spinner.succeed(chalk.green(`Agent deployed${id ? `  ${id}` : ""}`));
        print(result);
      } catch (err) {
        spinner.fail(chalk.red("Deploy failed"));
        console.error(err);
        process.exit(1);
      }
    }),
);

agentCmd.addCommand(
  new Command("ls")
    .description("List agents in a fleet")
    .requiredOption("--fleet <fleet-id>", "Fleet ID")
    .action(async (opts: { fleet: string }) => {
      print(await getClient().agents.list(opts.fleet));
    }),
);

agentCmd.addCommand(
  new Command("terminate")
    .description("Permanently terminate an agent and delete its pod")
    .argument("<agent-id>", "Agent ID")
    .requiredOption("--fleet <fleet-id>", "Fleet ID")
    .action(async (agentId: string, opts: { fleet: string }) => {
      const spinner = ora("Terminating…").start();
      try {
        const result = await getClient().agents.terminate(opts.fleet, agentId);
        spinner.succeed(chalk.yellow("Agent terminated"));
        print(result);
      } catch (err) {
        spinner.fail(chalk.red("Termination failed"));
        console.error(err);
        process.exit(1);
      }
    }),
);

agentCmd.addCommand(
  new Command("logs")
    .description("Stream agent task history")
    .argument("<agent-id>", "Agent ID")
    .requiredOption("--fleet <fleet-id>", "Fleet ID")
    .action(async (agentId: string, opts: { fleet: string }) => {
      const tasks = await getClient().tasks.list(opts.fleet, agentId);
      print(tasks);
    }),
);

program.addCommand(agentCmd);

// ─── computer ────────────────────────────────────────────────────────────────

const computerCmd = new Command("computer").description("Persistent agent computer commands");

computerCmd.addCommand(
  new Command("create")
    .description("Provision or wake an agent's one persistent computer")
    .option("--name <name>", "Computer name", "computer")
    .option("--prompt <prompt>", "Runtime system prompt")
    .option("--image <image>", "Docker image URI")
    .requiredOption("--agent-commons-id <agent-id>", "Agent Commons agent ID to bind ownership")
    .option("--profile <profile>", "starter, standard, performance, or gpu", "standard")
    .option("--mode <mode>", "elastic or fixed", "elastic")
    .action(async (opts: {
      name: string;
      prompt?: string;
      image?: string;
      agentCommonsId: string;
      profile: "starter" | "standard" | "performance" | "gpu";
      mode: "elastic" | "fixed";
    }) => {
      const spinner = ora(`Provisioning ${opts.name}…`).start();
      try {
        const result = await getClient().computers.create({
          name: opts.name,
          systemPrompt: opts.prompt,
          dockerImage: opts.image ?? null,
          agentCommonsId: opts.agentCommonsId,
          resourceProfile: opts.profile,
          resourceMode: opts.mode,
        });
        const id = (result as { _id?: string })?._id ?? "";
        spinner.succeed(chalk.green(`Computer provisioned${id ? `  ${id}` : ""}`));
        print(result);
      } catch (err) {
        spinner.fail(chalk.red("Provisioning failed"));
        console.error(err);
        process.exit(1);
      }
    }),
);

computerCmd.addCommand(
  new Command("ls")
    .description("List persistent agent computers")
    .option("--agent-commons-id <agent-id>", "Filter by Agent Commons agent")
    .option("--all", "Include terminated computers")
    .action(async (opts: { agentCommonsId?: string; all?: boolean }) => {
      print(await getClient().computers.list({
        agentCommonsId: opts.agentCommonsId,
        includeTerminated: Boolean(opts.all),
      }));
    }),
);

computerCmd.addCommand(
  new Command("status")
    .description("Show computer status")
    .argument("<computer-id>", "Computer ID")
    .action(async (computerId: string) => {
      print(await getClient().computers.get(computerId));
    }),
);

for (const action of ["wake", "sleep", "restart"] as const) {
  computerCmd.addCommand(
    new Command(action)
      .description(
        action === "sleep"
          ? "Sleep compute while retaining the persistent workspace"
          : action === "restart"
            ? "Replace the runtime while retaining the persistent workspace"
            : "Wake the persistent computer",
      )
      .argument("<computer-id>", "Computer ID")
      .action(async (computerId: string) => {
        const spinner = ora(`${action[0]!.toUpperCase()}${action.slice(1)}ing computer…`).start();
        try {
          const result = await getClient().computers[action](computerId);
          spinner.succeed(chalk.green(`Computer ${action} requested`));
          print(result);
        } catch (error) {
          spinner.fail(chalk.red(`Computer ${action} failed`));
          console.error(error);
          process.exit(1);
        }
      }),
  );
}

computerCmd.addCommand(
  new Command("resize")
    .description("Change the computer's elastic resource ceiling")
    .argument("<computer-id>", "Computer ID")
    .option("--profile <profile>", "starter, standard, performance, or gpu")
    .option("--mode <mode>", "elastic or fixed")
    .option("--vcpu <count>", "vCPU ceiling")
    .option("--memory <gib>", "Memory ceiling in GiB")
    .option("--storage <gib>", "Persistent storage in GiB (grow only)")
    .action(async (computerId: string, opts: { profile?: any; mode?: any; vcpu?: string; memory?: string; storage?: string }) => {
      const resources = {
        ...(opts.vcpu ? { vcpu: Number(opts.vcpu) } : {}),
        ...(opts.memory ? { memoryGiB: Number(opts.memory) } : {}),
        ...(opts.storage ? { storageGiB: Number(opts.storage) } : {}),
      };
      print(await getClient().computers.resize(computerId, {
        ...(opts.profile ? { resourceProfile: opts.profile } : {}),
        ...(opts.mode ? { resourceMode: opts.mode } : {}),
        ...(Object.keys(resources).length ? { resources } : {}),
      }));
    }),
);

computerCmd.addCommand(
  new Command("runtime")
    .description("Show runtime diagnostics for a computer")
    .argument("<computer-id>", "Computer ID")
    .action(async (computerId: string) => {
      print(await getClient().computers.runtimeStatus(computerId));
    }),
);

computerCmd.addCommand(
  new Command("read")
    .description("Read a workspace file from a computer")
    .argument("<computer-id>", "Computer ID")
    .argument("<path>", "Workspace path")
    .action(async (computerId: string, path: string) => {
      print(await getClient().computers.readFile(computerId, path));
    }),
);

computerCmd.addCommand(
  new Command("instruct")
    .description("Send a runtime instruction to a computer")
    .argument("<computer-id>", "Computer ID")
    .argument("<content>", "Instruction content")
    .option("--session <session-id>", "Runtime session ID")
    .action(async (computerId: string, content: string, opts: { session?: string }) => {
      const spinner = ora("Sending instruction…").start();
      try {
        const result = await getClient().computers.instruct(computerId, {
          content,
          sessionId: opts.session,
        });
        spinner.succeed(chalk.green("Instruction queued"));
        print(result);
      } catch (err) {
        spinner.fail(chalk.red("Instruction failed"));
        console.error(err);
        process.exit(1);
      }
    }),
);

computerCmd.addCommand(
  new Command("instructions")
    .description("List recent computer instructions")
    .argument("<computer-id>", "Computer ID")
    .action(async (computerId: string) => {
      print(await getClient().computers.instructions(computerId));
    }),
);

computerCmd.addCommand(
  new Command("terminate")
    .description("Permanently destroy a computer and its workspace")
    .argument("<computer-id>", "Computer ID")
    .action(async (computerId: string) => {
      const spinner = ora("Terminating computer…").start();
      try {
        const result = await getClient().computers.destroy(computerId);
        spinner.succeed(chalk.yellow("Computer and workspace destroyed"));
        print(result);
      } catch (err) {
        spinner.fail(chalk.red("Termination failed"));
        console.error(err);
        process.exit(1);
      }
    }),
);

program.addCommand(computerCmd);

// ─── task ───────────────────────────────────────────────────────────────────

const taskCmd = new Command("task").description("Task management commands");

taskCmd.addCommand(
  new Command("send")
    .description("Send a task to an agent")
    .argument("<agent-id>",    "Agent ID")
    .argument("<description>", "Task description")
    .requiredOption("--fleet <fleet-id>", "Fleet ID")
    .action(async (agentId: string, description: string, opts: { fleet: string }) => {
      const spinner = ora("Queuing task…").start();
      try {
        const task = await getClient().tasks.send(opts.fleet, agentId, { description });
        spinner.succeed(chalk.green("Task queued"));
        print(task);
      } catch (err) {
        spinner.fail(chalk.red("Failed to send task"));
        console.error(err);
        process.exit(1);
      }
    }),
);

taskCmd.addCommand(
  new Command("ls")
    .description("List tasks for an agent")
    .argument("<agent-id>", "Agent ID")
    .requiredOption("--fleet <fleet-id>", "Fleet ID")
    .action(async (agentId: string, opts: { fleet: string }) => {
      print(await getClient().tasks.list(opts.fleet, agentId));
    }),
);

program.addCommand(taskCmd);

// ─── world ──────────────────────────────────────────────────────────────────

const worldCmd = new Command("world").description("World / live view commands");

worldCmd.addCommand(
  new Command("snapshot")
    .description("Print the current world state snapshot")
    .argument("<fleet-id>", "Fleet ID")
    .action(async (fleetId: string) => {
      print(await getClient().world.snapshot(fleetId));
    }),
);

worldCmd.addCommand(
  new Command("stream-url")
    .description("Print the WebSocket stream URL for a fleet")
    .argument("<fleet-id>", "Fleet ID")
    .action((fleetId: string) => {
      console.log(getClient().world.streamUrl(fleetId));
    }),
);

program.addCommand(worldCmd);

// ─── Parse ──────────────────────────────────────────────────────────────────

program.parse();
