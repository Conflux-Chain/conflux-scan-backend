import {ConfigInstance} from '../../config/StatConfig';
import {KEY_BJ_DISABLE_PROXY, KEY_BJ_PROXY_URL, KV} from '../../model/KV';

const DEFAULT_BJ_PROXY = 'http://127.0.0.1:1080';

// One outbound proxy choice for all BJ jobs that request external HTTP data.
export async function getBjProxyUrl(): Promise<string | null> {
    if (!ConfigInstance?.serverTag?.includes('bj') || await KV.getSwitch(KEY_BJ_DISABLE_PROXY)) {
        return null;
    }
    return KV.getString(KEY_BJ_PROXY_URL,
        process.env.HTTPS_PROXY || process.env.HTTP_PROXY || DEFAULT_BJ_PROXY);
}
