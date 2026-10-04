"""Traces, when there is somewhere to send them: with
OTEL_EXPORTER_OTLP_ENDPOINT set (docker-compose's tracing profile sets
it to Jaeger's), every request the planner answers is a span, and every
call it makes with requests one under it -- aviationweather.gov, the
FAA, the USGS, model-service -- the webapp's span above it all, so a slow
plan is one trace from the page's call down. Without it, nothing is
loaded and nothing is sent."""
import logging
import os

log = logging.getLogger(__name__)


def instrument(app) -> bool:
    """Instruments `app` and `requests` when an OTLP endpoint is set;
    False, and nothing done, when it is not."""
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return False
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.requests import RequestsInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(resource=Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "planner")}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
    RequestsInstrumentor().instrument()
    log.info("tracing to %s", os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"])
    return True
