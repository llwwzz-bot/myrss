// ============================================================
// Cloudflare R2 图片存储
// ============================================================
import type { ImageUploadResult } from '../types';

/** 下载远程图片上传到 R2，返回 R2 地址（通过 Worker /img 路由访问） */
export async function uploadImageToR2(
  bucket: R2Bucket,
  workerHost: string,
  imageUrl: string,
  articleId: string,
  index: number
): Promise<ImageUploadResult | null> {
  try {
    const resp = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0 Safari/537.36', 'Referer': new URL(imageUrl).origin + '/' },
    });
    if (!resp.ok || !resp.body) return null;

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('webp') ? 'webp'
      : contentType.includes('gif') ? 'gif'
      : 'jpg';

    const key = `articles/${articleId}/${index}.${ext}`;
    await bucket.put(key, resp.body, { httpMetadata: { contentType } });

    return {
      originalUrl: imageUrl,
      r2Url: `https://${workerHost}/img/${articleId}/${index}`,
    };
  } catch {
    return null;
  }
}

/** 上传 base64 data URI 图片到 R2 */
export async function uploadBase64ToR2(
  bucket: R2Bucket,
  workerHost: string,
  dataUri: string,
  articleId: string,
  index: number
): Promise<ImageUploadResult | null> {
  try {
    const match = dataUri.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return null;

    const mimeType = match[1];               // e.g. "image/webp"
    const base64Data = match[2];
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const ext = mimeType.includes('png') ? 'png'
      : mimeType.includes('webp') ? 'webp'
      : mimeType.includes('gif') ? 'gif'
      : 'jpg';

    const key = `articles/${articleId}/${index}.${ext}`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: mimeType } });

    return {
      originalUrl: dataUri,
      r2Url: `https://${workerHost}/img/${articleId}/${index}`,
    };
  } catch {
    return null;
  }
}

/** 提取正文中所有图片 URL（http + base64 data URI） */
export function extractImageUrls(html: string): string[] {
  const urls: string[] = [];
  const regex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const src = match[1];
    if ((src.startsWith('http') || src.startsWith('data:image/')) && !urls.includes(src)) {
      urls.push(src);
    }
  }
  return urls.slice(0, 30);
}

/** 替换正文中的图片链接（支持 http + data URI） */
export function replaceImageUrls(html: string, uploads: ImageUploadResult[]): string {
  let result = html;
  for (const upload of uploads) {
    // data URI 可能超长，用 split/join 比 replaceAll 更可靠
    result = result.split(upload.originalUrl).join(upload.r2Url);
  }
  return result;
}