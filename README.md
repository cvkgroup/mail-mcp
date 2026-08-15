# mail-mcp

An MCP server core that enables hierarchical agent structures to communicate reliably without consuming context or forgetting protocol rules.

## Project setup

Dependencies are managed through npm metadata files (`package.json` and `package-lock.json`).
Install at any time with:

```bash
npm install
```

`node_modules/` is ignored and is not committed.

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm run lint` — run TypeScript type-checking
- `npm test` — run the test suite

## Implemented features

- Hierarchical agent registration (root and child agents)
- Hierarchy boundary enforcement for message delivery
- Reliable message delivery with acknowledgement tracking
- Retry support for unacknowledged messages

## Test coverage

The test suite validates all implemented features, including:

- Valid/invalid agent registration
- In-hierarchy and cross-hierarchy message sending
- Pending acknowledgement tracking and acknowledgement authorization
- Retry behavior and attempt counting
- Fire-and-forget (non-ack) message behavior
