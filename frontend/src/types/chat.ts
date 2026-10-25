export interface ChatInput {
  question: string
  collection_id: string | null
  document_id: string | null
  top_k: number
}

export interface ChatSource {
  source_id: string
  document_id: string
  filename: string
  collection_id: string
  page_number: number
  chunk_id: string
  excerpt: string
}

export interface ChatResponse {
  status: 'answered' | 'insufficient_evidence'
  answer: string
  sources: ChatSource[]
  chat_model: string
  embedding_model: string
  retrieval_count: number
  context_count: number
  incompatible_documents: number
  timings: { retrieval_ms: number; generation_ms: number; total_ms: number }
}
