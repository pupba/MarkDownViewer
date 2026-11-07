import { invoke, isTauri } from '@tauri-apps/api/core';
import { assetPath, byteLimit, decodeMarkdown, imageMime, markdownPath, visibleSegment } from './paths';
import wordmark from './assets/wordmark.png';
import start from './assets/sample/시작하기.md?raw';
import examples from './assets/sample/가이드/표현-예제.md?raw';
import privacy from './assets/sample/가이드/파일과-개인정보.md?raw';

export type Mode = 'file' | 'folder';
export interface Entry {
  path: string;
  size: number;
  modified: number;
}
type FileHandle = { kind: 'file'; name: string; getFile(): Promise<File> };
type DirectoryHandle = { kind: 'directory'; name: string; values(): AsyncIterable<FileHandle | DirectoryHandle> };
export type PickerWindow = Window & {
  showOpenFilePicker?: (options: object) => Promise<FileHandle[]>;
  showDirectoryPicker?: (options: object) => Promise<DirectoryHandle>;
};

export interface Source {
  name: string;
  mode: Mode | 'sample';
  documents: string[];
  snapshot?: boolean;
  read(path: string, limit: number): Promise<{ bytes: ArrayBuffer; entry: Entry; mime?: string }>;
}

export async function readDocument(source: Source, path: string) {
  if (!markdownPath.test(path) || !source.documents.includes(path)) throw new Error('선택 범위에 해당 문서가 없습니다.');
  const { bytes, entry } = await source.read(path, byteLimit);
  return { entry, raw: decodeMarkdown(path, new Uint8Array(bytes)) };
}

export async function readImage(source: Source, path: string) {
  if (!assetPath.test(path)) throw new Error('지원 이미지 형식은 PNG, JPEG, GIF, WebP입니다.');
  const { bytes, mime } = await source.read(path, byteLimit);
  const expected = imageMime(path, new Uint8Array(bytes));
  if (mime && mime !== expected) throw new Error('이미지 형식이 확장자와 일치하지 않습니다.');
  return new Blob([bytes], { type: expected });
}

const sortPaths = (paths: Iterable<string>) =>
  [...paths].filter(path => markdownPath.test(path)).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));

export const samplePath = '시작하기.md';
const samples = new Map([[samplePath, start], ['가이드/표현-예제.md', examples], ['가이드/파일과-개인정보.md', privacy]]);
export const sampleSource: Source = {
  name: '예제 문서',
  mode: 'sample',
  documents: [...samples.keys()],
  async read(path) {
    const text = samples.get(path);
    if (text !== undefined) {
      const bytes = new TextEncoder().encode(text).buffer;
      return { bytes, entry: { path, size: bytes.byteLength, modified: 0 } };
    }
    if (path !== '브랜드.png') throw new Error('이미지 파일을 찾을 수 없습니다.');
    const response = await fetch(wordmark);
    if (!response.ok) throw new Error('이미지 파일을 찾을 수 없습니다.');
    const bytes = await response.arrayBuffer();
    return { bytes, entry: { path, size: bytes.byteLength, modified: 0 } };
  },
};

function browserSource(name: string, mode: Mode, files: Map<string, File | FileHandle>, snapshot = false): Source {
  return {
    name, mode, snapshot, documents: sortPaths(files.keys()),
    async read(path, limit) {
      const item = files.get(path);
      if (!item) throw new Error('선택 범위에 해당 파일이 없습니다.');
      const file = 'getFile' in item ? await item.getFile() : item;
      if (file.size > limit) throw new Error('파일 크기가 20 MiB를 초과합니다.');
      return {
        bytes: await file.arrayBuffer(),
        entry: { path, size: file.size, modified: file.lastModified },
        mime: file.type,
      };
    },
  };
}

export function fromFiles(files: File[], mode: Mode) {
  const name = mode === 'folder' ? files[0]?.webkitRelativePath.split('/')[0] || '선택한 폴더' : '선택한 파일';
  const paths = new Map<string, File>();
  for (const file of files) {
    const segments = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1) : [file.name];
    if (segments.every(visibleSegment) && (markdownPath.test(file.name) || assetPath.test(file.name))) {
      paths.set(segments.join('/'), file);
    }
  }
  return browserSource(name, mode, paths, true);
}

export async function openBrowser(mode: Mode) {
  const picker = window as PickerWindow;
  if (mode === 'file' && picker.showOpenFilePicker) {
    const [file] = await picker.showOpenFilePicker({
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
      excludeAcceptAllOption: true,
    });
    return browserSource('선택한 파일', mode, new Map([[file.name, file]]));
  }
  if (mode === 'folder' && picker.showDirectoryPicker) {
    const directory = await picker.showDirectoryPicker({ mode: 'read' });
    const files = new Map<string, FileHandle>();
    const pending = [{ directory, prefix: '' }];
    while (pending.length) {
      const { directory: parent, prefix } = pending.pop()!;
      for await (const handle of parent.values()) {
        if (!visibleSegment(handle.name)) continue;
        const path = prefix + handle.name;
        if (handle.kind === 'directory') pending.push({ directory: handle, prefix: path + '/' });
        else if (markdownPath.test(path) || assetPath.test(path)) files.set(path, handle);
      }
    }
    return browserSource(directory.name, mode, files);
  }
  return null;
}

export const desktop = isTauri();

export async function openDesktop(mode: Mode): Promise<Source | null> {
  const grant = await invoke<{ id: number; name: string; documents: string[] } | null>('choose_source', { folder: mode === 'folder' });
  if (!grant) return null;
  return {
    name: grant.name,
    mode,
    documents: sortPaths(grant.documents),
    async read(path, limit) {
      const buffer = await invoke<ArrayBuffer>('read_selected_file', { id: grant.id, path, limit });
      const view = new DataView(buffer);
      return {
        bytes: buffer.slice(8),
        entry: { path, size: buffer.byteLength - 8, modified: view.getFloat64(0, true) },
      };
    },
  };
}

export function errorMessage(error: unknown) {
  if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
    return '파일 접근이 거부되었습니다. 파일이나 폴더를 다시 선택하세요.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return '파일이 이동되었거나 삭제되었습니다. 파일이나 폴더를 다시 선택하세요.';
  }
  if (error instanceof DOMException && error.name === 'NotReadableError') {
    return '파일을 다시 읽을 수 없습니다. 파일이나 폴더를 다시 선택하세요.';
  }
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '파일을 읽는 중 오류가 발생했습니다.';
}
