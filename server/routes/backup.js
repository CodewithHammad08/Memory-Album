const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { requireAuth, csrf } = require('../middleware/auth');
const Chapter = require('../models/Chapter');
const Photo = require('../models/Photo');
const JournalEntry = require('../models/JournalEntry');

// GET /api/backup - Export all scrapbook data
router.get('/', requireAuth, async (req, res) => {
  try {
    const [chapters, photos, entries] = await Promise.all([
      Chapter.find({}).sort({ date: 1, chapterNumber: 1 }).lean(),
      Photo.find({}).sort({ displayOrder: 1, createdAt: 1 }).lean(),
      JournalEntry.find({}).sort({ createdAt: 1 }).lean()
    ]);

    const backupPayload = {
      version: 1,
      appName: 'Our Story Memory Album',
      exportedAt: new Date().toISOString(),
      counts: {
        chapters: chapters.length,
        photos: photos.length,
        entries: entries.length
      },
      data: {
        chapters,
        photos,
        entries
      }
    };

    const filename = `our-story-backup-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json(backupPayload);
  } catch (err) {
    console.error('Backup export error:', err);
    return res.status(500).json({ error: 'Failed to create backup: ' + err.message });
  }
});

// POST /api/backup/restore - Restore scrapbook data from backup
router.post('/restore', requireAuth, csrf, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.data || !Array.isArray(payload.data.chapters)) {
      return res.status(400).json({ error: 'Invalid backup file structure.' });
    }

    const { chapters = [], photos = [], entries = [] } = payload.data;
    const mode = req.body.mode || 'merge'; // 'merge' or 'replace'

    if (mode === 'replace') {
      await Promise.all([
        Chapter.deleteMany({}),
        Photo.deleteMany({}),
        JournalEntry.deleteMany({})
      ]);
    }

    const chapterIdMap = new Map();
    let restoredChapters = 0;
    let restoredPhotos = 0;
    let restoredEntries = 0;

    // 1. Restore Chapters
    for (const ch of chapters) {
      const oldId = ch._id ? ch._id.toString() : null;
      const newId = new mongoose.Types.ObjectId();

      if (oldId) {
        chapterIdMap.set(oldId, newId);
      }

      await Chapter.create({
        _id: newId,
        title: ch.title || 'Untitled Chapter',
        chapterNumber: ch.chapterNumber || undefined,
        date: ch.date ? new Date(ch.date) : new Date(),
        location: ch.location || '',
        description: ch.description || '',
        mood: ch.mood || '',
        coverPhotoId: null // will re-link after photos
      });
      restoredChapters++;
    }

    // 2. Restore Photos
    const photoIdMap = new Map();
    for (const ph of photos) {
      const oldChId = ph.chapterId ? ph.chapterId.toString() : null;
      const mappedChId = oldChId ? chapterIdMap.get(oldChId) : null;

      // Validate targetChId is a valid ObjectId
      const rawTargetChId = mappedChId || ph.chapterId;
      if (!rawTargetChId || !mongoose.Types.ObjectId.isValid(rawTargetChId)) continue;
      const targetChId = rawTargetChId;

      const oldPhotoId = ph._id ? ph._id.toString() : null;
      const newPhotoId = new mongoose.Types.ObjectId();
      if (oldPhotoId) photoIdMap.set(oldPhotoId, newPhotoId);

      await Photo.create({
        _id: newPhotoId,
        chapterId: targetChId,
        cloudinaryPublicId: ph.cloudinaryPublicId || 'restored_photo',
        cloudinaryAssetId: ph.cloudinaryAssetId || '',
        deliveryType: ph.deliveryType || 'upload',
        resourceType: ph.resourceType || 'image',
        url: ph.url || '',
        secureUrl: ph.secureUrl || ph.url || '',
        caption: ph.caption || '',
        frameSize: ['small', 'standard', 'large'].includes(ph.frameSize) ? ph.frameSize : 'standard',
        isFavourite: Boolean(ph.isFavourite),
        displayOrder: ph.displayOrder || 0
      });
      restoredPhotos++;
    }

    // 3. Link Cover Photos in Chapters
    for (const ch of chapters) {
      if (ch.coverPhotoId) {
        const mappedPhotoId = photoIdMap.get(ch.coverPhotoId.toString());
        const mappedChId = ch._id ? chapterIdMap.get(ch._id.toString()) : null;
        if (mappedPhotoId && mappedChId) {
          await Chapter.findByIdAndUpdate(mappedChId, { coverPhotoId: mappedPhotoId });
        }
      }
    }

    // 4. Restore Journal Entries
    for (const en of entries) {
      const oldChId = en.chapterId ? en.chapterId.toString() : null;
      const mappedChId = oldChId ? chapterIdMap.get(oldChId) : null;
      const rawTargetChId = mappedChId || en.chapterId;
      if (!rawTargetChId || !mongoose.Types.ObjectId.isValid(rawTargetChId)) continue;
      const targetChId = rawTargetChId;

      await JournalEntry.create({
        chapterId: targetChId,
        title: en.title || 'A Memory',
        encryptedContent: en.encryptedContent || en.content || '',
        encryptedQuote: en.encryptedQuote || en.quote || '',
        pagePosition: ['notes', 'before', 'between', 'after'].includes(en.pagePosition) ? en.pagePosition : 'notes'
      });
      restoredEntries++;
    }

    return res.json({
      success: true,
      message: `Successfully restored ${restoredChapters} chapters, ${restoredPhotos} photos, and ${restoredEntries} notes.`,
      restored: {
        chapters: restoredChapters,
        photos: restoredPhotos,
        entries: restoredEntries
      }
    });
  } catch (err) {
    console.error('Backup restore error:', err);
    return res.status(500).json({ error: 'Failed to restore backup: ' + err.message });
  }
});

module.exports = router;
