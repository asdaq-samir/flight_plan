# Wingtip Maps on AWS

## Contents

- **[The design](#the-design)** — [What runs where](#what-runs-where) · [What is left out](#what-is-left-out)
- **[What it costs](#what-it-costs)**
- **[The first deploy](#the-first-deploy)** — [Before anything (the owner)](#before-anything-the-owner) · [The stack](#the-stack) · [The images and the server](#the-images-and-the-server) · [Mail](#mail) · [The first chart cycle](#the-first-chart-cycle) · [The chart model](#the-chart-model)
- **[Running it](#running-it)** — [Deploys](#deploys) · [On the server](#on-the-server) · [Chart cycles](#chart-cycles) · [Backups and restore](#backups-and-restore) · [A replaced server](#a-replaced-server) · [Teardown](#teardown)
- **[Gotchas](#gotchas)**

## The design

The app runs on one small server behind CloudFront. What is the same for
every pilot is drawn ahead of time and served from the edge.

The expensive parts of the old design, an ALB, RDS, a NAT gateway, VPC
endpoints and Fargate services running all month, cost about $200–250
a month for a planner nobody was using yet. This design costs a fifth of
that (below), and the map is faster: tiles come from the nearest
CloudFront edge, not from a planner drawing them on request.

### What runs where

```
pilot ──HTTPS──▶ CloudFront  (app.example.com, ACM certificate)
                   │
                   ├─ /tiles/*        ──▶ S3 tiles bucket       cached a month (immutable, cycle in the path)
                   ├─ /app/assets/*   ──▶ the server            cached a year (fingerprinted)
                   ├─ the chart, the airport search, the stock aircraft
                   │                  ──▶ the server            cached by their own header: a minute, an hour
                   └─ everything else ──▶ the server            not cached: pages, /api, sign-in
                                            │ origin.app.example.com:443, with X-Origin-Secret
                                            ▼
                        EC2 t3a.medium (Amazon Linux 2023, docker-compose.prod.yml)
                          caddy ─▶ webapp ─▶ planning-service ─▶ model-service
                                     │            └──────────▶ nav-log-agent ─▶ Anthropic
                                     └──▶ db (Postgres 18 + pgvector, on the server's disk)
                          nightly pg_dump ─▶ S3 server bucket (14 days)

EventBridge, daily 08:30 UTC ─▶ Fargate Spot task: python -m vfr.charts refresh
   a no-op until the FAA's new cycle, then fetches every sheet, draws the
   pyramid (1.5 million tiles) and publishes it to the tiles bucket,
   serving.json last, so every browser moves to the new cycle at once
```

- **One domain for everything** (`PublicHost`), so the webapp's Secure
  session cookies work as they do locally and the map's tile requests
  are same-origin.
- **What the edge keeps is what is the same for every pilot.** Besides
  the tiles and the app's files, three answers: the chart the map draws
  (a minute), the airport search as a pilot types, and the stock
  aircraft (an hour each). Each says so itself (`app.common` in the
  planner), the webapp passes the header on for those paths alone
  (`PlannerProxyController`), and CloudFront keys them by path and query
  string, never by cookie. Everything with weather in it (the fields in
  view, an airport's card, the Class B list, the airspace at a point), a
  route's answers, and anything of one pilot's is `no-store`, which
  `CacheHeadersTest` checks through the whole filter chain.
- **Only CloudFront reaches the server.** The security group admits
  port 443 from CloudFront's origin-facing addresses alone, and Caddy
  answers 404 to any request without the secret header CloudFront adds
  (`infra/server/Caddyfile`). Port 80 is open for Let's Encrypt, which
  gives Caddy the certificate for `origin.<domain>`.
- **No SSH.** A shell on the server is SSM Session Manager; deploys are
  SSM Run Command. The server's role can pull its own images, read its
  own secrets and write its own backups, and nothing else.
- **The planner no longer draws tiles** (`CHARTS_AUTO_REFRESH=0`,
  `CHART_TILES_URL`). It still reads the chart for checkpoints, from the
  sheets under each route, fetched the first time a route needs them
  and kept on the server's disk.
- **Images are x86** (t3a), so CI's images run as built. A Graviton
  server (t4g) would save about $3 a month and need every image built
  for both architectures.

Every resource is in [`infra/cloudformation/template.yaml`](../infra/cloudformation/template.yaml);
the server's own files are in [`infra/server/`](../infra/server/) and
[`docker-compose.prod.yml`](../docker-compose.prod.yml).

### What is left out

Each of these stays in the development stack (`docker-compose.yml`), and
nothing in production calls it; the developer console says so where it
offers one.

| Left out | Why | In production |
|---|---|---|
| crewai-agent | The same briefing nav-log-agent writes, built to compare frameworks | The comparison popover's CrewAI side reports it unavailable |
| Airflow, the pipelines, SageMaker | Retraining runs on the owner's machine | The console's retrain button says Airflow is not configured; a new model is uploaded (below) |
| Mailpit | A development mailer | Sign-in mail goes through Amazon SES |
| dev-services, Jupyter | Development tools | The console's service buttons say there is no sidecar |
| The Go retrain Lambda and API Gateway | Triggered Airflow, which is not here | — |

## What it costs

On-demand prices in us-east-1, October 2026, at today's traffic:

| Item | A month |
|---|---|
| EC2 t3a.medium, all month | $27.45 |
| Its public IPv4 address | $3.65 |
| 40 GB gp3 disk | $3.20 |
| S3 tiles: 1.5 million uploads a cycle ($7.50 per 56 days) and up to three cycles stored | ~$4.50 |
| Secrets Manager, four secrets | $1.60 |
| Route 53 hosted zone | $0.50 |
| Daily snapshots of the server's disk, seven kept | ~$1 |
| ECR, CloudWatch logs, backups, the Fargate Spot refresh (under $1 a cycle) | ~$1.50 |
| CloudFront | $0 within the always-free 1 TB and 10 million requests |
| SES | $0.10 per 1,000 sign-in emails |
| **Total** | **about $43** |

A one-year Savings Plan on the server takes about $10 off (**about
$33**). The next saving after that is the tiles' upload bill: one
PMTiles archive per chart kind in place of 1.5 million files would take
it to cents, at the cost of a PMTiles reader in the map.

The template's `BudgetEmail` sets an alarm at 80% of $50 a month.

## The first deploy

### Before anything (the owner)

What only the owner can do (issue #115):

1. An AWS account, with MFA on the root user.
2. A domain whose DNS is a Route 53 hosted zone in that account. Note
   the zone's ID.
3. The AWS CLI on the Mac, signed in to that account (`aws configure` or
   `aws sso login`), and the
   [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
   for a shell on the server.

### The stack

The server's image is named, not looked up, so that a later stack update
never replaces the server because Amazon published a newer one. Find the
current one, then create the stack (us-east-1 only: CloudFront's
certificate must be there):

```bash
AMI=$(aws ssm get-parameter --region us-east-1 \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)

aws cloudformation deploy --region us-east-1 --stack-name wingtip \
  --template-file infra/cloudformation/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    PublicHost=app.example.com HostedZoneId=Z0123456789ABC \
    ServerImageId="$AMI" BudgetEmail=you@example.com

aws cloudformation describe-stacks --region us-east-1 --stack-name wingtip \
  --query 'Stacks[0].Outputs' --output table
```

It takes about 20 minutes, most of it the certificate's DNS validation
and CloudFront. Pass `CreateGitHubOidcProvider=false` if the account
already trusts GitHub's OIDC provider. `MailDomain` sends sign-in mail
from another domain than `PublicHost`.

The outputs name everything the steps below need.

### The images and the server

The server boots, installs Docker, clones this repository and writes
its settings, but has no images to run until the first push to ECR.

1. In GitHub, Settings → Secrets and variables → Actions → Variables,
   add `AWS_ROLE_ARN` (the `DeployRoleArn` output), `AWS_REGION`
   (`us-east-1`) and `AWS_INSTANCE_ID` (the `ServerInstanceId` output).
2. Fill in the owner's values in the `AppSecret` output's secret, as
   [`infra/server/env.example`](../infra/server/env.example) lists them:

   ```bash
   aws secretsmanager put-secret-value --region us-east-1 \
     --secret-id <AppSecretArn> --secret-string file://app-secret.json
   rm app-secret.json
   ```

3. The next green CI run on `main` promotes its images, pushes the four
   the server runs to ECR (`promote.yml`, `push-ecr`) and runs
   [`infra/server/deploy.sh`](../infra/server/deploy.sh) on the server
   (`deploy`). To deploy without waiting for one:

   ```bash
   aws ssm send-command --region us-east-1 --instance-ids <ServerInstanceId> \
     --document-name AWS-RunShellScript \
     --parameters 'commands=["/srv/flight_plan/repo/infra/server/deploy.sh"]'
   ```

`deploy.sh` writes the server's `.env` from the stack's settings and the
four secrets, pulls the images and starts what changed. It is safe to run
at any time.

### Mail

The stack creates the SES identity for the mail domain and its three
DKIM records. Then:

1. **SMTP credentials:** SES console → SMTP settings → Create SMTP
   credentials. The user name and password go in the `AppSecret` as
   `MAIL_USERNAME` and `MAIL_PASSWORD`; run `deploy.sh` again.
2. **DMARC:** add a TXT record `_dmarc.<mail domain>` with
   `v=DMARC1; p=quarantine; rua=mailto:<you>`. DKIM, signed by SES for
   the domain, is what aligns for DMARC.
3. **SPF** is SES's own: it sends from `amazonses.com` unless a custom
   MAIL FROM domain is set up, so the domain needs no SPF record for
   these emails.
4. **Leave the sandbox:** SES console → Account dashboard → Request
   production access. Until Amazon approves it, mail goes only to
   addresses verified in SES, which is enough to test with your own.

### The first chart cycle

The daily refresh draws the cycle at 08:30 UTC. To have tiles now, run
the `ChartRefreshNow` output's command. The whole country takes some
hours on the task's two cores; its log is in CloudWatch under
`/ecs/wingtip-chart-refresh`. Until it publishes, the map has no chart
under it.

### The chart model

The planner ranks checkpoints with the chart model when one is there,
and by its own rules when not. To serve the one trained on the Mac:

```bash
aws s3 sync data/models/chart/current s3://<ServerBucketName>/models/chart/current/
```

then run `deploy.sh`, which copies it to the server. Each retrain on the
Mac is promoted the same way.

## Running it

### Deploys

A pull request merged to `main` deploys itself once CI passes: Promote
pushes the images and runs `deploy.sh` over SSM, and the job fails if it
does. A deploy restarts only the services whose image changed. The
server's copy of the repository follows `main` too (`git pull` in
`deploy.sh`), for `docker-compose.prod.yml` and the Caddyfile.

### On the server

```bash
aws ssm start-session --region us-east-1 --target <ServerInstanceId>
sudo -i
cd /srv/flight_plan/repo
docker compose --env-file /srv/flight_plan/.env -f docker-compose.prod.yml ps
docker compose --env-file /srv/flight_plan/.env -f docker-compose.prod.yml logs -f --tail 100 webapp
```

`/srv/flight_plan/data` is the planner's data folder, `/srv/flight_plan/postgres`
the database. Never edit `/srv/flight_plan/.env`; `deploy.sh` writes it.

### Chart cycles

Nothing to do: the daily task publishes each new cycle once and is a
no-op on the other 55 days. A Spot interruption starts it over the next
day, the old cycle served until then. Tiles are cached by their cycle,
so a tile drawn again within a cycle (a renderer change) reaches pilots
with the next cycle.

### Backups and restore

At 07:17 UTC every night `backup.sh` copies to
`s3://<ServerBucketName>/backups/<date>/` what the server alone holds:
the database (`postgres.dump`: accounts, aircraft, flights, the briefing
agent's memory) and the planner's `data/labels` (`labels.tar.gz`: the
checkpoint notes pilots and Claude have written). The bucket keeps 14
days. The dump is written to a file and checked with `pg_restore --list`
before it is uploaded, so a truncated one never replaces a good day, and a
failed backup emails `BudgetEmail` (confirm the SNS subscription mail once).
The server's disk is also snapshotted daily at 05:00 UTC, seven kept. To
restore one, on the server:

```bash
cd /srv/flight_plan/repo
B=s3://<ServerBucketName>/backups/<date>
aws s3 cp $B/postgres.dump - | \
  docker compose --env-file /srv/flight_plan/.env -f docker-compose.prod.yml \
  exec -T db pg_restore -U vfr -d vfr_route --clean --if-exists
aws s3 cp $B/labels.tar.gz - | tar -xz -C /srv/flight_plan/data
docker compose --env-file /srv/flight_plan/.env -f docker-compose.prod.yml restart webapp nav-log-agent planning-service
```

Everything else in the data folder (the FAA's files, the chart sheets)
is downloaded again by the planner as it is needed.

### A replaced server

A new `ServerImageId`, or any other change CloudFormation can make only
by replacing the server (its subnet, say), gives a new server. It
deploys itself on its first boot, with an empty database; restore last
night's dump as above. The old server's
disk is kept (it is not deleted with its server): delete it in the EC2
console under Volumes once the restore is checked.

### Teardown

```bash
aws cloudformation delete-stack --region us-east-1 --stack-name wingtip
```

Empty the tiles bucket first (or the delete fails on it). The server
bucket, with the backups, and the server's disk are kept on purpose:
delete them by hand when they are no longer wanted.

## Gotchas

- **The CloudFront prefix list counts as 55 rules** against the
  security group's limit of 60.
- **Caddy needs `origin.<domain>` to resolve** before it can get its
  certificate; it retries by itself after the first boot, while the
  record is being created.
- **The Fargate task has no data folder mounted:** the planner image
  makes `/workspace/data` its user's for that, and the task's 60 GB of
  storage holds the sheets and the pyramid.
- **The refresh task's empty disk would read as a cycle never drawn;**
  it asks the bucket's `serving.json` first (`vfr.charts.refresh`).
- **`AppSecret` is written once.** The stack leaves the values filled in
  by the owner alone unless its `SecretString` in the template changes,
  so leave that as it is.

---

Back to [`README.md`](README.md) for the project overview.
