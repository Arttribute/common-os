import { Command } from "commander";

const program = new Command();

program
  .name("commonos")
  .description("CommonOS CLI — deploy and manage AI agent fleets")
  .version("0.1.0");

program
  .command("auth")
  .description("Authentication commands")
  .addCommand(
    new Command("login").description("Authenticate with CommonOS").action(() => {
      console.log("commonos auth login — not yet implemented");
    })
  )
  .addCommand(
    new Command("whoami").description("Show current authenticated user").action(() => {
      console.log("commonos auth whoami — not yet implemented");
    })
  )
  .addCommand(
    new Command("logout").description("Log out").action(() => {
      console.log("commonos auth logout — not yet implemented");
    })
  );

program
  .command("fleet")
  .description("Fleet management commands")
  .addCommand(
    new Command("create")
      .description("Create a new fleet")
      .requiredOption("--name <name>", "Fleet name")
      .requiredOption("--provider <provider>", "Cloud provider: aws or gcp")
      .option("--region <region>", "Cloud region", "us-east-1")
      .action(() => {
        console.log("commonos fleet create — not yet implemented");
      })
  )
  .addCommand(
    new Command("ls").description("List all fleets").action(() => {
      console.log("commonos fleet ls — not yet implemented");
    })
  )
  .addCommand(
    new Command("status")
      .description("Show fleet status")
      .argument("<fleet-id>", "Fleet ID")
      .action(() => {
        console.log("commonos fleet status — not yet implemented");
      })
  );

program
  .command("agent")
  .description("Agent management commands")
  .addCommand(
    new Command("deploy")
      .description("Deploy an agent VM to a fleet")
      .requiredOption("--fleet <fleet-id>", "Fleet ID")
      .requiredOption("--role <role>", "Agent role")
      .option("--prompt <prompt>", "System prompt string or file path")
      .option("--image <image>", "Docker image URI (guest path)")
      .action(() => {
        console.log("commonos agent deploy — not yet implemented");
      })
  )
  .addCommand(
    new Command("ls")
      .description("List agents in a fleet")
      .requiredOption("--fleet <fleet-id>", "Fleet ID")
      .action(() => {
        console.log("commonos agent ls — not yet implemented");
      })
  )
  .addCommand(
    new Command("logs")
      .description("Stream agent task logs")
      .argument("<agent-id>", "Agent ID")
      .action(() => {
        console.log("commonos agent logs — not yet implemented");
      })
  )
  .addCommand(
    new Command("stop")
      .description("Stop an agent VM")
      .argument("<agent-id>", "Agent ID")
      .action(() => {
        console.log("commonos agent stop — not yet implemented");
      })
  )
  .addCommand(
    new Command("terminate")
      .description("Terminate an agent VM")
      .argument("<agent-id>", "Agent ID")
      .action(() => {
        console.log("commonos agent terminate — not yet implemented");
      })
  );

program
  .command("task")
  .description("Task management commands")
  .addCommand(
    new Command("send")
      .description("Send a task to an agent")
      .argument("<agent-id>", "Agent ID")
      .argument("<description>", "Task description")
      .action(() => {
        console.log("commonos task send — not yet implemented");
      })
  )
  .addCommand(
    new Command("ls")
      .description("List tasks for an agent")
      .argument("<agent-id>", "Agent ID")
      .action(() => {
        console.log("commonos task ls — not yet implemented");
      })
  );

program.parse();
