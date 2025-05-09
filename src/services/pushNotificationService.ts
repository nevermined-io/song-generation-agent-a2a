/**
 * @file pushNotificationService.ts
 * @description Service for handling push notifications using Server-Sent Events (SSE)
 */

import { Response } from "express";
import { Logger } from "../utils/logger";
import {
  PushNotificationConfig,
  PushNotificationEvent,
  PushNotificationEventType,
} from "../interfaces/a2a";

/**
 * @class PushNotificationService
 * @description Manages SSE connections and push notifications
 */
export class PushNotificationService {
  private connections: Map<string, Set<Response>>;
  private subscriptions: Map<string, PushNotificationConfig>;

  constructor() {
    this.connections = new Map();
    this.subscriptions = new Map();
  }

  /**
   * @method subscribeSSE
   * @description Subscribe a client to SSE notifications for a task
   * @param {string} taskId - The task ID to subscribe to
   * @param {Response} res - The Express response object for SSE
   * @param {PushNotificationConfig} config - Notification configuration
   */
  public subscribeSSE(
    taskId: string,
    res: Response,
    config: PushNotificationConfig
  ): void {
    // If no eventTypes are specified, subscribe to all events
    if (!config.eventTypes || config.eventTypes.length === 0) {
      config.eventTypes = [
        PushNotificationEventType.STATUS_UPDATE,
        PushNotificationEventType.ARTIFACT_CREATED,
        PushNotificationEventType.ERROR,
        PushNotificationEventType.COMPLETION,
      ];
    } else {
      // Convert strings to PushNotificationEventType if they come from query
      config.eventTypes = config.eventTypes.map((type: any) =>
        typeof type === "string"
          ? PushNotificationEventType[
              type.toUpperCase() as keyof typeof PushNotificationEventType
            ] || type
          : type
      );
    }
    this.subscriptions.set(taskId, config);
    if (!this.connections.has(taskId)) {
      this.connections.set(taskId, new Set());
    }
    this.connections.get(taskId)?.add(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    this.sendEventToClient(res, {
      type: PushNotificationEventType.STATUS_UPDATE,
      taskId,
      timestamp: new Date().toISOString(),
      data: { status: "connected" },
    });
    Logger.info(`Client subscribed to SSE notifications for task ${taskId}`);
    res.on("close", () => {
      this.unsubscribe(taskId, res);
    });
  }

  /**
   * @method subscribeWebhook
   * @description Register a webhook for push notifications for a task
   * @param {string} taskId - The task ID to subscribe to
   * @param {PushNotificationConfig} config - Notification configuration
   */
  public async subscribeWebhook(
    taskId: string,
    config: PushNotificationConfig
  ): Promise<void> {
    // If no eventTypes are specified, subscribe to all events
    if (!config.eventTypes || config.eventTypes.length === 0) {
      config.eventTypes = [
        PushNotificationEventType.STATUS_UPDATE,
        PushNotificationEventType.ARTIFACT_CREATED,
        PushNotificationEventType.ERROR,
        PushNotificationEventType.COMPLETION,
      ];
    }
    this.subscriptions.set(taskId, config);
    Logger.info(`Webhook configured for task ${taskId}: ${config.webhookUrl}`);
  }

  /**
   * @method unsubscribe
   * @description Unsubscribe a client from push notifications
   * @param {string} taskId - The task ID to unsubscribe from
   * @param {Response} res - The Express response object
   */
  public unsubscribe(taskId: string, res: Response): void {
    const connections = this.connections.get(taskId);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        this.connections.delete(taskId);
        this.subscriptions.delete(taskId);
      }
    }
    Logger.info(`Client unsubscribed from notifications for task ${taskId}`);
  }

  /**
   * @method notify
   * @description Send a notification to all subscribed clients for a task
   * @param {string} taskId - The task ID
   * @param {PushNotificationEvent} event - The event to send
   */
  public notify(taskId: string, event: PushNotificationEvent): void {
    const connections = this.connections.get(taskId);
    const config = this.subscriptions.get(taskId);
    Logger.info(`Notifying task ${taskId} with event ${event.type}`);

    if (!config) {
      return;
    }

    // Only send if client is subscribed to this event type
    if (config.eventTypes.includes(event.type)) {
      // Send to all SSE connections if any
      if (connections) {
        connections.forEach((res) => {
          this.sendEventToClient(res, event);
        });
      }
      // Always send to webhook if configured
      if (config.webhookUrl) {
        this.sendWebhookNotification(config.webhookUrl, event);
      }
    }
  }

  /**
   * @private
   * @method sendEventToClient
   * @description Send an SSE event to a client
   * @param {Response} res - The Express response object
   * @param {PushNotificationEvent} event - The event to send
   */
  private sendEventToClient(res: Response, event: PushNotificationEvent): void {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      Logger.error(`Error sending event to client: ${error}`);
      this.unsubscribe(event.taskId, res);
    }
  }

  /**
   * @private
   * @method sendWebhookNotification
   * @description Send a notification to a webhook URL
   * @param {string} webhookUrl - The webhook URL
   * @param {PushNotificationEvent} event - The event to send
   */
  private async sendWebhookNotification(
    webhookUrl: string,
    event: PushNotificationEvent
  ): Promise<void> {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      Logger.error(`Error sending webhook notification: ${error}`);
    }
  }
}
