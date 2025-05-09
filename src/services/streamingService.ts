/**
 * @file streamingService.ts
 * @description Service for handling real-time streaming events using Server-Sent Events (SSE)
 */

import { Response } from "express";
import { Logger } from "../utils/logger";
import { Task, TaskState, TaskArtifact } from "../interfaces/a2a";

/**
 * @interface StreamingConnection
 * @description Represents a streaming connection with its configuration
 */
interface StreamingConnection {
  response: Response;
  taskId: string;
}

/**
 * @enum EventType
 * @description Types of events that can be sent via SSE
 */
enum EventType {
  STATUS_UPDATE = "status_update",
  ARTIFACT = "artifact",
  ERROR = "error",
}

/**
 * @interface TaskStatusUpdateEvent
 * @description Event for task status updates via SSE
 */
interface TaskStatusUpdateEvent {
  id: string;
  status: {
    state: TaskState;
    timestamp: string;
    message?: any;
  };
  final: boolean;
  metadata?: Record<string, any>;
}

/**
 * @interface TaskArtifactUpdateEvent
 * @description Event for artifact updates via SSE
 */
interface TaskArtifactUpdateEvent {
  id: string;
  artifact: {
    parts: any[];
    index: number;
    append?: boolean;
    lastChunk?: boolean;
  };
  metadata?: Record<string, any>;
}

/**
 * @interface ErrorEvent
 * @description Event for error notifications via SSE
 */
interface ErrorEvent {
  id: string;
  error: {
    code: number;
    message: string;
    data?: any;
  };
  metadata?: Record<string, any>;
}

/**
 * @class StreamingService
 * @description Manages SSE connections and streaming events for real-time task updates
 */
export class StreamingService {
  private connections: Map<string, Set<StreamingConnection>>;

  /**
   * @constructor
   */
  constructor() {
    this.connections = new Map();
  }

  /**
   * @method subscribe
   * @description Subscribe a client to streaming events for a task
   * @param {string} taskId - The task ID to subscribe to
   * @param {Response} res - The Express response object for SSE
   */
  public subscribe(taskId: string, res: Response): void {
    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Initialize connection set for this task if it doesn't exist
    if (!this.connections.has(taskId)) {
      this.connections.set(taskId, new Set());
    }

    // Create new streaming connection
    const connection: StreamingConnection = {
      response: res,
      taskId,
    };

    // Add this connection to the set
    this.connections.get(taskId)?.add(connection);

    // Send initial connection confirmation
    this.sendEventToClient(
      connection,
      {
        id: taskId,
        status: {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        },
        final: false,
      },
      EventType.STATUS_UPDATE
    );

    Logger.info(`Client subscribed to streaming events for task ${taskId}`);

    // Handle client disconnect
    res.on("close", () => {
      this.unsubscribe(taskId, res);
    });
  }

  /**
   * @method unsubscribe
   * @description Unsubscribe a client from streaming events
   * @param {string} taskId - The task ID
   * @param {Response} res - The Express response object
   */
  public unsubscribe(taskId: string, res: Response): void {
    const connections = this.connections.get(taskId);
    if (connections) {
      connections.forEach((conn) => {
        if (conn.response === res) {
          connections.delete(conn);
          Logger.info(
            `Client unsubscribed from streaming events for task ${taskId}`
          );
        }
      });

      // Remove the task entry if no more connections
      if (connections.size === 0) {
        this.connections.delete(taskId);
      }
    }
  }

  /**
   * @method notifyTaskUpdate
   * @description Send a task update to all subscribed clients
   * @param {Task} task - The updated task
   */
  public notifyTaskUpdate(task: Task): void {
    const connections = this.connections.get(task.id);
    if (!connections) return;

    const isFinal = this.isTaskInFinalState(task.status.state);
    const event: TaskStatusUpdateEvent = {
      id: task.id,
      status: task.status,
      final: isFinal,
    };

    connections.forEach((connection) => {
      this.sendEventToClient(connection, event, EventType.STATUS_UPDATE);
    });

    // Send artifacts if available
    if (task.artifacts?.length) {
      this.sendArtifacts(task.id, task.artifacts);
    }
  }

  /**
   * @method notifyError
   * @description Send an error notification to all subscribed clients
   * @param {string} taskId - The task ID
   * @param {number} code - The error code
   * @param {string} message - The error message
   * @param {any} [data] - Additional error data
   */
  public notifyError(
    taskId: string,
    code: number,
    message: string,
    data?: any
  ): void {
    const connections = this.connections.get(taskId);
    if (!connections) return;

    const event: ErrorEvent = {
      id: taskId,
      error: {
        code,
        message,
        data,
      },
    };

    connections.forEach((connection) => {
      this.sendEventToClient(connection, event, EventType.ERROR);
    });
  }

  /**
   * @private
   * @method sendArtifacts
   * @description Send artifacts to all subscribed clients for a task
   * @param {string} taskId - The task ID
   * @param {TaskArtifact[]} artifacts - The artifacts to send
   */
  private sendArtifacts(taskId: string, artifacts: TaskArtifact[]): void {
    const connections = this.connections.get(taskId);
    if (!connections) return;

    artifacts.forEach((artifact) => {
      const artifactEvent: TaskArtifactUpdateEvent = {
        id: taskId,
        artifact: {
          parts: artifact.parts,
          index: artifact.index,
          append: artifact.append || false,
          lastChunk: artifact.index === artifacts.length - 1,
        },
      };

      connections.forEach((connection) => {
        this.sendEventToClient(connection, artifactEvent, EventType.ARTIFACT);
      });
    });
  }

  /**
   * @private
   * @method sendEventToClient
   * @description Send an SSE event to a client
   * @param {StreamingConnection} connection - The streaming connection
   * @param {any} event - The event data to send
   * @param {EventType} eventType - The type of event being sent
   */
  private sendEventToClient(
    connection: StreamingConnection,
    event: any,
    eventType: EventType
  ): void {
    try {
      // Format according to A2A protocol
      const dataStr = JSON.stringify(event);

      let output: string;

      // Using event types according to A2A protocol
      switch (eventType) {
        case EventType.STATUS_UPDATE:
          output = `event: status_update\ndata: ${dataStr}\n\n`;
          break;
        case EventType.ARTIFACT:
          output = `event: artifact\ndata: ${dataStr}\n\n`;
          break;
        case EventType.ERROR:
          output = `event: error\ndata: ${dataStr}\n\n`;
          break;
        default:
          output = `data: ${dataStr}\n\n`;
      }

      connection.response.write(output);

      // For final events in status updates, add an additional event to indicate end of stream
      const statusEvent = event as TaskStatusUpdateEvent;
      if (eventType === EventType.STATUS_UPDATE && statusEvent.final) {
        connection.response.write(`event: completion\ndata: ${dataStr}\n\n`);
      }
    } catch (error) {
      Logger.error(`Error sending event to client: ${error}`);
      this.unsubscribe(connection.taskId, connection.response);
    }
  }

  /**
   * @private
   * @method isTaskInFinalState
   * @description Check if a task is in a final state
   * @param {TaskState} state - The task state to check
   * @returns {boolean} Whether the task is in a final state
   */
  private isTaskInFinalState(state: TaskState): boolean {
    return [
      TaskState.COMPLETED,
      TaskState.CANCELLED,
      TaskState.FAILED,
    ].includes(state);
  }
}
