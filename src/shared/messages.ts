import type { UsageSnapshot } from './usage'

export interface InsertPromptRequest {
  type: 'INSERT_PROMPT'
  prompt: string
}

export type InsertPromptErrorCode = 'input_not_found' | 'insert_failed'

export type InsertPromptResponse =
  | { ok: true }
  | { ok: false; error: InsertPromptErrorCode; message: string }

export interface GetUsageRequest {
  type: 'GET_USAGE'
}

export type GetUsageResponse = { ok: true; usage: UsageSnapshot } | { ok: false }
