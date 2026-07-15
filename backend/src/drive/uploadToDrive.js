// Uploads a file (e.g. a property photo pulled from a WhatsApp/Telegram
// chat) straight to Google Drive via a service account — so the free-tier
// backend disk (which is ephemeral anyway) never holds uploaded media, and
// we use Drive's 15GB free storage instead of paying for hosted file storage.
'use strict';

const { google } = require('googleapis');
const { Readable } = require('stream');

function getDriveClient() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY تنظیم نشده است.');
  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Creates (or reuses) a per-property subfolder under the shared parent
 * folder, so every listing's photos stay grouped together.
 */
async function getOrCreatePropertyFolder(drive, propertyName) {
  const parentId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!parentId) throw new Error('GOOGLE_DRIVE_PARENT_FOLDER_ID تنظیم نشده است.');

  const safeName = propertyName.replace(/['"]/g, '');
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
  });
  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: { name: safeName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return folder.data.id;
}

/**
 * @param {string} propertyName - used to group photos of the same listing
 * @param {{ filename: string, mimeType: string, buffer: Buffer }[]} files
 * @returns {Promise<string>} a shareable link to the property's folder
 */
async function uploadPropertyPhotos(propertyName, files) {
  const drive = getDriveClient();
  const folderId = await getOrCreatePropertyFolder(drive, propertyName);

  for (const file of files) {
    await drive.files.create({
      requestBody: { name: file.filename, parents: [folderId] },
      media: { mimeType: file.mimeType, body: Readable.from(file.buffer) },
    });
  }

  // Share "anyone with the link can view" so the link works when pasted into
  // the app or sent to a client — matches how the folder will be used.
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  const folder = await drive.files.get({ fileId: folderId, fields: 'webViewLink' });
  return folder.data.webViewLink;
}

module.exports = { uploadPropertyPhotos };
