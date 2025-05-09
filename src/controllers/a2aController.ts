/**
 * @file a2aController.ts
 * @description Controller for handling A2A (Agent-to-Agent) interactions
 */

import { Request, Response } from "express";
import { Task, TaskState, Message, TaskStatus } from "../interfaces/a2a";
import { TaskStore } from "../core/taskStore";
import { SessionManager } from "../core/sessionManager";
import { ErrorHandler } from "../core/errorHandler";
import { TaskProcessor } from "../core/taskProcessor";
import { TaskQueue } from "../core/taskQueue";
import { Logger } from "../utils/logger";
import { SongGenerationController } from "./songController";
import { PushNotificationService } from "../services/pushNotificationService";
import { StreamingService } from "../services/streamingService";
import {
  PushNotificationConfig,
  PushNotificationEvent,
  PushNotificationEventType,
} from "../interfaces/a2a";

/**
 * @interface A2AControllerConfig
 * @description Configuration options for the A2A controller
 */
interface A2AControllerConfig {
  maxConcurrent?: number;
  maxRetries?: number;
  retryDelay?: number;
  openAiKey?: string;
  sunoKey?: string;
}

/**
 * @interface QueueStatus
 * @description Status information about the task queue
 */
export interface QueueStatus {
  queuedTasks: number;
  processingTasks: number;
  failedTasks: number;
  completedTasks: number;
}

/**
 * @class A2AController
 * @description Controls and manages A2A interactions and task processing
 */
export class A2AController {
  private taskStore: TaskStore;
  private sessionManager: SessionManager;
  private taskProcessor: TaskProcessor;
  private taskQueue: TaskQueue;
  private songController: SongGenerationController;
  private pushNotificationService: PushNotificationService;
  private streamingService: StreamingService;

  /**
   * @constructor
   * @param {A2AControllerConfig} config - Configuration options
   * @param {TaskStore} taskStore - Optional task store instance
   * @param {SessionManager} sessionManager - Optional session manager instance
   * @param {TaskProcessor} taskProcessor - Optional task processor instance
   * @param {TaskQueue} taskQueue - Optional task queue instance
   */
  constructor(
    private config: A2AControllerConfig = {},
    taskStore?: TaskStore,
    sessionManager?: SessionManager,
    taskProcessor?: TaskProcessor,
    taskQueue?: TaskQueue
  ) {
    if (!config.openAiKey || !config.sunoKey) {
      throw new Error("OpenAI and Suno API keys are required");
    }

    this.taskStore = taskStore || new TaskStore();
    this.sessionManager = sessionManager || new SessionManager();
    this.songController = new SongGenerationController(
      config.openAiKey,
      config.sunoKey
    );
    this.taskProcessor =
      taskProcessor || new TaskProcessor(this.taskStore, this.songController);
    this.taskQueue =
      taskQueue ||
      new TaskQueue(this.taskProcessor, {
        maxConcurrent: config.maxConcurrent || 1,
        maxRetries: config.maxRetries || 3,
        retryDelay: config.retryDelay || 1000,
      });
    this.pushNotificationService = new PushNotificationService();
    this.streamingService = new StreamingService();

    // Set up task store listeners for notifications
    this.setupTaskStoreListeners();
  }

  /**
   * @private
   * @method setupTaskStoreListeners
   * @description Set up listeners for task store events to trigger notifications
   */
  private setupTaskStoreListeners(): void {
    this.taskStore.addStatusListener(async (task: Task) => {
      // Only send status_update if not in a final state
      const isFinal =
        task.status.state === TaskState.COMPLETED ||
        task.status.state === TaskState.CANCELLED ||
        task.status.state === TaskState.FAILED;

      if (isFinal) {
        const completionEvent: PushNotificationEvent = {
          type: PushNotificationEventType.COMPLETION,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: {
            finalStatus: task.status,
            artifacts: task.artifacts,
          },
        };
        this.pushNotificationService.notify(task.id, completionEvent);
      } else {
        const event: PushNotificationEvent = {
          type: PushNotificationEventType.STATUS_UPDATE,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: {
            status: task.status,
            artifacts: task.artifacts,
          },
        };
        this.pushNotificationService.notify(task.id, event);
      }

      // Handle streaming updates
      this.streamingService.notifyTaskUpdate(task);
    });
  }

  /**
   * @method healthCheck
   * @description Check service health
   */
  public healthCheck = async (req: Request, res: Response): Promise<void> => {
    res.json({ status: "healthy" });
  };

  /**
   * @method getAgentCard
   * @description Returns the agent's capabilities and metadata
   * @returns {Object} Agent card information
   */
  public getAgentCard = async (req: Request, res: Response): Promise<void> => {
    res.json({
      name: "Song Generation Agent",
      description:
        "AI agent that generates songs based on text prompts, using AI models to create lyrics and melodies. Supports real-time updates via SSE (streaming) and push notifications via webhook.",
      url: "http://localhost:8001",
      provider: {
        organization: "Nevermined",
        url: "https://nevermined.io",
      },
      version: "1.0.0",
      documentationUrl: "https://docs.nevermined.io/agents/song-generation",
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["application/json", "audio/mpeg", "text/plain"],
      notificationEvents: [
        {
          type: "status_update",
          description:
            "Task status update. Data includes { status: TaskStatus, artifacts: TaskArtifact[] }",
        },
        {
          type: "completion",
          description:
            "Task completed/cancelled/failed. Data includes { finalStatus: TaskStatus, artifacts: TaskArtifact[] }",
        },
        {
          type: "artifact_created",
          description:
            "(Planned) New artifact created. Data includes { artifact: TaskArtifact }",
        },
        {
          type: "error",
          description: "Error event. Data includes { error: string }",
        },
      ],
      artifactStructure: {
        parts: [
          {
            type: "audio | text",
            text: "string (only for text parts)",
            audioUrl: "string (only for audio parts)",
          },
        ],
        metadata: "object (optional, song metadata: title, tags, duration)",
        index: "number (artifact order)",
        append: "boolean (optional, if the artifact is incremental)",
      },
      skills: [
        {
          id: "generate-song",
          name: "Generate Song",
          description:
            "Generates a complete song with lyrics and melody based on provided parameters",
          tags: ["music", "song", "generation", "creative", "ai"],
          examples: [
            "Create a happy pop song about summer adventures",
            "Generate a romantic ballad about first love",
          ],
          inputModes: ["application/json"],
          outputModes: ["application/json", "audio/mpeg"],
          parameters: [
            {
              name: "title",
              description: "The title of the song",
              required: false,
              type: "string",
            },
            {
              name: "tags",
              description: "List of genre tags or themes for the song",
              required: false,
              type: "array[string]",
            },
            {
              name: "lyrics",
              description: "Specific lyrics or text to include in the song",
              required: false,
              type: "string",
            },
            {
              name: "idea",
              description: "Brief description or concept for the song",
              required: true,
              type: "string",
            },
            {
              name: "duration",
              description: "Approximate duration of the song in seconds",
              required: false,
              type: "integer",
            },
          ],
          outputSchema: {
            "application/json": {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "The title of the generated song",
                },
                lyrics: {
                  type: "string",
                  description: "The complete lyrics of the song",
                },
                audioUrl: {
                  type: "string",
                  description: "URL to the generated audio file",
                },
                duration: {
                  type: "number",
                  description: "Duration of the song in seconds",
                },
                genre: {
                  type: "string",
                  description: "Genre of the generated song",
                },
                tags: {
                  type: "array",
                  items: {
                    type: "string",
                  },
                  description: "Tags describing the song",
                },
                metadata: {
                  type: "object",
                  description: "Additional metadata about the song",
                },
              },
              required: ["title", "lyrics", "audioUrl"],
            },
            "audio/mpeg": {
              description: "The song generated as an MP3 audio file",
            },
          },
        },
      ],
    });
  };

  /**
   * @method sendTask
   * @description Handle JSON-RPC 2.0 A2A task send (single-turn)
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  public sendTask = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jsonrpc, id, method, params } = req.body;
      if (jsonrpc !== "2.0" || !id || !method || !params) {
        res.status(400).json({
          jsonrpc: "2.0",
          id: id || null,
          error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
        });
        return;
      }
      const { message, metadata, sessionId, acceptedOutputModes } = params;
      if (
        !message ||
        !message.parts ||
        !message.parts[0] ||
        !message.parts[0].text ||
        !message.parts[0].text.trim()
      ) {
        res.status(400).json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Task must contain a non-empty message text",
          },
        });
        return;
      }
      const task = await this.createTask({
        sessionId,
        message,
        metadata,
        acceptedOutputModes,
      });
      res.json({
        jsonrpc: "2.0",
        id,
        result: task,
      });
    } catch (error) {
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: { code: -32000, message: (error as Error).message },
      });
    }
  };

  /**
   * @method getTaskStatus
   * @description Get status of a specific task
   */
  public getTaskStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      Logger.info(`Getting status for task: ${req.params.taskId}`);
      const task = await this.getTask(req.params.taskId);

      if (!task) {
        Logger.warn(`Task ${req.params.taskId} not found`);
        res.status(404).json({ error: "Task not found" });
        return;
      }

      Logger.debug(`Task ${req.params.taskId} status:`, task);
      res.json(task);
    } catch (error) {
      Logger.error(
        `Error getting task status: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      ErrorHandler.handleHttpError(error as Error, res);
    }
  };

  /**
   * @method cancelTask
   * @description Cancel a task if possible
   */
  public async cancelTask(taskId: string): Promise<boolean> {
    try {
      const task = await this.taskStore.getTask(taskId);
      if (!task) {
        Logger.warn(`Task ${taskId} not found for cancellation`);
        return false;
      }

      const cancelled = this.taskQueue.cancelTask(taskId);
      if (cancelled && task) {
        const updatedTask = {
          ...task,
          status: {
            ...task.status,
            state: TaskState.CANCELLED,
            timestamp: new Date().toISOString(),
          },
        };
        await this.taskStore.updateTask(updatedTask);
        Logger.info(`Task ${taskId} cancelled successfully`);
      }

      return cancelled;
    } catch (error) {
      Logger.error(
        `Error cancelling task ${taskId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      return false;
    }
  }

  /**
   * @method createTask
   * @description Create and enqueue a new task
   */
  public async createTask(params: {
    sessionId?: string;
    message: Message;
    metadata?: Record<string, any>;
    acceptedOutputModes?: string[];
  }): Promise<Task> {
    try {
      const { sessionId, message, metadata, acceptedOutputModes } = params;
      // Create new task
      const task: Task = {
        id: crypto.randomUUID(),
        sessionId,
        status: {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        },
        message,
        metadata,
      };

      // Store task first
      const storedTask = await this.taskStore.createTask({ ...task });
      Logger.info(`Created task ${storedTask.id}`);

      // Then enqueue it
      await this.taskQueue.enqueueTask({ ...storedTask });
      Logger.info(`Enqueued task ${storedTask.id}`);

      return storedTask;
    } catch (error) {
      Logger.error(
        `Error creating task: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      throw error;
    }
  }

  /**
   * @method getTask
   * @description Get task by ID
   */
  public async getTask(taskId: string): Promise<Task | null> {
    try {
      const task = await this.taskStore.getTask(taskId);
      return task;
    } catch (error) {
      Logger.error(
        `Error getting task ${taskId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      throw error;
    }
  }

  /**
   * @method updateTaskStatus
   * @description Update task status and history
   */
  public async updateTaskStatus(
    taskId: string,
    state: TaskState,
    message?: Message
  ): Promise<Task | null> {
    try {
      const task = await this.taskStore.getTask(taskId);
      if (!task) {
        Logger.warn(`Task ${taskId} not found for status update`);
        return null;
      }

      const newStatus: TaskStatus = {
        state,
        timestamp: new Date().toISOString(),
        message,
      };

      // Ensure we have a history array and add current status if it exists
      const history = [...(task.history || [])];
      if (task.status) {
        history.push(task.status);
      }

      const updatedTask: Task = {
        ...task,
        status: newStatus,
        history,
      };

      const result = await this.taskStore.updateTask(updatedTask);
      Logger.info(`Updated task ${taskId} status to ${state}`);
      return result;
    } catch (error) {
      Logger.error(
        `Error updating task status: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      throw error;
    }
  }

  /**
   * @method listTasks
   * @description List all tasks, optionally filtered by session ID
   */
  public listTasks = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.query.session_id as string;
      const tasks = await this.taskStore.listTasks();
      const filteredTasks = sessionId
        ? tasks.filter((task) => task.sessionId === sessionId)
        : tasks;
      res.json(filteredTasks);
    } catch (error) {
      Logger.error(
        `Error listing tasks: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      ErrorHandler.handleHttpError(error as Error, res);
    }
  };

  /**
   * @method sendTaskSubscribe
   * @description Handle JSON-RPC 2.0 A2A task send with subscription (multi-turn/streaming, SSE or webhook)
   * @param {Request} req - Express request
   * @param {Response} res - Express response
   */
  public sendTaskSubscribe = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { jsonrpc, id, method, params } = req.body;
      if (jsonrpc !== "2.0" || !id || !method || !params) {
        if (!res.headersSent) {
          const errorCode = -32600;
          const errorMessage = "Invalid JSON-RPC 2.0 request";

          // For SSE connections, send error via streaming protocol
          if (req.headers.accept?.includes("text/event-stream")) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            this.streamingService.notifyError(
              params?.id || "unknown",
              errorCode,
              errorMessage
            );
            // End the response after sending the error
            res.end();
          } else {
            // Regular JSON-RPC error response
            res.status(400).json({
              jsonrpc: "2.0",
              id: id || null,
              error: { code: errorCode, message: errorMessage },
            });
          }
        }
        return;
      }

      const {
        id: taskId,
        message,
        metadata,
        sessionId,
        acceptedOutputModes,
        notification,
      } = params;

      if (
        !message ||
        !message.parts ||
        !message.parts[0] ||
        !message.parts[0].text ||
        !message.parts[0].text.trim()
      ) {
        if (!res.headersSent) {
          const errorCode = -32602;
          const errorMessage = "Task must contain a non-empty message text";

          // For SSE connections, send error via streaming protocol
          if (req.headers.accept?.includes("text/event-stream")) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            this.streamingService.notifyError(
              taskId || "unknown",
              errorCode,
              errorMessage
            );
            // End the response after sending the error
            res.end();
          } else {
            // Regular JSON-RPC error response
            res.status(400).json({
              jsonrpc: "2.0",
              id,
              error: { code: errorCode, message: errorMessage },
            });
          }
        }
        return;
      }

      // 1. Create the task
      const task = await this.createTask({
        sessionId,
        message,
        metadata,
        acceptedOutputModes,
      });

      // 2. Check notification mode
      const mode = notification?.mode || "sse";
      const eventTypes = notification?.eventTypes || [];

      if (mode === "webhook" && notification?.url) {
        // Register webhook and respond immediately
        await this.pushNotificationService.subscribeWebhook(task.id, {
          taskId: task.id,
          webhookUrl: notification.url,
          eventTypes,
        });

        res.json({
          jsonrpc: "2.0",
          id,
          result: { taskId: task.id },
        });
        return;
      }

      // Default: SSE mode (keep connection open)
      this.streamingService.subscribe(task.id, res);

      // Start processing the task
      this.taskQueue.enqueueTask(task);
    } catch (error) {
      if (!res.headersSent) {
        const errorCode = -32000;
        const errorMessage =
          (error as Error).message || "Internal server error";

        // For SSE connections, send error via streaming protocol
        if (req.headers.accept?.includes("text/event-stream")) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          this.streamingService.notifyError(
            req.body?.params?.id || "unknown",
            errorCode,
            errorMessage
          );
          // End the response after sending the error
          res.end();
        } else {
          // Regular JSON-RPC error response
          res.status(500).json({
            jsonrpc: "2.0",
            id: req.body?.id || null,
            error: { code: errorCode, message: errorMessage },
          });
        }
      }
    }
  };

  /**
   * @method getTaskHistory
   * @description Get history of a specific task
   */
  public getTaskHistory = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const task = await this.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      res.json(task.history || []);
    } catch (error) {
      ErrorHandler.handleHttpError(error as Error, res);
    }
  };

  /**
   * @method getQueueStatus
   * @description Get current queue status
   */
  public getQueueStatus(): QueueStatus {
    return this.taskQueue.getQueueStatus();
  }
}

// Export only the class
export default A2AController;
