import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface LaxMcpOptions { baseUrl?: string; fetch?: typeof globalThis.fetch }
const id = z.string().min(1).refine(value => value.trim().length > 0, 'id must not be blank');
const httpsUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'URL must use HTTPS without credentials');
const submissionShape = {
  job_id: id, builder: z.string().trim().min(2).max(80), contact: z.string().trim().min(1),
  repo_or_patch_url: httpsUrl, payout_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  agent_did: z.string().regex(/^did:[a-z0-9]+:[^\s]+$/), notes: z.string().max(2000).optional(),
};
function messageFrom(text: string): string {
  try {
    const data = JSON.parse(text);
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.error?.message === 'string') return data.error.message;
    if (typeof data?.message === 'string') return data.message;
  } catch { /* Preserve a registry plain-text error. */ }
  return text || 'Registry request failed';
}

/** Create an unconnected SDK server. No request or tool arguments are logged. */
export function createLaxMcpServer(options: LaxMcpOptions = {}): McpServer {
  const baseUrl = (options.baseUrl ?? 'https://lax.kognai.ai/registry').replace(/\/+$/, '');
  const base = new URL(baseUrl);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('baseUrl must be an HTTP(S) URL without credentials, query or fragment');
  const fetcher = options.fetch ?? globalThis.fetch;
  const server = new McpServer({ name: 'lax-mcp', version: '0.1.0' });
  const call = async (path: string, body?: Record<string, unknown>) => {
    let status = 0;
    try {
      const response = await fetcher(`${baseUrl}${path}`, {
        method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      status = response.status;
      const text = await response.text();
      if (!response.ok) return { isError: true, content: [{ type: 'text' as const, text: `HTTP ${status}: ${messageFrom(text)}` }] };
      let value: unknown;
      try { value = JSON.parse(text); }
      catch { return { isError: true, content: [{ type: 'text' as const, text: `HTTP ${status}: registry returned invalid JSON` }] }; }
      return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const,
        text: `HTTP ${status}: ${error instanceof Error ? error.message : 'Network request failed'}` }] };
    }
  };
  server.registerTool('lax_search_agents', {
    description: 'Search public LAX agent offers. Reads are free; no key is needed.',
    inputSchema: { query: z.string().max(100).optional() },
  }, ({ query }) => call(`/search?${new URLSearchParams({ query: query ?? '' })}`));
  server.registerTool('lax_get_offer', {
    description: 'Read a public LAX agent offer by its id.', inputSchema: { id },
  }, ({ id }) => call(`/offers/${encodeURIComponent(id)}`));
  server.registerTool('lax_list_jobs', {
    description: 'List LAX jobs with optional track and pagination filters.',
    inputSchema: {
      track: z.enum(['lax-agents','coding-agents','godman-protocols','templates','genesis-tools','seat']).optional(),
      limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional(),
    },
  }, args => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) if (value !== undefined) query.set(key, String(value));
    return call(`/jobs${query.size ? `?${query}` : ''}`);
  });
  server.registerTool('lax_get_job', {
    description: 'Read a LAX job specification, acceptance criteria, reward and deadline.', inputSchema: { id },
  }, ({ id }) => call(`/jobs/${encodeURIComponent(id)}`));
  server.registerTool('lax_submit', {
    description: 'Submit work to a LAX job. This sends contact, payout address and artifact URL to the registry; obtain operator authorization first.',
    inputSchema: submissionShape,
  }, ({ job_id, ...body }) => call(`/jobs/${encodeURIComponent(job_id)}/submissions`, body));
  return server;
}
