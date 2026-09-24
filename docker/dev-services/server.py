"""The developer console's one door onto Docker: which of four services
are running, and starting one that is not.

This is the only process that holds the Docker socket for the console,
and it answers exactly two requests:

    GET  /services               -> [{"name": ..., "state": ...}, ...]
    POST /services/<name>/start  -> {"name": ..., "state": ..., "started": bool}

for the names in DEV_SERVICES, in this compose project only. Nothing
else reaches the Docker API through it: no create, no exec, no other
container, no other project. It replaced a general Docker socket proxy
whose "containers" grant also allowed `POST /containers/create`, and a
privileged container with the host's `/` mounted is root on the host.

Standard library only, so the image is python plus this file.
"""
from __future__ import annotations

import http.client
import json
import os
import socket
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOCKET_PATH = os.environ.get("DOCKER_SOCKET", "/var/run/docker.sock")
#: The only services this may report on or start.
ALLOWED = tuple(s.strip() for s in os.environ.get("DEV_SERVICES", "").split(",") if s.strip())


class DockerError(Exception):
    pass


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str):
        super().__init__("localhost", timeout=15)
        self._path = path

    def connect(self):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(15)
        sock.connect(self._path)
        self.sock = sock


def docker(method: str, path: str):
    """(status, parsed body) for one Docker Engine API call."""
    conn = _UnixConnection(SOCKET_PATH)
    try:
        conn.request(method, path, headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        raw = response.read()
    except OSError as err:
        raise DockerError(f"Docker is unreachable: {err}") from err
    finally:
        conn.close()
    return response.status, (json.loads(raw) if raw else None)


def own_project(api=docker) -> str | None:
    """The compose project this sidecar belongs to, read off its own
    container's labels -- so a checkout under another directory name
    starts its own containers, not flight_plan's."""
    status, body = api("GET", f"/containers/{socket.gethostname()}/json")
    if status != 200 or not body:
        return None
    return (body.get("Config", {}).get("Labels") or {}).get("com.docker.compose.project")


def find(name: str, project: str, api=docker) -> dict | None:
    filters = json.dumps({"label": [
        f"com.docker.compose.project={project}",
        f"com.docker.compose.service={name}",
    ]})
    status, body = api("GET", "/containers/json?all=1&filters=" + urllib.parse.quote(filters))
    if status != 200:
        raise DockerError(f"listing containers failed with {status}")
    return body[0] if body else None


def states(project: str, allowed=ALLOWED, api=docker) -> list:
    out = []
    for name in allowed:
        container = find(name, project, api)
        out.append({"name": name, "state": container["State"] if container else "absent"})
    return out


def start(name: str, project: str, allowed=ALLOWED, api=docker) -> tuple:
    """(HTTP status, body) for starting one allowed service."""
    if name not in allowed:
        return 404, {"detail": f"not a service this may start: {name}"}
    container = find(name, project, api)
    if container is None:
        return 409, {"detail": f"{name} has no container yet -- run `docker compose up -d {name}` once to create it"}
    if container["State"] == "running":
        return 200, {"name": name, "state": "running", "started": False}
    status, body = api("POST", f"/containers/{container['Id']}/start")
    if status not in (204, 304):
        return 502, {"detail": f"starting {name} failed: {(body or {}).get('message', status)}"}
    after = find(name, project, api)
    return 200, {"name": name, "state": after["State"] if after else "absent", "started": True}


class Handler(BaseHTTPRequestHandler):
    project: str | None = None

    def _send(self, status: int, body) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _project(self) -> str | None:
        if Handler.project is None:
            Handler.project = own_project()
        return Handler.project

    def do_GET(self):
        if self.path != "/services":
            return self._send(404, {"detail": "not found"})
        project = self._project()
        if project is None:
            return self._send(503, {"detail": "this sidecar is not running under compose"})
        try:
            return self._send(200, states(project))
        except DockerError as err:
            return self._send(502, {"detail": str(err)})

    def do_POST(self):
        parts = self.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "services" or parts[2] != "start":
            return self._send(404, {"detail": "not found"})
        project = self._project()
        if project is None:
            return self._send(503, {"detail": "this sidecar is not running under compose"})
        try:
            return self._send(*start(parts[1], project))
        except DockerError as err:
            return self._send(502, {"detail": str(err)})

    def log_message(self, fmt, *args):  # one line per request, on stderr as usual
        super().log_message(fmt, *args)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
