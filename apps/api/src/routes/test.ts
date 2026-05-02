import { Hono } from 'hono'
import { agents } from '../db/mongo.js'
import { deployAgent } from '../services/cloud-init.js'
import type { Env } from '../types.js'

const router = new Hono<Env>()

function splitCsv(value?: string): string[] {
	return (value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
}

function parseOptionalNumber(value?: string): number | undefined {
	if (!value) return undefined
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalBoolean(value?: string): boolean | undefined {
	if (!value) return undefined
	const normalized = value.trim().toLowerCase()
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false
	return undefined
}

function parseOptionalProtocol(value?: string): 'http' | 'https' | undefined {
	if (value === 'http' || value === 'https') return value
	return undefined
}

// POST /test/agents/:agentId/deploy
router.post('/agents/:agentId/deploy', async (c) => {
	if (c.get('authType') === 'agent') {
		return c.json({ error: 'tenant authorization required' }, 403)
	}

	const agentId = c.req.param('agentId')
	const body = await c.req.json<{
		cluster?: string
		containerUrl?: string
		containerPort?: number
		serviceName?: string
		taskFamily?: string
		subnetIds?: string[]
		securityGroupIds?: string[]
		assignPublicIp?: boolean
		executionRoleArn?: string
		taskRoleArn?: string
		cpu?: number | string
		memory?: number | string
		desiredCount?: number
		environment?: Record<string, string>
		loadBalancer?: {
			targetGroupArn?: string
			listenerPort?: number
			protocol?: 'http' | 'https'
		}
	}>().catch(() => ({})) as {
		cluster?: string
		containerUrl?: string
		containerPort?: number
		serviceName?: string
		taskFamily?: string
		subnetIds?: string[]
		securityGroupIds?: string[]
		assignPublicIp?: boolean
		executionRoleArn?: string
		taskRoleArn?: string
		cpu?: number | string
		memory?: number | string
		desiredCount?: number
		environment?: Record<string, string>
		loadBalancer?: {
			targetGroupArn?: string
			listenerPort?: number
			protocol?: 'http' | 'https'
		}
	}

	try {
		const agent = await (await agents()).findOne({
			_id: agentId,
			tenantId: c.get('tenantId'),
		}).lean()
		if (!agent) return c.json({ error: 'agent not found' }, 404)

		const cluster = body.cluster ?? process.env.TEST_ECS_CLUSTER ?? process.env.AWS_ECS_CLUSTER
		const containerUrl =
			body.containerUrl ??
			agent.config.dockerImage ??
			process.env.TEST_ECS_CONTAINER_URL
		const containerPort =
			body.containerPort ?? parseOptionalNumber(process.env.TEST_ECS_CONTAINER_PORT) ?? 80
		const subnetIds = body.subnetIds?.length
			? body.subnetIds
			: splitCsv(process.env.TEST_ECS_SUBNET_IDS ?? process.env.AWS_ECS_SUBNET_IDS)
		const securityGroupIds = body.securityGroupIds?.length
			? body.securityGroupIds
			: splitCsv(process.env.TEST_ECS_SECURITY_GROUP_IDS ?? process.env.AWS_ECS_SECURITY_GROUP_IDS)
		const targetGroupArn =
			body.loadBalancer?.targetGroupArn ?? process.env.TEST_ECS_TARGET_GROUP_ARN

		if (!cluster) {
			return c.json({
				error: 'cluster is required; set TEST_ECS_CLUSTER, set AWS_ECS_CLUSTER, or pass cluster in the request body',
			}, 400)
		}
		if (!containerUrl) {
			return c.json({
				error: 'containerUrl is required; set TEST_ECS_CONTAINER_URL, set agent.config.dockerImage, or pass containerUrl in the request body',
			}, 400)
		}
		if (!subnetIds.length) {
			return c.json({
				error: 'subnetIds are required; set TEST_ECS_SUBNET_IDS, set AWS_ECS_SUBNET_IDS, or pass subnetIds in the request body',
			}, 400)
		}
		if (!securityGroupIds.length) {
			return c.json({
				error: 'securityGroupIds are required; set TEST_ECS_SECURITY_GROUP_IDS, set AWS_ECS_SECURITY_GROUP_IDS, or pass securityGroupIds in the request body',
			}, 400)
		}

		const loadBalancer = targetGroupArn
			? {
					targetGroupArn,
					listenerPort:
						body.loadBalancer?.listenerPort ??
						parseOptionalNumber(process.env.TEST_ECS_LISTENER_PORT),
					protocol:
						body.loadBalancer?.protocol ??
						parseOptionalProtocol(process.env.TEST_ECS_PROTOCOL),
				}
			: undefined

		const deployment = await deployAgent({
			cluster,
			containerUrl,
			containerPort,
			serviceName:
				body.serviceName ?? `test-${agent._id}-${Date.now().toString(36)}`,
			taskFamily: body.taskFamily ?? process.env.AWS_ECS_TASK_FAMILY,
			region: process.env.AWS_REGION,
			subnetIds,
			securityGroupIds,
			assignPublicIp:
				body.assignPublicIp ??
				parseOptionalBoolean(
					process.env.TEST_ECS_ASSIGN_PUBLIC_IP ?? process.env.AWS_ECS_ASSIGN_PUBLIC_IP,
				),
			executionRoleArn:
				body.executionRoleArn ?? process.env.AWS_ECS_TASK_EXECUTION_ROLE_ARN,
			taskRoleArn: body.taskRoleArn ?? process.env.AWS_ECS_TASK_ROLE_ARN,
			cpu: body.cpu ?? parseOptionalNumber(process.env.AWS_ECS_TASK_CPU),
			memory: body.memory ?? parseOptionalNumber(process.env.AWS_ECS_TASK_MEMORY),
			desiredCount: body.desiredCount,
			logGroupName: process.env.AWS_ECS_LOG_GROUP,
			logStreamPrefix: process.env.AWS_ECS_LOG_STREAM_PREFIX,
			environment: {
				AGENT_ID: agent._id,
				FLEET_ID: agent.fleetId,
				TENANT_ID: agent.tenantId,
				AGENT_ROLE: agent.config.role,
				...(body.environment ?? {}),
			},
			loadBalancer,
		})

		return c.json({
			agentId: agent._id,
			fleetId: agent.fleetId,
			deployment,
		}, 201)
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : 'test deployment failed' },
			503,
		)
	}
})

export { router as testRouter }
