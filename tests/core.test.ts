import { describe, expect, it } from 'vitest';
import { byteLimit, decodeMarkdown, imageMime, resolveReference, visibleSegment } from '../src/paths';
import { findRanges, indexText } from '../src/search';

describe('파일 및 링크 경계', () => {
  it('선택한 루트 안에서 한글, 공백 및 fragment를 해석한다', () => {
    expect(resolveReference('docs/API.md', '../한글%20설명.md#시작')).toEqual({ path: '한글 설명.md', fragment: '시작' });
    expect(resolveReference('docs/API.md', '#%EC%8B%9C%EC%9E%91')).toEqual({ path: 'docs/API.md', fragment: '시작' });
    expect(resolveReference('docs/API.md', 'part%23A.md#foo')).toEqual({ path: 'docs/part#A.md', fragment: 'foo' });
  });
  it.each(['../../secret.md', '%2e%2e/%2e%2e/secret.md', '//remote/a.md', '%2fsecret.md',
    'file:///C:/file.md', 'javascript:alert(1)', 'data:text/html,x', 'https://tracker/x.png',
    'C:%5csecret.md', 'docs%5csecret.md', '.git/config', 'test/%ZZ'])('범위 밖 또는 위험한 참조 차단 %s', href => {
    expect(resolveReference('docs/API.md', href)).toBeNull();
  });
  it('숨김, 의존성, 금지 문자를 제외한다', () => {
    expect(['.git', 'NODE_MODULES', 'a:b.md', 'file.'].map(visibleSegment)).toEqual([false, false, false, false]);
    expect(visibleSegment('한글 API.md')).toBe(true);
  });
  it('UTF-8 BOM을 제거하고 바이너리, 잘못된 인코딩, 제한 초과를 거부한다', () => {
    const encoder = new TextEncoder();
    expect(decodeMarkdown('한글.MARKDOWN', encoder.encode('\ufeff# 한글'))).toBe('# 한글');
    expect(() => decodeMarkdown('a.md', new Uint8Array([0, 65]))).toThrow(/바이너리/);
    expect(() => decodeMarkdown('a.md', new Uint8Array([255]))).toThrow(/UTF-8/);
    expect(() => decodeMarkdown('a.md', new Uint8Array(byteLimit + 1))).toThrow(/20 MiB/);
    expect(() => decodeMarkdown('a.txt', encoder.encode('abc'))).toThrow(/Markdown/);
  });
  it('확장자와 이미지 시그니처를 함께 확인한다', () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(imageMime('logo.png', png)).toBe('image/png');
    expect(() => imageMime('logo.jpg', png)).toThrow();
    expect(() => imageMime('logo.svg', png)).toThrow();
  });
});

describe('문서 내 검색', () => {
  it('서식을 가로질러 찾고 정규식 문자와 대소문자 옵션을 처리한다', () => {
    const root = document.createElement('article');
    root.innerHTML = '<h1>한글 A<strong>PI</strong></h1><p>api.</p><pre>API.</pre><div data-search-exclude>API</div>';
    const index = indexText(root);
    expect(findRanges(index, '한글 API', false).map(range => range.toString())).toEqual(['한글 API']);
    expect(findRanges(index, 'API', true)).toHaveLength(2);
    expect(findRanges(index, 'API', false)).toHaveLength(3);
    expect(findRanges(index, 'API.', false)).toHaveLength(2);
    expect(findRanges(index, ' ', false)).toHaveLength(0);
  });
});
