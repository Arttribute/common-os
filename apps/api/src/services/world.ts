import { agents, worldStates } from '../db/mongo.js'

export async function removeAgentFromWorldState(fleetId: string, agentId: string): Promise<void> {
  await (await worldStates()).updateOne(
    { fleetId },
    {
      $pull: { agents: { agentId } as never },
      $set: { updatedAt: new Date() },
    },
  )
}

export async function upsertAgentInWorldState(fleetId: string, agentId: string): Promise<void> {
  const agent = await (await agents()).findOne({ _id: agentId, fleetId })
  if (!agent) return

  const entry = {
    agentId,
    role: agent.config.role,
    permissionTier: agent.permissionTier,
    status: agent.status,
    world: agent.world,
  }

  const existing = await (await worldStates()).findOne({ fleetId, 'agents.agentId': agentId })
  if (existing) {
    await (await worldStates()).updateOne(
      { fleetId, 'agents.agentId': agentId },
      { $set: { 'agents.$': entry, updatedAt: new Date() } },
    )
  } else {
    await (await worldStates()).updateOne(
      { fleetId },
      { $push: { agents: entry as never }, $set: { updatedAt: new Date() } },
    )
  }
}
