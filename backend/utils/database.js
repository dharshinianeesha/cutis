const mongoose = require('mongoose');
let connectingPromise = null;
mongoose.set('bufferCommands', false);
async function connectDb() {
  if (mongoose.connection.readyState === 1) return true;
  if (connectingPromise) return connectingPromise;
  const uri = (process.env.MONGODB_URI || '').trim();
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) return false;
  connectingPromise = mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
    maxPoolSize: 5, minPoolSize: 0
  }).then(() => true).catch(() => {
    console.error('[db] MongoDB connection failed. Check Atlas credentials, network access and MONGODB_URI.');
    return false;
  }).finally(() => { connectingPromise = null; });
  return connectingPromise;
}
module.exports = { connectDb };
