import {calculateDexPriceChange24h} from './dexPriceChange';

const superagent = require('superagent');
const {ProxyAgent} = require('proxy-agent');
const BigFixed = require('bigfixed');

const BLOCKS_URL = 'https://graphql.swappi.io/subgraphs/name/blocklytics/ethereum-blocks';
const SWAPPI_URL = 'https://graphql.swappi.io/subgraphs/name/swappi-dex/swappi-r2';
const DAY_SECONDS = 24 * 60 * 60;
const MAX_INDEX_LAG_SECONDS = 30 * 60;
const BATCH_SIZE = 100;
const TIMEOUT = {response: 13_000, deadline: 13_000};

const BLOCK_QUERY = `query($from: Int!, $to: Int!) {
    blocks(first: 1, orderBy: timestamp, orderDirection: asc,
        where: {timestamp_gt: $from, timestamp_lt: $to}) { number timestamp }
}`;

const PRICE_QUERY = `query($ids: [ID!]!, $block: Int!) {
    current: tokens(first: 1000, where: {id_in: $ids}) { id derivedETH }
    previous: tokens(first: 1000, where: {id_in: $ids}, block: {number: $block}) { id derivedETH }
    currentBundle: bundles(where: {id: "1"}) { ethPrice }
    previousBundle: bundles(where: {id: "1"}, block: {number: $block}) { ethPrice }
    _meta { block { timestamp } }
}`;

async function queryGraph(url: string, query: string, variables: object): Promise<any> {
    const request = superagent.post(url).send({query, variables}).timeout(TIMEOUT);
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxyUrl) request.agent(new ProxyAgent({getProxyForUrl: () => proxyUrl}));
    const response = await request;
    if (response.body?.errors?.length || !response.body?.data) {
        throw new Error(`Swappi subgraph query failed: ${JSON.stringify(response.body?.errors || response.body)}`);
    }
    return response.body.data;
}

function usdPrice(derivedETH: string, ethPrice: string): string | null {
    if (!Number.isFinite(Number(derivedETH)) || Number(derivedETH) <= 0 ||
        !Number.isFinite(Number(ethPrice)) || Number(ethPrice) <= 0) return null;
    return BigFixed(derivedETH).mul(BigFixed(ethPrice)).toString();
}

// The Swappi Analytics page calculates its displayed change from these same subgraph fields.
export async function getSwappiPriceChanges(addresses: string[]): Promise<Record<string, number>> {
    if (!addresses.length) return {};
    const now = Math.floor(Date.now() / 1000);
    const from = now - DAY_SECONDS;
    const blockData = await queryGraph(BLOCKS_URL, BLOCK_QUERY, {from, to: from + 600});
    const block = Number(blockData.blocks?.[0]?.number);
    if (!Number.isSafeInteger(block) || block <= 0) throw new Error('Swappi 24-hour block unavailable');

    const changes: Record<string, number> = {};
    const ids = [...new Set(addresses.map(address => address.toLowerCase()))];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const data = await queryGraph(SWAPPI_URL, PRICE_QUERY, {ids: ids.slice(i, i + BATCH_SIZE), block});
        const indexedAt = Number(data._meta?.block?.timestamp);
        if (!Number.isFinite(indexedAt) || now - indexedAt > MAX_INDEX_LAG_SECONDS) {
            throw new Error('Swappi price subgraph is stale');
        }
        const currentETH = data.currentBundle?.[0]?.ethPrice;
        const previousETH = data.previousBundle?.[0]?.ethPrice;
        const previous = new Map((data.previous || []).map(token => [token.id.toLowerCase(), token.derivedETH]));
        for (const token of data.current || []) {
            const id = token.id.toLowerCase();
            const currentUSD = usdPrice(token.derivedETH, currentETH);
            const previousUSD = usdPrice(previous.get(id) as string, previousETH);
            if (!currentUSD || !previousUSD) continue;
            const change = calculateDexPriceChange24h(currentUSD, previousUSD);
            if (change !== null) changes[id] = change;
        }
    }
    return changes;
}
