import { Box, useTheme } from '@mui/material';
import mermaid from 'mermaid';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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

const stripDisallowedTags = (code: string) =>
  code
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*\/?\s*script[^>]*>/gi, '');

type MermaidProps = {
  code: string;
};

function MermaidBlock({ code }: MermaidProps) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderId = useId().replace(/:/g, '-');

  const sanitizedCode = useMemo(() => stripDisallowedTags(code), [code]);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme.palette.mode === 'dark' ? 'dark' : 'default',
    });
  }, [theme.palette.mode]);

  useEffect(() => {
    let mounted = true;
    const render = async () => {
      setError(null);
      try {
        const { svg } = await mermaid.render(
          `mermaid-${renderId}`,
          sanitizedCode,
          containerRef.current ?? undefined,
        );
        if (!mounted) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!mounted) return;
        setError('Diagram failed to render');
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }
        console.error('Mermaid render error', err);
      }
    };
    render();
    return () => {
      mounted = false;
    };
  }, [renderId, sanitizedCode, theme.palette.mode]);

  return (
    <Box
      sx={{
        backgroundColor: (mui) => mui.palette.background.default,
        border: (mui) => `1px solid ${mui.palette.divider}`,
        borderRadius: 1,
        padding: 1,
        overflowX: 'auto',
        '& svg': {
          display: 'block',
          maxWidth: '100%',
        },
      }}
    >
      {error ? (
        <Box
          component="code"
          sx={{
            color: (mui) => mui.palette.error.main,
            display: 'block',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </Box>
      ) : (
        <div ref={containerRef} />
      )}
    </Box>
  );
}

export default function Markdown({
  content,
  'data-testid': dataTestId,
}: MarkdownProps) {
  return (
    <Box
      data-testid={dataTestId}
      sx={{
        minWidth: 0,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        '& p': { margin: '0 0 0.5em' },
        '& ul, & ol': { paddingLeft: '1.25rem', margin: '0 0 0.5em' },
        '& li': { marginBottom: '0.25em' },
        '& pre': {
          backgroundColor: (theme) => theme.palette.action.hover,
          borderRadius: 1,
          padding: 1,
          overflowX: 'auto',
          maxWidth: '100%',
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
        '& table': {
          display: 'block',
          maxWidth: '100%',
          overflowX: 'auto',
        },
        '& img': {
          maxWidth: '100%',
          height: 'auto',
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
        components={{
          code({ inline, className, children, ...props }) {
            const language = /language-([\w-]+)/.exec(className ?? '');
            const text = String(children ?? '').trim();
            if (!inline && language?.[1]?.toLowerCase() === 'mermaid') {
              return <MermaidBlock code={text} />;
            }
            if (!inline) {
              return (
                <pre>
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}
