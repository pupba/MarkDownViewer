import { expect, test } from '@playwright/test';

test('원본을 다시 읽고 파일 삭제 후 복구한다', async ({ page }) => {
  await page.addInitScript(() => {
    const scope = window as unknown as {
      currentMarkdown: string | null;
      showOpenFilePicker: () => Promise<unknown[]>;
    };
    scope.currentMarkdown = '# 처음 열기';
    scope.showOpenFilePicker = async () => [{
      kind: 'file', name: 'live.md',
      async getFile() {
        if (scope.currentMarkdown === null) throw new DOMException('', 'NotFoundError');
        return new File([scope.currentMarkdown], 'live.md');
      },
    }];
  });
  await page.goto('/');
  await page.getByRole('button', { name: '파일 열기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '처음 열기' })).toBeVisible();
  await page.evaluate(() => { Object.assign(window, { currentMarkdown: '# 바뀐 내용' }); });
  await page.getByRole('button', { name: '원본 다시 읽기' }).click();
  await expect(page.getByRole('heading', { name: '바뀐 내용' })).toBeVisible();
  await page.evaluate(() => { Object.assign(window, { currentMarkdown: null }); });
  await page.getByRole('button', { name: '원본 다시 읽기' }).click();
  await expect(page.getByRole('alert')).toContainText('이동되었거나 삭제');
  await expect(page.getByRole('heading', { name: '바뀐 내용' })).toBeVisible();
});

test('문서 2,000개를 표시하고 늦은 읽기가 선택을 덮어쓰지 않는다', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { showDirectoryPicker: async () => ({
      name: '검사 폴더',
      async *values() {
        for (let index = 0; index < 2000; index++) {
          const name = index + '.md';
          yield {
            kind: 'file', name,
            async getFile() {
              if (index === 1) await new Promise(resolve => setTimeout(resolve, 750));
              return new File(['# 문서 ' + index], name);
            },
          };
        }
      },
    }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '폴더 열기', exact: true }).click();
  await expect(page.locator('.count-chip')).toHaveText('2,000');
  await page.getByRole('button', { name: '1.md', exact: true }).click();
  await page.getByRole('button', { name: '2.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: '문서 2', exact: true })).toBeVisible();
  await page.waitForFunction(() => document.querySelector('[aria-current="page"]')?.textContent === '2.md');
  await page.getByRole('button', { name: '1999.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: '문서 1999', exact: true })).toBeVisible();
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
  await expect(page.getByRole('heading', { name: '문서 1', exact: true })).toHaveCount(0);
});
