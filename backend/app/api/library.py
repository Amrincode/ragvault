import os
from collections.abc import Iterator
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.session import get_session
from app.models import Collection, Document, DocumentChunk
from app.schemas.library import (
    ChunkPage,
    ChunkResponse,
    CollectionName,
    CollectionResponse,
    DocumentName,
    DocumentPage,
    DocumentResponse,
)
from app.services.library import (
    delete_document,
    document_count,
    require_collection,
    require_document,
    save_collection,
    upload_document,
)
from app.services.processing import PdfProcessor, get_processor, process_document
from app.services.storage import DocumentStorage, get_storage

router = APIRouter(prefix="/api", tags=["library"])
DB = Annotated[Session, Depends(get_session)]
Storage = Annotated[DocumentStorage, Depends(get_storage)]
Processor = Annotated[PdfProcessor, Depends(get_processor)]


@router.post("/documents/{document_id}/process", response_model=DocumentResponse)
def process_pdf(document_id: UUID, session: DB, storage: Storage, processor: Processor) -> Document:
    return process_document(session, storage, processor, document_id)


@router.get("/documents/{document_id}/processing", response_model=DocumentResponse)
def processing_status(document_id: UUID, session: DB) -> Document:
    return require_document(session, document_id)


@router.get("/documents/{document_id}/chunks", response_model=ChunkPage)
def list_chunks(
    document_id: UUID,
    session: DB,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    page_number: Annotated[int | None, Query(ge=1)] = None,
) -> ChunkPage:
    document = require_document(session, document_id)
    if document.processing_status not in {"processed", "no_text"}:
        raise api_error(
            409,
            "text_unavailable",
            "Process this document successfully before inspecting its chunks",
        )
    statement = select(DocumentChunk).where(DocumentChunk.document_id == document_id)
    if page_number is not None:
        statement = statement.where(DocumentChunk.page_number == page_number)
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = session.scalars(
        statement.order_by(DocumentChunk.chunk_index).offset(offset).limit(limit)
    )
    return ChunkPage(
        items=[ChunkResponse.model_validate(c) for c in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def collection_response(session: Session, collection: Collection) -> CollectionResponse:
    result = CollectionResponse.model_validate(collection)
    result.document_count = document_count(session, collection.id)
    return result


@router.get("/collections", response_model=list[CollectionResponse])
def list_collections(session: DB) -> list[CollectionResponse]:
    rows = session.execute(
        select(Collection, func.count(Document.id))
        .outerjoin(Document)
        .group_by(Collection.id)
        .order_by(func.lower(Collection.name), Collection.id)
    )
    return [
        CollectionResponse.model_validate(collection).model_copy(update={"document_count": count})
        for collection, count in rows
    ]


@router.post("/collections", response_model=CollectionResponse, status_code=201)
def create_collection(body: CollectionName, session: DB) -> CollectionResponse:
    return collection_response(session, save_collection(session, Collection(name=body.name)))


@router.patch("/collections/{collection_id}", response_model=CollectionResponse)
def rename_collection(collection_id: UUID, body: CollectionName, session: DB) -> CollectionResponse:
    collection = require_collection(session, collection_id, lock=True)
    collection.name = body.name
    return collection_response(session, save_collection(session, collection))


@router.delete("/collections/{collection_id}", status_code=204)
def remove_collection(collection_id: UUID, session: DB) -> Response:
    collection = require_collection(session, collection_id, lock=True)
    if document_count(session, collection_id):
        raise api_error(409, "collection_not_empty", "Delete the collection's documents first")
    session.delete(collection)
    session.commit()
    return Response(status_code=204)


@router.post(
    "/collections/{collection_id}/documents", response_model=DocumentResponse, status_code=201
)
def create_document(
    collection_id: UUID, session: DB, storage: Storage, file: Annotated[UploadFile, File()]
) -> Document:
    return upload_document(session, storage, collection_id, file)


@router.get("/documents", response_model=DocumentPage)
def list_documents(
    session: DB,
    collection_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DocumentPage:
    statement = select(Document)
    if collection_id is not None:
        require_collection(session, collection_id)
        statement = statement.where(Document.collection_id == collection_id)
    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    documents = session.scalars(
        statement.order_by(Document.created_at.desc(), Document.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return DocumentPage(
        items=[DocumentResponse.model_validate(document) for document in documents],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(document_id: UUID, session: DB) -> Document:
    return require_document(session, document_id)


@router.patch("/documents/{document_id}", response_model=DocumentResponse)
def rename_document(document_id: UUID, body: DocumentName, session: DB) -> Document:
    document = require_document(session, document_id, lock=True)
    document.filename = body.filename
    session.commit()
    return document


@router.get("/documents/{document_id}/file", response_class=StreamingResponse)
def serve_document(
    document_id: UUID, session: DB, storage: Storage, request: Request, download: bool = False
) -> StreamingResponse:
    document = require_document(session, document_id)
    try:
        source = storage.open_pdf(document.storage_key)
    except FileNotFoundError:
        raise api_error(404, "file_not_found", "Stored PDF is unavailable") from None
    size = os.fstat(source.fileno()).st_size

    def chunks() -> Iterator[bytes]:
        try:
            while chunk := source.read(1024 * 1024):
                yield chunk
        finally:
            source.close()

    disposition = "attachment" if download else "inline"
    return StreamingResponse(
        chunks(),
        media_type="application/pdf",
        headers={
            "Content-Length": str(size),
            "Content-Disposition": (
                f'{disposition}; filename="document.pdf"; '
                f"filename*=UTF-8''{quote(document.filename, safe='')}"
            ),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": (
                "default-src 'none'; frame-ancestors 'self' "
                f"{request.app.state.settings.cors_origin}"
            ),
        },
    )


@router.delete("/documents/{document_id}", status_code=204)
def remove_document(document_id: UUID, session: DB, storage: Storage) -> Response:
    delete_document(session, storage, document_id)
    return Response(status_code=204)


@router.get("/library/config")
def library_config(request: Request) -> dict[str, int]:
    return {
        "max_upload_bytes": request.app.state.settings.max_upload_bytes,
        "max_pdf_pages": request.app.state.settings.max_pdf_pages,
    }
