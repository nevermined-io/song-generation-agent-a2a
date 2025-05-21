/**
 * @file songController.ts
 * @description A2A controller for song generation process
 */

import {
  TaskContext,
  TaskState,
  TaskYieldUpdate,
  TaskArtifact,
  TaskStatus,
  Task,
} from "../interfaces/a2a";
import { SongMetadata, SongGenerationResult } from "../models/song";
import { SongMetadataGenerator } from "../core/songMetadataGenerator";
import { SunoClient } from "../clients/sunoClient";
import { SunoClientDemo } from "../clients/sunoClientDemo";
import { Logger } from "../utils/logger";
import { StatusData } from "../interfaces/apiResponses";

/**
 * @class SongGenerationController
 * @description Controls the song generation process following A2A protocol
 */
export class SongGenerationController {
  private readonly metadataGenerator: SongMetadataGenerator;
  private readonly sunoClient: SunoClient | SunoClientDemo;

  /**
   * @constructor
   * @param {string} openAiKey - OpenAI API key for metadata generation
   * @param {string} sunoKey - Suno API key for audio generation
   */
  constructor(openAiKey: string, sunoKey: string) {
    if (!openAiKey || !sunoKey) {
      throw new Error("Both OpenAI and Suno API keys are required");
    }
    this.metadataGenerator = new SongMetadataGenerator(openAiKey);
    // Use SunoClientDemo if DEMO_MODE is set, otherwise use SunoClient
    if (process.env.DEMO_MODE === "true") {
      this.sunoClient = new SunoClientDemo({ apiKey: sunoKey });
    } else {
      this.sunoClient = new SunoClient({ apiKey: sunoKey });
    }
  }

  /**
   * @private
   * @method updateTaskHistory
   * @description Updates the task history with a new status
   * @param {Task} task - The task to update
   * @param {TaskYieldUpdate} update - The update to add to history
   */
  private updateTaskHistory(task: Task, update: TaskYieldUpdate): void {
    if (!task.history) {
      task.history = [];
    }

    const historyEntry: TaskStatus = {
      state: update.state,
      timestamp: new Date().toISOString(),
      message: update.message,
    };

    task.history.push(historyEntry);
    task.status = historyEntry;
  }

  /**
   * @private
   * @method createTextMessage
   * @description Creates a text message part for A2A updates
   */
  private createTextMessage(text: string): TaskYieldUpdate {
    return {
      state: TaskState.WORKING,
      message: {
        role: "agent",
        parts: [{ type: "text", text }],
      },
    };
  }

  /**
   * @private
   * @method createArtifact
   * @description Creates a task artifact from song data
   */
  private createArtifact(
    songData: SongGenerationResult,
    metadata: SongMetadata
  ): TaskArtifact {
    if (!songData?.music?.audioUrl) {
      throw new Error("Invalid song data: missing audio URL");
    }

    return {
      parts: [
        {
          type: "audio",
          audioUrl: songData.music.audioUrl,
        },
        {
          type: "data",
          data: {
            title: metadata.title,
            lyrics: metadata.lyrics,
            tags: metadata.tags,
            duration: songData.music.duration,
            musicId: songData.music.musicId,
          },
        },
      ],
      metadata: {
        title: metadata.title,
        tags: metadata.tags,
        duration: songData.music.duration,
      },
      index: 0,
    };
  }

  /**
   * @private
   * @method validatePrompt
   * @description Validates the prompt and requests additional information if needed
   * @param {string} prompt - The prompt to validate
   * @returns {TaskYieldUpdate | null} Update requesting more info if needed, null if valid
   */
  private validatePrompt(prompt: string): TaskYieldUpdate | null {
    if (!prompt || !prompt.trim()) {
      return {
        state: TaskState.INPUT_REQUIRED,
        message: {
          role: "agent" as const,
          parts: [
            {
              type: "text",
              text: "Please provide a prompt for the song. No prompt was provided.",
            },
          ],
        },
      };
    }

    if (prompt.trim().length < 10) {
      return {
        state: TaskState.INPUT_REQUIRED,
        message: {
          role: "agent" as const,
          parts: [
            {
              type: "text",
              text: "Please provide a more detailed description of the song. The current prompt is too short.",
            },
          ],
        },
      };
    }

    return null;
  }

  /**
   * @async
   * @generator
   * @function handleTask
   * @description Handles a song generation task according to A2A protocol
   * @param {TaskContext} context - Task context from A2A
   * @yields {TaskYieldUpdate} Status updates and artifacts
   */
  async *handleTask(context: TaskContext): AsyncGenerator<TaskYieldUpdate> {
    const { task, isCancelled } = context;

    try {
      // Extract the main message and metadata from the task
      const idea =
        task.message?.parts?.find((p) => p.type === "text")?.text || "";
      const taskMeta = task.metadata || {};
      const title = taskMeta.title;
      const tags = taskMeta.tags;
      const lyrics = taskMeta.lyrics;
      const duration = taskMeta.duration;
      const metadataInput = { idea, title, tags, lyrics, duration };

      // Validate the main message
      const validationUpdate = this.validatePrompt(idea);
      if (validationUpdate) {
        this.updateTaskHistory(task, validationUpdate);
        yield validationUpdate;
        return;
      }

      // Initial status
      const initialUpdate = this.createTextMessage(
        "Starting song generation process..."
      );
      this.updateTaskHistory(task, initialUpdate);
      yield initialUpdate;

      // Generate metadata
      const metadataUpdate = this.createTextMessage(
        "Generating song metadata..."
      );
      this.updateTaskHistory(task, metadataUpdate);
      yield metadataUpdate;

      let songMetadata: SongMetadata;
      try {
        songMetadata = await this.metadataGenerator.generate(metadataInput);
        Logger.info(
          `Generated metadata: ${JSON.stringify(songMetadata, null, 2)}`
        );
      } catch (error) {
        Logger.error(`Metadata generation error: ${(error as Error).message}`);
        const errorUpdate: TaskYieldUpdate = {
          state: TaskState.FAILED,
          message: {
            role: "agent" as const,
            parts: [
              {
                type: "text",
                text: `Failed to generate song metadata: ${
                  (error as Error).message
                }`,
              },
            ],
          },
        };
        this.updateTaskHistory(task, errorUpdate);
        yield errorUpdate;
        return;
      }

      // Check for cancellation
      if (isCancelled()) {
        const cancelUpdate: TaskYieldUpdate = {
          state: TaskState.CANCELLED,
          message: {
            role: "agent" as const,
            parts: [{ type: "text", text: "Task cancelled by user" }],
          },
        };
        this.updateTaskHistory(task, cancelUpdate);
        yield cancelUpdate;
        return;
      }

      // Generate audio
      const audioUpdate = this.createTextMessage(
        `Generating audio for "${songMetadata.title}"...`
      );
      this.updateTaskHistory(task, audioUpdate);
      yield audioUpdate;

      let songData: SongGenerationResult | null = null;
      try {
        // Check for cancellation before starting generation
        if (isCancelled()) {
          const cancelUpdate: TaskYieldUpdate = {
            state: TaskState.CANCELLED,
            message: {
              role: "agent" as const,
              parts: [{ type: "text", text: "Task cancelled by user" }],
            },
          };
          this.updateTaskHistory(task, cancelUpdate);
          yield cancelUpdate;
          return;
        }

        const response = await this.sunoClient.generateSong(task.id, {
          prompt: idea,
          title: songMetadata.title,
          lyrics: songMetadata.lyrics,
          tags: songMetadata.tags,
        });

        if (!response?.id) {
          throw new Error("Generation error: No valid job ID received");
        }

        // Wait for completion with status updates
        let lastProgress = 0;
        for await (const status of this.sunoClient.waitForCompletion(task.id, {
          timeout: 400000,
          interval: 3000,
          onStatusUpdate: (status: StatusData) => {
            if (isCancelled()) {
              const cancelUpdate: TaskYieldUpdate = {
                state: TaskState.CANCELLED,
                message: {
                  role: "agent" as const,
                  parts: [{ type: "text", text: "Task cancelled by user" }],
                },
              };
              this.updateTaskHistory(task, cancelUpdate);
              return cancelUpdate;
            }

            if (status.progress > lastProgress) {
              lastProgress = status.progress;
              const progressUpdate = this.createTextMessage(
                `Generating audio... ${status.progress}%`
              );
              this.updateTaskHistory(task, progressUpdate);
              return progressUpdate;
            }
            return null;
          },
        })) {
          // Handle status updates
          if (status.progress > lastProgress) {
            lastProgress = status.progress;
            const progressUpdate = this.createTextMessage(
              `Generating audio... ${status.progress}%`
            );
            this.updateTaskHistory(task, progressUpdate);
            yield progressUpdate;
          }
        }

        // Get the final song data
        songData = await this.sunoClient.getSong(task.id);

        // Check for cancellation after generation
        if (isCancelled()) {
          const cancelUpdate: TaskYieldUpdate = {
            state: TaskState.CANCELLED,
            message: {
              role: "agent" as const,
              parts: [{ type: "text", text: "Task cancelled by user" }],
            },
          };
          this.updateTaskHistory(task, cancelUpdate);
          yield cancelUpdate;
          return;
        }

        if (!songData) {
          throw new Error("Generation error: No song data received");
        }

        // Create final update with artifact
        const finalUpdate: TaskYieldUpdate = {
          state: TaskState.COMPLETED,
          message: {
            role: "agent" as const,
            parts: [
              {
                type: "text",
                text: `Song "${songMetadata.title}" has been generated successfully!`,
              },
            ],
          },
          artifacts: [this.createArtifact(songData, songMetadata)],
        };

        this.updateTaskHistory(task, finalUpdate);
        yield finalUpdate;
      } catch (error) {
        Logger.error(`Task error: ${(error as Error).message}`);
        const errorUpdate: TaskYieldUpdate = {
          state: TaskState.FAILED,
          message: {
            role: "agent" as const,
            parts: [
              {
                type: "text",
                text: `Generation failed: ${(error as Error).message}`,
              },
            ],
          },
        };
        this.updateTaskHistory(task, errorUpdate);
        yield errorUpdate;
      }
    } catch (error) {
      Logger.error(`Task error: ${(error as Error).message}`);
      const errorUpdate: TaskYieldUpdate = {
        state: TaskState.FAILED,
        message: {
          role: "agent" as const,
          parts: [
            {
              type: "text",
              text: `Generation failed: ${(error as Error).message}`,
            },
          ],
        },
      };
      this.updateTaskHistory(task, errorUpdate);
      yield errorUpdate;
    }
  }
}
