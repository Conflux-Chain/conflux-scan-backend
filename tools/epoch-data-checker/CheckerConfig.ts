import {loadConfig, StatConfig} from '../../stat/config/StatConfig';

export function loadCheckerConfig(): StatConfig {
    // Keep the same config precedence as the stat containers.  The checker does
    // not create or start any container; it only reuses their RPC and DB config.
    return loadConfig('Prod');
}
