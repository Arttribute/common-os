# CommonOS Project Summary

## Overview
CommonOS is a deployment and management platform designed for AI agent fleets. It provides each agent with a dedicated, isolated runtime and persistent state, making them manageable as durable workers. This platform is akin to how Vercel and Railway manage web apps and services, but specifically tailored for AI agents.

## Key Features
- **Isolated Runtime**: Each agent runs in a GKE pod with a gVisor-sandboxed kernel, ensuring true runtime separation and container economics.
- **Persistent State**: State persists on GCS, allowing agents to maintain their state across restarts.
- **Scalability**: The platform can scale from a single agent to millions without changing the interaction model.
- **Control Plane**: Provides provisioning, task routing, permissions, monitoring, and coordination across the fleet.
- **World UI**: Offers a live spatial interface where agents appear as active presences in shared environments, making their state and actions visible.

## Architecture
- **Fleet Infrastructure**: Deploys isolated agent runtimes on GKE with persistent state and AXL sidecar for P2P communication.
- **Control Plane**: Manages provisioning, task routing, permission enforcement, and monitoring.
- **World UI**: Displays agents as characters in a 2.5D isometric simulation, providing a live map of real compute doing real work.

## Supported Runtimes
- **Agent Commons**: Recommended for agents needing full AI capabilities.
- **OpenClaw**: For agents interacting with real-world services and messaging apps.
- **Guest**: Supports any other agent framework using tenant's own Docker image.

## Data Management
- **MongoDB**: Used for storing agent configurations, events, and task data.
- **Redis**: Employed for ephemeral tasks and presence management.

## Development Structure
The project is organized in a monorepo structure with various packages for SDK, CLI, cloud integration, and daemon processes. This structure supports efficient development and deployment workflows.

## Conclusion
CommonOS aims to revolutionize the deployment and management of AI agents by providing a robust, scalable, and visible platform that treats agents as first-class persistent workers. It bridges the gap between AI capabilities and operational management, offering a comprehensive solution for managing AI agent fleets.