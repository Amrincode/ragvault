export interface ChatInput {
  question: string
  collection_id: string | null
  document_id: string | null
  top_k: number
}

export interface ChatSource {
  source_id: string
  citation_id?: string
  document_id: string
  filename: string
  collection_id: string
  page_number: number
  chunk_id: string
  excerpt: string
}

export interface CheckedCitation extends ChatSource {
  citation_id: string
  number: number
  match_method: 'exact' | 'whitespace_normalized'
}

export interface AnswerClaim {
  text: string
  status:
    | 'potentially_supported'
    | 'uncited'
    | 'invalid_citation'
    | 'support_not_established'
    | 'relevance_not_established'
    | 'potential_conflict'
  citations: CheckedCitation[]
  issues: string[]
}

export interface CitationVerification {
  status: 'not_run' | 'source_checks_passed' | 'issues_found'
  factual_support: 'not_established'
  accepted_claims: number
  withheld_claims: number
  notice: string
}

export interface ChatResponse {
  status: 'answered' | 'partial' | 'insufficient_evidence' | 'unreliable'
  answer: string
  sources: ChatSource[]
  chat_model: string
  embedding_model: string
  embedding_dimensions?: number | null
  retrieval_count: number
  context_count: number
  incompatible_documents: number
  timings: {
    retrieval_ms: number
    generation_ms: number
    total_ms: number
    verification_ms?: number
  }
  claims?: AnswerClaim[]
  verification?: CitationVerification
  evidence_fallback?: ChatSource[]
}
