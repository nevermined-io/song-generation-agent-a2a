/**
 * @file sunoClientDemo.ts
 * @description Demo/mock implementation of Suno API client for testing purposes
 */

import {
  GenerateSongResponse,
  StatusResponse,
  SongResponse,
  SongGenerationOptions,
  WaitForCompletionOptions,
  StatusData,
} from "../interfaces/apiResponses";

/**
 * @class SunoClientDemo
 * @description Simulated client for Suno API for testing/demo mode
 */
export class SunoClientDemo {
  /**
   * @constructor
   * @param {Object} config - Configuration options (ignored in demo)
   */
  constructor(config: { apiKey: string; baseUrl?: string; timeout?: number }) {}

  /**
   * @method generateSong
   * @description Simulates song generation request
   * @param {string} taskId - Internal task ID
   * @param {SongGenerationOptions} options - Song generation options
   * @returns {Promise<GenerateSongResponse>} Simulated response
   */
  async generateSong(
    taskId: string,
    options: SongGenerationOptions
  ): Promise<GenerateSongResponse> {
    return {
      id: taskId,
      status: "working",
      estimatedTime: 3,
    };
  }

  /**
   * @method checkStatus
   * @description Simulates checking the status of a song generation task
   * @param {string} taskId - Internal task ID
   * @returns {Promise<StatusResponse>} Simulated status
   */
  async checkStatus(taskId: string): Promise<StatusResponse> {
    return {
      status: "working",
      progress: 50,
      data: {
        status: "working",
        progress: 50,
        jobId: "demo-job-id",
        error: undefined,
      },
    };
  }

  /**
   * @method waitForCompletion
   * @description Simulates waiting for a song generation task to complete
   * @param {string} taskId - Internal task ID
   * @param {Object} [options] - Options for the wait operation
   * @returns {AsyncGenerator<StatusData, SongResponse>} Simulated generator
   */
  async *waitForCompletion(
    taskId: string,
    options: WaitForCompletionOptions = {}
  ): AsyncGenerator<StatusData, SongResponse> {
    yield {
      status: "working",
      progress: 50,
      jobId: "demo-job-id",
      error: undefined,
    };
    await new Promise((resolve) => setTimeout(resolve, 30000));
    yield {
      status: "working",
      progress: 100,
      jobId: "demo-job-id",
      error: undefined,
    };
    await new Promise((resolve) => setTimeout(resolve, 30000));
    return this.getSong(taskId);
  }

  /**
   * @method getSong
   * @description Simulates retrieving the generated song data
   * @param {string} taskId - Internal task ID
   * @returns {Promise<SongResponse>} Simulated song data
   */
  async getSong(taskId: string): Promise<SongResponse> {
    return {
      jobId: "demo-job-id",
      music: {
        musicId: "demo-music-id",
        title: "Demo Song Title",
        audioUrl:
          "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        duration: 120,
      },
      metadata: {
        title: "Demo Song Title",
        tags: ["demo", "test"],
      },
    };
  }
}
