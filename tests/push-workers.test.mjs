import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const workerRequire = createRequire(fs.realpathSync(require.resolve('wrangler/package.json')));
const { Miniflare } = workerRequire('miniflare');
const ts = require('typescript');

test('real Workers runtime can sign, encrypt, and construct a non-redirecting push request', async () => {
  const source = ts.transpileModule(fs.readFileSync('app/push-utils.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const runtime = new Miniflare({ modules: true, compatibilityDate: '2026-07-02', script: source + `
export default { async fetch() {
  let rejected=false;
  try { new Request('https://web.push.apple.com/test',{redirect:'error'}); } catch(error) { rejected=error instanceof TypeError; }
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey=await crypto.subtle.exportKey('jwk',keys.privateKey);
  const publicKey=uint8ArrayToBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey)));
  const recipient=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const p256dh=uint8ArrayToBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw',recipient.publicKey)));
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init);
    return Response.json({redirect:request.redirect,encryptedBytes:(await request.arrayBuffer()).byteLength,rejected},{status:201});
  };
  try {return await sendWebPush({endpoint:'https://web.push.apple.com/test',p256dh,auth_key:'A'.repeat(22)},
    {title:'test',body:'test'},{publicKey,privateKey:privateKey.d,subject:'mailto:test@example.com'});
  } finally {globalThis.fetch=original;}
}};` });
  try {
    const response = await runtime.dispatchFetch('https://fixture.test/');
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.rejected, true);
    assert.equal(result.redirect, 'manual');
    assert.ok(result.encryptedBytes > 100);
  } finally { await runtime.dispose(); }
});
