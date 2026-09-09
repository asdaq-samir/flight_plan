# Infrastructure

The AWS side of `docs/architecture-future.png` / `docs/README-Future.md`,
as actual code -- not deployed anywhere yet (no AWS account/credentials
available in the environment this was built in). See "What's verified"
below before treating any of this as deploy-ready.

## Layout

- `cloudformation/template.yaml` -- the target architecture: ECS Fargate
  (webapp) behind an ALB, RDS PostgreSQL, a SageMaker Endpoint (model-service's
  image), and the Retrain Trigger (API Gateway → Lambda → Airflow).
  Deploys into an **existing VPC** (parameters, not created here) -- a
  deliberate scope choice to keep the template focused on the application
  resources, where the real judgment is, rather than also re-deriving a
  VPC/subnet/NAT-gateway layout most orgs already have one of.
- `lambda-retrain-trigger/` -- the Go source for the "Retrain Trigger" box.
  Fetches Airflow credentials from Secrets Manager at invocation time (not
  a plaintext env var) and POSTs to Airflow's REST API to start a
  `vfr_pipeline` run on demand.

## Deploying (once you're ready to -- not yet)

1. Build the Lambda and upload it:
   ```bash
   cd infra/lambda-retrain-trigger
   GOOS=linux GOARCH=arm64 go build -o bootstrap main.go
   zip bootstrap.zip bootstrap
   aws s3 cp bootstrap.zip s3://<your-bucket>/retrain-trigger/bootstrap.zip
   ```
2. Check the RDS Postgres `EngineVersion` in `template.yaml` is still valid
   -- see the comment on the `Database` resource; RDS deprecates old minor
   versions on its own schedule, this wasn't checked against a live AWS
   account.
3. Deploy:
   ```bash
   aws cloudformation deploy \
     --template-file infra/cloudformation/template.yaml \
     --stack-name vfr-route \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides \
       VpcId=vpc-... \
       PublicSubnetIds=subnet-...,subnet-... \
       PrivateSubnetIds=subnet-...,subnet-... \
       WebappImageUri=<ecr-uri>/webapp:latest \
       ModelServiceImageUri=<ecr-uri>/model-service:latest \
       ModelArtifactS3Uri=s3://.../model.tar.gz \
       LambdaCodeS3Bucket=<your-bucket> \
       AirflowBaseUrl=http://... \
       AirflowCredentialsSecretArn=arn:aws:secretsmanager:...
   ```

## What's verified vs. not

**Verified**, without needing an actual AWS account:
- `lambda-retrain-trigger`: dependencies resolved and compiled for real
  (`GOOS=linux GOARCH=arm64 go build`, using a `golang:1.25-alpine`
  container rather than assuming it compiles), `go vet` clean.
- `template.yaml`: passes `cfn-lint` (a static AWS-CloudFormation-spec
  validator, no AWS credentials needed) with zero errors/warnings --
  caught and fixed three real issues along the way: a `Description`
  property nested wrong on `EcsTaskRole`, `Database` missing
  `UpdateReplacePolicy` alongside `DeletionPolicy`, and an initially-invalid
  `EngineVersion` (deprecated for new instances -- see the suppression
  comment on that resource for why the final value still isn't guaranteed
  current).

**Not verified, and can't be from here:** this has never been deployed.
`cfn-lint` catches structural/spec-level mistakes, not everything --
IAM permission gaps, actual VPC/subnet compatibility, real AWS quotas, and
whether resources actually stand up together are only provable with a real
`aws cloudformation deploy` against a real account.

## Known application-code gap

`WebappTaskDefinition` passes `SAGEMAKER_ENDPOINT_NAME` as an environment
variable, but `springboot-app`'s `ModelServiceClient.java` only knows how
to call `model-service` over plain HTTP (`MODEL_SERVICE_URL`) -- on AWS
there's no standalone `model-service` ECS task in the target architecture;
`model-service`'s own image *is* the SageMaker Endpoint's serving
container instead (see `model-service/app/main.py`'s docstring on why its
routes are already shaped `/ping` + `/invocations`). Calling SageMaker
Runtime's `InvokeEndpoint` API from Java instead of a REST call is real
application code that doesn't exist yet -- infrastructure alone doesn't
close this gap.
