# docs/traces/

Step-by-step traces of ContextPane's boundaries, captured by running the orchestrator's own functions. Each trace says how it was captured and what it does not show.

| Trace | Shows |
|---|---|
| [`mcp-vault-boundary.md`](mcp-vault-boundary.md) | The 3-step MCP vault boundary on `INC-4092`: real identifiers during the MCP gather → tokens and `ptr://` in the outbound prompt → server-side de-reference of the reply, fence check, and re-pseudonymisation of rows sent back to a model |
