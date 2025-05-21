/**
 * @file a2a.ts
 * @description Type definitions for A2A (Agent-to-Agent) interactions
 */

/**
 * @enum TaskState
 * @description Possible states of a task as defined by the A2A protocol
 */
export enum TaskState {
  SUBMITTED = "submitted",
  WORKING = "working",
  INPUT_REQUIRED = "input-required",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

/**
 * @type MessageRole
 * @description Message roles in the conversation
 */
export type MessageRole = "user" | "agent";

/**
 * @type MessagePartType
 * @description Message part types supported by the protocol
 */
export type MessagePartType = "text" | "image" | "audio" | "file" | "data";

/**
 * @interface MessagePart
 * @description Part of a message with type and content
 */
export interface MessagePart {
  type: MessagePartType;
  text?: string;
  url?: string;
  file?: {
    bytes: string;
    name: string;
  };
  data?: any;
}

/**
 * @interface Message
 * @description Message structure for task communication
 */
export interface Message {
  role: MessageRole;
  parts: MessagePart[];
}

/**
 * @interface TaskStatus
 * @description Status information for a task
 */
export interface TaskStatus {
  state: TaskState;
  timestamp: string;
  message?: Message;
}

/**
 * @interface TaskArtifactPart
 * @description Part of a task artifact containing response data
 */
export interface TaskArtifactPart {
  type: MessagePartType;
  text?: string;
  audioUrl?: string;
  file?: {
    bytes: string;
    name: string;
  };
  data?: any;
}

/**
 * @interface TaskArtifact
 * @description Artifact produced by an A2A task
 */
export interface TaskArtifact {
  parts: TaskArtifactPart[];
  metadata?: Record<string, any>;
  index: number;
  append?: boolean;
}

/**
 * @interface TaskHistoryEntry
 * @description Entry in task history tracking state changes
 */
export interface TaskHistoryEntry {
  timestamp: string;
  state: TaskState;
  message?: Message;
}

/**
 * @interface Task
 * @description Complete task information structure
 */
export interface Task {
  id: string;
  sessionId?: string;
  status: TaskStatus;
  artifacts?: TaskArtifact[];
  history?: TaskHistoryEntry[];
  message?: Message;
  metadata?: Record<string, any>;
}

/**
 * @interface TaskContext
 * @description Context provided to task handlers during execution
 */
export interface TaskContext {
  task: Task;
  isCancelled: () => boolean;
}

/**
 * @interface TaskRequest
 * @description Request structure for creating a new task
 */
export interface TaskRequest {
  sessionId: string;
  idea: string;
  title?: string;
  tags?: string[];
  acceptedOutputModes?: string[];
  message?: Message;
}

/**
 * @interface TaskYieldUpdate
 * @description Update yielded by task handlers during execution
 */
export interface TaskYieldUpdate {
  state: TaskState;
  message: Message;
  artifacts?: TaskArtifact[];
}

/**
 * @interface PushNotificationConfig
 * @description Configuration for push notifications
 */
export interface PushNotificationConfig {
  /** The task ID to subscribe to */
  taskId: string;
  /** The type of events to subscribe to */
  eventTypes: PushNotificationEventType[];
  /** Optional callback URL for webhook notifications */
  webhookUrl?: string;
}

/**
 * @enum PushNotificationEventType
 * @description Types of events that can trigger push notifications
 */
export enum PushNotificationEventType {
  STATUS_UPDATE = "status_update",
  ARTIFACT_CREATED = "artifact_created",
  ERROR = "error",
  COMPLETION = "completion",
}

/**
 * @interface PushNotificationEvent
 * @description Structure of a push notification event
 */
export interface PushNotificationEvent {
  /** The type of event */
  type: PushNotificationEventType;
  /** The task ID associated with the event */
  taskId: string;
  /** Timestamp of the event */
  timestamp: string;
  /** Event data */
  data: any;
}

/**
 * @interface AgentProvider
 * @description Information about the agent provider
 */
export interface AgentProvider {
  organization: string;
  url?: string;
}

/**
 * @interface AgentCapabilities
 * @description Capabilities supported by the agent
 */
export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

/**
 * @interface InputParameter
 * @description Parameter definition for agent skills
 */
export interface InputParameter {
  name: string;
  description: string;
  required: boolean;
  type: string;
}

/**
 * @interface AgentSkill
 * @description Definition of an agent's skill
 */
export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  parameters?: InputParameter[];
}

/**
 * @interface AgentCard
 * @description Complete agent information card
 */
export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  provider?: AgentProvider;
  version: string;
  documentationUrl?: string;
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}
