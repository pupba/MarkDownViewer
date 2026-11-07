import { Component, memo, useEffect, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import gfm from 'remark-gfm';
import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Root } from 'hast';
import { Check, Copy, FileWarning } from 'lucide-react';
import { readImage, type Source } from './source';
import { resolveReference } from './paths';

function headingText(children: ElementContent[]): string {
  return children.map(node => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return '';
    return node.tagName === 'img' ? String(node.properties.alt ?? '') : headingText(node.children);
  }).join('');
}

function headingAnchors() {
  return (root: Root) => {
    const slugger = new GithubSlugger();
    function visit(node: Root | Element) {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName) && !node.properties.id) {
        const text = headingText(node.children).trim();
        const slug = slugger.slug(text || 'section');
        node.properties.id = 'md-heading-' + slug;
        node.properties.dataOutline = text || '제목 없음';
      }
      for (const child of node.children) {
        if (child.type === 'element') visit(child);
      }
    }
    visit(root);
  };
}

function DocumentImage({ source, path, url, alt, title }: {
  source: Source; path: string; url: string; alt: string; title?: string;
}) {
  const [objectUrl, setUrl] = useState('');
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let active = true;
    let blobUrl = '';
    const target = resolveReference(path, url);
    if (!target || url.startsWith('#')) {
      setFailure('차단된 이미지 주소');
      return;
    }
    void readImage(source, target.path).then(blob => {
      if (!active) return;
      blobUrl = URL.createObjectURL(blob);
      setUrl(blobUrl);
    }, () => {
      if (active) setFailure('이미지를 열 수 없음');
    });
    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [source, path, url]);

  if (failure) return <span className="image-note"><FileWarning size={16} />{failure}{alt && ' · ' + alt}</span>;
  if (!objectUrl) return <span className="image-note">{alt || '이미지'} 불러오는 중…</span>;
  return <img src={objectUrl} alt={alt} title={title} loading="lazy" onError={() => setFailure('손상된 이미지')} />;
}

type TokenLines = Awaited<ReturnType<typeof import('./highlight')['tokenize']>>;

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [tokens, setTokens] = useState<TokenLines>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!language) return;
    let active = true;
    void import('./highlight').then(({ tokenize }) => tokenize(code, language.toLowerCase())).then(lines => {
      if (active) setTokens(lines);
    }).catch(() => { /* The original text stays visible when highlighting fails. */ });
    return () => { active = false; };
  }, [code, language]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus('복사됨');
    } catch {
      setStatus('복사 실패');
    }
  }
  return <div className="code-block">
    <div className="code-header" data-search-exclude>
      <span>{language || '텍스트'}</span>
      <button type="button" className="quiet-button" onClick={copy} aria-label="코드 복사">
        {status === '복사됨' ? <Check size={15} /> : <Copy size={15} />}
        <span aria-live="polite">{status || '복사'}</span>
      </button>
    </div>
    <pre tabIndex={0} aria-label="코드 블록"><code>{tokens
      ? tokens.map((line, index) => <span key={index}>{index > 0 && '\n'}{line.map((token, key) =>
        <span key={key} style={token.htmlStyle as React.CSSProperties}>{token.content}</span>)}</span>)
      : code}</code></pre>
  </div>;
}

export class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="alert" role="alert">문서를 표시할 수 없습니다. 다른 문서를 선택하거나 원본을 다시 읽어 보세요.</p>
      : this.props.children;
  }
}

export const Document = memo(function Document({ source, path, raw, navigate }: {
  source: Source; path: string; raw: string; navigate: (href: string) => void;
}) {
  const components: Components = {
    a: ({ href, children, title, id, node: _node, ...props }) => {
      const target = href && resolveReference(path, href);
      if (!target) return <button type="button" className="blocked-link" onClick={() => navigate(href || '')} title="차단된 링크">{children}</button>;
      return <a {...props} id={id} href={'#' + encodeURIComponent(target.fragment || target.path)} title={title}
        onClick={event => { event.preventDefault(); navigate(href); }}>{children}</a>;
    },
    img: ({ src, alt, title }) => <DocumentImage source={source} path={path} url={src || ''} alt={alt || ''} title={title} />,
    pre: ({ node }) => {
      const child = node?.children[0];
      const language = child?.type === 'element' && Array.isArray(child.properties.className)
        ? String(child.properties.className[0] ?? '').replace(/^language-/, '') : '';
      const code = child?.type === 'element' ? headingText(child.children).replace(/\n$/, '') : '';
      return <CodeBlock language={language} code={code} />;
    },
    table: ({ node: _node, ...props }) =>
      <div className="table-scroll" role="region" aria-label="문서 표" tabIndex={0}><table {...props} /></div>,
    input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked ? '완료' : '미완료'} />,
  };
  return <Markdown remarkPlugins={[gfm]} rehypePlugins={[headingAnchors]} skipHtml
    urlTransform={url => url} components={components}>{raw}</Markdown>;
});
