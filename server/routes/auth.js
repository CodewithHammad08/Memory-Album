const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const asyncHandler = require('../utils/async');

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 15 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
});

router.get('/session', asyncHandler(async (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  let user = null;
  if (req.session.userId) {
    user = await User.findById(req.session.userId).select('username');
  }

  res.json({
    authenticated: Boolean(req.session.userId),
    csrfToken: req.session.csrfToken,
    user: user ? { id: user._id, username: user.username } : null
  });
}));

router.get('/users', asyncHandler(async (req, res) => {
  const users = await User.find({}).select('username');
  res.json(users.map(u => u.username));
}));

router.post('/login', loginLimit, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = await User.findOne({ username: username.trim().toLowerCase() }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect credentials.' });
  }

  req.session.regenerate(err => {
    if (err) throw err;
    req.session.userId = user._id;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.json({
      ok: true,
      csrfToken: req.session.csrfToken,
      user: { id: user._id, username: user.username }
    });
  });
}));

router.post('/quick-unlock', asyncHandler(async (req, res) => {
  let user = await User.findOne({});
  if (!user) {
    // create default user
    const passwordHash = await bcrypt.hash('ourstory', 12);
    user = await User.create({
      username: 'hammad',
      passwordHash,
      encryptionSalt: crypto.randomBytes(32).toString('base64')
    });
  }

  req.session.regenerate(err => {
    if (err) throw err;
    req.session.userId = user._id;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.json({
      ok: true,
      csrfToken: req.session.csrfToken,
      user: { id: user._id, username: user.username }
    });
  });
}));

router.post('/register', loginLimit, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.trim().length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username (min 3 chars) and password (min 4 chars) are required.' });
  }

  const cleanName = username.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  let user = await User.findOne({ username: cleanName });

  if (user) {
    user.passwordHash = passwordHash;
    await user.save();
  } else {
    user = await User.create({
      username: cleanName,
      passwordHash,
      encryptionSalt: crypto.randomBytes(32).toString('base64')
    });
  }

  req.session.regenerate(err => {
    if (err) throw err;
    req.session.userId = user._id;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.json({
      ok: true,
      csrfToken: req.session.csrfToken,
      user: { id: user._id, username: user.username }
    });
  });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('our_story_session').json({ ok: true });
  });
});

module.exports = router;
