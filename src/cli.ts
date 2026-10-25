#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLaxMcpServer } from './index.js';
import { startHttpServer } from './http.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { process.stdout.write('Usage: lax-mcp [--http] [--port 3000]\n'); return; }
  let http = false;
  let portText = process.env.PORT ?? '3000';
  for (let i=0;i<args.length;i++) {
    if(args[i]==='--http') http=true;
    else if(args[i]==='--port' && args[i+1]) portText=args[++i];
    else throw new Error('Invalid argument');
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  if (http) {
    const listener = await startHttpServer({port});
    process.stderr.write('LAX MCP HTTP ready on loopback /mcp\n');
    const stop = () => listener.close();
    process.once('SIGTERM',stop); process.once('SIGINT',stop);
  } else {
    const server = createLaxMcpServer();
    await server.connect(new StdioServerTransport());
    const stop = () => { void server.close(); };
    process.once('SIGTERM',stop); process.once('SIGINT',stop);
  }
}
main().catch(() => { process.stderr.write('LAX MCP failed to start. Check arguments and port availability.\n'); process.exitCode=1; });
