const cloudinary = require('../config/cloudinary');

/**
 * Upload a file to Cloudinary
 * @param {string} fileData — base64 data URI or file path
 * @param {string} folder — Cloudinary folder name
 * @returns {object} Cloudinary upload result
 */
const uploadToCloudinary = async (fileData, folder = 'parcels') => {
  try {
    const result = await cloudinary.uploader.upload(fileData, {
      folder: `cargo-express66/${folder}`,
      resource_type: 'auto',
      quality: 'auto',
      fetch_format: 'auto',
    });

    return {
      public_id: result.public_id,
      secure_url: result.secure_url,
      url: result.url,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
    };
  } catch (err) {
    console.error('Cloudinary upload error:', err.message);
    throw new Error(`Failed to upload to Cloudinary: ${err.message}`);
  }
};

/**
 * Delete a file from Cloudinary by public_id
 * @param {string} publicId — Cloudinary public_id
 * @returns {object} Cloudinary deletion result
 */
const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
    });
    return result;
  } catch (err) {
    console.error('Cloudinary delete error:', err.message);
    throw new Error(`Failed to delete from Cloudinary: ${err.message}`);
  }
};

/**
 * Extract public_id from a Cloudinary URL
 * @param {string} url — Cloudinary URL
 * @returns {string} public_id
 */
const extractPublicId = (url) => {
  try {
    // URL format: https://res.cloudinary.com/<cloud>/image/upload/v<version>/<public_id>.<ext>
    const parts = url.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return null;

    // Skip version segment if present (v1234567890)
    let publicIdParts = parts.slice(uploadIndex + 1);
    if (publicIdParts[0] && publicIdParts[0].startsWith('v')) {
      publicIdParts = publicIdParts.slice(1);
    }

    // Remove file extension from last part
    const lastPart = publicIdParts[publicIdParts.length - 1];
    publicIdParts[publicIdParts.length - 1] = lastPart.replace(/\.[^/.]+$/, '');

    return publicIdParts.join('/');
  } catch {
    return null;
  }
};

/**
 * Upload multiple files and return array of URLs
 */
const uploadMultipleToCloudinary = async (files, folder = 'parcels') => {
  const results = [];
  for (const file of files) {
    const result = await uploadToCloudinary(file, folder);
    results.push(result.secure_url);
  }
  return results;
};

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  extractPublicId,
  uploadMultipleToCloudinary,
};
