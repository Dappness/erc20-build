import type { ConversationMessage } from './types.js'

export type { ConversationMessage }

export interface AITool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ToolCallResult {
  text: string
  toolCall: { name: string; input: unknown } | null
}

export interface AIProvider {
  complete(
    systemPrompt: string,
    messages: ConversationMessage[],
    options?: { maxTokens?: number; model?: string },
  ): Promise<string>

  completeWithTools(
    systemPrompt: string,
    messages: ConversationMessage[],
    tools: AITool[],
    options?: { maxTokens?: number; model?: string },
  ): Promise<ToolCallResult>
}
