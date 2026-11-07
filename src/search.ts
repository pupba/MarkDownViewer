interface SearchBlock {
  nodes: Text[];
  text: string;
}

const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'TD', 'TH', 'BLOCKQUOTE']);

export function indexText(root: HTMLElement): SearchBlock[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const blocks: SearchBlock[] = [];
  let previous: HTMLElement | null = null;
  let current: SearchBlock | undefined;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    let block = node.parentElement;
    if (!block || !node.data || block.closest('[data-search-exclude]')) continue;
    while (block !== root && !blockTags.has(block.tagName)) block = block.parentElement!;
    if (!current || block !== previous) {
      current = { nodes: [], text: '' };
      blocks.push(current);
      previous = block;
    }
    current.nodes.push(node);
    current.text += node.data;
  }
  return blocks;
}

export function findRanges(blocks: SearchBlock[], query: string, caseSensitive: boolean): Range[] {
  if (!query.trim()) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
  const result: Range[] = [];
  for (const { nodes, text } of blocks) {
    let startNode = 0;
    let startOffset = 0;
    for (const hit of text.matchAll(pattern)) {
      const start = hit.index;
      const end = start + hit[0].length;
      while (startOffset + nodes[startNode].length <= start) startOffset += nodes[startNode++].length;
      let endNode = startNode;
      let endOffset = startOffset;
      while (endOffset + nodes[endNode].length < end) endOffset += nodes[endNode++].length;
      const range = nodes[startNode].ownerDocument.createRange();
      range.setStart(nodes[startNode], start - startOffset);
      range.setEnd(nodes[endNode], end - endOffset);
      result.push(range);
      if (result.length === 5000) return result;
    }
  }
  return result;
}
