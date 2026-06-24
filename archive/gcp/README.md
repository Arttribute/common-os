# Archived Google Cloud deployment

CommonOS production moved completely to AWS in June 2026.

The former Cloud Build, Cloud Run, GKE, and IAM bootstrap files are retained
here for historical and recovery reference only. Nothing in this directory
may be connected to an automatic build or deployment trigger.

Current deployment paths:

- API: `.github/workflows/deploy-aws.yml`
- Agent image: `.github/workflows/agent.yml`
- Runner image: `.github/workflows/runner.yml`
