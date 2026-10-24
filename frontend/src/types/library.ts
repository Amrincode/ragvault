export interface Collection {
  id: string
  name: string
  document_count: number
  created_at: string
  updated_at: string
}

export interface Document {
  id: string
  collection_id: string
  filename: string
  file_size: number
  mime_type: 'application/pdf'
  checksum: string
  processing_status:
    'uploaded' | 'processing' | 'processed' | 'failed' | 'no_text'
  processing_started_at?: string | null
  processed_at?: string | null
  processing_error?: string | null
  page_count?: number | null
  chunk_count?: number
  chunk_size_chars?: number | null
  chunk_overlap_chars?: number | null
  created_at: string
  updated_at: string
}

export interface DocumentChunk {
  id: string
  document_id: string
  page_number: number
  chunk_index: number
  text: string
  start_char: number
  end_char: number
  created_at: string
}

export interface ChunkPage {
  items: DocumentChunk[]
  total: number
  limit: number
  offset: number
}

export interface DocumentPage {
  items: Document[]
  total: number
  limit: number
  offset: number
}

export interface LibraryConfig {
  max_upload_bytes: number
  max_pdf_pages: number
}
