declare module 'tree-sitter' {
  const TreeSitter: unknown;
  export default TreeSitter;
}

declare module 'tree-sitter-javascript' {
  const language: unknown;
  export default language;
}

declare module 'tree-sitter-typescript' {
  const language: { typescript: unknown; tsx: unknown };
  export default language;
}
