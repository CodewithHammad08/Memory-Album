require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { connectDatabase } = require('./config/database');
const User = require('./models/User');

const required = ['MONGODB_URI', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();
const production = process.env.NODE_ENV === 'production';

// Trust reverse proxy (Vercel edge / SSL termination)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

// ---- Lazy bootstrap for database & user accounts ----
let _bootstrapped = false;
let _bootstrapPromise = null;

async function doBootstrap() {
  if (_bootstrapped) return;
  if (_bootstrapPromise) return _bootstrapPromise;

  _bootstrapPromise = (async () => {
    await connectDatabase(process.env.MONGODB_URI);

    const names = (process.env.SETUP_USERNAMES || process.env.SETUP_USERNAME || 'hammad,zubiya')
      .split(',')
      .map(x => x.trim().toLowerCase())
      .filter(Boolean);

    const setupPass = process.env.SETUP_PASSWORD;
    if (!setupPass) return;
    const passwordHash = await bcrypt.hash(setupPass, 12);

    for (const username of names) {
      const existing = await User.findOne({ username });
      if (!existing) {
        await User.create({
          username,
          passwordHash,
          encryptionSalt: crypto.randomBytes(32).toString('base64')
        });
        console.info(`✓ Owner account created: ${username} (password: ${setupPass})`);
      } else {
        existing.passwordHash = passwordHash;
        await existing.save();
        console.info(`✓ Owner account password updated: ${username} (password: ${setupPass})`);
      }
    }
    _bootstrapped = true;
  })();

  return _bootstrapPromise;
}

// Middleware: lazily ensure DB connection and user accounts before handling any request
app.use(async (req, res, next) => {
  try {
    await doBootstrap();
    next();
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).json({ error: 'Database connection failed. Please try again.' });
  }
});

// Session middleware
app.use(session({
  name: 'our_story_session',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    dbName: 'our_story'
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chapters', require('./routes/chapters'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/entries', require('./routes/journal'));
app.use('/api/backup', require('./routes/backup'));

// Serve client assets
const clientDir = fs.existsSync(path.join(__dirname, '../client'))
  ? path.join(__dirname, '../client')
  : path.join(process.cwd(), 'client');

app.get(['/client/index.html', '/client/'], (req, res) => {
  res.redirect(301, '/');
});
app.use(express.static(clientDir));
app.use('/client', express.static(clientDir));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong. Please try again.' });
});

// Export for Vercel serverless
module.exports = app;

// Run as standalone server when executed directly (local dev)
if (require.main === module) {
  doBootstrap().then(() => {
    const port = process.env.PORT || 5001;
    const server = app.listen(port, () => {
      console.info(`\n♥ Our Story memory album is running at http://localhost:${port}\n`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => server.close(() => process.exit(0)));
    }
  }).catch(err => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
}
