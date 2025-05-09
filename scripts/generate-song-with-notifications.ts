/**
 * Script to generate a song using the Nevermined agent with SSE notifications (A2A JSON-RPC 2.0)
 * This script makes a single POST request to /tasks/sendSubscribe with notification.mode: 'sse',
 * and processes SSE events directly from the response stream.
 *
 * This script is now fully compliant with the A2A protocol (JSON-RPC 2.0) and uses the notification.mode field.
 */

import { v4 as uuidv4 } from "uuid";
import http from "http";
import https from "https";
import { URL } from "url";

// Configuration
const CONFIG = {
  serverUrl: process.env.SERVER_URL || "http://localhost:8001",
  eventTypes: ["status_update", "completion"],
};

/**
 * Creates a new song generation task and processes SSE events from the same connection
 * @param {Object} params Song generation parameters
 * @param {string} [params.idea] The main idea or prompt for the song
 * @param {string} [params.title] The title of the song
 * @param {string[]} [params.tags] Tags for the song
 * @param {string} [params.lyrics] Lyrics for the song
 * @param {number} [params.duration] Duration of the song in seconds
 * @param {string} [params.sessionId] Optional session ID
 * @returns {Promise<void>}
 */
async function generateSongWithNotifications(params: {
  idea?: string;
  title?: string;
  tags?: string[];
  lyrics?: string;
  duration?: number;
  sessionId?: string;
}): Promise<void> {
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

  // JSON-RPC 2.0 request body with SSE notification
  const jsonRpcRequest = {
    jsonrpc: "2.0",
    id: uuidv4(),
    method: "tasks/sendSubscribe",
    params: {
      sessionId: params.sessionId || uuidv4(),
      message,
      metadata,
      acceptedOutputModes: ["text"],
      notification: {
        mode: "sse",
        eventTypes: CONFIG.eventTypes,
      },
    },
  };

  // Prepare HTTP(S) request options
  const url = new URL("/tasks/sendSubscribe", CONFIG.serverUrl);
  const isHttps = url.protocol === "https:";
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
  };

  // Choose http or https module
  const client = isHttps ? https : http;

  // Make the POST request and process SSE events from the response
  await new Promise<void>((resolve, reject) => {
    const req = client.request(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Server responded with status ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      let buffer = "";
      console.log("SSE connection established. Waiting for events...");
      res.on("data", (chunk) => {
        buffer += chunk;
        let eventEnd;
        while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);
          processSSEEvent(rawEvent);
        }
      });
      res.on("end", () => {
        console.log("SSE connection closed by server.");
        resolve();
      });
      res.on("error", (err) => {
        reject(err);
      });
    });
    req.on("error", (err) => {
      reject(err);
    });
    req.write(JSON.stringify(jsonRpcRequest));
    req.end();
  });
}

/**
 * Parses and processes a single SSE event block
 * @param {string} rawEvent The raw SSE event string
 */
function processSSEEvent(rawEvent: string) {
  const lines = rawEvent.split("\n");
  let eventType = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }
  if (data) {
    try {
      const parsed = JSON.parse(data);
      console.log(`[SSE][${eventType}]`, parsed);
      // Optionally, handle completion/error to exit early
      if (eventType === "completion" || eventType === "error") {
        console.log("Final event received. Exiting.");
        process.exit(0);
      }
    } catch (err) {
      console.error("Failed to parse SSE data:", data, err);
    }
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
