/**
 * @file songController.test.ts
 * @description Unit tests for SongGenerationController
 */

import { SongGenerationController } from "../../../src/controllers/songController";
import { SunoClient } from "../../../src/clients/sunoClient";
import {
  TaskContext,
  TaskState,
  Task,
  TaskYieldUpdate,
  TaskStatus,
} from "../../../src/interfaces/a2a";
import { SongMetadata, SongGenerationResult } from "../../../src/models/song";
import { SongResponse } from "../../../src/interfaces/apiResponses";
import { SongMetadataGenerator } from "../../../src/core/songMetadataGenerator";
import {
  GenerateSongResponse,
  StatusResponse,
} from "../../../src/interfaces/apiResponses";

jest.mock("../../../src/core/songMetadataGenerator");
jest.mock("../../../src/clients/sunoClient");
jest.mock("music-metadata", () => require("../../mocks/music-metadata"));

describe("SongGenerationController", () => {
  let mockSunoClient: jest.Mocked<SunoClient>;
  let mockContext: TaskContext;
  let controller: SongGenerationController;

  beforeEach(() => {
    const mockTask: Task = {
      id: "test-task-id",
      sessionId: "test-session-id",
      prompt: "test prompt",
      status: {
        state: TaskState.SUBMITTED,
        timestamp: new Date().toISOString(),
      },
      message: {
        role: "user",
        parts: [
          {
            type: "text",
            text: "test prompt",
          },
        ],
      },
      history: [] as TaskStatus[],
    };

    mockContext = {
      task: mockTask,
      isCancelled: jest.fn().mockReturnValue(false),
    };

    // Mock the metadata generator
    const mockMetadata: SongMetadata = {
      title: "Test Song",
      lyrics: "Test lyrics",
      tags: ["pop", "test"],
    };

    // Mock input for SongMetadataGenerator
    const mockMetadataInput = {
      idea: "test prompt",
      title: undefined,
      tags: undefined,
      lyrics: undefined,
      duration: undefined,
    };

    // Mock the Suno client
    const mockGenerateSongResponse: GenerateSongResponse = {
      id: "test-job-id",
      status: "submitted",
      estimatedTime: 60,
    };

    const mockStatusResponse: StatusResponse = {
      status: "working",
      progress: 50,
      data: {
        status: "working",
        progress: 50,
        jobId: "test-job-id",
      },
    };

    const mockSongResponse: SongResponse = {
      jobId: "test-job-id",
      music: {
        musicId: "test-music-id",
        title: "Test Song",
        audioUrl: "test-url",
        duration: 180,
      },
      metadata: {
        title: "Test Song",
        lyrics: "Test lyrics",
        tags: ["pop", "test"],
      },
    };

    mockSunoClient = {
      generateSong: jest.fn().mockResolvedValue(mockGenerateSongResponse),
      checkStatus: jest.fn().mockResolvedValue(mockStatusResponse),
      getSong: jest.fn().mockResolvedValue(mockSongResponse),
      waitForCompletion: jest
        .fn()
        .mockImplementation(async (jobId, options) => {
          if (options?.onStatusUpdate) {
            await options.onStatusUpdate({
              status: "working",
              progress: 50,
              jobId: "test-job-id",
            });
          }
          return mockSongResponse;
        }),
    } as unknown as jest.Mocked<SunoClient>;

    jest
      .spyOn(SongMetadataGenerator.prototype, "generate")
      .mockResolvedValue(mockMetadata);

    // Inject the Suno client mock into the controller
    (SunoClient as jest.Mock).mockImplementation(() => mockSunoClient);

    controller = new SongGenerationController(
      "test-openai-key",
      "test-suno-key"
    );
  });

  describe("handleTask", () => {
    it("should generate a song successfully", async () => {
      const generator = controller.handleTask(mockContext);
      const results: TaskYieldUpdate[] = [];

      for await (const update of generator) {
        results.push(update);
      }

      // Verify the state updates
      expect(results.length).toBeGreaterThan(0);

      // Verify the final state
      const finalUpdate = results[results.length - 1];
      expect(finalUpdate.state).toBe(TaskState.COMPLETED);
      expect(finalUpdate.artifacts).toBeDefined();
      expect(finalUpdate.artifacts?.[0].parts).toHaveLength(2);

      // Verify the artifact content
      const artifact = finalUpdate.artifacts?.[0];
      expect(artifact).toBeDefined();
      expect(artifact?.parts[0].type).toBe("audio");
      expect(artifact?.parts[0].audioUrl).toBe("test-url");
      expect(artifact?.metadata?.title).toBe("Test Song");
      expect(artifact?.metadata?.duration).toBe(180);

      // Verify that SongMetadataGenerator.generate was called with the correct input object
      expect(SongMetadataGenerator.prototype.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          idea: "test prompt",
          title: undefined,
          tags: undefined,
          lyrics: undefined,
          duration: undefined,
        })
      );

      // Verify that the completion was properly waited for
      expect(mockSunoClient.waitForCompletion).toHaveBeenCalledWith(
        "test-job-id",
        {
          timeout: 5000,
          interval: 1000,
          onStatusUpdate: expect.any(Function),
        }
      );
    });

    it("should handle cancellation during song generation", async () => {
      // Configure the mock to return false in the first call and true in the second
      (mockContext.isCancelled as jest.Mock).mockImplementation(() => {
        // Simulate task cancellation during audio generation
        if (mockSunoClient.generateSong.mock.calls.length > 0) {
          return true;
        }
        return false;
      });

      const generator = controller.handleTask(mockContext);
      const results: TaskYieldUpdate[] = [];

      for await (const update of generator) {
        results.push(update);
      }

      const finalUpdate = results[results.length - 1];
      expect(finalUpdate.state).toBe(TaskState.CANCELLED);
    });

    it("should handle errors during generation", async () => {
      mockSunoClient.generateSong.mockRejectedValueOnce(
        new Error("Generation error: API Error")
      );

      const generator = controller.handleTask(mockContext);
      const results: TaskYieldUpdate[] = [];

      for await (const update of generator) {
        results.push(update);
      }

      const finalUpdate = results[results.length - 1];
      expect(finalUpdate.state).toBe(TaskState.FAILED);
      expect(finalUpdate.message?.parts[0].text).toContain("Generation failed");
    });
  });
});
