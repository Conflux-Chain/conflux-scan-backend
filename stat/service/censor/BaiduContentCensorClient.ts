type BaiduTokenResponse = {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
};

type BaiduCensorResponse = {
    conclusionType?: number;
    error_code?: number;
    error_msg?: string;
    [key: string]: unknown;
};

const API_BASE_URL = 'https://aip.baidubce.com';
const TOKEN_URL = `${API_BASE_URL}/oauth/2.0/token`;
const TEXT_CENSOR_PATH = '/rest/2.0/solution/v1/text_censor/v2/user_defined';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class BaiduContentCensorClient {
    private accessToken?: string;
    private tokenExpiresAt = 0;
    private tokenRequest?: Promise<string>;

    constructor(
        private readonly appId: string,
        private readonly apiKey: string,
        private readonly secretKey: string,
        private readonly timeoutMs = 3000,
    ) {
        // appId is accepted for compatibility with baidu-aip-sdk. The OAuth
        // client-credentials flow authenticates with apiKey and secretKey.
        void this.appId;
    }

    async textCensorUserDefined(text: string): Promise<BaiduCensorResponse> {
        const accessToken = await this.getAccessToken();
        const body = new URLSearchParams({text});
        const result = await this.request<BaiduCensorResponse>(
            `${API_BASE_URL}${TEXT_CENSOR_PATH}?access_token=${encodeURIComponent(accessToken)}`,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body,
            },
        );

        if (result.error_code === 110 || result.error_code === 111) {
            this.invalidateAccessToken(accessToken);
        }

        return result;
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
            return this.accessToken;
        }

        if (!this.tokenRequest) {
            this.tokenRequest = this.fetchAccessToken().finally(() => {
                this.tokenRequest = undefined;
            });
        }

        return this.tokenRequest;
    }

    private async fetchAccessToken(): Promise<string> {
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.apiKey,
            client_secret: this.secretKey,
        });
        const result = await this.request<BaiduTokenResponse>(TOKEN_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body,
        });

        if (!result.access_token) {
            throw new Error(
                `Baidu access token request failed: ${result.error_description || result.error || 'missing access_token'}`,
            );
        }

        this.accessToken = result.access_token;
        this.tokenExpiresAt = Date.now() + Math.max(result.expires_in || 0, 0) * 1000;
        return result.access_token;
    }

    private invalidateAccessToken(token: string): void {
        if (this.accessToken === token) {
            this.accessToken = undefined;
            this.tokenExpiresAt = 0;
        }
    }

    private async request<T>(url: string, init: RequestInit): Promise<T> {
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout>;
        const requestPromise = (async () => {
            const response = await fetch(url, {...init, signal: controller.signal});
            const text = await response.text();
            let result: T;

            try {
                result = JSON.parse(text) as T;
            } catch {
                throw new Error(`Baidu censor returned invalid JSON (HTTP ${response.status})`);
            }

            if (!response.ok) {
                throw new Error(`Baidu censor request failed with HTTP ${response.status}`);
            }

            return result;
        })();
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
                controller.abort();
                reject(new Error(`Baidu censor request timed out after ${this.timeoutMs}ms`));
            }, this.timeoutMs);
        });

        try {
            return await Promise.race([requestPromise, timeoutPromise]);
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(`Baidu censor request timed out after ${this.timeoutMs}ms`);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }
}
