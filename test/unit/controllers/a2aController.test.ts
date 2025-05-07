/**
 * @file A2A Controller Test Suite
 * @description Tests for the A2A Controller functionality
 */

import { Request, Response } from "express";
import { A2AController } from "../../../src/controllers/a2aController";
import {
  TaskState,
  Message,
  Task,
  TaskStatus,
} from "../../../src/interfaces/a2a";
import { mockTaskRequest, createMockTask } from "../../mocks/taskMocks";
import { TaskStore } from "../../../src/core/taskStore";
import { TaskProcessor } from "../../../src/core/taskProcessor";
import { TaskQueue } from "../../../src/core/taskQueue";
import { SessionManager } from "../../../src/core/sessionManager";
import { SongGenerationController } from "../../../src/controllers/songController";

jest.mock("../../../src/core/taskStore");
jest.mock("../../../src/core/taskProcessor");
jest.mock("../../../src/core/taskQueue");
jest.mock("../../../src/core/sessionManager");
jest.mock("../../../src/controllers/songController", () => {
  return {
    SongGenerationController: jest.fn().mockImplementation(() => ({
      handleTask: jest.fn().mockImplementation(async function* () {
        yield {
          state: TaskState.COMPLETED,
          message: {
            role: "agent",
            parts: [{ type: "text", text: "Song generated successfully" }],
          },
        };
      }),
    })),
  };
});

describe("A2AController", () => {
  let controller: A2AController;
  let taskStore: jest.Mocked<TaskStore>;
  let taskProcessor: jest.Mocked<TaskProcessor>;
  let taskQueue: jest.Mocked<TaskQueue>;
  let sessionManager: jest.Mocked<SessionManager>;
  let songController: jest.Mocked<SongGenerationController>;

  beforeEach(() => {
    taskStore = new TaskStore() as jest.Mocked<TaskStore>;
    songController = new SongGenerationController(
      "test-openai-key",
      "test-suno-key"
    ) as jest.Mocked<SongGenerationController>;
    taskProcessor = new TaskProcessor(
      taskStore,
      songController
    ) as jest.Mocked<TaskProcessor>;
    taskQueue = new TaskQueue(taskProcessor) as jest.Mocked<TaskQueue>;
    sessionManager = new SessionManager() as jest.Mocked<SessionManager>;

    controller = new A2AController(
      {
        maxConcurrent: 2,
        maxRetries: 3,
        retryDelay: 1000,
        openAiKey: "test-openai-key",
        sunoKey: "test-suno-key",
      },
      taskStore,
      sessionManager,
      taskProcessor,
      taskQueue
    );
  });

  /**
   * @test Health Check
   * @description Tests health check endpoint
   */
  describe("Health Check", () => {
    it("should return health status", async () => {
      const mockRes = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
        sendStatus: jest.fn(),
        links: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.healthCheck({} as Request, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({ status: "healthy" });
    });
  });

  /**
   * @test Agent Card
   * @description Tests agent card retrieval
   */
  describe("Agent Card", () => {
    it("should return agent information", async () => {
      const mockRes = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
        sendStatus: jest.fn(),
        links: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.getAgentCard({} as Request, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({
        name: "Song Generation Agent",
        description:
          "AI agent that generates songs based on text prompts, using AI models to create lyrics and melodies",
        url: "http://localhost:8001",
        provider: {
          organization: "Nevermined",
          url: "https://nevermined.io",
        },
        version: "1.0.0",
        documentationUrl: "https://docs.nevermined.io/agents/song-generation",
        capabilities: {
          streaming: true,
          pushNotifications: false,
          stateTransitionHistory: true,
        },
        defaultInputModes: ["text/plain", "application/json"],
        defaultOutputModes: ["application/json", "audio/mpeg", "text/plain"],
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
          },
        ],
      });
    });
  });

  /**
   * @test Task Creation
   * @description Tests task creation functionality
   */
  describe("Task Creation and Management", () => {
    it("should create and enqueue a new task", async () => {
      const mockMessage: Message = {
        role: "user",
        parts: [{ type: "text", text: "test prompt" }],
      };

      const mockTask: Partial<Task> = {
        prompt: "test prompt",
        sessionId: "test-session",
        status: {
          state: TaskState.SUBMITTED,
          timestamp: expect.any(String),
        },
        message: mockMessage,
      };

      taskStore.createTask.mockImplementation((task) => Promise.resolve(task));
      taskQueue.enqueueTask.mockResolvedValue(undefined);

      const task = await controller.createTask("test prompt", "test-session");

      expect(task).toMatchObject(mockTask);
      expect(task.id).toBeDefined();
      expect(typeof task.id).toBe("string");
      expect(taskStore.createTask).toHaveBeenCalledWith(
        expect.objectContaining(mockTask)
      );
      expect(taskQueue.enqueueTask).toHaveBeenCalledWith(
        expect.objectContaining(mockTask)
      );
    });

    it("should handle task creation error", async () => {
      taskStore.createTask.mockRejectedValue(new Error("Database error"));

      await expect(controller.createTask("test prompt")).rejects.toThrow(
        "Database error"
      );
    });

    it("should send task via HTTP endpoint", async () => {
      const mockMessage: Message = {
        role: "user",
        parts: [{ type: "text", text: "test prompt" }],
      };

      const mockReq = {
        body: {
          prompt: "test prompt",
          sessionId: "test-session",
        },
      } as Request;

      const mockRes = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
        sendStatus: jest.fn(),
        links: jest.fn(),
        send: jest.fn(),
      } as unknown as Response & { json: jest.Mock };

      const mockTask: Partial<Task> = {
        prompt: "test prompt",
        sessionId: "test-session",
        status: {
          state: TaskState.SUBMITTED,
          timestamp: expect.any(String),
        },
        message: mockMessage,
      };

      taskStore.createTask.mockImplementation((task) => Promise.resolve(task));
      taskQueue.enqueueTask.mockResolvedValue(undefined);

      await controller.sendTask(mockReq, mockRes);

      const response = mockRes.json.mock.calls[0][0];
      expect(response).toMatchObject(mockTask);
      expect(response.id).toBeDefined();
      expect(typeof response.id).toBe("string");
      expect(taskStore.createTask).toHaveBeenCalledWith(
        expect.objectContaining(mockTask)
      );
      expect(taskQueue.enqueueTask).toHaveBeenCalledWith(
        expect.objectContaining(mockTask)
      );
    });

    it("should create and track multiple tasks", async () => {
      // Mock taskStore.createTask to return the task as provided
      taskStore.createTask.mockImplementation((task) => Promise.resolve(task));

      // Create tasks through controller
      const task1 = await controller.createTask("test prompt 1", "session1");
      const task2 = await controller.createTask("test prompt 2", "session1");
      const task3 = await controller.createTask("test prompt 3", "session2");

      // Verify the tasks were created with correct properties
      expect(task1).toMatchObject({
        prompt: "test prompt 1",
        sessionId: "session1",
        status: {
          state: TaskState.SUBMITTED,
        },
        message: {
          role: "user",
          parts: [{ type: "text", text: "test prompt 1" }],
        },
      });

      expect(task2).toMatchObject({
        prompt: "test prompt 2",
        sessionId: "session1",
        status: {
          state: TaskState.SUBMITTED,
        },
        message: {
          role: "user",
          parts: [{ type: "text", text: "test prompt 2" }],
        },
      });

      expect(task3).toMatchObject({
        prompt: "test prompt 3",
        sessionId: "session2",
        status: {
          state: TaskState.SUBMITTED,
        },
        message: {
          role: "user",
          parts: [{ type: "text", text: "test prompt 3" }],
        },
      });

      // Verify taskStore.createTask was called with correct data
      expect(taskStore.createTask).toHaveBeenCalledTimes(3);

      // Verify tasks have unique IDs
      const taskIds = [task1.id, task2.id, task3.id];
      expect(new Set(taskIds).size).toBe(3);
    });
  });

  /**
   * @test Task Retrieval
   * @description Tests task retrieval functionality
   */
  describe("Task Retrieval", () => {
    it("should retrieve an existing task", async () => {
      const mockMessage: Message = {
        role: "user",
        parts: [{ type: "text", text: "test idea" }],
      };

      const mockTask: Task = {
        id: "test-id",
        prompt: "test idea",
        sessionId: "test-session",
        status: {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        },
        message: mockMessage,
        history: [],
      };

      taskStore.getTask.mockResolvedValue(mockTask);

      const result = await controller.getTask(mockTask.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockTask.id);
      expect(taskStore.getTask).toHaveBeenCalledWith(mockTask.id);
    });

    it("should return null for non-existent task", async () => {
      taskStore.getTask.mockResolvedValue(null);

      const result = await controller.getTask("non-existent");
      expect(result).toBeNull();
    });

    it("should list all tasks", async () => {
      const mockRes = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
        sendStatus: jest.fn(),
        links: jest.fn(),
        send: jest.fn(),
      } as unknown as Response & { json: jest.Mock };

      const mockTasks: Task[] = [
        {
          id: "task-1",
          prompt: "test idea 1",
          sessionId: "session-1",
          status: {
            state: TaskState.SUBMITTED,
            timestamp: expect.any(String),
          },
          history: [],
          message: {
            role: "user",
            parts: [{ type: "text", text: "test 1" }],
          },
        },
        {
          id: "task-2",
          prompt: "test idea 2",
          sessionId: "session-2",
          status: {
            state: TaskState.COMPLETED,
            timestamp: expect.any(String),
          },
          history: [],
          message: {
            role: "user",
            parts: [{ type: "text", text: "test 2" }],
          },
        },
      ];

      taskStore.listTasks.mockResolvedValue(mockTasks);

      await controller.listTasks({ query: {} } as Request, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "task-1",
            sessionId: "session-1",
            status: expect.objectContaining({
              state: TaskState.SUBMITTED,
            }),
          }),
          expect.objectContaining({
            id: "task-2",
            sessionId: "session-2",
            status: expect.objectContaining({
              state: TaskState.COMPLETED,
            }),
          }),
        ])
      );
    });

    it("should filter tasks by sessionId", async () => {
      const mockRes = {
        json: jest.fn(),
      };

      const mockTasks: Task[] = [
        {
          id: "task-1",
          prompt: "test idea 1",
          sessionId: "session1",
          status: {
            state: TaskState.SUBMITTED,
            timestamp: new Date().toISOString(),
          },
          history: [],
        },
        {
          id: "task-2",
          prompt: "test idea 2",
          sessionId: "session1",
          status: {
            state: TaskState.SUBMITTED,
            timestamp: new Date().toISOString(),
          },
          history: [],
        },
      ];

      taskStore.listTasks.mockResolvedValue(mockTasks);

      await controller.listTasks(
        { query: { session_id: "session1" } } as any,
        mockRes as any
      );
      expect(mockRes.json).toHaveBeenCalledWith(mockTasks);
    });
  });

  /**
   * @test Task Status Updates
   * @description Tests task status update functionality
   */
  describe("Task Status Management", () => {
    it("should update task status", async () => {
      const mockTask: Task = {
        id: "test-id",
        prompt: "test prompt",
        sessionId: "test-session",
        status: {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        } as TaskStatus,
        history: [],
      };

      const updatedTask: Task = {
        ...mockTask,
        status: {
          state: TaskState.WORKING,
          timestamp: new Date().toISOString(),
        } as TaskStatus,
        history: [mockTask.status],
      };

      taskStore.getTask.mockResolvedValue(mockTask);
      taskStore.updateTask.mockResolvedValue(updatedTask);

      const result = await controller.updateTaskStatus(
        "test-id",
        TaskState.WORKING
      );

      expect(result).toBeDefined();
      expect(result?.status.state).toBe(TaskState.WORKING);
      expect(result?.history).toHaveLength(1);
    });

    it("should handle task cancellation", async () => {
      const mockTask: Task = {
        id: "test-id",
        prompt: "test prompt",
        sessionId: "test-session",
        status: {
          state: TaskState.WORKING,
          timestamp: new Date().toISOString(),
        } as TaskStatus,
        history: [],
      };

      taskStore.getTask.mockResolvedValue(mockTask);
      taskQueue.cancelTask.mockReturnValue(true);
      taskStore.updateTask.mockResolvedValue({
        ...mockTask,
        status: {
          state: TaskState.CANCELLED,
          timestamp: new Date().toISOString(),
        } as TaskStatus,
      });

      const result = await controller.cancelTask("test-id");
      expect(result).toBe(true);
      expect(taskQueue.cancelTask).toHaveBeenCalledWith("test-id");
    });
  });

  /**
   * @test Queue Status
   * @description Tests queue status retrieval functionality
   */
  describe("Queue Status", () => {
    it("should return queue status", () => {
      const mockStatus = {
        queuedTasks: 1,
        processingTasks: 2,
        failedTasks: 0,
        completedTasks: 5,
      };

      taskQueue.getQueueStatus.mockReturnValue(mockStatus);

      const status = controller.getQueueStatus();
      expect(status).toEqual(mockStatus);
    });
  });

  /**
   * @test Task Management
   * @description Tests task management functionality
   */
  describe("Task Management", () => {
    it("should handle task lifecycle", async () => {
      let currentTask: Task = {
        id: "test-id",
        prompt: "test idea",
        sessionId: "test-session",
        status: {
          state: TaskState.SUBMITTED,
          timestamp: expect.any(String),
        },
        history: [],
        message: {
          role: "user",
          parts: [{ type: "text", text: "test idea" }],
        },
      };

      taskStore.createTask.mockImplementation((task) => Promise.resolve(task));
      taskStore.getTask.mockImplementation(() => Promise.resolve(currentTask));
      taskStore.updateTask.mockImplementation((task) => {
        currentTask = task;
        console.log("Task being updated:", JSON.stringify(task, null, 2));
        return Promise.resolve(task);
      });

      const task = await controller.createTask("test idea", "test-session");
      console.log("Initial task:", JSON.stringify(task, null, 2));

      const workingTaskResult = await controller.updateTaskStatus(
        task.id,
        TaskState.WORKING
      );
      console.log(
        "After WORKING update:",
        JSON.stringify(workingTaskResult, null, 2)
      );

      const completedTaskResult = await controller.updateTaskStatus(
        task.id,
        TaskState.COMPLETED
      );
      console.log(
        "After COMPLETED update:",
        JSON.stringify(completedTaskResult, null, 2)
      );

      expect(completedTaskResult?.status.state).toBe(TaskState.COMPLETED);
      expect(completedTaskResult?.history?.length).toBe(2);
      expect(completedTaskResult?.history?.map((h) => h.state)).toEqual([
        TaskState.SUBMITTED,
        TaskState.WORKING,
      ]);
    });

    it("should handle task cancellation", async () => {
      const mockTask: Task = {
        id: "test-id",
        prompt: "test idea",
        sessionId: "test-session",
        status: {
          state: TaskState.WORKING,
          timestamp: new Date().toISOString(),
        },
        history: [],
        message: {
          role: "user",
          parts: [{ type: "text", text: "test idea" }],
        },
      };

      taskStore.getTask.mockResolvedValue(mockTask);
      taskQueue.cancelTask.mockReturnValue(true);
      taskStore.updateTask.mockImplementation((task) => Promise.resolve(task));

      const result = await controller.cancelTask("test-id");
      expect(result).toBe(true);
      expect(taskQueue.cancelTask).toHaveBeenCalledWith("test-id");
    });

    it("should return null when cancelling non-existent task", async () => {
      taskStore.getTask.mockResolvedValue(null);
      const result = await controller.cancelTask("non-existent");
      expect(result).toBe(false);
    });

    it("should handle task history", async () => {
      const mockTask: Task = {
        id: "test-id",
        prompt: "test prompt",
        sessionId: "test-session",
        status: {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        } as TaskStatus,
        history: [
          {
            state: TaskState.SUBMITTED,
            timestamp: new Date().toISOString(),
          } as TaskStatus,
          {
            state: TaskState.WORKING,
            timestamp: new Date().toISOString(),
          } as TaskStatus,
          {
            state: TaskState.COMPLETED,
            timestamp: new Date().toISOString(),
          } as TaskStatus,
        ],
      };

      taskStore.createTask.mockResolvedValue(mockTask);

      const task = await controller.createTask("test prompt", "test-session");
      expect(task.history).toBeDefined();
      expect(task.history?.length).toBe(3);
      expect(task.history?.map((h) => h.state)).toEqual([
        TaskState.SUBMITTED,
        TaskState.WORKING,
        TaskState.COMPLETED,
      ]);
    });

    it("should return null for non-existent task", async () => {
      taskStore.getTask.mockResolvedValue(null);
      const result = await controller.getTask("non-existent");
      expect(result).toBeNull();
    });
  });

  /**
   * @test Task Subscription
   * @description Tests task subscription and streaming updates
   */
  describe("Task Subscription", () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockTask: Task;

    beforeEach(() => {
      mockReq = {
        body: {
          prompt: "test prompt",
          sessionId: "test-session",
        },
      };

      mockRes = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      mockTask = {
        id: "test-task-id",
        prompt: "test prompt",
        sessionId: "test-session",
        status: {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        },
        message: {
          role: "user",
          parts: [{ type: "text", text: "test prompt" }],
        },
      };

      // Mock taskStore methods
      taskStore.createTask.mockResolvedValue(mockTask);
      taskQueue.enqueueTask.mockResolvedValue(undefined);
    });

    it("should create and return task immediately", async () => {
      await controller.sendTaskSubscribe(
        mockReq as Request,
        mockRes as Response
      );

      expect(taskStore.createTask).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(mockTask);
    });

    it("should enqueue task after sending response", async () => {
      await controller.sendTaskSubscribe(
        mockReq as Request,
        mockRes as Response
      );

      expect(taskQueue.enqueueTask).toHaveBeenCalledWith(mockTask);
    });

    it("should handle errors gracefully", async () => {
      const error = new Error("Test error");
      taskStore.createTask.mockRejectedValue(error);

      await controller.sendTaskSubscribe(
        mockReq as Request,
        mockRes as Response
      );

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Internal server error",
      });
    });
  });
});
