#!/usr/bin/env bash
set -euo pipefail

WITH_PUBLIC_URLS=false
if [[ "${1:-}" == "--with-public-urls" ]]; then
  WITH_PUBLIC_URLS=true
fi

STACK_NAME="${STACK_NAME:-common-os-services}"

aws_cli() {
  if [[ -d /opt/homebrew/opt/expat/lib ]]; then
    DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib aws "$@"
  else
    aws "$@"
  fi
}

wait_for_stack() {
  local status
  for _ in $(seq 1 90); do
    status="$(aws_cli cloudformation describe-stacks \
      --stack-name "$STACK_NAME" \
      --query 'Stacks[0].StackStatus' \
      --output text \
      --region "$AWS_REGION")"
    echo "stack_status=$status"
    case "$status" in
      CREATE_COMPLETE|UPDATE_COMPLETE)
        return 0
        ;;
      *ROLLBACK*|*FAILED|DELETE_*)
        return 1
        ;;
    esac
    sleep 10
  done
  return 1
}

deploy_args=(
  cloudformation deploy
  --stack-name "$STACK_NAME"
  --template-file infra/aws/ecs-express-services.yml
  --parameter-overrides
  "ApiImageUri=$API_IMAGE"
  "RunnerImageUri=$RUNNER_IMAGE"
  "AgentImageUri=$AGENT_IMAGE"
  "ExecutionRoleArn=$TASK_EXECUTION_ROLE_ARN"
  "InfrastructureRoleArn=$INFRASTRUCTURE_ROLE_ARN"
  "ApiTaskRoleArn=$API_TASK_ROLE_ARN"
  "RuntimeSecretArn=$RUNTIME_SECRET_ARN"
  "EksClusterName=$EKS_CLUSTER"
  "EfsFileSystemId=$EFS_FILE_SYSTEM_ID"
)

if [[ "$WITH_PUBLIC_URLS" == true ]]; then
  : "${API_ENDPOINT:?API_ENDPOINT is required with --with-public-urls}"
  : "${RUNNER_ENDPOINT:?RUNNER_ENDPOINT is required with --with-public-urls}"
  deploy_args+=(
    "ApiPublicUrl=$API_ENDPOINT"
    "RunnerPublicUrl=$RUNNER_ENDPOINT"
  )
fi

deploy_args+=(--region "$AWS_REGION")

log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

set +e
aws_cli "${deploy_args[@]}" 2>&1 | tee "$log_file"
status="${PIPESTATUS[0]}"
set -e

if [[ "$status" -eq 0 ]]; then
  exit 0
fi

if grep -Eq 'InvalidChangeSetStatus|OBSOLETE|UPDATE_IN_PROGRESS' "$log_file"; then
  echo "CloudFormation deploy hit a transient changeset/update race; waiting for $STACK_NAME to settle..."
  wait_for_stack
  exit $?
fi

exit "$status"
