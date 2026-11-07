import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('예제 문서, 목차, 코드 강조, 검색, 좁은 화면', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Markdown Viewer 사용 가이드' })).toBeVisible();
  await page.getByRole('link', { name: '빠른 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '빠른 시작' })).toBeFocused();
  await page.getByRole('link', { name: 'Markdown 표현 예제' }).click();
  await expect(page.getByRole('heading', { name: 'Markdown 표현 예제' })).toBeVisible();
  await expect(page.locator('pre [style*="--shiki-light"]').first()).toBeVisible();
  await expect(page.locator('article img')).toBeVisible();
  await page.keyboard.press('Control+f');
  const search = page.getByRole('textbox', { name: '문서 내 검색' });
  await expect(search).toBeFocused();
  await search.fill('문서');
  await expect(page.locator('.match-count')).toHaveText(/1 \/ [2-9]/);
  await search.press('Enter');
  await expect(page.locator('.match-count')).toHaveText(/2 \/ [2-9]/);
  await search.press('Escape');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole('button', { name: '목차', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '이 문서의 목차' })).toBeVisible();
  await page.getByRole('link', { name: '체크리스트', exact: true }).click();
  await expect(page.getByRole('heading', { name: '체크리스트' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test('선택 폴더 탐색, 로컬 이미지, 외부 차단, 원본 보존', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'md-viewer-'));
  const main = join(dir, 'README.md');
  const external: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('blob:')) external.push(request.url());
  });
  try {
    await mkdir(join(dir, 'docs'));
    await writeFile(main, '\ufeff# 한글 문서\n\n[이동](docs/API.md#endpoint)\n\n![추적](https://example.invalid/track.png)\n\n[탈출](../secret.md)\n\n<script>window.evil = true</script>');
    await writeFile(join(dir, 'docs', 'API.md'), '# API\n\n## Endpoint\n\n![로고](../brand.png)');
    await writeFile(join(dir, 'brand.png'), await readFile('src/assets/mark.png'));
    const before = [createHash('sha256').update(await readFile(main)).digest('hex'), (await stat(main)).mtimeMs];
    await page.goto('/');
    await page.locator('input[webkitdirectory]').setInputFiles(dir);
    await expect(page.getByRole('heading', { name: '한글 문서' })).toBeVisible();
    await expect(page.getByText('차단된 이미지 주소 · 추적')).toBeVisible();
    await page.getByRole('button', { name: '탈출' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('link', { name: '이동', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Endpoint' })).toBeFocused();
    await expect(page.getByRole('img', { name: '로고' })).toBeVisible();
    expect(await page.locator('article script').count()).toBe(0);
    expect(external).toEqual([]);
    expect([createHash('sha256').update(await readFile(main)).digest('hex'), (await stat(main)).mtimeMs]).toEqual(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('잘못된 인코딩 오류에서 다른 문서를 열어 복구한다', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('input[accept]');
  await input.setInputFiles({ name: 'invalid.md', mimeType: 'text/markdown', buffer: Buffer.from([255, 255]) });
  await expect(page.getByRole('alert')).toContainText('UTF-8');
  await input.setInputFiles({ name: 'valid.markdown', mimeType: 'text/markdown', buffer: Buffer.from('# 다시 열기') });
  await expect(page.getByRole('heading', { name: '다시 열기' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
