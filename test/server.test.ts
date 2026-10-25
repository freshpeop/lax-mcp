import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fileURLToPath } from 'node:url';
import { createLaxMcpServer } from '../src/index.js';
import { startHttpServer } from '../src/http.js';

async function pair(fetch: typeof globalThis.fetch) {
  const server=createLaxMcpServer({fetch}); const client=new Client({name:'acceptance',version:'1'});
  const [ct,st]=InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  return {client,close:async()=>{await client.close();await server.close();}};
}
const submission={job_id:'job /1',builder:'Test Agent',contact:'secret@example.invalid',
  payout_address:`0x${'4'.repeat(40)}`,repo_or_patch_url:'https://example.invalid/work',agent_did:'did:web:example.invalid'};
test('A1 five described tools and valid input schemas',async()=>{
  const p=await pair(async()=>{throw Error('no request expected');});
  try {
    const {tools}=await p.client.listTools();
    assert.deepEqual(tools.map(t=>t.name).sort(),['lax_get_job','lax_get_offer','lax_list_jobs','lax_search_agents','lax_submit']);
    for(const t of tools){assert.ok(t.description);assert.equal(t.inputSchema.type,'object');}
  } finally {await p.close();}
});
test('A2 all tool routes, request bodies and raw registry results',async()=>{
  const calls: Array<{url:string;init?:RequestInit}>=[];
  const p=await pair((async(url,init)=>{calls.push({url:String(url),init});return Response.json({source:'registry',n:calls.length});}) as typeof fetch);
  try {
    const cases: Array<[string,Record<string,unknown>,string]>=[
      ['lax_search_agents',{query:'a & b'},'/search?query=a+%26+b'],
      ['lax_get_offer',{id:'offer /?'},'/offers/offer%20%2F%3F'],
      ['lax_list_jobs',{track:'godman-protocols',limit:2,offset:0},'/jobs?track=godman-protocols&limit=2&offset=0'],
      ['lax_get_job',{id:'job /?'},'/jobs/job%20%2F%3F'],
      ['lax_submit',submission,'/jobs/job%20%2F1/submissions'],
    ];
    for(const [name,args,path] of cases){
      const result=await p.client.callTool({name,arguments:args});
      assert.deepEqual(result.content,[{type:'text',text:JSON.stringify({source:'registry',n:calls.length})}]);
      assert.equal(calls.at(-1)?.url,'https://lax.kognai.ai/registry'+path);
    }
    const last=calls.at(-1)!; assert.equal(last.init?.method,'POST');
    const {job_id,...body}=submission;
    assert.deepEqual(JSON.parse(String(last.init?.body)),body);
    assert.equal(new Headers(last.init?.headers).get('content-type'),'application/json');
  } finally {await p.close();}
});
for(const status of [400,404,500,0])test(`A3 ${status} error is a result and next call survives`,async()=>{
  let count=0;
  const p=await pair(async()=>{
    if(count++===0){if(status===0)throw Error('offline');return Response.json({error:'registry says no'},{status});}
    return Response.json({job:{id:'ok'}});
  });
  try {
    const failed=await p.client.callTool({name:'lax_get_job',arguments:{id:'j'}});
    assert.equal(failed.isError,true);
    assert.match(JSON.stringify(failed.content),new RegExp(`HTTP ${status}`));
    assert.match(JSON.stringify(failed.content),status===0?/offline/:/registry says no/);
    const next=await p.client.callTool({name:'lax_get_job',arguments:{id:'j'}});
    assert.notEqual(next.isError,true);
  } finally {await p.close();}
});
test('A4 invalid input never reaches the registry',async()=>{
  let count=0;const p=await pair(async()=>{count++;return Response.json({});});
  try {
    for(const [name,args] of [
      ['lax_get_job',{}], ['lax_get_offer',{id:''}], ['lax_submit',{...submission,payout_address:'0x123'}],
      ['lax_submit',{...submission,repo_or_patch_url:'http://example.invalid'}],
      ['lax_search_agents',{query:'x'.repeat(101)}], ['lax_list_jobs',{limit:101}],
    ] as Array<[string,Record<string,unknown>]>) {
      const result=await p.client.callTool({name,arguments:args}); assert.equal(result.isError,true);
    }
    assert.equal(count,0);
  }finally{await p.close();}
});
test('A5 contacts, payout and headers are not logged',async()=>{
  const lines: unknown[]=[];const originals={log:console.log,warn:console.warn,error:console.error};
  console.log=console.warn=console.error=(...a)=>{lines.push(a);};
  const p=await pair(async()=>Response.json({submission:{id:'s'}}));
  try {await p.client.callTool({name:'lax_submit',arguments:submission});assert.deepEqual(lines,[]);}
  finally{await p.close();Object.assign(console,originals);}
});
test('A6 stdio bin completes SDK handshake and lists tools',async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/cli.js',import.meta.url))],stderr:'pipe'});
  const client=new Client({name:'stdio-test',version:'1'});let stderr='';
  transport.stderr?.on('data',chunk=>{stderr+=String(chunk);});
  try{await client.connect(transport);assert.equal((await client.listTools()).tools.length,5);assert.equal(stderr,'');}
  finally{await client.close();}
});
test('A6 HTTP transport roundtrip with injected registry',async()=>{
  const listener=await startHttpServer({port:0,fetch:async()=>Response.json({job:{id:'http'}})});
  const address=listener.address();assert.ok(address&&typeof address!=='string');
  const client=new Client({name:'http-test',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  try{
    await client.connect(transport);assert.equal((await client.listTools()).tools.length,5);
    const result=await client.callTool({name:'lax_get_job',arguments:{id:'http'}});
    assert.deepEqual(result.content,[{type:'text',text:'{"job":{"id":"http"}}'}]);
  }finally{await client.close();await new Promise<void>((resolve,reject)=>listener.close(e=>e?reject(e):resolve()));}
});
test('A7 README documents client config and all tools',async()=>{
  const {readFile}=await import('node:fs/promises');const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
  assert.match(readme,/mcpServers/);
  for(const name of ['lax_search_agents','lax_get_offer','lax_list_jobs','lax_get_job','lax_submit'])assert.ok(readme.includes(name));
});
