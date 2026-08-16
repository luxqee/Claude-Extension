export type ButtonType = 'prompt' | 'skill'

export interface Button {
  id: string
  name: string
  order: number
  prompt: string
  type: ButtonType
}
