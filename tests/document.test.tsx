import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Document } from '../src/Document';
import { sampleSource } from '../src/source';

afterEach(cleanup);

it('GFM과 중복 한글 앵커를 렌더링하고 위험한 HTML 및 링크를 격리한다', () => {
  const navigate = vi.fn();
  const raw = [
    '# 같은 제목!', '# 같은 제목!', '# 같은 제목-1', '###### 작은 제목',
    '- [x] 완료', '| A | B |\n| - | - |\n| 1 | ~~2~~ |',
    '<script>evil()</script>',
    '[차단](javascript:evil) [이동](guide.md#api)',
    '![추적](https://example.invalid/x.png)',
    '```unknown\n<code>\n```',
  ].join('\n\n');
  const { container, getByRole, getByText } = render(<Document source={sampleSource} path="README.md" raw={raw} navigate={navigate} />);
  expect([...container.querySelectorAll('[data-outline]')].map(heading => heading.id)).toEqual([
    'md-heading-같은-제목', 'md-heading-같은-제목-1', 'md-heading-같은-제목-1-1', 'md-heading-작은-제목',
  ]);
  expect(container.querySelector('table del')?.textContent).toBe('2');
  expect((getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  expect(container.querySelector('script, img, a[href^="javascript:"]')).toBeNull();
  expect(getByText('<code>').tagName).toBe('CODE');
  fireEvent.click(getByRole('link', { name: '이동' }));
  expect(navigate).toHaveBeenCalledWith('guide.md#api');
});
