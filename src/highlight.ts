import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const grammars = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  bash: () => import('shiki/langs/shellscript.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
};
const aliases: Record<string, keyof typeof grammars> = {
  js: 'javascript', ts: 'typescript', py: 'python', rs: 'rust', sh: 'bash', shell: 'bash',
  zsh: 'bash', ps1: 'powershell', yml: 'yaml', md: 'markdown',
};
const highlighter = createHighlighterCore({
  themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});

export async function tokenize(code: string, language: string) {
  const key = Object.hasOwn(aliases, language) ? aliases[language] : language as keyof typeof grammars;
  if (!Object.hasOwn(grammars, key) || code.length > 20000) return null;
  const instance = await highlighter;
  await instance.loadLanguage(grammars[key]());
  return instance.codeToTokens(code, { lang: key === 'bash' ? 'shellscript' : key, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false }).tokens;
}
