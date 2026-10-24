import logging
from uuid import UUID, uuid4

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import Collection, Document
from app.services.storage import DocumentStorage

logger = logging.getLogger(__name__)


def require_collection(session: Session, collection_id: UUID, *, lock: bool = False) -> Collection:
    statement = select(Collection).where(Collection.id == collection_id)
    collection = session.scalar(statement.with_for_update() if lock else statement)
    if collection is None:
        raise api_error(404, "collection_not_found", "Collection not found")
    return collection


def require_document(session: Session, document_id: UUID, *, lock: bool = False) -> Document:
    statement = select(Document).where(Document.id == document_id)
    document = session.scalar(statement.with_for_update() if lock else statement)
    if document is None:
        raise api_error(404, "document_not_found", "Document not found")
    return document


def document_count(session: Session, collection_id: UUID) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(Document)
            .where(Document.collection_id == collection_id)
        )
        or 0
    )


def save_collection(session: Session, collection: Collection) -> Collection:
    try:
        session.add(collection)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise api_error(
            409, "collection_name_conflict", "A collection with that name already exists"
        ) from None
    return collection


def upload_document(
    session: Session, storage: DocumentStorage, collection_id: UUID, upload: UploadFile
) -> Document:
    require_collection(session, collection_id)
    staged = storage.stage(upload)
    promoted = None
    committed = False
    try:
        # Lock the collection only after validation; deletion uses the same lock protocol.
        require_collection(session, collection_id, lock=True)
        identifier = uuid4()
        document = Document(
            id=identifier,
            collection_id=collection_id,
            filename=staged.filename,
            storage_key=f"{identifier.hex}.pdf",
            file_size=staged.size,
            checksum=staged.checksum,
            mime_type="application/pdf",
            processing_status="uploaded",
        )
        session.add(document)
        session.flush()
        promoted = storage.promote(staged, document.storage_key)
        session.commit()
        committed = True
        return document
    except IntegrityError:
        session.rollback()
        raise api_error(
            409, "duplicate_document", "This PDF already exists in this collection"
        ) from None
    except (SQLAlchemyError, OSError) as exc:
        session.rollback()
        logger.error("Upload could not be saved", extra={"error_type": type(exc).__name__})
        raise api_error(503, "upload_failed", "Upload could not be saved; please retry") from None
    finally:
        storage.cleanup(staged.path)
        if promoted is not None and not committed:
            storage.cleanup(promoted)


def delete_document(session: Session, storage: DocumentStorage, document_id: UUID) -> None:
    document = require_document(session, document_id, lock=True)
    if document.processing_status == "processing":
        raise api_error(
            409,
            "document_processing",
            "Wait for processing to finish or recover an expired attempt before deleting",
        )
    key = document.storage_key
    quarantined = None
    try:
        quarantined = storage.quarantine(key)
        session.delete(document)
        session.commit()
    except (SQLAlchemyError, OSError) as exc:
        session.rollback()
        if quarantined is not None:
            try:
                storage.restore(quarantined, key)
            except OSError:
                logger.error("Delete rollback requires storage recovery")
        logger.error("Document deletion failed", extra={"error_type": type(exc).__name__})
        raise api_error(
            503, "delete_failed", "Document could not be deleted; please retry"
        ) from None
    if quarantined is not None:
        storage.cleanup(quarantined)
