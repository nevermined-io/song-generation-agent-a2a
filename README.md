[![banner](https://raw.githubusercontent.com/nevermined-io/assets/main/images/logo/banner_logo.png)](https://nevermined.io)

Song Generator Agent (TypeScript)
=================================

> A TypeScript agent that listens for tasks via the **a2a** protocol, automatically generates lyrics and metadata using **LangChain** + **OpenAI**, and produces the final audio track through the **Suno** AI Music Generation API. It manages multiple steps internally, uses a modular architecture, and supports real-time notifications (SSE) and webhooks.

* * *

**Description**
---------------

The **Song Generator Agent** is designed to:

1.  **Receive** prompts or ideas for songs (e.g., "A futuristic ballad about neon cities").
2.  **Generate** missing metadata (lyrics, title, tags) using **LangChain** and **OpenAI**.
3.  **Invoke** the **Suno** API to synthesize the audio track (MP3) based on the prompt and metadata.
4.  **Output** the final track's URL, title, duration, and lyrics.

This agent implements the **A2A** (Agent-to-Agent) protocol, enabling standard orchestration and communication between Nevermined agents and third parties.

* * *

**Related Projects**
--------------------

This **Song Generator Agent** is part of an AI-powered multimedia creation ecosystem. To see how it interacts with other agents:

1.  [Music Video Orchestrator Agent](https://github.com/nevermined-io/music-video-orchestrator)
    * Orchestrates end-to-end workflows: collects prompts, splits tasks, pays agents, merges results.
2.  [Script Generator Agent](https://github.com/nevermined-io/movie-script-generator-agent)
    * Generates cinematic scripts, extracts scenes and characters, produces prompts for video.
3.  [Image / Video Generator Agent](https://github.com/nevermined-io/video-generator-agent)
    * Produces images/video using third-party APIs (Fal.ai, TTapi, Flux, Kling.ai).

**Workflow example:**

```
[ User Prompt ] --> [Music Orchestrator] --> [Song Generation] --> [Script Generation] --> [Image/Video Generation] --> [Final Compilation]
```

* * *

**Table of Contents**
---------------------

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Environment Variables](#environment-variables)
5. [Project Structure](#project-structure)
6. [Architecture & Workflow](#architecture--workflow)
7. [A2A Protocol](#a2a-protocol)
8. [Usage](#usage)
9. [Detailed Guide: Examples & Scripts](#detailed-guide-examples--scripts)
10. [Development & Testing](#development--testing)
11. [License](#license)

* * *

**Features**
-------------

* **Automatic metadata generation**: Uses **LangChain** + **OpenAI** for lyrics, titles, and tags.
* **Music generation with Suno**: Calls Suno's AI to synthesize the track, monitors progress, and retrieves the final MP3.
* **A2A protocol**: Full support for tasks, states, SSE notifications, and webhooks.
* **Configurable**: Customize prompts, models, or OpenAI usage.
* **Logging and error management**: Detailed logs (info, success, warn, error) via a custom `Logger`.
* **Modular and SOLID architecture**: Each class/function has a clear responsibility.
* **Real-time notifications**: Support for SSE and webhooks to receive task updates.

* * *

**Prerequisites**
-----------------

* **Node.js** (>= 18.0.0 recommended)
* **TypeScript** (^5.7.0 or higher)
* **Suno API Key** (for music generation)
* **OpenAI API Key** (for metadata/lyrics generation)

* * *

**Installation**
----------------

1.  **Clone** the repository:
    ```bash
    git clone https://github.com/nevermined-io/song-generation-agent-a2a.git
    cd song-generation-agent-a2a
    ```
2.  **Install** dependencies:
    ```bash
    yarn install
    ```
3.  **Configure** the environment:
    ```bash
    cp .env.example .env
    # Edit .env and add your keys
    ```
4.  **Build** the project (optional for production):
    ```bash
    yarn build
    ```

* * *

**Environment Variables**
-------------------------

Rename `.env.example` to `.env` and set the required keys:

```env
SUNO_API_KEY=your_suno_key
OPENAI_API_KEY=your_openai_key
```

* `SUNO_API_KEY`: Access to the Suno API for music generation.
* `OPENAI_API_KEY`: Access to OpenAI for lyrics/metadata generation.

* * *

**Project Structure**
---------------------

```plaintext
song-generation-agent-a2a/
├── src/
│   ├── server.ts                # Main entry point (Express)
│   ├── routes/
│   │   └── a2aRoutes.ts         # RESTful and A2A routes
│   ├── controllers/
│   │   ├── a2aController.ts     # Main A2A protocol logic
│   │   └── songController.ts    # Song generation logic
│   ├── core/
│   │   ├── songMetadataGenerator.ts # Metadata generation with OpenAI
│   │   ├── taskProcessor.ts     # Task processing
│   │   ├── taskStore.ts         # Task storage and lifecycle
│   │   └── ...
│   ├── services/
│   │   ├── pushNotificationService.ts # SSE and webhook notifications
│   │   └── streamingService.ts  # Real-time SSE streaming
│   ├── clients/
│   │   └── sunoClient.ts        # Suno API client
│   ├── interfaces/              # Types and A2A contracts
│   ├── models/                  # Data models (Song, Task)
│   ├── utils/                   # Utilities and logger
│   └── config/                  # Configuration and environment variables
├── scripts/
│   ├── generate-song.ts                 # CLI script: polling
│   ├── generate-song-with-notifications.ts # CLI script: SSE
│   └── generate-song-with-webhook.ts     # CLI script: webhooks
├── package.json
└── README.md
```

* * *

**Architecture & Workflow**
---------------------------

1. **Task reception**: The agent exposes RESTful and A2A endpoints (`/tasks/send`, `/tasks/sendSubscribe`) to receive prompts and metadata.
2. **Metadata generation**: If lyrics, title, or tags are missing, they are automatically generated using OpenAI via LangChain.
3. **Audio generation**: The Suno API is called to create the music track.
4. **Notifications**: The agent emits status updates and results via SSE (`/tasks/:taskId/notifications`) or webhooks.
5. **Result delivery**: The user receives the audio URL, title, duration, and lyrics as A2A artifacts.

**Simplified flow diagram:**

```
Client         Agent           OpenAI         Suno API
  |             |               |               |
  |--Task------>|               |               |
  |             |--(if needed)->|               |
  |             |  Generate     |               |
  |             |  metadata     |               |
  |             |<--------------|               |
  |             |  Metadata     |               |
  |             |---------------|--Generate---->|
  |             |               |   music track |
  |             |<------------------------------|
  |             |   Audio generated             |
  |<------------|   SSE/Webhook notifications   |
  |<------------|   Final result (artifacts)    |
```

* * *

**A2A Protocol**
----------------

The agent implements the **A2A** (Agent-to-Agent) protocol, which defines:

- **Task states**: `submitted`, `working`, `input-required`, `completed`, `failed`, `cancelled`.
- **Messages**: Standard structure with `role`, `parts` (text, audio, file, etc.).
- **Artifacts**: Structured responses with parts (audio, text, metadata).
- **Notifications**: Real-time updates via SSE or webhooks.

**Example task lifecycle:**

```
[SUBMITTED] --> [WORKING] --> [COMPLETED]
     |             |             
     |             +--> [INPUT-REQUIRED]
     |             |
     +-------------+--> [FAILED]
                   |
                   +--> [CANCELLED]
```

**A2A request example (JSON-RPC):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tasks/sendSubscribe",
  "params": {
    "id": "unique-task-id",
    "sessionId": "user-session-123",
    "acceptedOutputModes": ["text"],
    "message": {
      "role": "user",
      "parts": [
        { "type": "text", "text": "Create a happy pop song about summer" }
      ]
    }
  }
}
```

**Streaming SSE response example:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": "unique-task-id",
    "status": {
      "state": "working",
      "timestamp": "2024-06-01T12:00:00Z",
      "message": {
        "role": "agent",
        "parts": [
          { "type": "text", "text": "Generating song metadata..." }
        ]
      }
    },
    "final": false
  }
}
```

**Final artifact:**

```json
{
  "parts": [
    { "type": "audio", "audioUrl": "https://.../song.mp3" },
    { "type": "text", "text": "{\"title\":\"Summer Vibes\",...}" }
  ],
  "metadata": {
    "title": "Summer Vibes",
    "tags": ["pop", "happy", "summer"],
    "duration": 180
  },
  "index": 0
}
```

**Notifications and streaming:**
- **SSE**: Subscribe to `/tasks/:taskId/notifications` to receive real-time events.
- **Webhooks**: Register an endpoint via `/tasks/:taskId/notifications` (POST) to receive push events.

**A2A Protocol and API Endpoints**
----------------------------------

All API endpoints for task creation now require **JSON-RPC 2.0** requests and responses, as per the A2A protocol. This applies to `/tasks/send` and `/tasks/sendSubscribe`.

- **Endpoint for single-turn tasks:**
  - `POST /tasks/send`
- **Endpoint for streaming/multi-turn tasks:**
  - `POST /tasks/sendSubscribe`

**Notification Modes**
----------------------

The `/tasks/sendSubscribe` endpoint supports two notification modes, controlled by the `notification.mode` field in the request `params`:

- **SSE (Server-Sent Events):** Default mode. The HTTP connection remains open and the server streams events to the client.
- **Webhook:** The server sends notifications to a client-provided URL via HTTP POST.

**Request format (JSON-RPC 2.0):**

*For SSE (default):*
```json
{
  "jsonrpc": "2.0",
  "id": "client-request-id",
  "method": "tasks/sendSubscribe",
  "params": {
    "message": { ... },
    "notification": {
      "mode": "sse",
      "eventTypes": ["status_update", "completion"]
    }
  }
}
```

*For Webhook:*
```json
{
  "jsonrpc": "2.0",
  "id": "client-request-id",
  "method": "tasks/sendSubscribe",
  "params": {
    "message": { ... },
    "notification": {
      "mode": "webhook",
      "url": "https://yourapp.com/webhook-endpoint",
      "eventTypes": ["status_update", "completion"]
    }
  }
}
```

**Response format (JSON-RPC 2.0):**

- For SSE: The connection remains open and events are streamed.
- For Webhook: The server responds immediately with the taskId and sends notifications to the provided URL.

**Example event payload:**
```json
{
  "type": "status_update",
  "taskId": "...",
  "timestamp": "...",
  "data": { ... }
}
```

**Note:** The client must specify the notification mode in the request. If not specified, SSE is used by default.

* * *

**Usage**
---------

1. **Configure** `.env` with your keys.
2. **Start** the agent in development mode:
    ```bash
    yarn dev
    ```
   The agent will wait for A2A or REST tasks.
3. **Send a prompt** using a compatible client (see examples below).

* * *

**Detailed Guide: Examples & Scripts**
--------------------------------------

The repository includes example scripts to interact with the agent:

### 1. Classic polling (`scripts/generate-song.ts`)

Launches a task and periodically checks its status until completion.

```bash
yarn generate-song
```

### 2. SSE notifications (`scripts/generate-song-with-notifications.ts`)

Launches a task and subscribes to SSE events to receive real-time updates.

```bash
ts-node scripts/generate-song-with-notifications.ts "Create a pop song about summer"
```

### 3. Webhooks (`scripts/generate-song-with-webhook.ts`)

Launches a task and registers a local webhook to receive push notifications.

```bash
ts-node scripts/generate-song-with-webhook.ts "Create a pop song about summer"
```

**Programmatic usage example:**

```typescript
import { generateSong } from "./scripts/generate-song";

const result = await generateSong({
  idea: "Create a happy pop song about summer",
  title: "Summer Vibes",
  tags: ["pop", "happy", "summer"],
  lyrics: "We dance all night under the summer sky...",
  duration: 180,
});
console.log(result);
```

* * *

**How it works internally**
---------------------------

- **Input**: Receives an A2A message (prompt, optional metadata).
- **Validation**: If information is missing, requests additional input (`input-required`).
- **Metadata generation**: Uses OpenAI (LangChain) for lyrics, title, and tags.
- **Audio generation**: Calls Suno via API to create the track.
- **Notifications**: Emits SSE and/or webhook events on each state change.
- **Delivery**: Returns artifacts with the audio URL, title, duration, and lyrics.

* * *

**Development & Testing**
-------------------------

### Local execution

```bash
yarn dev
```

By default, it subscribes to the `AGENT_DID` in your `.env`.

### Build for production

```bash
yarn build
```

### Testing

```bash
yarn test
```

* * *

**License**
------------

```
Apache License 2.0

(C) 2025 Nevermined AG

Licensed under the Apache License, Version 2.0 (the "License"); 
you may not use this file except in compliance with the License.
You may obtain a copy of the License at:

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software 
distributed under the License is distributed on an "AS IS" BASIS, 
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. 
See the License for the specific language governing permissions 
and limitations under the License.
```