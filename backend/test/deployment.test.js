const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectDb } = require('../utils/database');
test('DB retries after missing configuration and failed connections, coalescing callers', async () => {
  const original = mongoose.connect;
  const uri = process.env.MONGODB_URI;
  try {
    process.env.MONGODB_URI = '';
    assert.equal(await connectDb(), false);
    process.env.MONGODB_URI = 'mongodb://127.0.0.1/test';
    let calls = 0;
    mongoose.connect = async () => { calls++; await new Promise(r => setTimeout(r, 10)); throw Error('offline'); };
    assert.deepEqual(await Promise.all([connectDb(), connectDb()]), [false, false]);
    assert.equal(calls, 1);
    assert.equal(await connectDb(), false);
    assert.equal(calls, 2);
    mongoose.connect = async () => { calls++; };
    assert.equal(await connectDb(), true);
  } finally {
    mongoose.connect = original;
    if (uri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = uri;
  }
});
test('Netlify function serves API JSON and keeps unknown API routes as 404', async () => {
  process.env.MONGODB_URI = '';
  const { handler } = require('../../netlify/functions/api');
  const invoke = path => handler({ httpMethod: 'GET', path, headers: {}, queryStringParameters: null, body: null, isBase64Encoded: false, requestContext: {} }, {});
  const health = await invoke('/api/health');
  assert.equal(health.statusCode, 200);
  assert.equal(JSON.parse(health.body).dbConnected, false);
  assert.equal((await invoke('/api/missing')).statusCode, 404);
});
