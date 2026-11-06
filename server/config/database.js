const mongoose = require('mongoose');

// Connection caching for serverless environments (Vercel)
// Reuses an existing connection across warm invocations
let cached = global._mongooseCache || { conn: null, promise: null };
global._mongooseCache = cached;

async function connectDatabase(uri) {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose.connect(uri, {
      dbName: 'our_story',
      serverSelectionTimeoutMS: 10000,
      bufferCommands: false
    }).then(m => {
      console.info('MongoDB connected');
      return m;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectDatabase };

