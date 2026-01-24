# ECS Deployment Guide for BookPlayer API

## Quick Reference

| Resource | Value |
|----------|-------|
| **Cluster** | `bookplayer-cluster` |
| **Service** | `bookplayer-api` |
| **ECR Repository** | `327317202676.dkr.ecr.us-east-1.amazonaws.com/bookplayer-api` |
| **Endpoint** | `https://api.bookplayer.app` |
| **Architecture** | ARM64 (Fargate) |

---

## Deployment

### GitHub Actions (Recommended)

The repository uses a GitOps workflow where `docker/ecs/task-definition.json` is the source of truth.

**To deploy:**

1. Go to [GitHub Actions](https://github.com/user/bookplayer-api/actions)
2. Select **"Deploy to ECS"** workflow
3. Click **"Run workflow"** → Select `production` → **"Run workflow"**

The workflow will:
- Build the Docker image for ARM64
- Push to ECR with commit SHA tag
- Register a new task definition revision (from `task-definition.json`)
- Deploy to ECS with rolling update
- Wait for service stability

**Build time:** ~5-7 minutes (ARM64 cross-compilation via QEMU)

### Manual Deployment

For emergencies or debugging, you can deploy manually:

```bash
# 1. Authenticate to ECR (valid for 12 hours)
aws ecr get-login-password --region us-east-1 --profile bookplayer | \
  docker login --username AWS --password-stdin 327317202676.dkr.ecr.us-east-1.amazonaws.com

# 2. Build and push
yarn build && \
docker build --no-cache --platform linux/arm64 -f docker/Dockerfile \
  -t 327317202676.dkr.ecr.us-east-1.amazonaws.com/bookplayer-api:latest . && \
docker push 327317202676.dkr.ecr.us-east-1.amazonaws.com/bookplayer-api:latest

# 3. Register task definition (if changed)
aws ecs register-task-definition \
  --cli-input-json file://docker/ecs/task-definition.json \
  --profile bookplayer

# 4. Deploy
aws ecs update-service \
  --cluster bookplayer-cluster \
  --service bookplayer-api \
  --force-new-deployment \
  --profile bookplayer
```

---

## Adding Environment Variables

Since we use GitOps, adding a new environment variable requires two steps:

### 1. Add to AWS Secrets Manager

```bash
# Get current secret, add new key, update
aws secretsmanager get-secret-value \
  --secret-id prod/bookplayer-api \
  --profile bookplayer \
  --query SecretString --output text | \
  jq '. + {"NEW_VARIABLE": "value"}' | \
  aws secretsmanager put-secret-value \
    --secret-id prod/bookplayer-api \
    --secret-string "$(cat -)" \
    --profile bookplayer
```

### 2. Add to task-definition.json

Edit `docker/ecs/task-definition.json`:

```json
"secrets": [
  // ... existing secrets ...
  {
    "name": "NEW_VARIABLE",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:327317202676:secret:prod/bookplayer-api:NEW_VARIABLE::"
  }
]
```

### 3. Deploy

Commit, push, and run the GitHub Actions workflow. The new task definition will be registered automatically.

---

## Monitoring

### Check deployment status

```bash
aws ecs describe-services \
  --cluster bookplayer-cluster \
  --services bookplayer-api \
  --profile bookplayer \
  --query 'services[0].deployments[*].{status:status,running:runningCount,desired:desiredCount,taskDef:taskDefinition}' \
  --output table
```

### View logs

```bash
# Follow logs in real-time
aws logs tail /ecs/bookplayer-api --profile bookplayer --follow

# View last 30 minutes
aws logs tail /ecs/bookplayer-api --profile bookplayer --since 30m
```

### Check service events

```bash
aws ecs describe-services \
  --cluster bookplayer-cluster \
  --services bookplayer-api \
  --profile bookplayer \
  --query 'services[0].events[0:5].[createdAt,message]' \
  --output text
```

### Health check

```bash
curl https://api.bookplayer.app/v1/status
# Expected: OK
```

---

## Rollback

### Option 1: Redeploy previous commit

```bash
# Find the commit you want to rollback to
git log --oneline -10

# Checkout and deploy
git checkout <commit-sha>
# Run GitHub Actions workflow
```

### Option 2: Use previous ECR image

```bash
# List recent images
aws ecr describe-images \
  --repository-name bookplayer-api \
  --profile bookplayer \
  --query 'imageDetails | sort_by(@, &imagePushedAt) | [-5:].{pushedAt:imagePushedAt,tags:imageTags}' \
  --output table

# Update service to use specific image tag
# (Edit task-definition.json with the old image tag and deploy)
```

### Option 3: ECS rollback (if deployment fails)

ECS automatically rolls back if health checks fail during deployment (maintains minimum healthy percent).

---

## Infrastructure Configuration

### Current Setup

| Component | Configuration |
|-----------|---------------|
| CPU | 0.25 vCPU (256 units) |
| Memory | 512 MB |
| Architecture | ARM64 |
| Desired Count | 2 |
| Min Healthy | 100% |
| Max | 200% |

### Cost Estimate

| Configuration | Monthly Cost |
|---------------|--------------|
| 2x tasks (0.25 vCPU, 512MB ARM) | ~$18 |

---

## Initial Setup (One-time)

> **Note:** This section is for reference. The infrastructure is already set up.

### Prerequisites

1. **ECR Repository**
```bash
aws ecr create-repository \
  --repository-name bookplayer-api \
  --image-scanning-configuration scanOnPush=true \
  --profile bookplayer
```

2. **Secrets Manager Secret**
```bash
aws secretsmanager create-secret \
  --name prod/bookplayer-api \
  --secret-string '{"DB_HOST": "...", "DB_USER": "...", ...}' \
  --profile bookplayer
```

3. **IAM Roles**
- `ecsTaskExecutionRole` - For ECS to pull images and secrets
- `bookplayer-api-task-role` - For the application to access S3, SES, etc.

4. **ECS Cluster**
```bash
aws ecs create-cluster \
  --cluster-name bookplayer-cluster \
  --capacity-providers FARGATE \
  --profile bookplayer
```

5. **ECS Service**
```bash
aws ecs create-service \
  --cluster bookplayer-cluster \
  --service-name bookplayer-api \
  --task-definition bookplayer-api \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration '...' \
  --load-balancers '...' \
  --profile bookplayer
```

---

## Troubleshooting

### Task failing health checks

```bash
# Check target group health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:327317202676:targetgroup/bp-api-group/049aa891f4dddb51 \
  --profile bookplayer
```

### Container won't start

```bash
# Check stopped task reason
aws ecs describe-tasks \
  --cluster bookplayer-cluster \
  --tasks $(aws ecs list-tasks --cluster bookplayer-cluster --service-name bookplayer-api --desired-status STOPPED --query 'taskArns[0]' --output text --profile bookplayer) \
  --profile bookplayer \
  --query 'tasks[0].{reason:stoppedReason,container:containers[0].reason}'
```

### Secrets not loading

Verify the execution role has permission to read secrets:
```bash
aws secretsmanager get-secret-value \
  --secret-id prod/bookplayer-api \
  --profile bookplayer
```

### ECR login expired

```bash
# Re-authenticate (valid for 12 hours)
aws ecr get-login-password --region us-east-1 --profile bookplayer | \
  docker login --username AWS --password-stdin 327317202676.dkr.ecr.us-east-1.amazonaws.com
```
