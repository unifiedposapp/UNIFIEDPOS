# AWS ECS Fargate — multi-region reference

These files are a **starting reference**, not a turnkey stack. They deploy the same
portable image built from the repo-root [`Dockerfile`](../../Dockerfile) onto ECS
Fargate behind an Application Load Balancer, one stack per region.

| File | Purpose |
|---|---|
| `ecs-task-definition.json` | **Web** task (API + SPA). `SCHEDULER_ENABLED=false`, `SKIP_MIGRATIONS=true`. Scale freely. |
| `ecs-task-definition-scheduler.json` | **Scheduler** task. `SCHEDULER_ENABLED=true`. Run **exactly one** per region so background jobs never fire twice. Not behind the ALB. |
| `ecs-service.json` | Web service: Fargate, 2 tasks, ALB target group, deployment circuit-breaker + auto-rollback. |

Placeholders to replace before use (the CD workflow does this automatically):
`<AWS_ACCOUNT_ID>`, `<AWS_REGION>`, `<PRIVATE_SUBNET_*>`, `<APP_SECURITY_GROUP>`,
and the target-group `<SUFFIX>`.

## Topology (per region)

```
Route 53 (latency/geolocation) ─▶ CloudFront + WAF ─▶ ALB (HTTPS, TLS at the edge)
                                                        │
                                          ┌─────────────▼─────────────┐
                                          │ ECS service: web ×2 (Fargate) │  SCHEDULER_ENABLED=false
                                          └─────────────┬─────────────┘
                                          ECS service: scheduler ×1        SCHEDULER_ENABLED=true
                                                        │ Prisma
                                          ┌─────────────▼─────────────┐
                                          │ RDS/Aurora PostgreSQL 16   │ + RDS Proxy (pooler)
                                          │ Multi-AZ, private subnets  │
                                          └────────────────────────────┘
```

Run **one of these stacks per region** (e.g. `us-east-1`, `eu-central-1`,
`ap-northeast-1`), each with its **own database** and its own
`CORS_ORIGIN`/`APP_BASE_URL`. Route tenants to their home region at Route 53 for
data residency. Do not share a single primary DB across regions.

## One-time setup (per region)

1. **ECR repo:** `aws ecr create-repository --repository-name unified-pos --region <AWS_REGION>`
2. **Secrets Manager** — create each secret referenced in the task definitions
   (`unified-pos/prod-DatabaseUrl`, `-JwtSecret`, `-EncryptionKey`, `-CorsOrigin`,
   `-AppBaseUrl`, `-ResendApiKey`, `-MetricsToken`, `-StripeSecretKey`,
   `-StripeWebhookSecret`). Generate secrets:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" # ENCRYPTION_KEY
   ```
   **Back up `ENCRYPTION_KEY` in your DR vault** — losing it makes encrypted
   credential rows permanently unreadable.
3. **IAM roles:**
   - `unified-pos-ecs-execution` — trust `ecs-tasks.amazonaws.com`; attach
     `AmazonECSTaskExecutionRolePolicy` + a policy granting `secretsmanager:GetSecretValue`
     on the `unified-pos/prod-*` secrets and `logs:*` on the CloudWatch group.
   - `unified-pos-ecs-task` — trust `ecs-tasks.amazonaws.com`; grant only what the
     app calls at runtime (e.g. S3 media bucket if enabled).
4. **CloudWatch log group:** `aws logs create-log-group --log-group-name /ecs/unified-pos`
5. **RDS PostgreSQL 16** in private subnets, Multi-AZ, with **RDS Proxy**; put
   `DATABASE_URL` (pointing at the proxy endpoint) in Secrets Manager.
6. **ALB + target group** `unified-pos-web` (HTTP:3001, health check `/api/health`),
   TLS terminated at the ALB or CloudFront; WAF in front.

## Migrations

The task definitions set `SKIP_MIGRATIONS=true`, so migrations do **not** run on
every boot. Apply them from a **one-off task** at deploy time (the CD workflow does
this before updating the services):

```bash
aws ecs run-task --cluster unified-pos --region <AWS_REGION> \
  --task-definition unified-pos-web \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<PRIVATE_SUBNET_1>],securityGroups=[<APP_SECURITY_GROUP>],assignPublicIp=DISABLED}" \
  --overrides '{
    "containerOverrides": [{
      "name": "unified-pos",
      "command": ["node","node_modules/prisma/build/index.js","migrate","deploy","--schema=packages/server/prisma/schema.prisma"],
      "environment": [{"name":"SCHEDULER_ENABLED","value":"false"}]
    }]
  }'
```

Wait for it to reach `STOPPED` with exit code 0 before rolling the services.

## Register / update the services

```bash
# register the (substituted) task definitions
aws ecs register-task-definition --region <AWS_REGION> --cli-input-json file://ecs-task-definition.json
aws ecs register-task-definition --region <AWS_REGION> --cli-input-json file://ecs-task-definition-scheduler.json

# create services (first time)
aws ecs create-service --region <AWS_REGION> --cli-input-json file://ecs-service.json
aws ecs create-service --region <AWS_REGION> --cluster unified-pos \
  --service-name unified-pos-scheduler --task-definition unified-pos-scheduler \
  --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<PRIVATE_SUBNET_1>,<PRIVATE_SUBNET_2>],securityGroups=[<APP_SECURITY_GROUP>],assignPublicIp=DISABLED}"

# roll a new image (deploy): force-new-deployment after pushing :latest (or a pinned tag)
aws ecs update-service --region <AWS_REGION> --cluster unified-pos --service unified-pos-web --force-new-deployment
```

## Notes

- **Graceful shutdown:** the app drains on `SIGTERM`; `stopTimeout: 15` (task) and
  the ALB deregistration delay should both be ≥ 10s.
- **`TRUST_PROXY=1`** is set so `req.ip`/rate-limiting see the real client behind
  the ALB.
- **`STRICT_PROD_CONFIG=true`** makes the container refuse to boot if the
  production configuration review fails (missing email provider, placeholder
  secret, CORS wildcard) — surfacing misconfig in CloudWatch instead of degrading.
- **Stripe webhooks:** point Stripe at the ALB `/api/webhooks/stripe` and ensure no
  proxy buffers/rewrites the request body (the raw body is required for HMAC
  signature verification).
- **Metrics:** scrape `/api/metrics` on **every** web task (counters are
  per-replica) with the `METRICS_TOKEN` bearer; aggregate in Prometheus.
