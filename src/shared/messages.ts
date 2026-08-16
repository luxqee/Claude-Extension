export interface InsertAndSendRequest {
  type: 'INSERT_AND_SEND'
  prompt: string
}

export type InsertAndSendErrorCode =
  | 'no_claude_tab'
  | 'no_content_script'
  | 'input_not_found'
  | 'send_failed'

export type InsertAndSendResponse =
  | { ok: true }
  | { ok: false; error: InsertAndSendErrorCode; message: string }
