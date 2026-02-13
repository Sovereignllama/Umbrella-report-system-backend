import axios from 'axios';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.warn('⚠️  Twilio credentials not configured. SMS webhook will not function.');
}

/**
 * Generate TwiML response XML
 */
export function generateTwiMLResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Download media from Twilio URL
 * @param mediaUrl - The Twilio media URL
 * @returns Buffer containing the media content
 */
export async function downloadTwilioMedia(mediaUrl: string): Promise<Buffer> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials not configured');
  }
  
  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: {
        username: TWILIO_ACCOUNT_SID,
        password: TWILIO_AUTH_TOKEN,
      },
    });
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error('Failed to download media from Twilio:', error);
    throw new Error('Failed to download media from Twilio');
  }
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
  };
  
  return mimeToExt[mimeType.toLowerCase()] || 'jpg';
}

/**
 * Validate Twilio request signature
 * @param url - The full URL of the webhook endpoint
 * @param params - The POST parameters from Twilio
 * @param signature - The X-Twilio-Signature header value
 * @returns true if signature is valid, false otherwise
 */
export function validateTwilioSignature(
  url: string,
  params: Record<string, any>,
  signature: string
): boolean {
  if (!TWILIO_AUTH_TOKEN) {
    console.error('Cannot validate signature: TWILIO_AUTH_TOKEN not configured');
    return false;
  }
  
  try {
    return twilio.validateRequest(
      TWILIO_AUTH_TOKEN,
      signature,
      url,
      params
    );
  } catch (error) {
    console.error('Error validating Twilio signature:', error);
    return false;
  }
}

/**
 * Check if content type is an image
 */
export function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}
