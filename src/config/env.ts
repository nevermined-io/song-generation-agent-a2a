/**
 * @file env.ts
 * @description Environment configuration and validation
 */

import dotenv from "dotenv";

dotenv.config();

export const NVM_API_KEY = process.env.NVM_API_KEY!;
export const NVM_ENVIRONMENT = process.env.NVM_ENVIRONMENT || "testing";
export const AGENT_DID = process.env.AGENT_DID!;
export const SUNO_API_KEY = process.env.SUNO_API_KEY!;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
export const IS_DUMMY = process.env.IS_DUMMY === "true";
export const DUMMY_JOB_ID = process.env.DUMMY_JOB_ID!;
export const DEMO_MODE = process.env.DEMO_MODE === "true";

export interface EnvConfig {
  PORT: number;
  HOST: string;
  NODE_ENV: string;
  LOG_LEVEL: string;
  OPENAI_API_KEY: string;
  SUNO_API_KEY: string;
  MAX_CONCURRENT_TASKS: number;
  MAX_RETRIES: number;
  RETRY_DELAY: number;
  TASK_TIMEOUT: number;
}

/**
 * @constant defaultConfig
 * @description Default configuration values
 */
export const defaultConfig: Partial<EnvConfig> = {
  PORT: 8001,
  HOST: "localhost",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  MAX_CONCURRENT_TASKS: 1,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  TASK_TIMEOUT: 400000, // 5 minutes
};

/**
 * @constant requiredEnvVars
 * @description List of required environment variables
 */
export const requiredEnvVars: (keyof EnvConfig)[] = [
  "OPENAI_API_KEY",
  "SUNO_API_KEY",
];
