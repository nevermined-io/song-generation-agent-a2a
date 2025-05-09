/**
 * @file songMetadataGenerator.ts
 * @description Generates song metadata using LangChain and OpenAI
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { AIMessage } from "@langchain/core/messages";
import { SongMetadata } from "../models/song";
import { Logger } from "../utils/logger";

/**
 * @typedef {Object} SongMetadataInput
 * @property {string} idea - Main concept or prompt for the song (from message.parts[0].text)
 * @property {string} [title] - The title of the song (from metadata.title)
 * @property {string[]} [tags] - List of genre tags or themes for the song (from metadata.tags)
 * @property {string} [lyrics] - Specific lyrics or text to include in the song (from metadata.lyrics)
 * @property {number} [duration] - Approximate duration of the song in seconds (from metadata.duration)
 */

/**
 * @class SongMetadataGenerator
 * @description Generates structured song metadata using LangChain and OpenAI
 */
export class SongMetadataGenerator {
  private chain: RunnableSequence;
  private readonly MODEL = "gpt-4o-mini";

  /**
   * @constructor
   * @param {string} apiKey - OpenAI API key
   * @throws {Error} If API key is missing
   */
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("OpenAI API key is required");
    }

    const llm = new ChatOpenAI({
      modelName: this.MODEL,
      apiKey,
      temperature: 0.7,
    });

    // Prompt template will be built dynamically in generate()
    this.chain = RunnableSequence.from([
      // Placeholder, replaced in generate()
      async (input: any) => input.prompt,
      llm,
      this.extractJson,
      new JsonOutputParser<SongMetadata>(),
    ]);
  }

  /**
   * @private
   * @method buildPrompt
   * @description Builds the prompt dynamically based on provided fields. If a field is present, the LLM must respect it; otherwise, it must generate it.
   * @param {SongMetadataInput} input - The input object
   * @returns {string} The constructed prompt
   */
  private buildPrompt(input: any): string {
    // Build the partial object only with the present fields
    const partialMetadata: Record<string, any> = {};
    if (input.title) partialMetadata.title = input.title;
    if (input.lyrics) partialMetadata.lyrics = input.lyrics;
    if (input.tags && Array.isArray(input.tags) && input.tags.length > 0)
      partialMetadata.tags = input.tags;
    if (input.idea) partialMetadata.idea = input.idea;
    if (input.duration) partialMetadata.duration = input.duration;

    return `You are a professional songwriter and music metadata expert.
You will receive a partial song metadata object. Some fields may already be provided (title, tags, lyrics, idea, duration) and MUST be respected exactly as given.
For any missing fields, generate creative and appropriate values to complete the metadata.

Return a JSON object with this structure:
{
  "title": "...",
  "lyrics": "...",
  "tags": [ ... ],
  "idea": "...",
  "duration": ...
}

Rules:
- If a field is provided, use it exactly as given, EXCEPT for lyrics: if lyrics are present but seem incomplete for the song's duration or context, complete them naturally and coherently, keeping the original content.
- If a field is missing, generate it.
- If you generate lyrics, include section metadata like [verse], [chorus], [solo], [intro], [instrumental], etc., to provide more context and structure to the song.
- Output ONLY the JSON, no explanations or additional text.
- The JSON must be properly formatted and escaped.

Partial metadata provided:
${JSON.stringify(partialMetadata, null, 2)}
`;
  }

  /**
   * @private
   * @method extractJson
   * @description Extracts JSON from LLM response
   */
  private extractJson = async (message: AIMessage): Promise<string> => {
    let content = "";

    if (typeof message.content === "string") {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content
        .map((c) => {
          if (typeof c === "string") return c;
          if (typeof c === "object" && c.type === "text") return c.text;
          return JSON.stringify(c);
        })
        .join("\n");
    } else if (typeof message.content === "object") {
      content = JSON.stringify(message.content);
    }

    Logger.debug(`Raw content from LLM: ${content}`);

    // Try to find JSON in code block first
    let jsonMatch = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1].trim();
      try {
        const parsed = JSON.parse(jsonStr); // Validate JSON
        Logger.debug(
          `Found JSON in code block: ${JSON.stringify(parsed, null, 2)}`
        );
        if (this.validateJsonStructure(parsed)) {
          return jsonStr;
        }
        Logger.debug("JSON structure validation failed");
      } catch (e) {
        const error = e as Error;
        Logger.debug(`Invalid JSON in code block: ${error.message}`);
      }
    }

    // Try to find JSON between curly braces
    jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[0].trim();
      try {
        const parsed = JSON.parse(jsonStr); // Validate JSON
        Logger.debug(
          `Found JSON between curly braces: ${JSON.stringify(parsed, null, 2)}`
        );
        if (this.validateJsonStructure(parsed)) {
          return jsonStr;
        }
        Logger.debug("JSON structure validation failed");
      } catch (e) {
        const error = e as Error;
        Logger.debug(`Invalid JSON between curly braces: ${error.message}`);
        // Try to clean up common issues
        const cleaned = jsonStr
          .replace(/\n/g, " ")
          .replace(/\s+/g, " ")
          .replace(/,\s*}/g, "}");
        try {
          const parsed = JSON.parse(cleaned); // Validate cleaned JSON
          Logger.debug(
            `Found cleaned JSON: ${JSON.stringify(parsed, null, 2)}`
          );
          if (this.validateJsonStructure(parsed)) {
            return cleaned;
          }
          Logger.debug("Cleaned JSON structure validation failed");
        } catch (e) {
          const error = e as Error;
          Logger.debug(`Failed to clean up JSON: ${error.message}`);
        }
      }
    }

    throw new Error("Cannot generate song metadata from empty input");
  };

  /**
   * @private
   * @method validateJsonStructure
   * @description Validates that the parsed JSON has the correct structure
   * @param {any} json - The parsed JSON to validate
   * @returns {boolean} True if the structure is valid
   */
  private validateJsonStructure(json: any): boolean {
    if (!json || typeof json !== "object") return false;

    // Validate title
    if (typeof json.title !== "string") return false;
    if (json.title.trim() === "") return false;

    // Validate lyrics
    if (typeof json.lyrics !== "string") return false;
    if (json.lyrics.trim() === "") return false;

    // Validate tags
    if (!Array.isArray(json.tags)) return false;
    if (json.tags.length < 3 || json.tags.length > 8) return false;
    if (
      !json.tags.every(
        (tag: unknown) => typeof tag === "string" && tag.trim() !== ""
      )
    )
      return false;

    return true;
  }

  /**
   * @async
   * @method generate
   * @description Generates song metadata from a set of parameters
   * @param {SongMetadataInput} input - The song metadata input object
   * @returns {Promise<SongMetadata>} Generated metadata
   * @throws {Error} If generation or validation fails
   */
  async generate(input: any): Promise<SongMetadata> {
    if (
      !input ||
      typeof input !== "object" ||
      !input.idea ||
      input.idea.trim() === ""
    ) {
      throw new Error("Cannot generate song metadata from empty input");
    }
    try {
      Logger.debug(`Generating metadata for input: ${JSON.stringify(input)}`);
      const prompt = this.buildPrompt(input);
      // Rebuild the chain with the new prompt
      const chain = RunnableSequence.from([
        async () => prompt,
        this.chain.steps[1], // llm
        this.extractJson,
        new JsonOutputParser<SongMetadata>(),
      ]);
      const metadata = await chain.invoke({});
      this.validateMetadata(metadata, input);
      return metadata;
    } catch (error) {
      const message = (error as Error).message;
      Logger.debug(`Metadata generation error: ${message}`);
      if (
        message.includes("Json not found") ||
        message.includes("No valid JSON found")
      ) {
        throw new Error("Cannot generate song metadata from empty input");
      }
      if (message.includes("Title too long")) {
        throw new Error("Title too long");
      }
      throw new Error(`Error generating metadata: ${message}`);
    }
  }

  /**
   * @private
   * @method validateMetadata
   * @description Validates the generated metadata, ensuring it respects user input if provided
   * @param {SongMetadata} metadata - The metadata to validate
   * @param {SongMetadataInput} input - The original input object
   * @throws {Error} If validation fails
   */
  private validateMetadata(metadata: SongMetadata, input?: any): void {
    if (!metadata.title?.trim()) {
      throw new Error("Invalid or missing title");
    }
    if (!metadata.lyrics?.trim()) {
      throw new Error("Invalid or missing lyrics");
    }
    if (!Array.isArray(metadata.tags) || metadata.tags.length < 3) {
      throw new Error("Invalid or insufficient tags");
    }
    if (metadata.title.length > 60) {
      throw new Error("Title too long");
    }
    if (Array.isArray(metadata.tags)) {
      metadata.tags = metadata.tags.map((tag) => tag.trim().toLowerCase());
    }
  }
}
