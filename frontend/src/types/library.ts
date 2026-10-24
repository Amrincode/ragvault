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
  processing_status: 'uploaded'
  created_at: string
  updated_at: string
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
