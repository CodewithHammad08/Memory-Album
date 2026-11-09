const { Schema, model } = require('mongoose');

module.exports = model('Photo', new Schema({
  chapterId: { type: Schema.Types.ObjectId, ref: 'Chapter', required: true, index: true },
  cloudinaryPublicId: { type: String, required: true },
  cloudinaryAssetId: { type: String, default: '' },
  deliveryType: { type: String, default: 'upload' },
  resourceType: { type: String, default: 'image' },
  url: { type: String, default: '' },
  secureUrl: { type: String, default: '' },
  caption: { type: String, trim: true, maxlength: 500, default: '' },
  // Lets each memory have its own place in the scrapbook composition.
  frameSize: { type: String, enum: ['small', 'standard', 'large'], default: 'standard' },
  customWidth: { type: Number, default: 0 },
  customHeight: { type: Number, default: 0 },
  imgHeight: { type: Number, default: 0 },
  objectFit: { type: String, enum: ['cover', 'contain'], default: 'cover' },
  rotation: { type: Number, default: 0 },
  cropZoom: { type: Number, default: 1 },
  cropX: { type: Number, default: 0 },
  cropY: { type: Number, default: 0 },
  isFavourite: { type: Boolean, default: false, index: true },
  displayOrder: { type: Number, default: 0 }
}, { timestamps: true }));
