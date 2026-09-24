/**
 * Translation between the provider-independent tool vocabulary
 * (VoiceToolDeclaration / VoiceToolResult in types.ts) and Gemini's own
 * function-calling shapes (geminiLiveProtocol.ts). Pure functions only —
 * this is the single place where "our tool schema" becomes "Gemini's tool
 * schema", so nothing Gemini-specific about tools leaks into the
 * conversation layer that actually implements them.
 */

import type {
  GeminiLiveFunctionDeclaration,
  GeminiLiveFunctionResponse,
  GeminiLiveSchema,
  GeminiLiveSchemaType,
  GeminiLiveToolDeclaration,
  GeminiLiveToolScheduling,
} from './geminiLiveProtocol'
import type { VoiceToolDeclaration, VoiceToolResult, VoiceToolSchema, VoiceToolSchemaType, VoiceToolScheduling } from './types'

const SCHEMA_TYPES: Record<VoiceToolSchemaType, GeminiLiveSchemaType> = {
  object: 'OBJECT',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
}

const SCHEDULING: Record<VoiceToolScheduling, GeminiLiveToolScheduling> = {
  interrupt: 'INTERRUPT',
  when_idle: 'WHEN_IDLE',
  silent: 'SILENT',
}

export function toGeminiSchema(schema: VoiceToolSchema): GeminiLiveSchema {
  return {
    type: SCHEMA_TYPES[schema.type],
    ...(schema.description ? { description: schema.description } : {}),
    ...(schema.enum ? { enum: schema.enum } : {}),
    ...(schema.properties
      ? {
          properties: Object.fromEntries(
            Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
          ),
        }
      : {}),
    ...(schema.required ? { required: schema.required } : {}),
    ...(schema.items ? { items: toGeminiSchema(schema.items) } : {}),
  }
}

export function toGeminiFunctionDeclaration(tool: VoiceToolDeclaration): GeminiLiveFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    ...(tool.parameters ? { parameters: toGeminiSchema(tool.parameters) } : {}),
    ...(tool.nonBlocking ? { behavior: 'NON_BLOCKING' as const } : {}),
  }
}

/**
 * Gemini takes an ARRAY of tool objects, each holding function
 * declarations. An empty input produces an empty array, which
 * buildSetupMessage then omits from `setup` entirely — declaring "no tools"
 * and declaring "an empty tool list" are not the same message.
 */
export function toGeminiToolDeclarations(tools: VoiceToolDeclaration[]): GeminiLiveToolDeclaration[] {
  if (tools.length === 0) return []
  return [{ functionDeclarations: tools.map(toGeminiFunctionDeclaration) }]
}

export function toGeminiFunctionResponse(result: VoiceToolResult): GeminiLiveFunctionResponse {
  return {
    id: result.id,
    name: result.name,
    response: result.scheduling
      ? { ...result.response, scheduling: SCHEDULING[result.scheduling] }
      : result.response,
  }
}
