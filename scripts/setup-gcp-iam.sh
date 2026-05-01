#!/usr/bin/env bash
# setup-gcp-iam.sh — one-shot IAM bootstrap for the CommonOS GCP project.
#
# Run once from any machine that has gcloud authenticated as an Owner/Editor:
#   bash scripts/setup-gcp-iam.sh
#
# Safe to re-run — all operations are idempotent.
#
# Security model:
#   Authorization is enforced by GCP IAM — only the common-os-api service account
#   has container.admin, so no external service can provision GKE resources regardless
#   of network access. Master authorized networks is opened to 0.0.0.0/0 so Cloud Run
#   (which uses dynamic egress IPs) can reach the GKE control plane; the SA credential
#   is what actually gates access.

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-common-os-prod}"
REGION="${GCP_REGION:-europe-west1}"
GKE_CLUSTER="${GKE_CLUSTER:-common-os-agents}"
GCS_BUCKET="${GCS_BUCKET_NAME:-agent-session-state-bucket}"
AR_REPO="common-os"

echo "=== CommonOS GCP IAM Setup ==="
echo "Project : $PROJECT_ID"
echo "Region  : $REGION"
echo ""

# ── Resolve project number ─────────────────────────────────────────────────
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
echo "Project number: $PROJECT_NUMBER"

# ── Service account names ──────────────────────────────────────────────────
API_SA="common-os-api@${PROJECT_ID}.iam.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# ── 1. Enable required GCP APIs ────────────────────────────────────────────
echo ""
echo "1/5  Enabling GCP APIs..."
gcloud services enable \
  container.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project="$PROJECT_ID" \
  --quiet
echo "     APIs enabled."

# ── 2. Create common-os-api service account ───────────────────────────────
echo ""
echo "2/5  Creating common-os-api service account..."
gcloud iam service-accounts create common-os-api \
  --display-name="CommonOS Cloud Run (API + Runner)" \
  --project="$PROJECT_ID" 2>/dev/null \
  && echo "     Created $API_SA" \
  || echo "     $API_SA already exists — skipping."

# ── 3. Grant roles to common-os-api SA (Cloud Run runtime) ────────────────
# This SA is the runtime identity for both common-os-api-prod and
# common-os-runner-prod Cloud Run services.
#
#  container.admin          — list/get GKE cluster + call k8s API (create
#                             namespaces & pods in common-os-agents cluster)
#  storage.admin            — create the agent-session-state-bucket and write
#                             placeholder objects via ensureAgentStorage()
#  secretmanager.accessor   — read MONGODB_URI, PRIVY_APP_SECRET etc.
#  artifactregistry.reader  — (future) pull images from AR if needed at runtime
#  iam.serviceAccountUser   — impersonate other SAs if required
#  logging.logWriter        — write structured logs to Cloud Logging
echo ""
echo "3/5  Granting roles to $API_SA..."
for ROLE in \
  roles/container.admin \
  roles/storage.admin \
  roles/secretmanager.secretAccessor \
  roles/artifactregistry.reader \
  roles/iam.serviceAccountUser \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$API_SA" \
    --role="$ROLE" \
    --condition=None \
    --quiet
  echo "     ✓ $ROLE"
done

# ── 4. Grant roles to default compute SA (GKE node pool) ──────────────────
echo ""
echo "4/5  Granting roles to $COMPUTE_SA (GKE node pool)..."
for ROLE in \
  roles/storage.objectAdmin \
  roles/artifactregistry.reader \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$COMPUTE_SA" \
    --role="$ROLE" \
    --condition=None \
    --quiet
  echo "     ✓ $ROLE"
done

# ── 5. Grant roles to Cloud Build SA ─────────────────────────────────────
echo ""
echo "5/5  Granting roles to $CLOUDBUILD_SA (Cloud Build)..."
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$CLOUDBUILD_SA" \
    --role="$ROLE" \
    --condition=None \
    --quiet
  echo "     ✓ $ROLE"
done

# ── GKE master authorized networks ────────────────────────────────────────
# Cloud Run uses dynamic egress IPs, so we open the GKE control plane endpoint
# to all IPs. Authorization is enforced by IAM — the SA credential is the actual
# gate, not the network. Anyone reaching the endpoint without a valid token gets 401.
echo ""
echo "Unlocking GKE master authorized networks..."
if gcloud container clusters describe "$GKE_CLUSTER" \
    --region="$REGION" --project="$PROJECT_ID" --quiet 2>/dev/null; then
  gcloud container clusters update "$GKE_CLUSTER" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --enable-master-authorized-networks \
    --master-authorized-networks=0.0.0.0/0 \
    --quiet
  echo "     ✓ Master authorized networks set to 0.0.0.0/0"
else
  echo "     GKE cluster $GKE_CLUSTER not found — skipping (cluster created on first agent provision)"
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "=== IAM setup complete ==="
echo ""
echo "Next steps (if not already done):"
echo "  1. Trigger a Cloud Build for apps/api and apps/runner so Cloud Run"
echo "     revisions are redeployed with --service-account=$API_SA"
echo "     (both cloudbuild.yaml files now include this flag)."
echo ""
echo "  2. Ensure the Artifact Registry repository exists:"
echo "     gcloud artifacts repositories create $AR_REPO \\"
echo "       --repository-format=docker \\"
echo "       --location=$REGION \\"
echo "       --project=$PROJECT_ID"
echo ""
echo "  3. Set Secret Manager secrets (if using secret refs in Cloud Run):"
echo "     gcloud secrets create MONGODB_URI --project=$PROJECT_ID"
echo "     gcloud secrets create PRIVY_APP_SECRET --project=$PROJECT_ID"
echo "     (then add a version for each with the actual value)"
