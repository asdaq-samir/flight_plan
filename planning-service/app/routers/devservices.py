"""Starting a development service the console links to.

The console offers doors into Jupyter and nav-log-agent. A door into
something that is not running is a dead link, and telling a developer
to go and type `docker compose up -d ml` is a worse answer than doing it.
The training run (compose's `retrain`) is started the same way, by
/api/retrain (routers/system.py), and its container's state is read
here too.

This service never touches Docker itself. It asks the dev-services
sidecar (docker/dev-services), the one process holding the socket for
this, which answers two requests -- which of its services are up, and
start one -- and refuses everything else, including any name not on its
own list. STARTABLE below only names them for the console; the sidecar
is what enforces the list. It sits on a network only this service
shares, so nothing else in the stack can ask it anything.
"""
import logging

import requests
from fastapi import APIRouter, HTTPException

from wingtip import retry

from ..schemas import DevService, DevServices, DevServiceStarted
from ..settings import get_settings

log = logging.getLogger(__name__)

router = APIRouter()

#: The services the console links to, and what it calls them. db and
#: webapp are absent on purpose: nothing in the console links to a
#: database port, and webapp starting itself is a contradiction.
STARTABLE = {
    "ml": "Jupyter (the notebooks)",
    "nav-log-agent": "nav-log-agent",
}

#: The training run's container (docker-compose.yml's `retrain`): started
#: by /api/retrain rather than linked to, so not among STARTABLE.
RETRAIN_SERVICE = "retrain"

#: Unset in every deployment that is not the compose stack, which is
#: how the console knows not to offer a start button at all.
SIDECAR_URL = get_settings().dev_services_url


def _sidecar(method: str, path: str) -> requests.Response | None:
    if SIDECAR_URL is None:
        return None
    try:
        return requests.request(method, f"{SIDECAR_URL}{path}", timeout=20)
    except requests.RequestException as err:
        log.info("dev-services sidecar unreachable, so services cannot be started from here: %s", err)
        return None


def service_state(name: str) -> str | None:
    """The state of one of the sidecar's services ("running", "exited",
    "absent" when it has no container yet), or None where there is no
    sidecar to ask."""
    response = _sidecar("GET", "/services")
    if response is None or response.status_code != 200:
        return None
    return {s["name"]: s["state"] for s in response.json()}.get(name, "absent")


@router.get("/api/dev/services", response_model=DevServices)
def dev_services() -> DevServices:
    """Which of the services the console links to are running.

    `available` is false where there is no sidecar to ask, which is how
    the console knows to stop offering to start anything rather than
    offering a button that will fail.
    """
    response = _sidecar("GET", "/services")
    if response is None or response.status_code != 200:
        return DevServices(available=False, services=[])
    states = {s["name"]: s["state"] for s in response.json()}
    return DevServices(
        available=True,
        services=[
            DevService(name=name, label=label, state=states.get(name, "absent"))
            for name, label in STARTABLE.items()
        ],
    )


@router.post("/api/dev/services/{service}/start", response_model=DevServiceStarted)
def start_dev_service(service: str) -> DevServiceStarted:
    """Start one of them, if it is not already up.

    Already running is a success, not an error: the console calls this
    on every click so a link always works, and the common case is that
    there was nothing to do.
    """
    if service not in STARTABLE:
        raise HTTPException(404, f"not a service this may start: {service}")
    response = _sidecar("POST", f"/services/{service}/start")
    if response is None:
        raise HTTPException(503, "no dev-services sidecar, so nothing can be started from here")
    if response.status_code != 200:
        raise HTTPException(response.status_code, retry.upstream_detail(response, "the dev-services sidecar"))
    body = response.json()
    if body.get("started"):
        log.info("started %s from the developer console", service)
    return DevServiceStarted(service=service, state=body["state"], started=body["started"])
