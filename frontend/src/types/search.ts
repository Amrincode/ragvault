export interface SearchInput {
  query: string
  top_k?: number
  collection_id?: string | null
  document_id?: string | null
}
export interface SearchHit {
  document_id: string
  filename: string
  collection_id: string
  page_number: number
  chunk_id: string
  excerpt: string
  distance: number
  similarity: number
}
export interface SearchResponse {
  items: SearchHit[]
  model: string
  dimensions: number
  top_k: number
  elapsed_ms: number
  incompatible_documents: number
}
