import {QuoteOptions} from "../../config/StatConfig";

const PEER_URLS = {
    1029: 'https://www.confluxscan.org',
    1030: 'https://evm.confluxscan.org',
};

export function getPricePeerUrl(quote: QuoteOptions, serverTag: string, networkId: number): string | null {
    if (!quote?.enable || !serverTag?.includes('bj')) {
        return null;
    }
    return PEER_URLS[networkId] || null;
}
