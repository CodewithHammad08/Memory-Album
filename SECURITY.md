# Security & privacy

## Authentication

The server stores a bcrypt password hash only. Login sessions use HTTP-only, SameSite cookies and are backed by MongoDB; production cookies require HTTPS. Login requests are rate-limited and write requests require a session-bound CSRF token.

## Content encryption

When a private encryption phrase is supplied at unlock, the browser derives a non-exportable AES-256-GCM key with PBKDF2-SHA-256 (310,000 iterations). Journal text is encrypted before it is sent to the server. The phrase and derived key never leave browser memory and are cleared when the album locks. Losing both an encryption phrase and any separately exported recovery material means encrypted entries cannot be recovered.

## Images and Cloudinary

Cloudinary credentials stay server-side. Upload signatures are generated only for authenticated sessions and use authenticated delivery. For full end-to-end image encryption, encrypt the file in the browser before upload and send it as a Cloudinary `raw` authenticated asset; no image transformation must be used on encrypted files.

## Limits

No client-only application can secure a device that is already compromised. Make periodic offline encrypted backups; Cloudinary is not a permanent-only archive.
