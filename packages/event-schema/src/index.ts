import { z } from "zod";

const StateChangeEvent = z.object({
  type: z.literal("state_change"),
  payload: z.object({
    status: z.enum(["online", "idle", "working", "error", "offline"]),
  }),
});

const TaskStartEvent = z.object({
  type: z.literal("task_start"),
  payload: z.object({
    taskId: z.string(),
    description: z.string(),
  }),
});

const TaskCompleteEvent = z.object({
  type: z.literal("task_complete"),
  payload: z.object({
    taskId: z.string(),
    output: z.string().optional(),
  }),
});

const ActionEvent = z.object({
  type: z.literal("action"),
  payload: z.object({
    label: z.string(),
    detail: z.string().optional(),
  }),
});

const MessageSentEvent = z.object({
  type: z.literal("message_sent"),
  payload: z.object({
    toAgentId: z.string(),
    preview: z.string(),
  }),
});

const MessageRecvEvent = z.object({
  type: z.literal("message_recv"),
  payload: z.object({
    fromAgentId: z.string(),
    preview: z.string(),
  }),
});

const WorldMoveEvent = z.object({
  type: z.literal("world_move"),
  payload: z.object({
    room: z.string(),
    x: z.number(),
    y: z.number(),
  }),
});

const FileChangedEvent = z.object({
  type: z.literal("file_changed"),
  payload: z.object({
    path: z.string(),
    op: z.enum(["create", "modify", "delete"]),
  }),
});

const ErrorEvent = z.object({
  type: z.literal("error"),
  payload: z.object({
    message: z.string(),
  }),
});

const HeartbeatEvent = z.object({
  type: z.literal("heartbeat"),
  payload: z.object({}).optional(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  StateChangeEvent,
  TaskStartEvent,
  TaskCompleteEvent,
  ActionEvent,
  MessageSentEvent,
  MessageRecvEvent,
  WorldMoveEvent,
  FileChangedEvent,
  ErrorEvent,
  HeartbeatEvent,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent["type"];

export type StateChangeEvent = z.infer<typeof StateChangeEvent>;
export type TaskStartEvent = z.infer<typeof TaskStartEvent>;
export type TaskCompleteEvent = z.infer<typeof TaskCompleteEvent>;
export type ActionEvent = z.infer<typeof ActionEvent>;
export type MessageSentEvent = z.infer<typeof MessageSentEvent>;
export type MessageRecvEvent = z.infer<typeof MessageRecvEvent>;
export type WorldMoveEvent = z.infer<typeof WorldMoveEvent>;
export type FileChangedEvent = z.infer<typeof FileChangedEvent>;
export type ErrorEvent = z.infer<typeof ErrorEvent>;
export type HeartbeatEvent = z.infer<typeof HeartbeatEvent>;
