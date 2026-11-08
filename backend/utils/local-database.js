const path = require('node:path');
const fs = require('node:fs/promises');

async function startLocalDatabase() {
  if (process.env.MONGODB_URI?.trim() || process.env.NETLIFY || process.env.VERCEL ||
      ['production', 'test'].includes(process.env.NODE_ENV) || process.env.DISABLE_LOCAL_DB === 'true') return null;

  const { MongoMemoryServer } = require('mongodb-memory-server');
  const dbPath = path.join(__dirname, '..', '.local_mongo_data');
  await fs.mkdir(dbPath, {recursive:true});
  const mongo = await MongoMemoryServer.create({instance:{dbPath, storageEngine:'wiredTiger'}});
  process.env.MONGODB_URI = mongo.getUri();
  return mongo;
}

module.exports = { startLocalDatabase };
