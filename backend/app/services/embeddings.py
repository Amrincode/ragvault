"""Mockable Ollama embeddings. No text/vector payloads are logged."""

import hashlib
import json
import math
from dataclasses import dataclass
from time import monotonic

import httpx
from fastapi import Request

from app.core.config import Settings


class EmbeddingFailure(Exception):
    pass


@dataclass(frozen=True)
class ModelIdentity:
    name: str
    digest: str


def canonical_model(name: str) -> str:
    if not isinstance(name, str) or not 1 <= len(name) <= 200:
        raise ValueError("Invalid embedding model name")
    return name if ":" in name.rsplit("/", 1)[-1] else name + ":latest"


class EmbeddingClient:
    def __init__(self, client: httpx.Client, settings: Settings):
        self.client = client
        self.settings = settings

    def request(self, method, path, *, deadline=None, **kwargs):
        timeout = self.settings.embedding_timeout_seconds
        if deadline is not None:
            timeout = min(timeout, deadline - monotonic())
        if timeout <= 0:
            raise EmbeddingFailure
        try:
            with self.client.stream(method, path, timeout=timeout, **kwargs) as response:
                response.raise_for_status()
                body = bytearray()
                for part in response.iter_bytes():
                    body.extend(part)
                    if len(body) > 16 * 1024 * 1024 or (
                        deadline is not None and monotonic() > deadline
                    ):
                        raise EmbeddingFailure
                return json.loads(body)
        except (httpx.HTTPError, ValueError, TypeError):
            raise EmbeddingFailure from None

    def identity(self, *, deadline=None) -> ModelIdentity:
        data = self.request("GET", "api/tags", deadline=deadline)
        try:
            expected = canonical_model(self.settings.ollama_embedding_model)
            candidates = [m for m in data["models"] if canonical_model(m["name"]) == expected]
            digest = candidates[0]["digest"]
            if not isinstance(digest, str) or not 1 <= len(digest) <= 128:
                raise ValueError
            return ModelIdentity(expected, digest)
        except (KeyError, IndexError, TypeError, ValueError):
            raise EmbeddingFailure from None

    def embed(
        self,
        texts: list[str],
        identity: ModelIdentity,
        *,
        query=False,
        dimensions=None,
        deadline=None,
    ) -> list[list[float]]:
        if not texts or len(texts) > self.settings.embedding_batch_size:
            raise EmbeddingFailure
        prefix = (
            self.settings.embedding_query_prefix
            if query
            else self.settings.embedding_document_prefix
        )
        data = self.request(
            "POST",
            "api/embed",
            deadline=deadline,
            json={
                "model": identity.name,
                "input": [prefix + text for text in texts],
                "truncate": False,
            },
        )
        try:
            if canonical_model(data["model"]) != identity.name:
                raise ValueError
            vectors = data["embeddings"]
            if not isinstance(vectors, list) or len(vectors) != len(texts):
                raise ValueError
            expected = dimensions
            for vector in vectors:
                if (
                    not isinstance(vector, list)
                    or not vector
                    or len(vector) > self.settings.max_embedding_dimensions
                ):
                    raise ValueError
                if expected is None:
                    expected = len(vector)
                if len(vector) != expected or any(
                    type(v) not in (int, float) or not math.isfinite(v) for v in vector
                ):
                    raise ValueError
                # Reject float32 overflow and zero vectors (cosine distance is undefined).
                if any(abs(v) > 3.4e38 for v in vector) or sum(v * v for v in vector) <= 0:
                    raise ValueError
            normalized = []
            for vector in vectors:
                norm = math.sqrt(sum(v * v for v in vector))
                normalized.append([v / norm for v in vector])
            return normalized
        except (KeyError, TypeError, ValueError, OverflowError):
            raise EmbeddingFailure from None

    def fingerprint(self, identity: ModelIdentity, dimensions: int) -> str:
        payload = [
            "l2-v1",
            identity.name,
            identity.digest,
            dimensions,
            self.settings.embedding_document_prefix,
            self.settings.embedding_query_prefix,
        ]
        return hashlib.sha256(json.dumps(payload, ensure_ascii=True).encode()).hexdigest()


def get_embeddings(request: Request) -> EmbeddingClient:
    return request.app.state.embeddings
