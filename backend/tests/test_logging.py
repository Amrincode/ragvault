import json
import logging

from app.core.logging import JsonFormatter


def test_dependency_logs_are_structured_and_do_not_serialize_exceptions() -> None:
    record = logging.LogRecord(
        "app.db.session", logging.WARNING, "", 0, "Dependency check failed", (), None
    )
    record.dependency = "database"
    record.error_type = "OperationalError"
    payload = json.loads(JsonFormatter().format(record))
    assert payload["level"] == "WARNING"
    assert payload["dependency"] == "database"
    assert payload["error_type"] == "OperationalError"
    assert payload["timestamp"].endswith("+00:00")
