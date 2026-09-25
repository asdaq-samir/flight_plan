"""Retry/error helpers shared by external HTTP callers."""
import requests
from tenacity import Retrying, retry_if_exception, stop_after_attempt, wait_incrementing


def with_retries(
    action,
    *,
    describe: str,
    retries: int = 3,
    backoff_s: float = 2.0,
    transient: tuple = (requests.RequestException,),
    error: type = RuntimeError,
):
    """Run action with the package standard transient-error policy."""
    def retryable(exc: BaseException) -> bool:
        return isinstance(exc, transient) and not isinstance(exc, requests.exceptions.SSLError)

    try:
        for attempt in Retrying(
            stop=stop_after_attempt(retries),
            wait=wait_incrementing(start=backoff_s, increment=backoff_s),
            retry=retry_if_exception(retryable),
            reraise=True,
        ):
            with attempt:
                return action()
    except requests.exceptions.SSLError as err:
        raise error(f"{describe} failed: {err}") from err
    except transient as err:
        raise error(f"{describe} failed after {retries} attempts: {err}") from err


def upstream_detail(response, service: str) -> str:
    """Return an upstream service useful error detail when available."""
    try:
        detail = response.json().get("detail")
    except (ValueError, AttributeError):
        detail = None
    if detail:
        return str(detail)
    text = (getattr(response, "text", "") or "").strip()
    return text or f"{service} answered {response.status_code}"
