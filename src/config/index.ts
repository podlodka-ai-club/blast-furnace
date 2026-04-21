interface Config {
  env: string;
  port: number;
  redis: {
    host: string;
    port: number;
  };
  github: {
    token: string;
    owner: string;
    repo: string;
  };
}

function loadConfig(): Config {
  return {
    env: process.env['NODE_ENV'] ?? 'development',
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    redis: {
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    },
    github: {
      token: process.env['GITHUB_TOKEN'] ?? '',
      owner: process.env['GITHUB_OWNER'] ?? '',
      repo: process.env['GITHUB_REPO'] ?? '',
    },
  };
}

export const config = loadConfig();
export type { Config };
