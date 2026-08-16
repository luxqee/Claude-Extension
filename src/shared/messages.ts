export interface InsertPromptRequest {
  type: 'INSERT_PROMPT'
  prompt: string
}

export type InsertPromptErrorCode = 'input_not_found' | 'insert_failed'

export type InsertPromptResponse =
  | { ok: true }
  | { ok: false; error: InsertPromptErrorCode; message: string }
