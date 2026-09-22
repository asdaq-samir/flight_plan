"""Starting a development service the console links to.

The console offers doors into Jupyter, Airflow and the two other
services. A door into something that is not running is a dead link, and
telling a developer to go and type `docker compose up -d ml` is a
worse answer than doing it.

What this is allowed to touch is fixed here, in code: four service
names, no arguments, start only. It cannot stop anything, cannot reach
the database or the gateway, and cannot be asked for a service not on
the list. The container it acts on is found by the labels compose
already puts on it, so there is no shelling out to the compose CLI and
no image that needs it installed.

The socket itself is the real privilege, not this endpoint -- see the
comment beside the mount in docker-compose.yml. It is mounted into this
service, which is bound to loopback, and deliberately not into webapp,
which is the container exposed to the network.
"""
import logging
import os

from fastapi import APIRouter, HTTPException

from ..schemas import DevService, DevServices, DevServiceStarted

log = logging.getLogger(__name__)

router = APIRouter()

#: The only services this may start, and what the console calls them.
#: db and webapp are absent on purpose: nothing in the console links to
#: a database port, and webapp starting itself is a contradiction.
STARTABLE = {
    "ml": "Jupyter (the notebooks)",
    "airflow": "Airflow (the training DAG)",
    "model-service": "model-service API docs",
    "nav-log-agent": "nav-log-agent",
}

#: The compose project these containers belong to. Compose defaults it
#: to the directory name; COMPOSE_PROJECT_NAME overrides it.
PROJECT = os.environ.get("COMPOSE_PROJECT_NAME", "flight_plan")


def _client():
    """The Docker client, or None where there is no socket -- which is
    every deployment that is not this development stack."""
    try:
        import docker
    except ImportError:  # pragma: no cover -- the package is pinned
        return None
    try:
        return docker.from_env()
    except Exception as err:  # noqa: BLE001 -- no socket is an answer, not a fault
        log.info("no Docker socket, so services cannot be started from here: %s", err)
        return None


def _container(client, service: str):
    found = client.containers.list(
        all=True,
        filters={
            "label": [
                f"com.docker.compose.project={PROJECT}",
                f"com.docker.compose.service={service}",
            ]
        },
    )
    return found[0] if found else None


@router.get("/api/dev/services", response_model=DevServices)
def dev_services() -> DevServices:
    """Which of the services the console links to are running.

    `available` is false where there is no Docker socket at all, which
    is how the console knows to stop offering to start anything rather
    than offering a button that will fail.
    """
    client = _client()
    if client is None:
        return DevServices(available=False, services=[])
    return DevServices(
        available=True,
        services=[
            DevService(
                name=name,
                label=label,
                state=(c.status if (c := _container(client, name)) else "absent"),
            )
            for name, label in STARTABLE.items()
        ],
    )


@router.post("/api/dev/services/{service}/start", response_model=DevServiceStarted)
def start_dev_service(service: str) -> DevServiceStarted:
    """Start one of the four, if it is not already up.

    Already running is a success, not an error: the console calls this
    on every click so a link always works, and the common case is that
    there was nothing to do.
    """
    if service not in STARTABLE:
        raise HTTPException(404, f"not a service this may start: {service}")

    client = _client()
    if client is None:
        raise HTTPException(503, "no Docker socket, so nothing can be started from here")

    container = _container(client, service)
    if container is None:
        # Never created. Starting needs an image and a full service
        # definition, which is compose's job, not this endpoint's.
        raise HTTPException(
            409,
            f"{service} has no container yet -- run `docker compose up -d {service}` once to create it",
        )

    if container.status == "running":
        return DevServiceStarted(service=service, state="running", started=False)

    container.start()
    container.reload()
    log.info("started %s from the developer console", service)
    return DevServiceStarted(service=service, state=container.status, started=True)
