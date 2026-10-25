import json
from unittest.mock import patch

import httpx
import pytest

from app.services.llm import LLMClient, LLMFailure


def payload(settings, **overrides):
    return {
        "model": settings.ollama_chat_model,
        "done": True,
        "done_reason": "stop",
        "message": {
            "role": "assistant",
            "content": json.dumps(
                {
                    "status": "answered",
                    "claims": [
                        {
                            "citations": [
                                {"citation_id": "C1", "quote": "Backups last thirty days."}
                            ],
                        }
                    ],
                }
            ),
        },
        **overrides,
    }


def invoke(settings, handler, messages=None):
    with httpx.Client(
        base_url="http://ollama.test/", transport=httpx.MockTransport(handler)
    ) as http:
        return LLMClient(http, settings).generate(messages or [{"role": "user", "content": "test"}])


def test_chat_api_contract_and_no_sensitive_logging(settings, caplog):
    def handler(request):
        assert request.url.path == "/api/chat"
        body = json.loads(request.content)
        assert body["model"] == settings.ollama_chat_model
        assert body["stream"] is False and "tools" not in body
        assert body["options"] == {"temperature": 0, "num_ctx": 4096, "num_predict": 512}
        assert body["format"]["additionalProperties"] is False
        assert "text" not in body["format"]["$defs"]["EvidenceSelection"]["properties"]
        assert request.extensions["timeout"]["connect"] == 3
        assert request.extensions["timeout"]["read"] == 180
        return httpx.Response(200, json=payload(settings))

    result = invoke(settings, handler)
    assert result.status == "answered" and result.claims[0].text == "Backups last thirty days."
    assert "Backups last thirty days" not in caplog.text


def test_grouped_distinct_quotes_remain_independent_and_invalid_alias_is_not_repaired(settings):
    from test_citations import source

    from app.services.citations import verify_claims

    data = payload(settings)
    data["message"]["content"] = json.dumps(
        {
            "status": "answered",
            "claims": [
                {
                    "citations": [
                        {"citation_id": "C1", "quote": "Include a risk analysis."},
                        {"citation_id": "C1", "quote": "Include a cost estimate."},
                        {"citation_id": "C99", "quote": "A fabricated requirement."},
                    ]
                }
            ],
        }
    )
    generated = invoke(settings, lambda request: httpx.Response(200, json=data))
    checked = verify_claims(
        generated, [source("Include a risk analysis. Include a cost estimate.")]
    )
    assert [c.status for c in checked] == [
        "potentially_supported",
        "potentially_supported",
        "invalid_citation",
    ]
    assert checked[-1].issues == ["unknown_citation"]


def test_grouped_selections_remain_bounded_and_truncation_is_partial(settings):
    data = payload(settings)
    data["message"]["content"] = json.dumps(
        {
            "status": "answered",
            "claims": [
                {
                    "citations": [
                        {"citation_id": "C1", "quote": f"Item {i * 3 + j}."} for j in range(3)
                    ]
                }
                for i in range(3)
            ],
        }
    )
    generated = invoke(settings, lambda request: httpx.Response(200, json=data))
    assert generated.status == "partial" and len(generated.claims) == 6


@pytest.mark.parametrize(
    "change",
    [
        {"done": False},
        {"done_reason": "length"},
        {"model": "other:latest"},
        {"message": {"role": "user", "content": "private"}},
        {"message": {"role": "assistant", "content": "not json"}},
        {"message": {"role": "assistant", "content": '{"status":"answered","answer":" "}'}},
        {
            "message": {
                "role": "assistant",
                "content": '{"status":"answered","answer":"a","sources":[]}',
            }
        },
        {"message": {"role": "assistant", "content": '{"status":"made_up","answer":"a"}'}},
        {"message": {"role": "assistant", "tool_calls": [{"name": "exec"}], "content": "{}"}},
        {"error": "private-provider-error"},
    ],
)
def test_invalid_or_incomplete_generation_fails_closed(settings, change, caplog):
    with pytest.raises(LLMFailure, match="invalid_generation"):
        invoke(settings, lambda _: httpx.Response(200, json=payload(settings, **change)))
    assert "private" not in caplog.text


@pytest.mark.parametrize("value", [[], None, "bad", {}])
def test_malformed_envelope(settings, value):
    with pytest.raises(LLMFailure, match="invalid_generation"):
        invoke(settings, lambda _: httpx.Response(200, json=value))


@pytest.mark.parametrize("status,code", [(404, "chat_model_missing"), (500, "generation_failed")])
def test_http_failures(settings, status, code):
    with pytest.raises(LLMFailure, match=code):
        invoke(settings, lambda _: httpx.Response(status, text="private error"))


@pytest.mark.parametrize(
    "error,code",
    [(httpx.ConnectError, "chat_unavailable"), (httpx.ReadTimeout, "generation_timeout")],
)
def test_network_failures(settings, error, code):
    def handler(request):
        raise error("private error", request=request)

    with pytest.raises(LLMFailure, match=code):
        invoke(settings, handler)


def test_body_answer_and_prompt_budgets(settings):
    with pytest.raises(LLMFailure, match="invalid_generation"):
        invoke(settings, lambda _: httpx.Response(200, content=b"x" * 65537))
    settings.chat_max_answer_chars = 256
    data = payload(settings)
    data["message"]["content"] = json.dumps(
        {
            "status": "answered",
            "claims": [
                {
                    "citations": [{"citation_id": "C1", "quote": "a" * 257}],
                }
            ],
        }
    )
    with pytest.raises(LLMFailure, match="invalid_generation"):
        invoke(settings, lambda _: httpx.Response(200, json=data))
    with pytest.raises(LLMFailure, match="chat_context_too_large"):
        invoke(
            settings,
            lambda _: pytest.fail("must not call provider"),
            [{"role": "user", "content": "a" * 5000}],
        )


def test_concurrency_and_slot_release_after_failure(settings):
    with httpx.Client(
        base_url="http://ollama.test/", transport=httpx.MockTransport(lambda _: httpx.Response(500))
    ) as http:
        client = LLMClient(http, settings)
        client.slot.acquire()
        try:
            with pytest.raises(LLMFailure, match="chat_busy"):
                client.generate([])
        finally:
            client.slot.release()
        for _ in range(2):
            with pytest.raises(LLMFailure, match="generation_failed"):
                client.generate([])


def test_elapsed_response_deadline(settings):
    with patch("app.services.llm.monotonic", side_effect=[0, 181]):
        with pytest.raises(LLMFailure, match="generation_timeout"):
            invoke(settings, lambda _: httpx.Response(200, json=payload(settings)))


def test_excessively_nested_provider_json_is_rejected(settings):
    with pytest.raises(LLMFailure, match="invalid_generation"):
        invoke(settings, lambda _: httpx.Response(200, content=b"[" * 2000 + b"]" * 2000))


@pytest.mark.parametrize(
    "citation",
    [
        {"citation_id": "C1", "quote": "fact", "page_number": 99},
        {"citation_id": "C1", "quote": "fact", "document_id": "invented"},
        {"citation_id": "C1"},
        {"citation_id": "C1", "quote": "\x00"},
    ],
)
def test_malformed_citations_and_model_metadata_are_not_accepted(settings, citation):
    data = payload(settings)
    data["message"]["content"] = json.dumps(
        {"status": "answered", "claims": [{"citations": [citation]}]}
    )
    with pytest.raises(LLMFailure, match="invalid_generation"):
        invoke(settings, lambda _: httpx.Response(200, json=data))


def test_freeform_claim_text_is_rejected_rather_than_silently_repaired(settings):
    data = payload(settings)
    selected = json.loads(data["message"]["content"])
    selected["claims"][0]["text"] = "An invented numerical claim: 900 days."
    data["message"]["content"] = json.dumps(selected)
    with pytest.raises(LLMFailure, match="invalid_generation"):
        invoke(settings, lambda _: httpx.Response(200, json=data))
