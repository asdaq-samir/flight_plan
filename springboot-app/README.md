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

`webapp` brings up `db`, `model-service` and `planning-service` with it.

```bash
# The JUnit suite, including Testcontainers' real Postgres. No native
# Maven needed; the Docker socket is passed through so Testcontainers can
# start a sibling container.
docker run --rm -v "$PWD/springboot-app":/build -v /build/target \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  -w /build maven:3.9-eclipse-temurin-25 mvn -B test
```

Three details in that command each fix a real failure, not a style
preference:

- **`-e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`, not
  `--add-host=host.docker.internal:host-gateway`.** The two solve
  different halves of the problem — `--add-host` only makes the
  hostname *resolvable* inside this container; it never tells
  Testcontainers to actually *use* it when reaching back into a
  sibling container it started via the mounted socket. Without the env
  var, Testcontainers tries the Docker bridge gateway directly and
  fails to reach its own Ryuk resource-reaper: `Could not connect to
  Ryuk at 172.17.0.1:<port>`.
- **`-v /build/target`**, an anonymous volume, not the host directory —
  on a repo synced by iCloud, a build run outside Docker (an IDE, a
  local `mvn`) can leave iCloud sync-conflict copies in `target/`
  (`V1__create_routes_table 3.sql` and similar), and Flyway then
  refuses to start with "found more than one migration with version
  1". The anonymous volume is empty on every run, so the host's
  `target/` — conflict copies included — never enters the build.
- **No `clean`.** The Maven clean plugin cannot delete a mount point
  ("Device or resource busy"), which the anonymous volume above is.

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

5. **Version the schema** (`flyway-core`). `V3__create_pilots_aircraft_flights.sql`.
   Migrations are ordinary SQL, applied in order, recorded in a table.
   Once this is in place `ddl-auto: validate` means the app refuses to
   start if the code and the schema disagree — a good failure.

6. **Test it properly** (`spring-boot-starter-test`, Testcontainers).
   Three flavours, all present here: `@WebMvcTest` for a controller with
   no database, plain Mockito for a service, and `@SpringBootTest` with a
   real Postgres in a container for persistence. An H2 in-memory database
   would be faster and would not catch Postgres-specific SQL.

7. **Call another service** (the JDK `HttpClient`).
   `PlannerProxyController.java` forwards `/api/planner/*` to
   `planning-service`. Now you need timeouts, and a decision about what
   happens when the other service is down.

8. **Add sign-in** (`spring-boot-starter-security` +
   `-oauth2-client`). The moment you add the starter, *everything* is
   locked including your health endpoint, and you have to say what is
   public. `security/SecurityConfig.java` is that list.

9. **Serve the front end.** Point `app.static-location` at the built
   bundle (the classpath for a local build, a directory beside the jar in
   the image) and one origin serves page and API — one session, one set
   of rules, no CORS.

### The method

Add one starter at a time and run the app after each. Spring's magic is
mostly *auto-configuration reacting to what is on the classpath*, so
adding a starter changes behaviour without you writing a line. Adding
them one at a time is the only way to see which one did what.

## The package map

One job per class.

| Package | What lives there |
|---|---|
| `controller/` | HTTP endpoints. `PlannerProxyController` forwards `/api/planner/*` to `planning-service`; `GlobalExceptionHandler` turns exceptions into JSON; `MagicLinkController` is the email sign-in flow's own two steps (request, verify). |
| `service/` | Business logic: `PilotService`, `AircraftService`, `FlightService`, each scoped to the signed-in pilot. |
| `repository/` | Spring Data interfaces. No implementations — Spring writes them. |
| `domain/` | JPA entities: `Pilot`, `Aircraft`, `Flight`, `FlightCheckpoint`, `MagicLink`. |
| `dto/` | Request and response shapes, kept separate from entities so the API and the schema can change independently. |
| `security/` | `SecurityConfig` (what is public), `OAuthClientsConfig` (builds Google/Apple's client registrations in Java, not YAML — Apple's own secret is a signed JWT no static property could hold), `MagicLinkAuthenticationToken` (the session's own principal after a magic-link sign-in), `DeveloperOnly` (whether the caller holds the developer role, read from their row on every request), `SignInOptions` (whether anyone can sign in here at all), and `CsrfCookieFilter` (forces the `XSRF-TOKEN` cookie to actually be written — see below). |
| `config/` | `WebMvcConfig` — static-resource and SPA routing. |

Five migrations, in `resources/db/migration/`: routes, then normalised
checkpoints, then pilots/aircraft/flights, then Apple's own subject
column plus the magic-link table, then dropping the routes pair again
once `planning-service` owned scoring and nothing here read them.

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

**Sign-in is conditional, and three-way.** `oauth2Login` registers
only when `OAuthClientsConfig` actually produced a client registration
(real Google or Apple credentials, `oauth` profile active), so local
development needs no credentials and the pages open without a login
wall. Deploy with credentials set and the same code requires sign-in.
The magic-link flow (`MagicLinkController`) is separate from all of
that — no profile, no OIDC registration, just email address in,
one-time link out — and works (or fails to send, logged rather than
thrown) whether or not OIDC is configured.

**Planner writes need a session once anyone can sign in, and the
developer's work needs the developer role.** `GET /api/planner/**` is
public apart from the stack's own status and services; `POST`/`DELETE`
through the proxy (checkpoint notes, corridor builds) and the billed
`/api/comparison` narrative require a session whenever `SecurityConfig`
sees a way to obtain one -- OIDC credentials or a configured
`MAIL_HOST` for the magic link. The developer's work -- picks (the
model's training labels), a retrain, a chart refresh,
`/api/planner/status` and `/api/planner/dev/**` -- needs
`PilotRole.DEVELOPER` on top of that, read from the pilot's row on
every request (`DeveloperOnly`), so granting or revoking the role with
an `UPDATE` takes effect at once. Locally none of it applies: nobody can
sign in, so the training workspace keeps working signed out.

**Testcontainers needs the Docker socket.** That is why the `mvn test`
command above mounts `/var/run/docker.sock`; without it the persistence
tests cannot start their Postgres.

**`CsrfCookieFilter` exists because the `XSRF-TOKEN` cookie is written
lazily.** `CookieCsrfTokenRepository` with
`CsrfTokenRequestAttributeHandler` — the standard setup — only writes the
cookie once something reads `csrfToken.getToken()` during the request,
which a server-rendered template does and a JSON-only API never does.
Without the filter no response carried the cookie, `web/`'s `client.ts`
had no token to echo back, and every POST/DELETE failed CSRF validation —
reported as a 401 by Spring Security's own `HttpStatusEntryPoint`, since the caller is anonymous.
The filter forces the token to materialise on every request, the pattern
Spring's own docs recommend for an SPA.

**The planner proxy pins HTTP/1.1.** The JDK `HttpClient` defaults to
attempting an HTTP/2 upgrade, which uvicorn (HTTP/1.1 only) rejects with
`Unsupported upgrade request`; on a reused connection the *next* request
then arrives with no body, and FastAPI answers 422 for a body Spring
received intact. `.version(HttpClient.Version.HTTP_1_1)` on the shared
client is what prevents it.
