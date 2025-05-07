/**
 * Script to generate a song using the Nevermined agent with SSE notifications (A2A JSON-RPC 2.0)
 * Instead of polling, it subscribes to server events to get real-time updates
 * about the song generation progress
 *
 * This script is now fully compliant with the A2A protocol (JSON-RPC 2.0).
 */

import axios, { AxiosError } from "axios";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import EventSource from "eventsource";

// Configuration
const CONFIG = {
  serverUrl: process.env.SERVER_URL || "http://localhost:8001",
  maxConnectionAttempts: 5,
  reconnectDelay: 1000, // 1 second
};

// Types for SSE messages
interface TaskNotification {
  type: string;
  taskId: string;
  timestamp: string;
  data: {
    status?: {
      state: string;
      timestamp: string;
    };
    progress?: number;
    error?: string;
    parts?: Array<{
      type: string;
      text?: string;
      audioUrl?: string;
    }>;
    artifacts?: Array<{
      parts: Array<{
        type: string;
        text?: string;
        audioUrl?: string;
      }>;
    }>;
    result?: any;
  };
}

/**
 * Checks if the server is running by making a health check request
 * @returns {Promise<boolean>} True if server is running, false otherwise
 */
async function isServerRunning(): Promise<boolean> {
  try {
    console.log(`Checking server health at: ${CONFIG.serverUrl}/health`);
    const response = await axios.get(`${CONFIG.serverUrl}/health`);
    console.log("Server response:", response.status, response.data);
    return response.status === 200;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Server connection error:", {
        message: error.message,
        code: error.code,
        response: error.response?.data,
      });
    } else {
      console.error("Unknown error:", error);
    }
    return false;
  }
}

/**
 * Starts the server using npm run start
 * @returns {Promise<void>}
 * @throws {Error} If server fails to start within timeout
 */
async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("Starting server...");
    const serverProcess = spawn("npm", ["run", "start"], {
      stdio: "inherit",
      shell: true,
    });

    let startTimeout: NodeJS.Timeout;
    let checkInterval: NodeJS.Timeout;

    startTimeout = setTimeout(() => {
      clearInterval(checkInterval);
      serverProcess.kill();
      reject(new Error("Server failed to start within 30 seconds timeout"));
    }, 30000);

    checkInterval = setInterval(async () => {
      try {
        if (await isServerRunning()) {
          clearTimeout(startTimeout);
          clearInterval(checkInterval);
          resolve();
        }
      } catch (error) {
        console.log("Waiting for server to be ready...");
      }
    }, 1000);

    serverProcess.on("error", (error) => {
      clearTimeout(startTimeout);
      clearInterval(checkInterval);
      reject(new Error(`Failed to start server: ${error.message}`));
    });

    serverProcess.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(startTimeout);
        clearInterval(checkInterval);
        reject(new Error(`Server process exited with code ${code}`));
      }
    });
  });
}

/**
 * Creates a new song generation task and sets up push notifications (JSON-RPC 2.0)
 * @param {Object} params Song generation parameters
 * @param {string} [params.idea] The main idea or prompt for the song
 * @param {string} [params.title] The title of the song
 * @param {string[]} [params.tags] Tags for the song
 * @param {string} [params.lyrics] Lyrics for the song
 * @param {number} [params.duration] Duration of the song in seconds
 * @param {string} [params.sessionId] Optional session ID
 * @returns {Promise<string>} Task ID
 */
async function createSongTask(params: {
  idea?: string;
  title?: string;
  tags?: string[];
  lyrics?: string;
  duration?: number;
  sessionId?: string;
}): Promise<string> {
  try {
    // Build the message and metadata according to A2A
    const message = {
      role: "user",
      parts: [{ type: "text", text: params.idea || "" }],
    };
    const metadata: Record<string, any> = {};
    if (params.title) metadata.title = params.title;
    if (params.tags) metadata.tags = params.tags;
    if (params.lyrics) metadata.lyrics = params.lyrics;
    if (params.duration) metadata.duration = params.duration;

    // JSON-RPC 2.0 request body
    const jsonRpcRequest = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tasks/sendSubscribe",
      params: {
        id: uuidv4(),
        sessionId: params.sessionId || uuidv4(),
        message,
        metadata,
        acceptedOutputModes: ["text"],
      },
    };

    console.log("Sending JSON-RPC 2.0 task request:", jsonRpcRequest);
    const response = await axios.post(
      `${CONFIG.serverUrl}/tasks/sendSubscribe`,
      jsonRpcRequest
    );
    console.log("Server response:", response.data);
    if (response.data && response.data.result && response.data.result.id) {
      return response.data.result.id;
    }
    throw new Error("Invalid response from server: missing result.id");
  } catch (error) {
    if (error instanceof AxiosError) {
      console.error("API Response:", error.response?.data);
      throw new Error(
        `Failed to create song generation task: ${error.message}`
      );
    }
    throw new Error("Failed to create song generation task: Unknown error");
  }
}

/**
 * Subscribes to task updates using Server-Sent Events
 * @param {string} taskId The task ID to subscribe to
 * @returns {Promise<any>} Returns a promise that resolves with the final task result
 */
function subscribeToTaskUpdates(taskId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    let lastProgress = 0;
    let lastMessage = "";
    let reconnectAttempts = 0;

    function connect() {
      const eventSource = new EventSource(
        `${CONFIG.serverUrl}/tasks/${taskId}/notifications`,
        {
          headers: {
            Accept: "text/event-stream",
          },
        }
      );

      eventSource.onopen = () => {
        console.log("SSE connection established");
        reconnectAttempts = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const notification = JSON.parse(event.data) as TaskNotification;
          console.log("Received notification:", notification);

          // Handle progress updates
          if (notification.data?.status?.state) {
            console.log(`Status: ${notification.data.status.state}`);

            // Check for completion or error states
            if (
              ["COMPLETED", "FAILED", "CANCELLED"].includes(
                notification.data.status.state
              )
            ) {
              eventSource.close();
              if (notification.data.status.state === "COMPLETED") {
                resolve(notification.data);
              } else {
                reject(
                  new Error(
                    `Task ${notification.data.status.state.toLowerCase()}: ${
                      notification.data.error || "Unknown error"
                    }`
                  )
                );
              }
            }
          }

          // Handle progress updates
          if (
            notification.data?.progress &&
            notification.data.progress > lastProgress
          ) {
            lastProgress = notification.data.progress;
            console.log(`Progress: ${notification.data.progress}%`);
          }

          // Handle message updates
          if (notification.data?.parts) {
            const currentMessage = notification.data.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");

            if (currentMessage && currentMessage !== lastMessage) {
              console.log(`Update: ${currentMessage}`);
              lastMessage = currentMessage;
            }
          }

          // Handle artifacts
          if (notification.data?.artifacts) {
            console.log("Received artifacts:", notification.data.artifacts);
          }
        } catch (error) {
          console.error("Error parsing SSE message:", error);
        }
      };

      eventSource.onerror = (event) => {
        console.error("SSE connection error:", event);
        eventSource.close();

        if (reconnectAttempts < CONFIG.maxConnectionAttempts) {
          reconnectAttempts++;
          console.log(
            `Reconnecting (attempt ${reconnectAttempts}/${CONFIG.maxConnectionAttempts})...`
          );
          setTimeout(connect, CONFIG.reconnectDelay);
        } else {
          reject(new Error("Max reconnection attempts reached"));
        }
      };
    }

    connect();
  });
}

/**
 * Generates a song with real-time updates via SSE
 * @param {Object} songParams Parameters for song generation
 * @param {string} [songParams.idea] The main idea or prompt for the song
 * @param {string} [songParams.title] The title of the song
 * @param {string[]} [songParams.tags] Tags for the song
 * @param {string} [songParams.lyrics] Lyrics for the song
 * @param {number} [songParams.duration] Duration of the song in seconds
 * @param {string} [songParams.sessionId] Optional session ID
 * @returns {Promise<any>} The final song generation result
 */
async function generateSongWithNotifications(songParams: {
  idea?: string;
  title?: string;
  tags?: string[];
  lyrics?: string;
  duration?: number;
  sessionId?: string;
}): Promise<any> {
  try {
    // Ensure server is running
    if (!(await isServerRunning())) {
      console.log("Server not running, attempting to start...");
      await startServer();
    }

    // Create task and get updates
    const taskId = await createSongTask(songParams);
    console.log(`Task created with ID: ${taskId}`);

    // Subscribe to updates and wait for completion
    const result = await subscribeToTaskUpdates(taskId);
    console.log("Song generation completed:", result);
    return result;
  } catch (error) {
    console.error("Error in song generation:", error);
    throw error;
  }
}

// Run the script if called directly
if (require.main === module) {
  const songParams = {
    idea: process.argv[2] || "Create a happy pop song about summer adventures",
    title: "Summer Vibes",
    tags: ["pop", "happy", "summer"],
    lyrics: "We dance all night under the summer sky...",
    duration: 180,
  };
  generateSongWithNotifications(songParams)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { generateSongWithNotifications };
