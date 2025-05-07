/**
 * Script to generate a song using the Nevermined agent with webhook notifications
 * Instead of SSE, it registers a webhook and receives notifications via HTTP POST
 * @todo Remove the express server after testing
 */

import axios, { AxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";
import express from "express";
import bodyParser from "body-parser";
import { AddressInfo } from "net";

// Configuration
const CONFIG = {
  serverUrl: process.env.SERVER_URL || "http://localhost:8001",
  webhookPort: 4001,
  webhookPath: "/webhook-test-client",
  eventTypes: ["status_update", "completion"],
};

/**
 * Starts a temporary Express server to receive webhook notifications
 * @returns {Promise<string>} The webhook URL
 */
async function startWebhookServer(): Promise<string> {
  return new Promise((resolve) => {
    const app = express();
    app.use(bodyParser.json());

    //TODO: remove after testing
    app.post(CONFIG.webhookPath, (req, res) => {
      console.log(
        "[Webhook Client] Notification received:",
        JSON.stringify(req.body, null, 2)
      );
      res.status(200).send("OK");
    });

    const server = app.listen(CONFIG.webhookPort, () => {
      const address = server.address() as AddressInfo;
      const url = `http://localhost:${address.port}${CONFIG.webhookPath}`;
      console.log(`[Webhook Client] Listening for notifications at: ${url}`);
      resolve(url);
    });
  });
}

/**
 * Creates a new song generation task (JSON-RPC 2.0)
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
 * Registers a webhook for receiving notifications for a task
 * @param {string} taskId The task ID
 * @param {string} webhookUrl The webhook URL
 * @returns {Promise<void>}
 */
async function registerWebhook(
  taskId: string,
  webhookUrl: string
): Promise<void> {
  try {
    const config = {
      taskId,
      eventTypes: CONFIG.eventTypes,
      webhookUrl,
    };
    console.log("Registering webhook:", config);
    const response = await axios.post(
      `${CONFIG.serverUrl}/tasks/${taskId}/notifications`,
      config
    );
    console.log("Webhook registration response:", response.data);
  } catch (error) {
    if (error instanceof AxiosError) {
      console.error("Webhook registration error:", error.response?.data);
      throw new Error(`Failed to register webhook: ${error.message}`);
    }
    throw new Error("Failed to register webhook: Unknown error");
  }
}

/**
 * Main function to generate a song and receive webhook notifications
 * @param {Object} songParams Parameters for song generation
 * @param {string} [songParams.idea] The main idea or prompt for the song
 * @param {string} [songParams.title] The title of the song
 * @param {string[]} [songParams.tags] Tags for the song
 * @param {string} [songParams.lyrics] Lyrics for the song
 * @param {number} [songParams.duration] Duration of the song in seconds
 * @param {string} [songParams.sessionId] Optional session ID
 * @returns {Promise<void>}
 */
async function generateSongWithWebhook(songParams: {
  idea?: string;
  title?: string;
  tags?: string[];
  lyrics?: string;
  duration?: number;
  sessionId?: string;
}): Promise<void> {
  // Start webhook server
  const webhookUrl = await startWebhookServer();

  // Create task
  const taskId = await createSongTask(songParams);
  console.log(`Task created with ID: ${taskId}`);

  // Register webhook
  await registerWebhook(taskId, webhookUrl);

  console.log("Waiting for webhook notifications... (press Ctrl+C to exit)");
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
  generateSongWithWebhook(songParams)
    .then(() => {})
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { generateSongWithWebhook };
