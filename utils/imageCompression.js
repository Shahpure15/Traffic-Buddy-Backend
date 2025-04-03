const sharp = require('sharp');

/**
 * Compresses an image from base64 string or buffer
 * @param {string|Buffer} image - Base64-encoded image string, Buffer, or file object
 * @param {number} quality - JPEG quality (1-100), defaults to 50
 * @returns {Promise<string>} Compressed base64 image with data URI scheme
 */
async function compressImage(image, quality = 50) {
  try {
    // Handle different input types
    let buffer;
    let contentType = 'image/jpeg'; // Default content type

    // Case 1: image is already a Buffer
    if (Buffer.isBuffer(image)) {
      buffer = image;
    }
    // Case 2: image is a base64 string with data URI format
    else if (typeof image === 'string' && image.startsWith('data:')) {
      const matches = image.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        contentType = matches[1];
        const base64Data = matches[2];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        throw new Error('Invalid base64 image format');
      }
    }
    // Case 3: image is a plain base64 string without data URI
    else if (typeof image === 'string') {
      buffer = Buffer.from(image, 'base64');
    }
    // Case 4: image is a file from multer
    else if (image && image.buffer) {
      buffer = image.buffer;
      contentType = image.mimetype || contentType;
    }
    else {
      throw new Error('Unsupported image format');
    }
    
    // Compress image using sharp
    const compressedBuffer = await sharp(buffer)
      .jpeg({ quality: quality })
      .toBuffer();
    
    // Convert back to base64
    const compressedBase64 = compressedBuffer.toString('base64');
    
    // Return with proper data URI format
    return `data:image/jpeg;base64,${compressedBase64}`;
  } catch (error) {
    console.error('Error compressing image:', error);
    // If compression fails, return original if it's a Buffer or a file
    if (Buffer.isBuffer(image)) {
      return `data:image/jpeg;base64,${image.toString('base64')}`;
    } else if (image && image.buffer) {
      return `data:${image.mimetype || 'image/jpeg'};base64,${image.buffer.toString('base64')}`;
    }
    throw error;
  }
}

module.exports = { compressImage };