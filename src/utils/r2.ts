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

/** 提取正文中所有图片 URL */
export function extractImageUrls(html: string): string[] {
  const urls: string[] = [];
  const regex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const src = match[1];
    if (src.startsWith('http') && !urls.includes(src)) {
      urls.push(src);
    }
  }
  return urls.slice(0, 30); // 最多 10 张，避免超时
}

/** 替换正文中的图片链接 */
export function replaceImageUrls(html: string, uploads: ImageUploadResult[]): string {
  let result = html;
  for (const upload of uploads) {
    result = result.replaceAll(upload.originalUrl, upload.r2Url);
  }
  return result;
}
