import argparse
import sys

import uvicorn

from app.core.config import ConfigurationError, get_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Start the RAGVault API")
    parser.add_argument("--reload", action="store_true", help="Reload on source changes")
    args = parser.parse_args()
    try:
        settings = get_settings()
    except ConfigurationError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from None
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.backend_host,
        port=settings.backend_port,
        reload=args.reload,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
