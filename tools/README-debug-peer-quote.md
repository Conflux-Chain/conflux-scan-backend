# Peer token quote diagnostics

Run this in the `stat_task` container so it sees the same `Prod.js`, database,
environment variables, and local proxy as the scheduled job:

```bash
docker compose exec -T stat_task npm run debug:peer-quote -- --network-id 1030 2>&1 | tee peer-quote-debug.log
```

The tool reads `KEY_BJ_DISABLE_PROXY` and `KEY_BJ_PROXY_URL` from
the KV table, selects the same tokens as `TokenQuoteSync`, and sends one read-only
`/v1/token` request. It prints the chosen proxy source and address, peer DNS
result, proxy TCP reachability, request and response milestones, elapsed time,
and error code/status/timeout details. Proxy credentials are masked in its own
logs and library proxy debug output is disabled when credentials are present.
It does not update token prices or send alerts.

To test a specific token without querying the token table:

```bash
docker compose exec stat_task npm run debug:peer-quote -- --network-id 1030 --address 'net1030:...'
```

For an isolated network test without DB access, provide an address and
`--skip-db`. You can also override the proxy with `--proxy-url URL`, or force a
direct request with `--no-proxy`. Those options only affect the diagnostic run.

The tool exits with status 0 when the peer responds with a token list, and 1
on a connection, timeout, HTTP, or response-shape failure. A successful TCP
probe only confirms that the proxy port is reachable; the subsequent request
and proxy debug lines show whether its CONNECT request succeeds.
