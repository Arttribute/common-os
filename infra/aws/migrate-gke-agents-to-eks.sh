#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
: "${GKE_CONTEXT:?Set GKE_CONTEXT to the source kubectl context}"
: "${EKS_CONTEXT:?Set EKS_CONTEXT to the target kubectl context}"

MIGRATION_DIR="${MIGRATION_DIR:-/tmp/common-os-gke-to-eks}"
PODS_JSON="$MIGRATION_DIR/pods.json"
NAMESPACES_JSON="$MIGRATION_DIR/namespaces.json"
mkdir -p "$MIGRATION_DIR"
chmod 700 "$MIGRATION_DIR"

source_kubectl() { kubectl --context "$GKE_CONTEXT" "$@"; }
target_kubectl() { kubectl --context "$EKS_CONTEXT" "$@"; }
aws_cli() {
  if [[ -d /opt/homebrew/opt/expat/lib ]]; then
    DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib aws "$@"
  else
    aws "$@"
  fi
}

snapshot() {
  local selector="managed-by=common-os"
  if [[ -n "${FLEET_ID:-}" ]]; then
    selector="${selector},fleet-id=${FLEET_ID}"
  fi
  source_kubectl get namespaces -l "$selector" -o json > "$NAMESPACES_JSON"
  if [[ $(jq '.items | length' "$NAMESPACES_JSON") -eq 0 ]]; then
    echo "No source namespaces matched selector: $selector" >&2
    exit 1
  fi
  printf '{"apiVersion":"v1","kind":"List","items":[' > "$PODS_JSON"
  first=true
  while IFS= read -r namespace; do
    pod=$(source_kubectl get pods -n "$namespace" -l managed-by=common-os -o json | jq -c '.items[]')
    [[ -n "$pod" ]] || continue
    $first || printf ',' >> "$PODS_JSON"
    printf '%s' "$pod" >> "$PODS_JSON"
    first=false
  done < <(jq -r '.items[].metadata.name' "$NAMESPACES_JSON")
  printf ']}' >> "$PODS_JSON"
  chmod 600 "$PODS_JSON" "$NAMESPACES_JSON"
}

require_snapshot() {
  test -s "$PODS_JSON" && test -s "$NAMESPACES_JSON" || {
    echo "Migration snapshot is missing; run stage first." >&2
    exit 1
  }
}

stage() {
  : "${EFS_FILE_SYSTEM_ID:?Set EFS_FILE_SYSTEM_ID}"
  snapshot

  sed "s/EFS_FILE_SYSTEM_ID/$EFS_FILE_SYSTEM_ID/g" \
    "$(dirname "$0")/eks-storage-class.yml" | target_kubectl apply -f -

  jq -c '.items[] | select(.metadata.name as $ns | $pods[0].items | any(.metadata.namespace == $ns)) |
    {apiVersion:"v1",kind:"Namespace",metadata:{name:.metadata.name,labels:.metadata.labels}}' \
    --slurpfile pods "$PODS_JSON" "$NAMESPACES_JSON" |
  while IFS= read -r namespace; do
    printf '%s\n' "$namespace" | target_kubectl apply -f -
  done

  jq -r '.items[].metadata.namespace' "$PODS_JSON" | sort -u |
  while IFS= read -r namespace; do
    cat <<YAML | target_kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: agent-storage
  namespace: $namespace
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 5Gi
  storageClassName: common-os-efs
---
apiVersion: v1
kind: Pod
metadata:
  name: workspace-migration
  namespace: $namespace
  labels:
    managed-by: common-os-migration
spec:
  restartPolicy: Always
  containers:
    - name: migration
      image: public.ecr.aws/docker/library/alpine:3.20
      command: ["sh", "-c", "sleep 86400"]
      volumeMounts:
        - name: agent-storage
          mountPath: /mnt/shared
  volumes:
    - name: agent-storage
      persistentVolumeClaim:
        claimName: agent-storage
YAML
  done

  target_kubectl wait --for=condition=Ready pods -A -l managed-by=common-os-migration --timeout=20m
}

copy_workspaces() {
  : "${MIGRATION_BUCKET:?Set MIGRATION_BUCKET to the temporary S3 transfer bucket}"
  require_snapshot
  while IFS=$'\t' read -r namespace pod; do
    echo "Copying $namespace"
    archive="$MIGRATION_DIR/${namespace}.tar.gz"
    if ! gzip -t "$archive" 2>/dev/null; then
      rm -f "$archive"
      for attempt in 1 2 3; do
        if source_kubectl exec -n "$namespace" "$pod" -c agent -- \
            tar -C /mnt/shared -czf - . > "$archive" && gzip -t "$archive"; then
          break
        fi
        rm -f "$archive"
        echo "Download attempt $attempt failed for $namespace; retrying..." >&2
        sleep $((attempt * 5))
      done
    fi
    gzip -t "$archive" || { echo "Workspace download failed for $namespace." >&2; exit 1; }

    object_key="common-os/migration/${namespace}.tar.gz"
    aws_cli s3 cp "$archive" "s3://${MIGRATION_BUCKET}/${object_key}" --region eu-west-1 --only-show-errors
    download_url=$(aws_cli s3 presign "s3://${MIGRATION_BUCKET}/${object_key}" --region eu-west-1 --expires-in 3600)
    target_kubectl exec -n "$namespace" workspace-migration -c migration -- \
      sh -c 'rm -f /tmp/migration-complete /tmp/migration-failed; nohup sh -c '\''wget -q -O /tmp/workspace.tar.gz "$1" && gzip -t /tmp/workspace.tar.gz && tar -C /mnt/shared -xzf /tmp/workspace.tar.gz && rm -f /tmp/workspace.tar.gz && touch /tmp/migration-complete || touch /tmp/migration-failed'\'' sh "$1" >/tmp/migration.log 2>&1 </dev/null &' sh "$download_url"

    completed=false
    for _ in $(seq 1 360); do
      state=$(target_kubectl exec -n "$namespace" workspace-migration -c migration -- \
        sh -c 'if [ -f /tmp/migration-complete ]; then echo complete; elif [ -f /tmp/migration-failed ]; then echo failed; else echo running; fi')
      if [[ "$state" == "complete" ]]; then
        completed=true
        break
      fi
      if [[ "$state" == "failed" ]]; then
        target_kubectl exec -n "$namespace" workspace-migration -c migration -- cat /tmp/migration.log >&2 || true
        break
      fi
      sleep 5
    done
    $completed || { echo "Workspace extraction failed for $namespace." >&2; exit 1; }
    aws_cli s3 rm "s3://${MIGRATION_BUCKET}/${object_key}" --region eu-west-1 --only-show-errors
    rm -f "$archive"
  done < <(jq -r '.items[] | [.metadata.namespace,.metadata.name] | @tsv' "$PODS_JSON")
}

render_target_pods() {
  require_snapshot
  jq -c \
    --arg image "$AGENT_IMAGE_URL" \
    --arg api "$API_URL" \
    --arg runner "$RUNNER_URL" '
    .items[] |
    {
      apiVersion:"v1",
      kind:"Pod",
      metadata:{
        name:.metadata.name,
        namespace:.metadata.namespace,
        labels:(.metadata.labels | del(."topology.kubernetes.io/region", ."topology.kubernetes.io/zone")),
        annotations:(.metadata.annotations // {})
      },
      spec:{
        restartPolicy:"Always",
        containers:(.spec.containers | map(
          if .name == "agent" then .image = $image else . end |
          .env = ((.env // []) | map(
            if .name == "API_URL" then .value = $api
            elif .name == "RUNNER_URL" then .value = $runner
            else . end
          )) |
          .volumeMounts = ((.volumeMounts // []) | map(select(.name == "agent-storage")))
        )),
        volumes:[{name:"agent-storage",persistentVolumeClaim:{claimName:"agent-storage"}}]
      }
    }' "$PODS_JSON"
}

cutover() {
  : "${AGENT_IMAGE_URL:?Set AGENT_IMAGE_URL to the ECR agent image}"
  : "${API_URL:?Set API_URL to the AWS CommonOS API endpoint}"
  : "${RUNNER_URL:?Set RUNNER_URL to the AWS CommonOS runner endpoint}"
  : "${MONGODB_URI:?Set MONGODB_URI for the CommonOS production database}"
  require_snapshot
  copy_workspaces
  source_selector="managed-by=common-os"
  if [[ -n "${FLEET_ID:-}" ]]; then
    source_selector="${source_selector},fleet-id=${FLEET_ID}"
  fi
  while IFS= read -r namespace; do
    source_kubectl delete pod -n "$namespace" -l managed-by=common-os --wait=true --timeout=10m
  done < <(jq -r '.items[].metadata.namespace' "$PODS_JSON" | sort -u)
  target_kubectl delete pods -A -l managed-by=common-os-migration --wait=true --timeout=10m

  render_target_pods |
  while IFS= read -r pod; do
    printf '%s\n' "$pod" | target_kubectl apply -f -
  done

  target_kubectl wait --for=condition=Ready pods -A -l managed-by=common-os --timeout=30m

  expected=$(jq '.items | length' "$PODS_JSON")
  actual=$(target_kubectl get pods -A -l managed-by=common-os -o json | jq '[.items[] | select(.status.phase == "Running")] | length')
  test "$actual" -eq "$expected" || {
    echo "EKS verification failed: expected $expected running pods, found $actual" >&2
    exit 1
  }

  RETAIN_FLEET_ID="${FLEET_ID:-}" node "$(dirname "$0")/update-agent-provider.mjs" "$PODS_JSON" eu-west-1
  source_kubectl delete namespaces -l "$source_selector" --wait=false
  echo "Cutover complete: $actual agent pods are running on EKS."
}

case "$MODE" in
  stage) stage ;;
  copy) copy_workspaces ;;
  cutover) cutover ;;
  *) echo "Usage: $0 {stage|copy|cutover}" >&2; exit 2 ;;
esac
