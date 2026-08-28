# mail-mcp

An MCP server that enables hierarchical agent structures to communicate reliably without consuming context or forgetting the rules of their protocol.

## Development

Dependencies are managed with `package.json` + `package-lock.json`.

```bash
npm ci
npm test
npm run build
```

The implementation is written in TypeScript under `/src`.

## Seat identity certificates

The seat name is carried in a **Subject Alternative Name** (SAN) entry of the
seat's certificate, as a single DNS name whose value is the seat name (`DNS:<seat>`, for example `DNS:orch`), and
**never in the Common Name (CN)** — TLS software ignores the Common Name for
identity. A certificate that has no usable SAN — no SAN at all, or a SAN with
no bare seat-name entry — is refused with a named `SeatCertificateError`.
The certificate the server issues puts the seat name in the SAN and uses a
neutral Common Name, so every issued certificate follows exactly that one
format.

## Running it yourself

Build the server, then point an MCP client at `dist/index.js`:

```bash
npm ci
npm run build
```

The server is a stdio MCP server, so it is launched by the MCP client (or by piping
JSON-RPC on stdin). Two environment variables configure it:

- `AGENT_MAIL_BASE_DIR` — where the mailbox lives (message files, `mail.jsonl` index,
  and `seats.json`). Defaults to `<cwd>/week7/mail`.
- `AGENT_MAIL_BOOTSTRAP` — a JSON array of seats for first launch. The first
  lead/architect cannot register itself, so it must come from here:

```bash
export AGENT_MAIL_BASE_DIR=/tmp/agent-mail
export AGENT_MAIL_BOOTSTRAP='[{"id":"lead","role":"lead","lane":"hq"}]'
node dist/index.js
```

On a mailbox that already has a lead/architect persisted in `seats.json`,
`AGENT_MAIL_BOOTSTRAP` may be omitted. If neither is present the server fails fast
and names the missing variable.

A full end-to-end check that drives the built server over real MCP stdio with a
throwaway mailbox (and a stub wake transport) is:

```bash
npm run smoke
```

Run the test suite with:

```bash
npm test
```

Example MCP client config (Claude Desktop style):

```json
{
  "mcpServers": {
    "agent-mail": {
      "command": "node",
      "args": ["/absolute/path/to/mail-mcp/dist/index.js"],
      "env": {
        "AGENT_MAIL_BASE_DIR": "/absolute/path/to/agent-mail-mailbox",
        "AGENT_MAIL_BOOTSTRAP": "[{\"id\":\"lead\",\"role\":\"lead\",\"lane\":\"hq\"}]"
      }
    }
  }
}
```
## Seat certificates

Each seat is identified by a certificate. The seat name is placed in a
**Subject Alternative Name** (SAN) entry of that certificate — specifically a
`dNSName` entry of the form `DNS:<seat>` (for example `DNS:orch`) — and it is
**never** placed in the **Common Name** (`CN`), because TLS software ignores
the Common Name when establishing identity. The Common Name of a seat
certificate stays neutral (`mail.example`).

The server refuses any certificate whose SAN is missing or holds no usable
seat entry (including a certificate that carries the seat name only in the
Common Name), raising the named `UnusableSANError`. Every certificate the
server issues uses this one format: `DNS:<seat>` in the SAN, never in the CN.
`src/certificates.ts` implements `seatNameFromCertificate`, `issueSeatCertificate`
(alias `createSeatCertificate`), and `commonNameOfCertificate`.
