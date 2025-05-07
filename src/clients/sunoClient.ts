/**
 * @file sunoClient.ts
 * @description Modern implementation of Suno API client for song generation
 */

import axios, { AxiosResponse, AxiosError } from "axios";
import { calculateDuration } from "../utils/audio";
import { Logger } from "../utils/logger";
import {
  GenerateSongResponse,
  StatusResponse,
  SongResponse,
  SongOptions,
  SongGenerationOptions,
  SongGenerationResponse,
  WaitForCompletionOptions,
  StatusData,
} from "../interfaces/apiResponses";
import { SunoError, SunoErrorCode } from "../errors/sunoError";

// TTAPI specific status types
type TTAPIStatus = "SUCCESS" | "FAILED" | "ON_QUEUE" | "PROCESSING";

interface TTAPIResponse {
  data: {
    jobId: string;
    progress?: string;
    message?: string;
    musics?: Array<{
      musicId: string;
      title: string;
      audioUrl: string;
    }>;
  };
  status: TTAPIStatus;
}

/**
 * @class SunoClient
 * @description Client for interacting with the Suno AI song generation API through TTAPI
 */
export class SunoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultTimeout: number;
  private jobIdMap: Map<string, string> = new Map(); // Mapeo de taskId a jobId

  /**
   * @constructor
   * @param {Object} config - Configuration options for the Suno client
   * @param {string} config.apiKey - API key for authentication
   * @param {string} [config.baseUrl] - Base URL for the API (optional)
   * @param {number} [config.timeout] - Default timeout in milliseconds (optional)
   */
  constructor(config: { apiKey: string; baseUrl?: string; timeout?: number }) {
    if (!config.apiKey) {
      throw new SunoError(
        SunoErrorCode.INVALID_API_KEY,
        400,
        "API key is required"
      );
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.ttapi.io/suno/v1";
    this.defaultTimeout = config.timeout || 30000;
  }

  /**
   * @private
   * @method getRequestHeaders
   * @description Returns the necessary headers for API requests
   */
  private getRequestHeaders() {
    return {
      headers: {
        "TT-API-KEY": this.apiKey,
        "Content-Type": "application/json",
      },
    };
  }

  /**
   * @private
   * @method handleResponse
   * @description Handles API response and converts to expected type
   */
  private handleResponse<T>(response: AxiosResponse): T {
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !["SUCCESS", "ON_QUEUE"].includes(response.data.status)
    ) {
      throw new SunoError(
        SunoErrorCode.API_ERROR,
        response.status,
        "API request failed"
      );
    }

    return response.data;
  }

  /**
   * @private
   * @method mapTTAPIStatusToInternal
   * @description Maps TTAPI status to internal status
   */
  private mapTTAPIStatusToInternal(
    ttapiStatus: TTAPIStatus
  ): StatusResponse["status"] {
    switch (ttapiStatus) {
      case "SUCCESS":
        return "completed";
      case "FAILED":
        return "failed";
      case "ON_QUEUE":
      case "PROCESSING":
        return "working";
      default:
        return "working";
    }
  }

  /**
   * @private
   * @method getJobId
   * @description Gets the TTAPI jobId for a given taskId
   */
  private getJobId(taskId: string): string {
    const jobId = this.jobIdMap.get(taskId);
    if (!jobId) {
      throw new SunoError(
        SunoErrorCode.INVALID_REQUEST,
        400,
        `No jobId found for taskId: ${taskId}`
      );
    }
    return jobId;
  }

  /**
   * @method generateSong
   * @description Initiates the generation of a new song with the specified options
   * @param {string} taskId - Our internal task ID
   * @param {SongGenerationOptions} options - Options for song generation
   * @returns {Promise<GenerateSongResponse>} Response containing the task ID and initial status
   * @throws {SunoError} If the API request fails
   */
  async generateSong(
    taskId: string,
    options: SongGenerationOptions
  ): Promise<GenerateSongResponse> {
    if (!options.prompt) {
      throw new SunoError(
        SunoErrorCode.INVALID_REQUEST,
        400,
        "Prompt is required"
      );
    }

    try {
      const payload = {
        mv: "chirp-v4",
        custom: true,
        instrumental: false,
        gpt_description_prompt: options.prompt,
        prompt: options.lyrics,
        title: options.title || "Generated Song",
        tags: options.tags?.join(",") || "pop",
      };

      const response = await axios.post(
        `${this.baseUrl}/music`,
        payload,
        this.getRequestHeaders()
      );

      const ttapiResponse = this.handleResponse<TTAPIResponse>(response);

      // Save the mapping of taskId to jobId
      this.jobIdMap.set(taskId, ttapiResponse.data.jobId);
      Logger.debug(
        `Mapped taskId ${taskId} to TTAPI jobId ${ttapiResponse.data.jobId}`
      );

      return {
        id: taskId, // Return our original taskId
        status: this.mapTTAPIStatusToInternal(ttapiResponse.status),
        estimatedTime: 300,
      };
    } catch (error) {
      if (error instanceof SunoError) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
        throw new SunoError(
          SunoErrorCode.NETWORK_ERROR,
          error.response?.status || 500,
          `Network error during song generation: ${error.message}`
        );
      }
      throw new SunoError(
        SunoErrorCode.UNKNOWN_ERROR,
        500,
        "Unknown error during song generation"
      );
    }
  }

  /**
   * @method checkStatus
   * @description Checks the status of a song generation task
   * @param {string} taskId - Our internal task ID
   * @returns {Promise<StatusResponse>} Current status of the generation task
   * @throws {SunoError} If the status check fails
   */
  async checkStatus(taskId: string): Promise<StatusResponse> {
    if (!taskId) {
      throw new SunoError(
        SunoErrorCode.INVALID_REQUEST,
        400,
        "Task ID is required"
      );
    }

    try {
      const jobId = this.getJobId(taskId);

      Logger.debug(
        `Checking status for taskId ${taskId} with TTAPI jobId ${jobId}`
      );

      const response = await axios.post(
        `${this.baseUrl}/fetch`,
        { jobId },
        this.getRequestHeaders()
      );

      const ttapiResponse = this.handleResponse<TTAPIResponse>(response);
      const progress = parseInt(ttapiResponse.data.progress || "0");

      const statusData: StatusData = {
        status: this.mapTTAPIStatusToInternal(ttapiResponse.status),
        progress,
        jobId: ttapiResponse.data.jobId,
        error: ttapiResponse.data.message,
      };

      return {
        status: statusData.status,
        progress,
        data: statusData,
      };
    } catch (error) {
      if (error instanceof SunoError) {
        throw error;
      }
      throw new SunoError(
        SunoErrorCode.NETWORK_ERROR,
        500,
        "Network error during status check"
      );
    }
  }

  /**
   * @method waitForCompletion
   * @description Waits for a song generation task to complete
   * @param {string} taskId - Our internal task ID
   * @param {Object} [options] - Options for the wait operation
   * @returns {AsyncGenerator<StatusData, SongResponse>} Generator that yields status updates and returns song data
   * @throws {SunoError} If the wait operation times out or fails
   */
  async *waitForCompletion(
    taskId: string,
    options: WaitForCompletionOptions = {}
  ): AsyncGenerator<StatusData, SongResponse> {
    const { timeout = 400000, interval = 5000, onStatusUpdate } = options;
    const startTime = Date.now();
    const jobId = this.getJobId(taskId);
    Logger.debug(
      `Waiting for completion of taskId ${taskId} with TTAPI jobId ${jobId}`
    );

    let lastProgress = 0;

    while (true) {
      if (Date.now() - startTime > timeout) {
        throw new SunoError(
          SunoErrorCode.TIMEOUT,
          408,
          `Song generation timed out after ${timeout}ms`
        );
      }

      const response = await axios.post(
        `${this.baseUrl}/fetch`,
        { jobId },
        this.getRequestHeaders()
      );

      const ttapiResponse = this.handleResponse<TTAPIResponse>(response);

      // Always update progress if it has changed
      if (
        ttapiResponse.data.progress &&
        parseInt(ttapiResponse.data.progress) > lastProgress
      ) {
        lastProgress = parseInt(ttapiResponse.data.progress);
        const statusData: StatusData = {
          status: this.mapTTAPIStatusToInternal(ttapiResponse.status),
          progress: lastProgress,
          jobId: ttapiResponse.data.jobId,
          error: ttapiResponse.data.message,
        };

        if (onStatusUpdate) {
          onStatusUpdate(statusData);
        }
        yield statusData;
      }

      switch (ttapiResponse.status) {
        case "SUCCESS":
          return await this.getSong(taskId);
        case "FAILED":
          throw new SunoError(
            SunoErrorCode.GENERATION_FAILED,
            500,
            ttapiResponse.data.message || "Song generation failed"
          );
        case "ON_QUEUE":
        case "PROCESSING":
        default:
          await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }
  }

  /**
   * @method getSong
   * @description Retrieves the generated song data once complete
   * @param {string} taskId - Our internal task ID
   * @returns {Promise<SongResponse>} Generated song data including download URL
   * @throws {SunoError} If the song retrieval fails
   */
  async getSong(taskId: string): Promise<SongResponse> {
    if (!taskId) {
      throw new SunoError(
        SunoErrorCode.INVALID_REQUEST,
        400,
        "Task ID is required"
      );
    }

    try {
      const jobId = this.getJobId(taskId);
      Logger.debug(
        `Getting song for taskId ${taskId} with TTAPI jobId ${jobId}`
      );

      const response = await axios.post(
        `${this.baseUrl}/fetch`,
        { jobId },
        this.getRequestHeaders()
      );

      const ttapiResponse = this.handleResponse<TTAPIResponse>(response);

      if (
        ttapiResponse.status !== "SUCCESS" ||
        !ttapiResponse.data.musics?.[0]
      ) {
        throw new SunoError(
          SunoErrorCode.GENERATION_FAILED,
          500,
          `Song not ready or failed. Status: ${ttapiResponse.status}`
        );
      }

      const music = ttapiResponse.data.musics[0];
      const duration = await calculateDuration(music.audioUrl);

      return {
        jobId: ttapiResponse.data.jobId,
        music: {
          musicId: music.musicId,
          title: music.title,
          audioUrl: music.audioUrl,
          duration,
        },
        metadata: {
          title: music.title,
          tags: [], // Note: TTAPI doesn't return tags in the response
        },
      };
    } catch (error) {
      if (error instanceof SunoError) {
        throw error;
      }
      throw new SunoError(
        SunoErrorCode.NETWORK_ERROR,
        500,
        "Network error during song retrieval"
      );
    }
  }
}
