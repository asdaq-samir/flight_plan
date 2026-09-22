# Security

## Reporting a vulnerability

Report privately through GitHub's own channel — the **Security** tab, then
**Report a vulnerability** — rather than by opening an issue, so a problem
is not public before there is a fix.

This is a personal project, not a staffed product. Expect an
acknowledgement within a week rather than within hours.

## What this project holds, and what it does not

Worth stating plainly, because it narrows what a report is likely to be
about.

**It has no production deployment.** The AWS side is written and
validated but has never been deployed; there is no live instance and no
real user data anywhere. Everything runs locally under Docker Compose.

**It stores no passwords.** Sign-in is Google or Apple OIDC, or an
emailed one-time link. The link's row in `magic_links` holds a SHA-256 of
the token, never the token itself, and is consumed by a single
conditional `UPDATE` so two requests racing the same link cannot both
sign in.

**It holds no secrets in the repository.** Credentials arrive as
environment variables or GitHub Actions secrets. `.env` is gitignored.
The AWS deploy job authenticates with OIDC against a role ARN held in a
repository variable, not with a stored access key.

**Its dependencies are pinned and watched.** `planning-service`'s
requirements pin exact versions and every GitHub Action is pinned to a
commit rather than a movable tag. Dependabot opens grouped version
updates monthly, security updates immediately, and CI fails the build on
a high-severity npm advisory.

## Scope

In scope: anything reachable through the web app or its API — the session
and sign-in flow, the CSRF protection, the planner and comparison
proxies, the access rules in `SecurityConfig`, and the GitHub Actions
workflow, which holds a registry token and, in the deploy job, AWS
credentials.

Out of scope: the accuracy of anything this project computes. Bad
navigation output is a correctness bug, not a vulnerability — open an
issue for it.

## Not for real flight

This software is a portfolio and learning project. It is not an approved
source of aeronautical information and must not be used to plan or
conduct an actual flight. Use official FAA charts and publications and a
current, approved planning tool.
