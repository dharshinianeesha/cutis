const { app, connectDb } = require('./app');
const mongoose = require('mongoose');
const { startLocalDatabase } = require('./utils/local-database');

const PORT = process.env.PORT || 4000;

async function start() {
  let localMongo;
  try {
    localMongo = await startLocalDatabase();
    if (localMongo) console.log('[db] Started the persistent local MongoDB database.');
  } catch (error) {
    console.error('[db] Local MongoDB could not start. Check the local database directory or configure MONGODB_URI.');
  }
  if (!(await connectDb())) console.warn('[db] Database unavailable. Check /api/health for connection status.');

  const server = app.listen(PORT, () => {
    console.log(`Cutis backend running at http://localhost:${PORT}`);
    console.log(`Frontend accessible at http://localhost:${PORT}`);
  });

  function shutdown() {
    server.close(async () => {
      try {
        await mongoose.disconnect();
      } finally {
        await localMongo?.stop({doCleanup:false});
      }
    });
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
start();
