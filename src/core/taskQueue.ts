/**
 * @file taskQueue.ts
 * @description Manages a queue of tasks with retry logic
 */

import { Task } from "../interfaces/a2a";
import { TaskProcessor } from "./taskProcessor";
import { Logger } from "../utils/logger";

/**
 * @interface QueueConfig
 * @description Configuration options for the task queue
 */
interface QueueConfig {
  maxConcurrent: number;
  maxRetries: number;
  retryDelay: number;
}

/**
 * @interface QueueStatus
 * @description Status information about the task queue
 */
interface QueueStatus {
  queuedTasks: number;
  processingTasks: number;
  failedTasks: number;
  completedTasks: number;
}

/**
 * @class TaskQueue
 * @description Manages task queuing and processing with retry logic
 */
export class TaskQueue {
  private queue: Task[] = [];
  private processing: Set<string> = new Set();
  private failed: Set<string> = new Set();
  private completed: Set<string> = new Set();
  private retryCount: Map<string, number> = new Map();

  constructor(
    private taskProcessor: TaskProcessor,
    private config: QueueConfig = {
      maxConcurrent: 1,
      maxRetries: 3,
      retryDelay: 1000,
    }
  ) {}

  /**
   * @method enqueueTask
   * @description Add a task to the queue
   */
  public async enqueueTask(task: Task): Promise<void> {
    try {
      if (!task?.id) {
        throw new Error("Invalid task: missing task ID");
      }

      Logger.info(`Enqueueing task ${task.id}`);
      this.queue.push(task);
      await this.processNextTasks();
    } catch (error) {
      Logger.error(
        `Error enqueueing task: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      throw error;
    }
  }

  /**
   * @method processNextTasks
   * @description Process next tasks in queue if capacity allows
   */
  private async processNextTasks(): Promise<void> {
    try {
      while (
        this.queue.length > 0 &&
        this.processing.size < this.config.maxConcurrent
      ) {
        const task = this.queue.shift();
        if (!task) continue;

        this.processing.add(task.id);
        this.processTask(task).catch((error) => {
          Logger.error(
            `Error in processTask: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        });
      }
    } catch (error) {
      Logger.error(
        `Error processing next tasks: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * @method processTask
   * @description Process a single task with retry logic
   */
  private async processTask(task: Task): Promise<void> {
    try {
      await this.taskProcessor.processTask(task);
      this.processing.delete(task.id);
      this.completed.add(task.id);
      Logger.info(`Task ${task.id} completed successfully`);
      await this.processNextTasks();
    } catch (error) {
      const retries = this.retryCount.get(task.id) || 0;

      if (retries < this.config.maxRetries) {
        Logger.warn(
          `Retrying task ${task.id} (attempt ${retries + 1}/${
            this.config.maxRetries
          })`
        );
        this.retryCount.set(task.id, retries + 1);

        setTimeout(() => {
          this.queue.push(task);
          this.processing.delete(task.id);
          this.processNextTasks().catch((error) => {
            Logger.error(
              `Error in retry processNextTasks: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );
          });
        }, this.config.retryDelay);
      } else {
        Logger.error(
          `Task ${task.id} failed after ${this.config.maxRetries} retries`
        );
        this.processing.delete(task.id);
        this.failed.add(task.id);
        await this.processNextTasks();
      }
    }
  }

  /**
   * @method cancelTask
   * @description Cancel a task if it's in the queue
   */
  public cancelTask(taskId: string): boolean {
    try {
      const index = this.queue.findIndex((task) => task.id === taskId);
      if (index === -1) {
        return false;
      }

      this.queue.splice(index, 1);
      Logger.info(`Task ${taskId} cancelled successfully`);
      return true;
    } catch (error) {
      Logger.error(
        `Error cancelling task: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      return false;
    }
  }

  /**
   * @method getQueueStatus
   * @description Get current status of the queue
   */
  public getQueueStatus(): QueueStatus {
    return {
      queuedTasks: this.queue.length,
      processingTasks: this.processing.size,
      failedTasks: this.failed.size,
      completedTasks: this.completed.size,
    };
  }
}
