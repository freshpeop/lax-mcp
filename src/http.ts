import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLaxMcpServer, type LaxMcpOptions } from './index.js';
import type { Server } from 'node:http';

/** Stateless Streamable HTTP, bound to loopback. Each request has its own SDK server. */
export async function startHttpServer(options: LaxMcpOptions & { port?: number } = {}): Promise<Server> {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.post('/mcp', async (req, res) => {
    const server = createLaxMcpServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close().catch(() => {}); void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({jsonrpc:'2.0',id:null,error:{code:-32603,message:'MCP request failed'}});
    }
  });
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({jsonrpc:'2.0',id:null,error:{code:-32000,message:'Use POST for stateless MCP requests'}});
  });
  return new Promise((resolve, reject) => {
    const http = app.listen(options.port ?? 3000, '127.0.0.1', () => resolve(http));
    http.once('error', reject);
  });
}
