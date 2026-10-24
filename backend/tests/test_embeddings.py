import json
from time import monotonic

import httpx
import pytest

from app.core.config import Settings
from app.services.embeddings import EmbeddingClient, EmbeddingFailure, ModelIdentity

IDENTITY = ModelIdentity("nomic-embed-text:latest", "a" * 64)


def make_client(handler, **settings):
    config = Settings(_env_file=None, postgres_password="test-only", **settings)
    return EmbeddingClient(
        httpx.Client(base_url="http://ollama.test/", transport=httpx.MockTransport(handler)), config
    )


def test_model_identity_and_batch_embeddings_use_prefixes_and_no_truncation():
    requests = []

    def respond(request):
        if request.url.path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": IDENTITY.name, "digest": IDENTITY.digest}]}
            )
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(
            200,
            json={"model": "nomic-embed-text", "embeddings": [[3.0, 4.0] for _ in body["input"]]},
        )

    client = make_client(respond)
    assert client.identity() == IDENTITY
    assert client.embed(["one", "two"], IDENTITY) == [[0.6, 0.8], [0.6, 0.8]]
    client.embed(["question"], IDENTITY, query=True, dimensions=2)
    assert requests[0]["input"] == ["search_document: one", "search_document: two"]
    assert requests[1]["input"] == ["search_query: question"]
    assert requests[0]["truncate"] is False


@pytest.mark.parametrize(
    "vectors",
    [
        [],
        [[1.0, 0.0], [1.0, 0.0]],
        [[0.0, 0.0]],
        [[float("nan"), 1]],
        [[float("inf"), 1]],
        [[True, 1]],
        [["bad", 1]],
        [[1e39, 1]],
        [[1]],
        [None],
    ],
)
def test_invalid_embedding_payloads_and_dimension_mismatch(vectors):
    client = make_client(
        lambda _: httpx.Response(
            200, content=json.dumps({"model": IDENTITY.name, "embeddings": vectors})
        )
    )
    with pytest.raises(EmbeddingFailure):
        client.embed(["text"], IDENTITY, dimensions=2)


def test_mixed_dimensions_and_model_changes_are_rejected():
    client = make_client(
        lambda _: httpx.Response(
            200, json={"model": IDENTITY.name, "embeddings": [[1, 0], [1, 0, 0]]}
        )
    )
    with pytest.raises(EmbeddingFailure):
        client.embed(["a", "b"], IDENTITY)
    client = make_client(
        lambda _: httpx.Response(200, json={"model": "other-model", "embeddings": [[1, 0]]})
    )
    with pytest.raises(EmbeddingFailure):
        client.embed(["a"], IDENTITY)


@pytest.mark.parametrize(
    "payload", [{}, {"models": []}, {"models": [{"name": False}]}, {"models": None}]
)
def test_missing_model_or_malformed_tags(payload):
    client = make_client(lambda _: httpx.Response(200, json=payload))
    with pytest.raises(EmbeddingFailure):
        client.identity()


@pytest.mark.parametrize(
    "failure",
    [httpx.ConnectError("private connection details"), httpx.ReadTimeout("private timeout")],
)
def test_connection_failures_do_not_echo_details(failure):
    def respond(_):
        raise failure

    client = make_client(respond)
    with pytest.raises(EmbeddingFailure) as error:
        client.identity()
    assert "private" not in str(error.value)


def test_time_budget_batch_and_dimension_limits():
    client = make_client(
        lambda _: httpx.Response(200, json={"model": IDENTITY.name, "embeddings": [[1, 0, 0]]}),
        embedding_batch_size=1,
        max_embedding_dimensions=2,
    )
    with pytest.raises(EmbeddingFailure):
        client.embed(["a", "b"], IDENTITY)
    with pytest.raises(EmbeddingFailure):
        client.embed(["a"], IDENTITY)
    with pytest.raises(EmbeddingFailure):
        client.identity(deadline=monotonic() - 1)


def test_fingerprint_changes_with_digest_dimensions_or_prefixes():
    client = make_client(lambda _: httpx.Response(500))
    baseline = client.fingerprint(IDENTITY, 2)
    assert baseline != client.fingerprint(ModelIdentity(IDENTITY.name, "b" * 64), 2)
    assert baseline != client.fingerprint(IDENTITY, 3)
    alternate = make_client(lambda _: httpx.Response(500), embedding_query_prefix="")
    assert baseline != alternate.fingerprint(IDENTITY, 2)
