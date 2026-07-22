'use client';

// Reads an image File chosen from the user's gallery/camera and returns a small
// square JPEG data URL (center-cropped, ~size px). Downscaling in the browser
// keeps the stored avatar to a few KB, so it fits comfortably in a DB text
// column and uploads instantly.
export function fileToAvatarDataUrl(file, size = 160) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('فایل تصویر معتبر نیست.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // cover: scale so the image fills the square, then center-crop
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('خواندن تصویر ناموفق بود.'));
    };
    img.src = url;
  });
}
