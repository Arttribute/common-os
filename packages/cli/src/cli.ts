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
    .option("--url <api-url>", "API base URL (default: https://api.commonos.dev)")
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
    .option("--provider <provider>", "Cloud provider: aws or gcp", "aws")
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
    .option("--tier <tier>",      "Permission tier: manager or worker", "worker")
    .option("--room <room>",      "Room to place agent in",             "dev-room")
    .option("--type <type>",      "Cloud instance type",                "t3.medium")
    .action(async (opts: {
      fleet: string; role: string; prompt?: string; image?: string;
      tier: string; room: string; type: string;
    }) => {
      const spinner = ora(`Deploying ${opts.role}…`).start();
      try {
        const result = await getClient().agents.deploy(opts.fleet, {
          role:            opts.role,
          systemPrompt:    opts.prompt ?? `You are a ${opts.role} in a software team.`,
          permissionTier:  opts.tier,
          room:            opts.room,
          dockerImage:     opts.image ?? null,
          integrationPath: opts.image ? "guest" : "native",
          instanceType:    opts.type,
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
  new Command("stop")
    .description("Terminate an agent VM")
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
