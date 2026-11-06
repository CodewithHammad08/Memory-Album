const router = require('express').Router();
const Entry = require('../models/JournalEntry');
const { requireAuth, csrf } = require('../middleware/auth');
const asyncHandler = require('../utils/async');

router.use(requireAuth);

router.get('/chapter/:chapterId', asyncHandler(async (req, res) => {
  res.json(await Entry.find({ chapterId: req.params.chapterId }).sort({ createdAt: 1 }));
}));

router.post('/chapter/:chapterId', csrf, asyncHandler(async (req, res) => {
  const entry = await Entry.create({
    ...req.body,
    chapterId: req.params.chapterId
  });
  res.status(201).json(entry);
}));

router.put('/:id', csrf, asyncHandler(async (req, res) => {
  const e = await Entry.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!e) return res.status(404).json({ error: 'Entry not found.' });
  res.json(e);
}));

router.delete('/:id', csrf, asyncHandler(async (req, res) => {
  const e = await Entry.findByIdAndDelete(req.params.id);
  if (!e) return res.status(404).json({ error: 'Entry not found.' });
  res.status(204).end();
}));

module.exports = router;
