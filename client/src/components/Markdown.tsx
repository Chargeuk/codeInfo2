import { Box } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

type MarkdownProps = {
  content: string;
  'data-testid'?: string;
};

const markdownSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className']],
    span: [...(defaultSchema.attributes?.span ?? []), ['className']],
    pre: [...(defaultSchema.attributes?.pre ?? []), ['className']],
  },
};

export default function Markdown({
  content,
  'data-testid': dataTestId,
}: MarkdownProps) {
  return (
    <Box
      data-testid={dataTestId}
      sx={{
        '& p': { margin: '0 0 0.5em' },
        '& ul, & ol': { paddingLeft: '1.25rem', margin: '0 0 0.5em' },
        '& li': { marginBottom: '0.25em' },
        '& pre': {
          backgroundColor: (theme) => theme.palette.action.hover,
          borderRadius: 1,
          padding: 1,
          overflowX: 'auto',
          margin: '0.25em 0',
          fontSize: '0.9rem',
        },
        '& code': {
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: '0.9em',
          backgroundColor: (theme) => theme.palette.action.hover,
          borderRadius: '4px',
          padding: '0.1em 0.25em',
        },
        '& pre code': {
          backgroundColor: 'transparent',
          padding: 0,
        },
        '& blockquote': {
          borderLeft: (theme) => `4px solid ${theme.palette.divider}`,
          margin: '0.25em 0',
          paddingLeft: '0.75em',
          color: 'text.secondary',
        },
        '& a': {
          color: 'primary.main',
          textDecoration: 'underline',
          wordBreak: 'break-word',
        },
        '& :last-child': { marginBottom: 0 },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize(markdownSchema)]}
        linkTarget="_blank"
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}
