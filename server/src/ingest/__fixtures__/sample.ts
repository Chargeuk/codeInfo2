export const exampleOne = `function alpha() {
  return 'alpha';
}

class Beta {
  method() {
    return 'beta';
  }
}
`;

export const longRun = `function start() {
  return 'start';
}

function middle() {
  ${'x'.repeat(3000)}
}
`;

export const prosePlanningDoc = `# Story Heading

This is a planning note that should stay grouped as prose.

## Goals

- Keep markdown headings together.
- Keep lists together when possible.

\`\`\`ts
export function example() {
  return 'fenced block';
}
\`\`\`

This trailing paragraph should remain part of the prose-oriented chunk flow.
`;

export const longProseParagraph =
  `${'Sentence about large-text chunking. '.repeat(160)}`.trim();
