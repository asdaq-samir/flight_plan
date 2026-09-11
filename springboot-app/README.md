# springboot-app/

`webapp` — the public surface. It is the only service a browser talks to:
it serves the React bundle, proxies the planner, holds pilots and flights
in Postgres, and owns sign-in.

Everything else in this repo sits behind it on a private network.

## Contents

- [Running it](#running-it)
- [Learning this from zero](#learning-this-from-zero)
- [The package map](#the-package-map)
- [Things that are not obvious](#things-that-are-not-obvious)

## Running it

```bash
docker compose up -d --build webapp
# http://localhost:8080/app/plan
# http://localhost:8080/swagger-ui/index.html
```

`webapp` brings up `db` and `model-service` with it, but **not**
`planning-service` — start that too or the pages render empty.

```bash
# The JUnit suite, including Testcontainers' real Postgres. No native
# Maven needed; the Docker socket is passed through so Testcontainers can
# start a sibling container.
docker run --rm -v "$PWD/springboot-app":/build -w /build \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --add-host=host.docker.internal:host-gateway \
  maven:3.9-eclipse-temurin-21 mvn test
```

## Learning this from zero

The bare minimum is one file. Spring Initializr
([start.spring.io](https://start.spring.io)) with a single dependency,
*Spring Web*, gives you a runnable service:

```java
@SpringBootApplication
@RestController
public class App {
    public static void main(String[] args) { SpringApplication.run(App.class, args); }

    @GetMapping("/hello")
    public String hello() { return "VFR route"; }
}
```

`mvn spring-boot:run`, then `curl localhost:8080/hello`. That is the
whole framework at its smallest: an annotation that starts an embedded
Tomcat, and a method that answers a path.

### The rungs

Each rung adds one Spring *starter*, and each starter earns itself by
solving a problem the previous rung creates.

1. **Answer a path** (above). `spring-boot-starter-web`. No database, no
   security, no tests.

2. **Return an object, not a string.** Make the method return a record.
   Spring serialises it to JSON with no work from you — that is
   Jackson arriving as a transitive dependency, and it is worth knowing
   it is doing the work rather than the framework itself.

3. **Take input, and validate it.** A `@PostMapping` with `@RequestBody`.
   Then send it nonsense and watch it fail with a 500 and a stack trace.
   The fix — `@Valid`, plus a `@RestControllerAdvice` — is
   `controller/GlobalExceptionHandler.java`, and the reason it exists is
   that an unhandled exception is a bad API response.

4. **Persist something** (`spring-boot-starter-data-jpa` + the Postgres
   driver). An `@Entity`, a `Repository` interface with no
   implementation, and suddenly you can save. Then change a field and
   watch Hibernate silently alter your table — which is why
   `ddl-auto: validate` is set here and Flyway owns the schema instead.

5. **Version the schema** (`flyway-core`). `V1__create_routes_table.sql`.
   Migrations are ordinary SQL, applied in order, recorded in a table.
   Once this is in place `ddl-auto: validate` means the app refuses to
   start if the code and the schema disagree — a good failure.

6. **Test it properly** (`spring-boot-starter-test`, Testcontainers).
   Three flavours, all present here: `@WebMvcTest` for a controller with
   no database, plain Mockito for a service, and `@SpringBootTest` with a
   real Postgres in a container for persistence. An H2 in-memory database
   would be faster and would not catch Postgres-specific SQL.

7. **Call another service** (`RestClient`). `ModelServiceClient.java`.
   Now you need timeouts, and a decision about what happens when the
   other service is down.

8. **Add sign-in** (`spring-boot-starter-security` +
   `-oauth2-client`). The moment you add the starter, *everything* is
   locked including your health endpoint, and you have to say what is
   public. `security/SecurityConfig.java` is that list.

9. **Serve the front end.** Put the built bundle in
   `src/main/resources/static/` and one origin serves page and API — one
   session, one set of rules, no CORS.

### The method

Add one starter at a time and run the app after each. Spring's magic is
mostly *auto-configuration reacting to what is on the classpath*, so
adding a starter changes behaviour without you writing a line. Adding
them one at a time is the only way to see which one did what.

## The package map

28 classes, one job each.

| Package | What lives there |
|---|---|
| `controller/` | HTTP endpoints. `PlannerProxyController` forwards `/api/planner/*` to `planning-service`; `GlobalExceptionHandler` turns exceptions into JSON. |
| `service/` | Business logic, and the outbound call to the model (`ModelServiceClient`, which switches to SageMaker Runtime when `SAGEMAKER_ENDPOINT_NAME` is set). |
| `repository/` | Spring Data interfaces. No implementations — Spring writes them. |
| `domain/` | JPA entities: `Pilot`, `Aircraft`, `Flight`, `FlightCheckpoint`, `Route`, `Checkpoint`. |
| `dto/` | Request and response shapes, kept separate from entities so the API and the schema can change independently. |
| `security/` | `SecurityConfig` (what is public), `Http401EntryPoint` (an API answers 401, it does not redirect to a login page), and `CsrfCookieFilter` (forces the `XSRF-TOKEN` cookie to actually be written — see below). |
| `config/` | `WebMvcConfig` — static-resource and SPA routing. |

Three migrations, in `resources/db/migration/`: routes, then normalised
checkpoints, then pilots/aircraft/flights.

## Things that are not obvious

**`ddl-auto: validate`, never `update`.** Hibernate can alter tables to
match your entities, which is convenient right up to the moment it drops
a column in production. Flyway owns the schema; Hibernate is only allowed
to check that it matches and refuse to start if not.

**The proxy's base URL is externalised.** `planner-service.base-url`
reads `${PLANNER_SERVICE_URL}`, which is a Compose hostname locally and a
Cloud Map name on AWS (`planning-service.vfr-route.internal`). Note the
env var name must match `application.yml` exactly — Spring's relaxed
binding does *not* map `PLANNER_SERVICE_BASE_URL` onto a property with a
hyphen in it.

**Sign-in is conditional.** `oauth2Login` registers only when a Google
client-id is present, so local development needs no credentials and the
pages open without a login wall. Deploy with the id set and the same code
requires sign-in.

**`GET /api/routes` returns 500.** `RouteController` maps only POST
there, which is fine, but `GlobalExceptionHandler` swallows
`HttpRequestMethodNotSupportedException` and reports it as a 500 — so a
client cannot tell "wrong method" from "server broke". It should pass 405
through. Unfixed.

**Testcontainers needs the Docker socket.** That is why the `mvn test`
command above mounts `/var/run/docker.sock`; without it the persistence
tests cannot start their Postgres.

**The `XSRF-TOKEN` cookie was never actually being set — fixed.**
`SecurityConfig` uses `CookieCsrfTokenRepository` with
`CsrfTokenRequestAttributeHandler`, the standard setup, but that
handler resolves the token *lazily*: the cookie is only written once
something reads `csrfToken.getToken()` during the request, which a
server-rendered page does by referencing `${_csrf}` in a template.
Nothing here does — every response is JSON — so the cookie was never
set on any response, `web/`'s `client.ts` never had a token to echo
back, and every POST/DELETE (saving a pick, deleting one, starting a
build) failed CSRF validation. Because the caller is anonymous, Spring
reports that as 401 "authentication required" via `Http401EntryPoint`
rather than 403 via an access-denied handler, which is a doubly
misleading way to hear "your cookie never arrived." `CsrfCookieFilter`
forces the token to materialise on every request; it's the pattern
Spring's own docs recommend for exactly this SPA scenario.

**The planner proxy's `HttpClient` was corrupting POST bodies — fixed.**
`PlannerProxyController`'s JDK `HttpClient` defaulted to attempting an
HTTP/2 upgrade against `planning-service` (uvicorn, HTTP/1.1 only).
Observed as uvicorn logging `Unsupported upgrade request` followed by
`Invalid HTTP request received` for the *next* request on a reused
connection, which FastAPI then saw as a request with no body at all —
a 422 "field required" with `input: null`, for a body Spring itself had
received intact. Fixed by pinning `.version(HttpClient.Version.HTTP_1_1)`
on the shared client. Both of these were found the same way: `web/`
grew a feature that actually exercised a write path nothing had
exercised end to end before.
