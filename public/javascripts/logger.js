/* public/javascripts/logger.js */
/**
 * Production-safe logger
 * - Development: Shows all logs
 * - Production: Hides sensitive logs, keeps only errors
 */

const isDevelopment = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname.includes('dev') ||
                      window.location.hostname.includes('staging');

export const logger = {
    /**
     * Debug logs - only in development
     */
    debug: (...args) => {
        if (isDevelopment) {
            console.log(...args);
        }
    },

    /**
     * Info logs - only in development
     */
    info: (...args) => {
        if (isDevelopment) {
            console.info(...args);
        }
    },

    /**
     * Warning logs - always show
     */
    warn: (...args) => {
        console.warn(...args);
    },

    /**
     * Error logs - always show
     */
    error: (...args) => {
        console.error(...args);
    },

    /**
     * Success logs - only in development
     */
    success: (...args) => {
        if (isDevelopment) {
            console.log('%c' + args[0], 'color: #4CAF50; font-weight: bold', ...args.slice(1));
        }
    },

    /**
     * Group logs - only in development
     */
    group: (label, fn) => {
        if (isDevelopment) {
            console.group(label);
            fn();
            console.groupEnd();
        }
    }
};

// Alternative: Override console globally (more aggressive)
export function disableConsoleLogs() {
    if (!isDevelopment) {
        const noop = () => {};
        console.log = noop;
        console.debug = noop;
        console.info = noop;
        // Keep console.warn and console.error
    }
}

// Auto-detect and disable if in production
if (!isDevelopment) {
    console.log = () => {};
    console.debug = () => {};
    console.info = () => {};
    // Errors and warnings still show
}

console.log('🔧 Logger initialized - Environment:', isDevelopment ? 'Development' : 'Production');