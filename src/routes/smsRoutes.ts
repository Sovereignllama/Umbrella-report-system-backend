import { Router, Request, Response } from 'express';
import {
  generateTwiMLResponse,
  downloadTwilioMedia,
  getExtensionFromMimeType,
  validateTwilioSignature,
  isImageContentType,
} from '../services/twilioService';
import { getOrCreateFolder, uploadFile, getFolderByPath } from '../services/sharepointService';
import { parseSmsDate } from '../utils/dateParser';

const router = Router();

/**
 * Twilio webhook for incoming SMS/MMS messages
 * POST /api/sms/incoming
 * 
 * Receives photos of daily sign-in/out sheets and uploads them to SharePoint
 */
router.post('/incoming', async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate Twilio signature for security
    const twilioSignature = req.headers['x-twilio-signature'] as string;
    if (!twilioSignature) {
      res.status(403).send('Forbidden: Missing signature');
      return;
    }

    // Use explicit webhook URL if configured (required behind reverse proxies like Render)
    const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
    let url: string;
    if (webhookUrl) {
      url = webhookUrl;
    } else {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      url = `${protocol}://${host}${req.originalUrl}`;
    }
    
    const isValid = validateTwilioSignature(url, req.body, twilioSignature);
    if (!isValid) {
      console.warn('Invalid Twilio signature received');
      res.status(403).send('Forbidden: Invalid signature');
      return;
    }

    const {
      Body: messageBody = '',
      NumMedia: numMediaStr = '0',
      MediaUrl0: mediaUrl,
      MediaContentType0: mediaContentType,
    } = req.body;

    const numMedia = parseInt(numMediaStr);

    // Validation 1: Check for exactly one photo
    if (numMedia === 0) {
      res.type('text/xml').send(
        generateTwiMLResponse('Please attach a photo of the sign-in/out sheet.')
      );
      return;
    }

    if (numMedia > 1) {
      res.type('text/xml').send(
        generateTwiMLResponse('Please send only one photo per message.')
      );
      return;
    }

    // Validation 2: Check that media is an image
    if (!isImageContentType(mediaContentType)) {
      res.type('text/xml').send(
        generateTwiMLResponse('Please send an image file (JPEG, PNG, etc.).')
      );
      return;
    }

    // Validation 3: Parse the date from message body
    const parsedDate = parseSmsDate(messageBody);
    if (!parsedDate) {
      res.type('text/xml').send(
        generateTwiMLResponse(
          "I couldn't understand the date. Please send a photo with the date in one of these formats: Feb 16, feb16, 2/16, or February 16"
        )
      );
      return;
    }

    // Format date for filename and folder structure
    const year = parsedDate.getUTCFullYear();
    const month = parsedDate.getUTCMonth();
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[month];
    
    // Format date as YYYY-MM-DD for filename
    const dateStr = parsedDate.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Get file extension from content type
    const extension = getExtensionFromMimeType(mediaContentType);
    const fileName = `${dateStr}.${extension}`;

    // Download the photo from Twilio
    console.log(`📥 Downloading photo from Twilio: ${mediaUrl}`);
    const photoBuffer = await downloadTwilioMedia(mediaUrl);

    // Create folder structure: Track/sign_in_out/{year}/{month_name}/
    // Navigate to existing Track/sign_in_out folder, then create year/month as needed
    console.log(`📁 Creating SharePoint folder structure: Track/sign_in_out/${year}/${monthName}/`);
    
    const signInOutFolder = await getFolderByPath('Track/sign_in_out');
    if (!signInOutFolder) {
      throw new Error('Track/sign_in_out folder not found in SharePoint');
    }
    
    // Get or create year folder (e.g., "2026")
    const yearFolder = await getOrCreateFolder(signInOutFolder.id, String(year));
    
    // Get or create month folder (e.g., "February")
    const monthFolder = await getOrCreateFolder(yearFolder.folderId, monthName);

    // Upload the photo to SharePoint
    console.log(`☁️  Uploading file: ${fileName}`);
    const uploadResult = await uploadFile(monthFolder.folderId, fileName, photoBuffer);
    
    console.log(`✅ Sign-in/out sheet uploaded successfully: ${uploadResult.webUrl}`);

    // Send success response via TwiML
    res.type('text/xml').send(
      generateTwiMLResponse(`✅ Sign-in/out sheet uploaded for ${dateStr}`)
    );
  } catch (error) {
    console.error('Error processing SMS webhook:', error);
    
    // Send error response via TwiML
    res.type('text/xml').send(
      generateTwiMLResponse('Sorry, there was an error processing your request. Please try again.')
    );
  }
});

export default router;
