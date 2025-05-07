/**
 * Script to generate a song using the Nevermined agent (A2A JSON-RPC 2.0)
 * It checks if the server is running, starts it if needed,
 * creates a song generation task and polls for its completion
 *
 * This script is now fully compliant with the A2A protocol (JSON-RPC 2.0).
 */

import axios, { AxiosError } from "axios";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";

// Configuration
const CONFIG = {
  serverUrl: process.env.SERVER_URL || "http://localhost:8001",
  pollingInterval: 5000, // 5 seconds
  maxRetries: 60, // 5 minutes maximum waiting time
};

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
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers,
        },
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

    // Set a timeout of 30 seconds for server to start
    startTimeout = setTimeout(() => {
      clearInterval(checkInterval);
      serverProcess.kill();
      reject(new Error("Server failed to start within 30 seconds timeout"));
    }, 30000);

    // Wait for server to be ready
    checkInterval = setInterval(async () => {
      try {
        if (await isServerRunning()) {
          clearTimeout(startTimeout);
          clearInterval(checkInterval);
          resolve();
        }
      } catch (error) {
        // If checking server status fails, log but continue waiting
        console.log("Waiting for server to be ready...");
      }
    }, 1000);

    // Handle server process errors
    serverProcess.on("error", (error) => {
      clearTimeout(startTimeout);
      clearInterval(checkInterval);
      reject(new Error(`Failed to start server: ${error.message}`));
    });

    // Handle server process exit
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
 * Creates a new song generation task using JSON-RPC 2.0 (A2A protocol)
 * @param {Object} params Song generation parameters
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
      method: "tasks/send",
      params: {
        id: uuidv4(),
        sessionId: params.sessionId || uuidv4(),
        message,
        metadata,
      },
    };

    console.log("Sending JSON-RPC 2.0 task request:", jsonRpcRequest);
    const response = await axios.post(
      `${CONFIG.serverUrl}/tasks/send`,
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
      console.error("Request that failed:", {
        url: error.config?.url,
        data: error.config?.data,
        headers: error.config?.headers,
      });
      throw new Error(
        `Failed to create song generation task: ${error.message}`
      );
    }
    throw new Error("Failed to create song generation task: Unknown error");
  }
}

/**
 * Checks the status of a task
 * @param {string} taskId The task ID to check
 * @returns {Promise<any>} Task status and result
 */
async function checkTaskStatus(taskId: string): Promise<any> {
  try {
    const response = await axios.get(`${CONFIG.serverUrl}/tasks/${taskId}`);
    return {
      status: response.data.status.state,
      result: response.data.status.message,
      error: response.data.status.error,
      progress: response.data.status.progress || 0,
      parts: response.data.status.message?.parts || [],
      artifacts: response.data.status.artifacts || [],
      history: response.data.status.history || [],
    };
  } catch (error) {
    if (error instanceof AxiosError) {
      console.error("API Response:", error.response?.data);
      throw new Error(`Failed to check task status: ${error.message}`);
    }
    throw new Error("Failed to check task status: Unknown error");
  }
}

/**
 * Main function to generate a song
 * @param {Object} songParams Parameters for song generation
 * @returns {Promise<any>} Generated song data or error
 */
async function generateSong(songParams: {
  idea?: string;
  title?: string;
  tags?: string[];
  lyrics?: string;
  duration?: number;
  sessionId?: string;
}): Promise<any> {
  try {
    // Check if server is running
    const isRunning = await isServerRunning();
    if (!isRunning) {
      await startServer();
    }

    // Create task
    console.log("Creating song generation task...");
    const taskId = await createSongTask(songParams);
    console.log(`Task created with ID: ${taskId}`);

    // Poll for completion
    let retries = 0;
    let lastProgress = 0;
    let lastMessage = "";

    while (retries < CONFIG.maxRetries) {
      const status = await checkTaskStatus(taskId);

      // Handle progress updates
      if (status.progress > lastProgress) {
        lastProgress = status.progress;
        console.log(`Progress: ${status.progress}%`);
      }

      // Handle message updates
      const currentMessage = status.parts
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("\n");

      if (currentMessage && currentMessage !== lastMessage) {
        console.log(`Update: ${currentMessage}`);
        lastMessage = currentMessage;
      }

      // Check final states
      if (status.status === "completed") {
        console.log("Song generation completed successfully!");

        // Buscar el artifact de audio en los artifacts devueltos
        const audioArtifact = status.artifacts?.find((artifact: any) =>
          artifact.parts?.some((part: any) => part.type === "audio")
        );

        if (audioArtifact) {
          const audioPart = audioArtifact.parts.find(
            (part: any) => part.type === "audio"
          );
          const metadataPart = audioArtifact.parts.find(
            (part: any) => part.type === "text"
          );

          return {
            status: "completed",
            audioUrl: audioPart?.audioUrl,
            metadata: metadataPart?.text ? JSON.parse(metadataPart.text) : null,
            artifacts: status.artifacts,
          };
        }
        return status.result;
      } else if (status.status === "failed") {
        throw new Error(`Song generation failed: ${status.error}`);
      } else if (status.status === "cancelled") {
        throw new Error("Song generation was cancelled");
      }

      console.log(`Task status: ${status.status}. Waiting...`);
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.pollingInterval)
      );
      retries++;
    }

    throw new Error("Timeout waiting for song generation");
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error generating song:", error.message);
      throw error;
    }
    throw new Error("Unknown error occurred while generating song");
  }
}

// Example usage
if (require.main === module) {
  const songParams = {
    idea: "Create a happy pop song about summer",
    title: "Summer Vibes",
    tags: ["pop", "happy", "summer"],
    lyrics: "We dance all night under the summer sky...",
    duration: 180, // 3 minutes
  };

  generateSong(songParams)
    .then((result) => {
      console.log("Generated song:", result);
    })
    .catch((error) => {
      console.error("Failed to generate song:", error.message);
      process.exit(1);
    });
}

export { generateSong, isServerRunning, startServer };
