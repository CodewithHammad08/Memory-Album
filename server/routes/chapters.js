const router = require('express').Router();
const Chapter = require('../models/Chapter');
const Photo = require('../models/Photo');
const Entry = require('../models/JournalEntry');
const { configureCloudinary } = require('../config/cloudinary');
const { requireAuth, csrf } = require('../middleware/auth');
const asyncHandler = require('../utils/async');

router.use(requireAuth);

async function renumber() {
  const all = await Chapter.find().sort({ date: 1, _id: 1 });
  await Promise.all(all.map((c, i) => Chapter.updateOne({ _id: c._id }, { $set: { chapterNumber: i + 1 } })));
}

function formatChapter(chapter) {
  const c = chapter.toObject ? chapter.toObject() : { ...chapter };
  if (c.coverPhotoId && typeof c.coverPhotoId === 'object') {
    if (!c.coverPhotoId.url || !c.coverPhotoId.secureUrl) {
      try {
        const cloud = configureCloudinary();
        const url = cloud.url(c.coverPhotoId.cloudinaryPublicId, {
          resource_type: c.coverPhotoId.resourceType || 'image',
          type: c.coverPhotoId.deliveryType || 'upload',
          secure: true
        });
        c.coverPhotoId.url = c.coverPhotoId.url || url;
        c.coverPhotoId.secureUrl = c.coverPhotoId.secureUrl || url;
      } catch {
        // keep existing
      }
    }
  }
  return c;
}

// GET all chapters
router.get('/', asyncHandler(async (req, res) => {
  const chapters = await Chapter.find().populate('coverPhotoId').sort({ date: 1, _id: 1 });
  res.json(chapters.map(formatChapter));
}));

// GET single chapter
router.get('/:id', asyncHandler(async (req, res) => {
  const c = await Chapter.findById(req.params.id).populate('coverPhotoId');
  if (!c) return res.status(404).json({ error: 'Chapter not found.' });
  res.json(formatChapter(c));
}));

// POST new chapter
router.post('/', csrf, asyncHandler(async (req, res) => {
  const c = await Chapter.create(req.body);
  await renumber();
  const created = await Chapter.findById(c._id).populate('coverPhotoId');
  res.status(201).json(formatChapter(created));
}));

// PUT update chapter
router.put('/:id', csrf, asyncHandler(async (req, res) => {
  const c = await Chapter.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).populate('coverPhotoId');
  if (!c) return res.status(404).json({ error: 'Chapter not found.' });
  await renumber();
  res.json(formatChapter(c));
}));

// DELETE chapter
router.delete('/:id', csrf, asyncHandler(async (req, res) => {
  const c = await Chapter.findById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Chapter not found.' });

  const photos = await Photo.find({ chapterId: c._id });
  const cloud = configureCloudinary();
  await Promise.all(photos.map(photo =>
    cloud.uploader.destroy(photo.cloudinaryPublicId, {
      resource_type: photo.resourceType || 'image',
      type: photo.deliveryType || 'upload'
    }).catch(err => console.warn('Cloudinary delete error:', err.message))
  ));

  await Promise.all([
    Chapter.deleteOne({ _id: c._id }),
    Photo.deleteMany({ chapterId: c._id }),
    Entry.deleteMany({ chapterId: c._id })
  ]);

  await renumber();
  res.status(204).end();
}));

module.exports = router;
