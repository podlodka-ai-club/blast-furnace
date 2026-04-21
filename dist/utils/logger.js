function formatLogEntry(level, message, context) {
    return {
        timestamp: new Date().toISOString(),
        level,
        message,
        context,
    };
}
function logToConsole(entry) {
    const formatted = JSON.stringify(entry);
    switch (entry.level) {
        case 'debug':
            console.debug(formatted);
            break;
        case 'info':
            console.info(formatted);
            break;
        case 'warn':
            console.warn(formatted);
            break;
        case 'error':
            console.error(formatted);
            break;
    }
}
function mergeContext(defaultContext, context) {
    if (!defaultContext && !context)
        return undefined;
    return { ...defaultContext, ...context };
}
export function createLogger(defaultContext) {
    return {
        debug(message, context) {
            const entry = formatLogEntry('debug', message, mergeContext(defaultContext, context));
            logToConsole(entry);
        },
        info(message, context) {
            const entry = formatLogEntry('info', message, mergeContext(defaultContext, context));
            logToConsole(entry);
        },
        warn(message, context) {
            const entry = formatLogEntry('warn', message, mergeContext(defaultContext, context));
            logToConsole(entry);
        },
        error(message, context) {
            const entry = formatLogEntry('error', message, mergeContext(defaultContext, context));
            logToConsole(entry);
        },
    };
}
export const logger = createLogger();
