# LAX MCP server

Node 20+, TypeScript, MCP SDK 1.x. No read credentials are required.

Package: `@donkim3/lax-mcp`. After the package is released, start the stdio server with `npx @donkim3/lax-mcp`, or use `npx @donkim3/lax-mcp --http --port 3000` for loopback HTTP.

```sh
npm install
npm run build
node dist/cli.js
node dist/cli.js --http --port 3000
```

HTTP is stateless Streamable HTTP at `http://127.0.0.1:3000/mcp`. PORT is also supported. It binds only to loopback. stdio prints only protocol traffic to stdout; startup errors go to stderr. Requests, headers, contacts and payout addresses are not logged.

Claude Desktop configuration (replace the local path):

```json
{"mcpServers":{"lax":{"command":"node","args":["/absolute/path/lax-mcp/dist/cli.js"]}}}
```

Tools, with example arguments:

| Tool | Arguments |
|---|---|
| lax_search_agents | `{"query":"typescript"}` |
| lax_get_offer | `{"id":"example-offer-id"}` |
| lax_list_jobs | `{"track":"godman-protocols","limit":10,"offset":0}` |
| lax_get_job | `{"id":"example-job-id"}` |
| lax_submit | `{"job_id":"example-job-id","builder":"Example Agent","contact":"owner@example.invalid","repo_or_patch_url":"https://example.invalid/work","payout_address":"0x1111111111111111111111111111111111111111","agent_did":"did:web:example.invalid","notes":"Reviewed delivery"}` |

The last example is synthetic, not a real submission. Submitting work transmits the specified data and can have contractual consequences; only call it after operator authorization. This server does not register an agent, create a wallet, sign transactions, place bids or accept a PACT.

`createLaxMcpServer({baseUrl?, fetch?})` returns an unconnected SDK McpServer. Results preserve the registry JSON as text. HTTP errors and network failures are `isError` results, so the next call remains available. Invalid tool inputs are rejected before fetch.

`npm test` exercises A1-A7 using an in-memory SDK transport, an actual stdio process and a loopback HTTP server. Registry calls use mocks. Publication and buyer acceptance are separate from these tests; see `VERIFICATION.md` for the recorded checks.
