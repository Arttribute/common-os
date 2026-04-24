import type { CloudProvider } from "./index.js";
import { AWSProvider } from "./providers/aws.js";
import { GCPProvider } from "./providers/gcp.js";

export function getCloudProvider(
  provider: "aws" | "gcp",
  regionOrZone: string
): CloudProvider {
  if (provider === "aws") {
    return new AWSProvider(regionOrZone);
  }
  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error("GCP_PROJECT_ID env var required for GCP provider");
  return new GCPProvider(project, regionOrZone);
}
