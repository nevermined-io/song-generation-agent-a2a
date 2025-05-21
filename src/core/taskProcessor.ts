/**
 * @file taskProcessor.ts
 * @description Processes tasks and manages their lifecycle
 */

import {
  Task,
  TaskState,
  Message,
  MessagePart,
  TaskContext,
} from "../interfaces/a2a";
import { TaskStore } from "./taskStore";
import { Logger } from "../utils/logger";
import { SongGenerationController } from "../controllers/songController";

/**
 * @class TaskProcessor
 * @description Handles the processing of individual tasks
 */
export class TaskProcessor {
  private isCancelled: boolean = false;

  /**
   * @constructor
   * @param {TaskStore} taskStore - Store for task persistence
   * @param {SongGenerationController} songController - Controller for song generation
   */
  constructor(
    private taskStore: TaskStore,
    private songController: SongGenerationController
  ) {}

  /**
   * @method processTask
   * @description Process a single task
   */
  public async processTask(task: Task): Promise<void> {
    try {
      Logger.info(`Processing task ${task.id}`);

      // Validate task data
      this.validateTask(task);

      // Update task status to working
      await this.updateTaskStatus(task, TaskState.WORKING);

      // Create task context
      const context: TaskContext = {
        task,
        isCancelled: () => this.isCancelled,
      };

      // Process with song generation controller
      for await (const update of this.songController.handleTask(context)) {
        await this.updateTaskStatus(
          task,
          update.state,
          update.message,
          update.artifacts
        );

        // If task is completed or failed, break the loop
        if (
          update.state === TaskState.COMPLETED ||
          update.state === TaskState.FAILED
        ) {
          break;
        }
      }
    } catch (error) {
      Logger.error(
        `Error processing task ${task.id}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );

      const errorMessage: Message = {
        role: "agent",
        parts: [
          {
            type: "text",
            text:
              error instanceof Error
                ? error.message
                : "Unknown error occurred during processing",
          },
        ],
      };

      await this.updateTaskStatus(task, TaskState.FAILED, errorMessage);
      throw error;
    }
  }

  /**
   * @method validateTask
   * @description Validate task data before processing
   */
  private validateTask(task: Task): void {
    if (!task?.message?.parts) {
      throw new Error("Task message is empty or invalid");
    }

    const textParts = task.message.parts.filter(
      (part): part is MessagePart & { text: string } =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0
    );

    if (textParts.length === 0) {
      throw new Error("Task must contain a non-empty text prompt");
    }
  }

  /**
   * @method updateTaskStatus
   * @description Update task status and persist changes
   */
  private async updateTaskStatus(
    task: Task,
    state: TaskState,
    message?: Message,
    artifacts?: any[]
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const currentTask = await this.taskStore.getTask(task.id);

      if (!currentTask) {
        throw new Error(`Task ${task.id} not found`);
      }

      // Only update and notify if state or progress text changes
      const lastStatus = currentTask.status;
      const lastHistory = currentTask.history || [];
      const lastProgress =
        lastHistory.length > 0
          ? lastHistory[lastHistory.length - 1]
          : undefined;
      const isStateChanged = lastStatus?.state !== state;
      let isProgressChanged = false;
      if (
        message &&
        lastProgress &&
        message.parts &&
        lastProgress.message &&
        lastProgress.message.parts
      ) {
        // Compare progress text if present
        const lastText = lastProgress.message.parts.find(
          (p: any) => p.type === "text"
        )?.text;
        const newText = message.parts.find((p: any) => p.type === "text")?.text;
        isProgressChanged = lastText !== newText;
      }

      if (!isStateChanged && !isProgressChanged) {
        return;
      }

      const statusUpdate = {
        state,
        timestamp,
        message,
      };

      const updatedTask = {
        ...currentTask,
        status: statusUpdate,
        history: [...(currentTask.history || []), statusUpdate],
        ...(artifacts ? { artifacts } : {}),
      };

      await this.taskStore.updateTask(updatedTask);
      Logger.info(`Updated task ${task.id} status to ${state}`);
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
   * @method cancelTask
   * @description Cancel the current task processing
   */
  public cancelTask(): void {
    this.isCancelled = true;
  }
}
