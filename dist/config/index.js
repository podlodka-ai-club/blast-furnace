function parsePort(value, defaultVal) {
    const parsed = parseInt(value ?? String(defaultVal), 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
        return defaultVal;
    }
    return parsed;
}
function loadConfig() {
    return {
        env: process.env['NODE_ENV'] ?? 'development',
        port: parsePort(process.env['PORT'], 3000),
        redis: {
            host: process.env['REDIS_HOST'] ?? 'localhost',
            port: parsePort(process.env['REDIS_PORT'], 6379),
            password: process.env['REDIS_PASSWORD'] || undefined,
        },
        github: {
            token: process.env['GITHUB_TOKEN'] ?? '',
            owner: process.env['GITHUB_OWNER'] ?? '',
            repo: process.env['GITHUB_REPO'] ?? '',
        },
    };
}
export const config = loadConfig();
