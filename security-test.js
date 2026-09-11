/**
 * Security Test Suite — Validates all hardening layers
 * Run: node security-test.js
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.TEST_URL || 'http://localhost:3000';
let passed = 0, failed = 0, total = 0;

function test(name, fn) {
  total++;
  return fn().then(() => { passed++; console.log(`  ✅ ${name}`); })
    .catch(e => { failed++; console.log(`  ❌ ${name}: ${e.message}`); });
}

async function req(path, opts = {}) {
  const url = new URL(path, BASE);
  const res = await fetch(url.toString(), {
    redirect: 'manual',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

async function run() {
  console.log('\n🔒 Security Test Suite\n');
  console.log('━'.repeat(50));

  // 1. Security Headers
  console.log('\n📋 Security Headers:');
  const home = await req('/');
  
  await test('X-Content-Type-Options: nosniff', async () => {
    if (home.headers.get('x-content-type-options') !== 'nosniff') throw Error('Missing');
  });
  await test('X-Frame-Options: DENY', async () => {
    if (home.headers.get('x-frame-options') !== 'DENY') throw Error('Missing');
  });
  await test('Strict-Transport-Security present', async () => {
    const h = home.headers.get('strict-transport-security');
    if (!h) throw Error('Missing HSTS');
  });
  await test('Content-Security-Policy present', async () => {
    if (!home.headers.get('content-security-policy')) throw Error('Missing CSP');
  });
  await test('X-Powered-By removed', async () => {
    if (home.headers.get('x-powered-by')) throw Error('Still present');
  });
  await test('Referrer-Policy present', async () => {
    if (!home.headers.get('referrer-policy')) throw Error('Missing');
  });
  await test('Permissions-Policy present', async () => {
    if (!home.headers.get('permissions-policy')) throw Error('Missing');
  });

  // 2. Auth Protection
  console.log('\n🔑 Authentication:');
  await test('GET /api/models requires auth', async () => {
    const r = await req('/api/models');
    if (r.status !== 401) throw Error(`Got ${r.status}`);
  });
  await test('POST /api/chat requires auth', async () => {
    const r = await req('/api/chat', { method: 'POST', body: '{}' });
    if (r.status !== 401) throw Error(`Got ${r.status}`);
  });
  await test('POST /api/clone requires auth', async () => {
    const r = await req('/api/clone', { method: 'POST', body: '{}' });
    if (r.status !== 401) throw Error(`Got ${r.status}`);
  });
  await test('POST /api/upload requires auth', async () => {
    const r = await req('/api/upload', { method: 'POST', body: '{}' });
    if (r.status !== 401) throw Error(`Got ${r.status}`);
  });

  // 3. Input Validation
  console.log('\n🧹 Input Validation:');
  await test('Register rejects short password', async () => {
    const r = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'test', password: 'short' }),
    });
    if (r.status !== 400) throw Error(`Got ${r.status}`);
  });
  await test('Register rejects invalid username chars', async () => {
    const r = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: '<script>', password: 'longenoughpassword123' }),
    });
    if (r.status !== 400) throw Error(`Got ${r.status}`);
  });

  // 4. SSRF Protection
  console.log('\n🛑 SSRF Protection:');
  await test('Clone blocks localhost', async () => {
    const r = await req('/api/clone', {
      method: 'POST',
      body: JSON.stringify({ url: 'http://127.0.0.1/admin' }),
    });
    if (r.status === 200) throw Error('Should be blocked');
  });

  // 5. Error Handling
  console.log('\n🚫 Error Handling:');
  await test('404 does not leak stack trace', async () => {
    const r = await req('/api/nonexistent-route-xyz');
    if (r.text.includes('Error') && r.text.includes('at ')) throw Error('Stack trace leaked');
  });
  await test('Invalid JSON returns clean error', async () => {
    const r = await req('/api/chat', {
      method: 'POST',
      body: '{invalid json',
      headers: { 'Content-Type': 'application/json' },
    });
    if (r.text.includes('SyntaxError')) throw Error('Error type leaked');
  });

  // 6. Health Check
  console.log('\n💚 Health:');
  await test('Health endpoint returns ok', async () => {
    const r = await req('/api/health');
    if (r.json?.status !== 'ok') throw Error('Not ok');
  });

  // Summary
  console.log('\n' + '━'.repeat(50));
  console.log(`\n📊 Results: ${passed}/${total} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
