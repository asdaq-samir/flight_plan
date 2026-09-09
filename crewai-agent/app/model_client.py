"""Client for model-service's /invocations endpoint. Identical to
nav-log-agent's -- both builds call the same model-serving endpoint, per
docs/architecture-aws.png (the CrewAI build is a framework comparison, not a
different data source).

Locally this is a plain HTTP call to the model-service container. On AWS,
model-service's image IS a SageMaker Endpoint's serving container -- there's
no standalone HTTP service to call, so the same request/response contract
goes through SageMaker Runtime's invoke_endpoint instead. Which path runs is
decided by whether SAGEMAKER_ENDPOINT_NAME is set -- true only on AWS, where
CrewaiAgentTaskDefinition (infra/cloudformation/template.yaml) passes it.
"""
import json
import os

import boto3
import requests

MODEL_SERVICE_URL = os.environ.get("MODEL_SERVICE_URL", "http://model-service:8000")
SAGEMAKER_ENDPOINT_NAME = os.environ.get("SAGEMAKER_ENDPOINT_NAME")


def get_checkpoints(departure_ident: str, destination_ident: str) -> list[dict]:
    """Scored checkpoints for a route, from model-service or SageMaker --
    see module docstring for which, and why."""
    payload = {"departure_ident": departure_ident, "destination_ident": destination_ident}
    if SAGEMAKER_ENDPOINT_NAME:
        return _invoke_sagemaker(payload)
    return _invoke_http(payload)


def _invoke_http(payload: dict) -> list[dict]:
    resp = requests.post(f"{MODEL_SERVICE_URL}/invocations", json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()["checkpoints"]


def _invoke_sagemaker(payload: dict) -> list[dict]:
    client = boto3.client("sagemaker-runtime")
    response = client.invoke_endpoint(
        EndpointName=SAGEMAKER_ENDPOINT_NAME,
        ContentType="application/json",
        Body=json.dumps(payload),
    )
    return json.loads(response["Body"].read())["checkpoints"]
