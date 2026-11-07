import { FileText, Folder, ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

type Branch = { files: string[]; folders: Map<string, Branch> };

function listFiles(paths: string[]) {
  const root: Branch = { files: [], folders: new Map() };
  for (const path of paths) {
    let branch = root;
    for (const name of path.split('/').slice(0, -1)) {
      if (!branch.folders.has(name)) branch.folders.set(name, { files: [], folders: new Map() });
      branch = branch.folders.get(name)!;
    }
    branch.files.push(path);
  }
  return root;
}

function TreeBranch({ branch, current, select, prefix }: {
  branch: Branch; current?: string; select: (path: string) => void; prefix: string;
}) {
  return <ul className="tree-list">
    {branch.files.map(path => <li key={path}>
      <button className="tree-row" title={path} aria-current={current === path ? 'page' : undefined} onClick={() => select(path)}>
        <FileText size={16} /><span>{path.split('/').at(-1)}</span>
      </button>
    </li>)}
    {[...branch.folders].map(([name, folder]) => <li key={name}>
      <details open={current?.startsWith(prefix + name + '/') || undefined}>
        <summary className="tree-row folder-row"><ChevronDown size={14} /><Folder size={15} /><span>{name}</span></summary>
        <TreeBranch branch={folder} current={current} select={select} prefix={prefix + name + '/'} />
      </details>
    </li>)}
  </ul>;
}

export function FileTree({ files, current, select }: { files: string[]; current?: string; select: (path: string) => void }) {
  const root = useMemo(() => listFiles(files), [files]);
  return <nav aria-label="문서 탐색"><TreeBranch branch={root} current={current} select={select} prefix="" /></nav>;
}
