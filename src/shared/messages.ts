import type { UsageSnapshot } from './usage'

export interface InsertPromptRequest {
  type: 'INSERT_PROMPT'
  prompt: string
  /** Opaque id the sidebar maps back to which button/prompt was run.
   * When present, the content script watches for the user to actually
   * send the message and then posts a PROMPT_SENT message with this id. */
  runToken?: string
}

export type InsertPromptErrorCode = 'input_not_found' | 'insert_failed'

export type InsertPromptResponse =
  | { ok: true }
  | { ok: false; error: InsertPromptErrorCode; message: string }

/** Sent from the content script to the sidebar when an inserted prompt is
 * observed to have actually been submitted to Claude (the input cleared
 * after holding the text), so analytics count sends, not just inserts. */
export interface PromptSentMessage {
  type: 'PROMPT_SENT'
  runToken: string
}

export interface GetUsageRequest {
  type: 'GET_USAGE'
}

export type GetUsageResponse = { ok: true; usage: UsageSnapshot } | { ok: false }
