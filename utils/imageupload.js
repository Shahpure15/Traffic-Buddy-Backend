const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');
const path = require('path');
const { compressImage } = require('./imageCompression');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY,
  },
});

/**
 * Uploads an image to Cloudflare R2 storage
 * @param {Buffer|Object|string} image - Image as buffer, multer file, or base64 string
 * @param {string} folder - Folder name in the bucket
 * @returns {Promise<string>} Public URL of the uploaded image
 */
const uploadImageToR2 = async (image, folder = 'traffic_buddy') => {
  try {
    if (!image) {
      throw new Error('Missing required parameter: image');
    }

    console.log(`Starting R2 upload to folder: ${folder}`);
    
    let buffer;
    let contentType = 'image/jpeg';
    let fileExt = 'jpeg';
    
    // Handle multer file
    if (image.buffer) {
      console.log('Processing multer file upload');
      buffer = image.buffer;
      contentType = image.mimetype || 'image/jpeg';
      fileExt = contentType.split('/')[1] || 'jpeg';
    } 
    // Handle base64 string
    else if (typeof image === 'string') {
      console.log('Compressing base64 image...');
      try {
        // Compress the image before uploading (50% quality)
        const compressedImage = await compressImage(image, 50);
        console.log('Image compressed successfully');
        
        // Extract the content type and base64 data
        const matches = compressedImage.match(/^data:(.+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
          throw new Error('Invalid base64 format after compression');
        }
        
        contentType = matches[1];
        const base64Data = matches[2];
        buffer = Buffer.from(base64Data, 'base64');
        fileExt = contentType.split('/')[1] || 'jpeg';
      } catch (compressError) {
        console.error('Error in compression, trying direct upload:', compressError);
        
        // Try to handle it as a direct base64 string without data URI
        if (!image.includes('data:')) {
          buffer = Buffer.from(image, 'base64');
        } else {
          // Try one more time to extract base64 data from data URI
          const parts = image.split(';base64,');
          if (parts.length === 2) {
            const dataPart = parts[0];
            const base64Part = parts[1];
            contentType = dataPart.replace('data:', '') || 'image/jpeg';
            buffer = Buffer.from(base64Part, 'base64');
            fileExt = contentType.split('/')[1] || 'jpeg';
          } else {
            throw new Error('Unable to parse base64 image');
          }
        }
      }
    }
    // Handle buffer directly
    else if (Buffer.isBuffer(image)) {
      console.log('Processing buffer upload');
      buffer = image;
    }
    else {
      throw new Error('Unsupported image format');
    }
    
    console.log(`Buffer size: ${buffer.length} bytes`);
    console.log(`Content type: ${contentType}`);
    
    // Generate unique filename
    const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
    console.log(`File name: ${fileName}`);

    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
    });

    console.log('Sending to R2...');
    await s3Client.send(command);
    console.log('Upload complete');
    
    // Construct the public URL using the public endpoint
    const url = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${fileName}`;
    console.log('Generated URL:', url);
    return url;
  } catch (error) {
    console.error('Error uploading image to R2:', error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
};

module.exports = { uploadImageToR2 };