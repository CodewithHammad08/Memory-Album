const router = require('express').Router();
const multer = require('multer');
const Photo = require('../models/Photo');
const Chapter = require('../models/Chapter');
const { configureCloudinary } = require('../config/cloudinary');
const { requireAuth, csrf } = require('../middleware/auth');
const asyncHandler = require('../utils/async');

// Configure multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB per photo or video
});

// Helper: Stream buffer directly to Cloudinary
function streamUploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const cloud = configureCloudinary();
    const stream = cloud.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// Helper: Ensure photo object has valid url and secureUrl
function formatPhoto(photo) {
  const p = photo.toObject ? photo.toObject() : { ...photo };
  if (!p.url || !p.secureUrl) {
    try {
      const cloud = configureCloudinary();
      const generated = cloud.url(p.cloudinaryPublicId, {
        resource_type: p.resourceType || 'image',
        type: p.deliveryType || 'upload',
        secure: true
      });
      p.url = p.url || generated;
      p.secureUrl = p.secureUrl || generated;
    } catch {
      p.url = p.url || '';
      p.secureUrl = p.secureUrl || '';
    }
  }
  return p;
}

router.use(requireAuth);

// 1. Direct Server Upload: receives files from form, streams to Cloudinary, saves in MongoDB
router.post('/upload', csrf, upload.array('photos', 30), asyncHandler(async (req, res) => {
  const chapterId = req.body.chapterId;
  if (!chapterId) {
    return res.status(400).json({ error: 'Chapter ID is required.' });
  }

  const chapter = await Chapter.findById(chapterId);
  if (!chapter) {
    return res.status(404).json({ error: 'Chapter not found.' });
  }

  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: 'No image files provided.' });
  }

  const folder = `our-story/chapter-${String(chapter.chapterNumber || 1).padStart(2, '0')}`;
  const existingCount = await Photo.countDocuments({ chapterId });

  const uploadedPhotos = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const uploadResult = await streamUploadToCloudinary(file.buffer, {
      folder,
      resource_type: 'auto',
      type: 'upload'
    });

    const photo = await Photo.create({
      chapterId: chapter._id,
      cloudinaryPublicId: uploadResult.public_id,
      cloudinaryAssetId: uploadResult.asset_id || '',
      deliveryType: 'upload',
      resourceType: uploadResult.resource_type || 'image',
      url: uploadResult.secure_url || uploadResult.url,
      secureUrl: uploadResult.secure_url || uploadResult.url,
      caption: (files.length === 1 && req.body.caption) ? req.body.caption.trim() : '',
      isFavourite: false,
      displayOrder: existingCount + i
    });

    // Auto-set cover photo if chapter doesn't have one
    if (!chapter.coverPhotoId) {
      chapter.coverPhotoId = photo._id;
      await chapter.save();
    }

    uploadedPhotos.push(formatPhoto(photo));
  }

  res.status(201).json(uploadedPhotos);
}));

// 2. Client-side signed upload support
router.post('/upload-signature', csrf, asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.body.chapterId);
  if (!chapter) {
    return res.status(404).json({ error: 'Chapter not found.' });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `our-story/chapter-${String(chapter.chapterNumber || 1).padStart(2, '0')}`;
  const cloud = configureCloudinary();
  const signature = cloud.utils.api_sign_request(
    { timestamp, folder },
    process.env.CLOUDINARY_API_SECRET
  );

  res.json({
    timestamp,
    folder,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME
  });
}));

// 3. Register a photo created from client direct upload
router.post('/', csrf, asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (!body.url && body.cloudinaryPublicId) {
    const cloud = configureCloudinary();
    body.url = cloud.url(body.cloudinaryPublicId, {
      resource_type: body.resourceType || 'image',
      type: body.deliveryType || 'upload',
      secure: true
    });
    body.secureUrl = body.url;
  }
  const existingCount = await Photo.countDocuments({ chapterId: body.chapterId });
  if (typeof body.displayOrder !== 'number') {
    body.displayOrder = existingCount;
  }
  const p = await Photo.create(body);
  const chapter = await Chapter.findById(p.chapterId);
  if (chapter && !chapter.coverPhotoId) {
    chapter.coverPhotoId = p._id;
    await chapter.save();
  }
  res.status(201).json(formatPhoto(p));
}));

// 4. Get favourites
router.get('/favourites', asyncHandler(async (req, res) => {
  const photos = await Photo.find({ isFavourite: true }).populate('chapterId').sort({ createdAt: -1 });
  res.json(photos.map(formatPhoto));
}));

// 5. Get photos by chapter
router.get('/chapter/:chapterId', asyncHandler(async (req, res) => {
  const photos = await Photo.find({ chapterId: req.params.chapterId }).sort({ displayOrder: 1, createdAt: 1 });
  res.json(photos.map(formatPhoto));
}));

// 6. Delivery endpoint
router.get('/:id/delivery', asyncHandler(async (req, res) => {
  const p = await Photo.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Photo not found.' });
  if (p.secureUrl || p.url) {
    return res.json({ url: p.secureUrl || p.url });
  }
  const cloud = configureCloudinary();
  const url = cloud.url(p.cloudinaryPublicId, {
    resource_type: p.resourceType || 'image',
    type: p.deliveryType || 'upload',
    secure: true
  });
  res.json({ url });
}));

// 7. Make cover photo
router.post('/:id/make-cover', csrf, asyncHandler(async (req, res) => {
  const photo = await Photo.findById(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  const chapter = await Chapter.findById(photo.chapterId);
  if (!chapter) return res.status(404).json({ error: 'Chapter not found.' });

  chapter.coverPhotoId = photo._id;
  await chapter.save();
  res.json({ ok: true, chapterId: chapter._id, coverPhotoId: photo._id });
}));

// 8. Toggle favourite
router.post('/:id/favourite', csrf, asyncHandler(async (req, res) => {
  const photo = await Photo.findById(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  photo.isFavourite = !photo.isFavourite;
  await photo.save();
  res.json(formatPhoto(photo));
}));

// 9. Update photo presentation details
router.put('/:id', csrf, asyncHandler(async (req, res) => {
  // Keep this endpoint deliberately narrow: photos may only update their
  // scrapbook metadata, never their ownership or Cloudinary information.
  const updates = {};
  if (typeof req.body.caption === 'string') updates.caption = req.body.caption.trim();
  if (['small', 'standard', 'large'].includes(req.body.frameSize)) updates.frameSize = req.body.frameSize;
  if (typeof req.body.displayOrder === 'number') updates.displayOrder = req.body.displayOrder;
  if (typeof req.body.customWidth === 'number') updates.customWidth = Math.max(0, Math.min(1200, req.body.customWidth));
  if (typeof req.body.rotation === 'number') updates.rotation = req.body.rotation;
  if (typeof req.body.cropZoom === 'number') updates.cropZoom = Math.max(0.5, Math.min(5, req.body.cropZoom));
  if (typeof req.body.cropX === 'number') updates.cropX = req.body.cropX;
  if (typeof req.body.cropY === 'number') updates.cropY = req.body.cropY;

  const p = await Photo.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!p) return res.status(404).json({ error: 'Photo not found.' });
  res.json(formatPhoto(p));
}));

// 10. Delete photo
router.delete('/:id', csrf, asyncHandler(async (req, res) => {
  const p = await Photo.findByIdAndDelete(req.params.id);
  if (!p) return res.status(404).json({ error: 'Photo not found.' });

  try {
    const cloud = configureCloudinary();
    await cloud.uploader.destroy(p.cloudinaryPublicId, {
      resource_type: p.resourceType || 'image',
      type: p.deliveryType || 'upload'
    });
  } catch (err) {
    console.warn('Cloudinary destroy error:', err.message);
  }

  // If this was the chapter's cover photo, assign the next photo or null
  const chapter = await Chapter.findById(p.chapterId);
  if (chapter && String(chapter.coverPhotoId) === String(p._id)) {
    const nextPhoto = await Photo.findOne({ chapterId: chapter._id }).sort({ displayOrder: 1 });
    chapter.coverPhotoId = nextPhoto ? nextPhoto._id : null;
    await chapter.save();
  }

  res.status(204).end();
}));

module.exports = router;
