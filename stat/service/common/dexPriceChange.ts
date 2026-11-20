const BigFixed = require('bigfixed');

export function calculateDexPriceChange24h(currentPrice: number | string, previousPrice: number | string): number | null {
    if (!Number.isFinite(Number(currentPrice)) || Number(currentPrice) <= 0 ||
        !Number.isFinite(Number(previousPrice)) || Number(previousPrice) <= 0) return null;
    const change = BigFixed(String(currentPrice)).sub(BigFixed(String(previousPrice)))
        .div(BigFixed(String(previousPrice))).mul(100).toNumber();
    return Number.isFinite(change) ? change : null;
}
