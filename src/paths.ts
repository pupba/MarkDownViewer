export const markdownPath = /\.(?:md|markdown)$/i;
export const assetPath = /\.(?:png|jpe?g|gif|webp)$/i;
export const byteLimit = 20 * 1024 * 1024;
const excluded = new Set(['node_modules', '__macosx', 'thumbs.db']);

export function visibleSegment(name: string) {
  return Boolean(name && !name.startsWith('.') && !excluded.has(name.toLowerCase()) &&
    !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(name) && !/[. ]$/.test(name));
}

export function resolveReference(from: string, reference: string) {
  try {
    const [rawPath, rawFragment] = reference.trim().split(/#(.*)/s);
    const relative = decodeURIComponent(rawPath);
    const fragment = decodeURIComponent(rawFragment ?? '');
    if (!relative) return reference.startsWith('#') ? { path: from, fragment } : null;
    if (/^(?:\/|\\)|[\\:\x00-\x1f\x7f]/.test(relative)) return null;
    const segments = from.split('/').slice(0, -1);
    for (const part of relative.split('/')) {
      if (part === '.') continue;
      if (part === '..') {
        if (!segments.length) return null;
        segments.pop();
      } else {
        if (!visibleSegment(part)) return null;
        segments.push(part);
      }
    }
    return { path: segments.join('/'), fragment };
  } catch {
    return null;
  }
}

export function imageMime(path: string, bytes: Uint8Array) {
  const signature = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, value: string) =>
    [...value].every((char, index) => bytes[start + index] === char.charCodeAt(0));
  if (/\.png$/i.test(path) && signature(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (/\.jpe?g$/i.test(path) && signature(255, 216, 255)) return 'image/jpeg';
  if (/\.gif$/i.test(path) && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return 'image/gif';
  if (/\.webp$/i.test(path) && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  throw new Error('지원하지 않거나 손상된 이미지입니다.');
}

export function decodeMarkdown(path: string, bytes: Uint8Array) {
  if (!markdownPath.test(path)) throw new Error('Markdown 파일(.md, .markdown)을 선택하세요.');
  if (bytes.byteLength > byteLimit) throw new Error('파일 크기가 20 MiB를 초과합니다.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('UTF-8로 저장된 Markdown 파일을 선택하세요.');
  }
  if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) throw new Error('바이너리 파일은 열 수 없습니다.');
  return text;
}
