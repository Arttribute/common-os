export const AWS_COMMONOS_API_URL =
  'https://co-34acbf16a9a0464c8be79137d4f7bbd6.ecs.eu-west-1.on.aws';

const STALE_API_HOSTS = ['run.app', 'common-os-api-prod'];

export function getCommonOsApiUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '');

  if (!configured) return AWS_COMMONOS_API_URL;
  if (STALE_API_HOSTS.some((host) => configured.includes(host))) {
    return AWS_COMMONOS_API_URL;
  }

  return configured;
}
