"""The one way to ask model-service for a route's scored checkpoints.

Locally that is an HTTP POST to the model-service container's
/invocations. On AWS the same image runs as a SageMaker Endpoint's serving
container, with no HTTP service to call, so the identical request goes
through SageMaker Runtime's invoke_endpoint instead. Which path runs is
decided by SAGEMAKER_ENDPOINT_NAME alone -- set only on AWS, by the task
definitions in infra/cloudformation/template.yaml -- so planning-service
and both agents share this module and never need to know which they are
talking to.
"""
import json
import logging
import os
import threading
import time

import requests

log = logging.getLogger(__name__)

MODEL_SERVICE_URL = os.environ.get("MODEL_SERVICE_URL", "http://model-service:8000")
SAGEMAKER_ENDPOINT_NAME = os.environ.get("SAGEMAKER_ENDPOINT_NAME")
TIMEOUT_S = 90

# One Session per process, not one per call: a bare requests.post() opens
# a fresh TCP connection (and, to model-service over plain HTTP inside the
# compose network, a fresh handshake) every time, for a process that
# calls the same host on every plan. A Session pools and reuses the
# connection instead.
_session = requests.Session()

# boto3 clients are expensive to build (they parse the service's whole
# API model from botocore's bundled JSON on every construction) and are
# documented as thread-safe once built, so one lazily-created client is
# reused rather than one per inference. Lazy, not built at import time:
# importing this module must not need boto3 at all outside AWS, and the
# non-AWS images do not install it.
_sagemaker_client = None
_sagemaker_client_lock = threading.Lock()


def _sagemaker() -> "object":
    global _sagemaker_client
    if _sagemaker_client is None:
        with _sagemaker_client_lock:
            if _sagemaker_client is None:
                import boto3
                _sagemaker_client = boto3.client("sagemaker-runtime")
    return _sagemaker_client


class ModelServiceError(Exception):
    """No result from model-service or the endpoint standing in for it.
    `status` is what an HTTP caller should relay: 502 when the service
    could not be reached, otherwise the status it answered with."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class RouteNotCollected(ModelServiceError):
    """model-service has no feature store for this corridor -- its 404.
    Collection is a pipeline job, not something a scoring call can do."""

    def __init__(self, departure_ident: str, destination_ident: str):
        super().__init__(f"{departure_ident}->{destination_ident} has not been collected yet", 404)


def invoke(departure_ident: str, destination_ident: str, model: str | None = None) -> dict:
    """The full /invocations response. `model` picks one of the trained
    candidates instead of whatever is promoted; the planner never sets it."""
    payload = {"departure_ident": departure_ident, "destination_ident": destination_ident}
    if model is not None:
        payload["model"] = model
    path = "sagemaker" if SAGEMAKER_ENDPOINT_NAME else "http"
    started = time.time()
    try:
        if SAGEMAKER_ENDPOINT_NAME:
            return _invoke_sagemaker(payload)
        return _invoke_http(payload)
    finally:
        # Logged whether this succeeded or raised (a timeout is exactly
        # the case worth seeing the duration of): the one place every
        # scored-route request passes through, whichever of the two
        # backends is answering it.
        log.info("model_client.invoke (%s): %s->%s in %.2fs", path, departure_ident, destination_ident, time.time() - started)


def get_checkpoints(departure_ident: str, destination_ident: str) -> list[dict]:
    return invoke(departure_ident, destination_ident)["checkpoints"]


def list_routes() -> dict:
    """The corridors model-service has a feature store for. HTTP only: the
    SageMaker endpoint has no /routes, and on AWS collection is a
    pipeline job rather than something a running service offers."""
    try:
        return _session.get(f"{MODEL_SERVICE_URL}/routes", timeout=10).json()
    except requests.RequestException as err:
        raise ModelServiceError(f"Could not reach model-service: {err}") from err


def _invoke_http(payload: dict) -> dict:
    try:
        resp = _session.post(f"{MODEL_SERVICE_URL}/invocations", json=payload, timeout=TIMEOUT_S)
    except requests.RequestException as err:
        raise ModelServiceError(f"Could not reach model-service: {err}") from err
    if resp.status_code == 404:
        raise RouteNotCollected(payload["departure_ident"], payload["destination_ident"])
    if resp.status_code != 200:
        raise ModelServiceError(_detail(resp), resp.status_code)
    return resp.json()


def _detail(resp: requests.Response) -> str:
    try:
        return resp.json().get("detail", resp.text)
    except ValueError:
        return resp.text


def _invoke_sagemaker(payload: dict) -> dict:
    # BotoCoreError/ClientError imported here so the local images and the
    # test suite need no boto3; the AWS images install it. The client
    # itself is _sagemaker()'s job now, built once and reused.
    from botocore.exceptions import BotoCoreError, ClientError

    client = _sagemaker()
    try:
        response = client.invoke_endpoint(
            EndpointName=SAGEMAKER_ENDPOINT_NAME,
            ContentType="application/json",
            Body=json.dumps(payload),
        )
    except ClientError as err:
        # The container's own status comes back on the ModelError.
        status = int(err.response.get("OriginalStatusCode") or 0)
        if status == 404:
            raise RouteNotCollected(payload["departure_ident"], payload["destination_ident"]) from err
        raise ModelServiceError(f"SageMaker endpoint {SAGEMAKER_ENDPOINT_NAME}: {err}", status or 502) from err
    except BotoCoreError as err:
        raise ModelServiceError(f"Could not reach SageMaker endpoint {SAGEMAKER_ENDPOINT_NAME}: {err}") from err
    return json.loads(response["Body"].read())
