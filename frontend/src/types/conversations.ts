import type { ChatResponse } from './chat'

export interface Conversation {
  id: string
  title: string
  collection_id: string | null
  document_id: string | null
  scope_available: boolean
  scope_label: string
  generating: boolean
  created_at: string
  updated_at: string
}
export interface ConversationPage {
  items: Conversation[]
  total: number
  limit: number
  offset: number
}
export interface SavedMessage {
  id: string
  request_id: string
  position: number
  role: 'user' | 'assistant'
  status: 'pending' | 'complete' | 'failed'
  content: string
  answer: ChatResponse | null
  error_code: string | null
  citation_state: 'none' | 'available' | 'stale' | 'unavailable' | 'invalid'
  created_at: string
}
export interface MessagePage {
  items: SavedMessage[]
  total: number
  limit: number
  offset: number
}
export interface SavedTurn {
  user: SavedMessage
  assistant: SavedMessage
  duplicate: boolean
}
export interface TurnInput {
  request_id: string
  question: string
  top_k: number
}
