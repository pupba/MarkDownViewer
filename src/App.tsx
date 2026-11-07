import { useCallback, useDeferredValue, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, CircleHelp, FilePlus2, FileText, FolderOpen, ListTree, LockKeyhole,
  Moon, PanelLeft, RefreshCw, Search, Sun, X } from 'lucide-react';
import { Document, RenderBoundary } from './Document';
import { FileTree } from './FileTree';
import { desktop, errorMessage, fromFiles, openBrowser, openDesktop, readDocument, samplePath, sampleSource, type Mode, type Source } from './source';
import { markdownPath, resolveReference } from './paths';
import { findRanges, indexText } from './search';
import wordmark from './assets/wordmark.png';

type Reading = Awaited<ReturnType<typeof readDocument>> & { revision: number };
type Heading = { id: string; level: number; label: string };
type Panel = 'files' | 'outline';
type PendingInput = { mode: Mode; restore?: string };
type HighlightApi = typeof CSS & { highlights?: Map<string, unknown> };

function readableSize(size: number) {
  return size < 1024 ? size + ' B' : (size / 1024).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + ' KB';
}

export function App() {
  const [source, setSource] = useState(sampleSource);
  const [reading, setReading] = useState<Reading>();
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [section, setSection] = useState('');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<Range[]>([]);
  const [match, setMatch] = useState(0);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('md-viewer-theme') === 'dark'; } catch { return false; }
  });

  const request = useRef(0);
  const choosing = useRef(false);
  const pending = useRef<PendingInput | undefined>(undefined);
  const fragment = useRef('');
  const dragDepth = useRef(0);
  const article = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const path = reading?.entry.path;

  const load = useCallback(async (next: Source, file: string, anchor = '') => {
    const ticket = ++request.current;
    setLoading(true);
    setError('');
    try {
      const content = await readDocument(next, file);
      if (ticket !== request.current) return;
      fragment.current = anchor;
      setMatch(0);
      setMatches([]);
      setReading({ ...content, revision: ticket });
    } catch (failure) {
      if (ticket === request.current) setError(errorMessage(failure));
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(sampleSource, samplePath); }, [load]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('md-viewer-theme', dark ? 'dark' : 'light'); } catch { /* Storage can be disabled. */ }
  }, [dark]);

  function adopt(next: Source, restore?: string) {
    if (restore && !next.documents.includes(restore)) {
      setError('선택한 파일 또는 폴더에서 현재 문서를 찾을 수 없습니다.');
      return;
    }
    ++request.current;
    setSource(next);
    setReading(undefined);
    setQuery('');
    setError('');
    setPanel(null);
    const first = restore || next.documents.find(file => /^readme\.md$/i.test(file)) || next.documents[0];
    if (first) void load(next, first);
    else setLoading(false);
  }

  const choose = useCallback(async (mode: Mode, restore?: string, snapshot = false) => {
    if (choosing.current) return;
    function fallback() {
      pending.current = { mode, restore };
      (mode === 'file' ? fileInput : folderInput).current?.click();
    }
    if (snapshot) {
      fallback();
      return;
    }
    choosing.current = true;
    setSelecting(true);
    try {
      const next = await (desktop ? openDesktop(mode) : openBrowser(mode));
      if (next) adopt(next, restore);
      else if (!desktop) fallback();
    } catch (failure) {
      if (!desktop && failure instanceof DOMException && failure.name === 'SecurityError') fallback();
      else if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(errorMessage(failure));
    } finally {
      choosing.current = false;
      setSelecting(false);
    }
  }, [load]);

  function receive(event: ChangeEvent<HTMLInputElement>, mode: Mode) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    const restore = pending.current?.mode === mode ? pending.current.restore : undefined;
    pending.current = undefined;
    if (files.length) adopt(fromFiles(files, mode), restore);
  }

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'o') {
          event.preventDefault();
          void choose('file');
        }
        if (event.key.toLowerCase() === 'f' && !search.current?.disabled) {
          event.preventDefault();
          search.current?.focus();
          search.current?.select();
        }
      }
      if (event.key === 'Escape' && panel) setPanel(null);
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [choose, panel]);

  const goTo = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target || !article.current?.contains(target)) return false;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
    setSection(id);
    setPanel(null);
    return true;
  }, []);

  const goFragment = useCallback((anchor: string) => {
    if (!goTo('md-heading-' + anchor) && !goTo(anchor)) setError('문서에서 해당 위치를 찾을 수 없습니다.');
  }, [goTo]);

  useEffect(() => {
    const content = article.current;
    const scroller = scroll.current;
    if (!reading || !content || !scroller) {
      setHeadings([]);
      setSection('');
      return;
    }
    const targets = Array.from(content.querySelectorAll<HTMLElement>('[data-outline]'));
    setHeadings(targets.map(el => ({ id: el.id, level: Number(el.tagName[1]), label: el.dataset.outline! })));
    scroller.scrollTop = 0;
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = scroller!.getBoundingClientRect().top + 110;
        let active = targets[0];
        for (const heading of targets) {
          if (heading.getBoundingClientRect().top > line) break;
          active = heading;
        }
        setSection(active?.id || '');
      });
    }
    update();
    if (fragment.current) goFragment(fragment.current);
    fragment.current = '';
    scroller.addEventListener('scroll', update, { passive: true });
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener('scroll', update); };
  }, [reading, goFragment]);

  useEffect(() => {
    const content = article.current;
    if (!content || !deferredQuery.trim()) {
      setMatches([]);
      return;
    }
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMatches(findRanges(indexText(content!), deferredQuery, caseSensitive)));
    }
    update();
    const observer = new MutationObserver(update);
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [reading, deferredQuery, caseSensitive]);

  useEffect(() => {
    const api = (globalThis.CSS as HighlightApi | undefined)?.highlights;
    if (!api || typeof Highlight === 'undefined') return;
    if (matches.length) api.set('md-search', new Highlight(...matches));
    if (matches[match]) api.set('md-search-active', new Highlight(matches[match]));
    return () => { api.delete('md-search'); api.delete('md-search-active'); };
  }, [matches, match]);

  function step(delta: number) {
    if (!matches.length) return;
    const next = (match + delta + matches.length) % matches.length;
    setMatch(next);
    const range = matches[next];
    const target = range.startContainer.parentElement;
    target?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const code = target?.closest('pre');
    if (code) code.scrollLeft += range.getBoundingClientRect().left - code.getBoundingClientRect().left - 16;
    if (!(globalThis.CSS as HighlightApi | undefined)?.highlights) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  const navigate = useCallback((href: string) => {
    if (!path) return;
    const target = resolveReference(path, href);
    if (!target) {
      setError('이 링크는 열 수 없습니다. 선택한 폴더의 Markdown 링크만 열 수 있습니다.');
      return;
    }
    setError('');
    if (target.path === path && target.fragment) goFragment(target.fragment);
    else if (markdownPath.test(target.path) && source.documents.includes(target.path)) void load(source, target.path, target.fragment);
    else setError('선택 범위에 링크된 문서가 없습니다. 연결된 파일이 있는 폴더를 열어 보세요.');
  }, [path, source, load, goFragment]);

  function openDocument(file: string) {
    setPanel(null);
    void load(source, file);
  }

  function reload() {
    if (!path) return;
    if (source.snapshot && source.mode !== 'sample') void choose(source.mode, path, true);
    else void load(source, path);
  }

  const foldersSupported = desktop || 'webkitdirectory' in HTMLInputElement.prototype || 'showDirectoryPicker' in window;
  const togglePanel = (next: Panel) => setPanel(previous => previous === next ? null : next);
  const firstHeading = headings[0]?.level ?? 1;
  const count = matches.length === 5000 ? '5,000+' : matches.length.toLocaleString('ko-KR');
  const matchIndex = Math.min(match, Math.max(matches.length - 1, 0));

  return <div className="app" data-dragging={dragging || undefined}
    onDragEnter={event => {
      if (desktop || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      dragDepth.current++;
      setDragging(true);
    }}
    onDragOver={event => { if (!desktop && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDragLeave={event => {
      if (!dragDepth.current) return;
      event.preventDefault();
      if (--dragDepth.current === 0) setDragging(false);
    }}
    onDrop={event => {
      if (desktop || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length) adopt(fromFiles(files, 'file'));
    }}>
    <a className="skip" href="#reading-pane">본문으로 이동</a>
    <input ref={fileInput} type="file" accept=".md,.markdown" hidden onChange={event => receive(event, 'file')} />
    <input ref={folderInput} type="file" {...{ webkitdirectory: "" }} multiple hidden onChange={event => receive(event, 'folder')} />
    <header className="topbar">
      <div className="brand">
        <span className="brand-image"><img src={wordmark} alt="PRESTIQUE LABS" /></span>
        <span className="brand-rule" aria-hidden="true" />
        <span className="product">Markdown Viewer</span>
      </div>
      <div className="top-actions">
        <button className="button primary" disabled={selecting} onClick={() => void choose('file')}><FilePlus2 size={16} />파일 열기</button>
        {foldersSupported && <button className="button secondary" disabled={selecting} onClick={() => void choose('folder')}><FolderOpen size={17} />폴더 열기</button>}
        <button className="icon-button theme-button" aria-label={dark ? '밝은 테마로 전환' : '어두운 테마로 전환'}
          title={dark ? '밝은 테마로 전환' : '어두운 테마로 전환'} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={17} />}</button>
      </div>
    </header>

    <div className="workbench">
      <aside id="files-panel" className={panel === 'files' ? 'rail file-rail panel-open' : 'rail file-rail'} aria-label="문서 패널">
        <div className="rail-title"><FolderOpen size={16} /> <h2>문서 탐색</h2><span className="count-chip">{source.documents.length.toLocaleString('ko-KR')}</span></div>
        <div className="rail-body">
          <p className="workspace-name" title={source.name}>{source.name}</p>
          {source.documents.length ? <FileTree files={source.documents} current={path} select={openDocument} />
            : <p className="rail-empty">열 수 있는 문서가 없습니다.</p>}
        </div>
        {source.mode !== 'sample' && <button className="rail-footer quiet-button" onClick={() => adopt(sampleSource)}><CircleHelp size={16} /> 예제 문서 보기</button>}
      </aside>

      <section className="reader">
        <div className="reader-tools">
          <div className="breadcrumbs">
            <button className="icon-button mobile-panel" aria-controls="files-panel" aria-expanded={panel === 'files'}
              aria-label="문서 탐색" onClick={() => togglePanel('files')}><PanelLeft size={18} /></button>
            <span className="crumb-root">{source.name}</span>
            {path && <><ChevronRight size={14} /><span className="crumb-current" title={path}>{path.split('/').join(' / ')}</span></>}
            <button className="icon-button reload-button" aria-label="원본 다시 읽기" title="원본 다시 읽기"
              disabled={!path || loading || selecting} onClick={reload}><RefreshCw size={15} /></button>
          </div>
          <div className="find-tools" role="search" aria-label="문서 내 검색">
            <div className="find-field">
              <Search size={17} />
              <input ref={search} aria-label="문서 내 검색" placeholder="문서 내 검색" value={query}
                disabled={!reading} onChange={event => { setMatch(0); setQuery(event.target.value); }}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
                  if (event.key === 'Escape') { setQuery(''); setMatch(0); search.current?.blur(); }
                }} />
              {query ? <button className="icon-button clear-search" aria-label="검색어 지우기" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={14} /></button>
                : <kbd className="shortcut">Ctrl F</kbd>}
            </div>
            {query && <div className="find-controls">
              <span className="match-count" aria-live="polite">{matches.length ? (matchIndex + 1) + ' / ' + count : '결과 없음'}</span>
              <button className="icon-button case-button" title="대소문자 구분" aria-label="대소문자 구분" aria-pressed={caseSensitive}
                onClick={() => { setMatch(0); setCaseSensitive(!caseSensitive); }}>Aa</button>
              <button className="icon-button" aria-label="이전 검색 결과" disabled={!matches.length} onClick={() => step(-1)}><ArrowUp size={15} /></button>
              <button className="icon-button" aria-label="다음 검색 결과" disabled={!matches.length} onClick={() => step(1)}><ArrowDown size={15} /></button>
            </div>}
          </div>
          <button className="icon-button mobile-panel" aria-controls="outline-panel" aria-expanded={panel === 'outline'}
            aria-label="목차" onClick={() => togglePanel('outline')}><ListTree size={18} /></button>
        </div>

        <main id="reading-pane" className="reader-scroll" ref={scroll} tabIndex={-1} aria-busy={loading}>
          <div className="paper">
            {error && <div className="alert" role="alert"><span>{error}</span><button className="icon-button" aria-label="오류 메시지 닫기" onClick={() => setError('')}><X size={16} /></button></div>}
            {reading ? <>
              <div className="document-meta"><FileText size={15} /><span>MARKDOWN</span><span className="meta-dot" /><span>{readableSize(reading.entry.size)}</span>
                {source.mode === 'sample' && <span className="example-chip">예제</span>}
              </div>
              <article className="document" ref={article} key={reading.revision}>
                <RenderBoundary><Document source={source} path={reading.entry.path} raw={reading.raw} navigate={navigate} /></RenderBoundary>
              </article>
            </> : <div className="empty">
              <FileText size={28} />
              <h1>{loading ? '문서를 불러오는 중…' : '열린 문서가 없습니다'}</h1>
              <p>{loading ? '파일을 읽고 있습니다.' : 'Markdown 파일을 선택하거나 문서가 들어 있는 폴더를 열어 보세요.'}</p>
              {!loading && <button className="button primary" onClick={() => void choose('file')}><FilePlus2 size={16} />파일 열기</button>}
            </div>}
          </div>
        </main>
      </section>

      <aside id="outline-panel" className={panel === 'outline' ? 'rail outline-rail panel-open' : 'rail outline-rail'} aria-label="목차 패널">
        <div className="rail-title"><ListTree size={16} /> <h2>이 문서의 목차</h2></div>
        <nav className="rail-body outline-body" aria-label="이 문서의 목차">
          {headings.length ? <ul className="outline-list">
            {headings.map(heading => <li key={heading.id} style={{ '--depth': Math.max(0, heading.level - firstHeading) } as React.CSSProperties}>
              <a href={'#' + encodeURIComponent(heading.id)} title={heading.label} aria-current={section === heading.id ? 'location' : undefined}
                onClick={event => { event.preventDefault(); goTo(heading.id); }}>{heading.label}</a>
            </li>)}
          </ul> : <p className="rail-empty">표시할 제목이 없습니다.</p>}
        </nav>
      </aside>
    </div>
    <footer className="statusbar">
      <span><LockKeyhole size={13} /> 로컬 읽기 전용</span>
      <span role="status">{loading ? '불러오는 중…' : reading ? 'UTF-8 · Markdown' : 'Markdown Viewer'}</span>
    </footer>
    {dragging && <div className="drop-overlay"><FilePlus2 size={30} /><strong>Markdown 파일을 놓아 열기</strong></div>}
  </div>;
}
