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
 * Creates a new song generation task
 * @param {Object} params Song generation parameters
 * @returns {Promise<string>} Task ID
 */
async function createSongTask(params: {
  prompt: string;
  style?: string;
  duration?: number;
}): Promise<string> {
  try {
    const taskRequest = {
      prompt: params.prompt,
      sessionId: uuidv4(),
    };
    console.log("Sending task request:", taskRequest);
    const response = await axios.post(
      `${CONFIG.serverUrl}/tasks/sendSubscribe`,
      taskRequest
    );
    console.log("Server response:", response.data);
    return response.data.id;
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
 * @returns {Promise<void>}
 */
async function generateSongWithWebhook(songParams: {
  prompt: string;
  style?: string;
  duration?: number;
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
  const prompt =
    process.argv[2] || "Create a happy pop song about summer adventures";
  generateSongWithWebhook({ prompt })
    .then(() => {})
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { generateSongWithWebhook };
