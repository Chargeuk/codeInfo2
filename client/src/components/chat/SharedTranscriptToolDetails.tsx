import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Collapse,
  Stack,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import type { ToolCall } from '../../hooks/useChatStream';

type RepoEntry = {
  id: string;
  description?: string | null;
  containerPath?: string;
  hostPath?: string;
  hostPathWarning?: string;
  lastIngestAt?: string | null;
  modelId?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  counts?: { files?: number; chunks?: number; embedded?: number };
  lastError?: string | null;
};

type VectorFile = {
  hostPath: string;
  highestMatch: number | null;
  chunkCount: number;
  lineCount: number | null;
  hostPathWarning?: string;
  repo?: string;
  modelId?: string;
};

type VectorMatch = {
  id: string;
  repo: string;
  relPath: string;
  hostPath?: string;
  containerPath?: string;
  score: number | null;
  chunk?: string;
  modelId?: string;
};

type SharedTranscriptToolDetailsProps = {
  tool: ToolCall;
  toggleKey: string;
  isToolErrorOpen: boolean;
  onToggleToolError: (toggleKey: string) => void;
  extraContent?: ReactNode;
};

const accordionTransitionProps = { transition: { unmountOnExit: true } };

const renderParamsAccordion = (params: unknown, accordionId: string) => (
  <Accordion
    defaultExpanded={false}
    disableGutters
    data-testid="tool-params-accordion"
    id={`params-${accordionId}`}
    slotProps={accordionTransitionProps}
  >
    <AccordionSummary
      expandIcon={<ExpandMoreIcon fontSize="small" />}
      aria-controls={`params-${accordionId}-content`}
    >
      <Typography variant="body2" fontWeight={600}>
        Parameters
      </Typography>
    </AccordionSummary>
    <AccordionDetails>
      <Box
        component="pre"
        sx={{
          bgcolor: 'grey.100',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 1,
          overflowX: 'auto',
          fontSize: '0.8rem',
          lineHeight: 1.4,
        }}
      >
        {JSON.stringify(params ?? {}, null, 2)}
      </Box>
    </AccordionDetails>
  </Accordion>
);

const resolveRepoModelLabel = (repo: RepoEntry): string | null => {
  if (repo.embeddingProvider && repo.embeddingModel) {
    return `${repo.embeddingProvider} / ${repo.embeddingModel}`;
  }
  if (repo.modelId) return repo.modelId;
  return null;
};

const renderRepoList = (repos: RepoEntry[]) => (
  <Stack spacing={1} data-testid="tool-repo-list">
    {repos.map((repo) => (
      <Accordion
        key={repo.id}
        disableGutters
        data-testid="tool-repo-item"
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
        slotProps={accordionTransitionProps}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
          <Typography variant="body2" fontWeight={600}>
            {repo.id}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={0.5}>
            {repo.description && (
              <Typography variant="body2" color="text.secondary">
                {repo.description}
              </Typography>
            )}
            {repo.hostPath && (
              <Typography variant="caption" color="text.secondary">
                Host path: {repo.hostPath}
              </Typography>
            )}
            {repo.containerPath && (
              <Typography variant="caption" color="text.secondary">
                Container path: {repo.containerPath}
              </Typography>
            )}
            {repo.hostPathWarning && (
              <Typography variant="caption" color="warning.main">
                Warning: {repo.hostPathWarning}
              </Typography>
            )}
            {repo.counts && (
              <Typography variant="caption" color="text.secondary">
                {`Files: ${repo.counts.files ?? 0} · Chunks: ${
                  repo.counts.chunks ?? 0
                } · Embedded: ${repo.counts.embedded ?? 0}`}
              </Typography>
            )}
            {typeof repo.lastIngestAt === 'string' && repo.lastIngestAt && (
              <Typography variant="caption" color="text.secondary">
                Last ingest: {repo.lastIngestAt}
              </Typography>
            )}
            {resolveRepoModelLabel(repo) && (
              <Typography variant="caption" color="text.secondary">
                Model: {resolveRepoModelLabel(repo)}
              </Typography>
            )}
            {repo.lastError && (
              <Typography variant="caption" color="error.main">
                Last error: {repo.lastError}
              </Typography>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>
    ))}
  </Stack>
);

const renderVectorFiles = (files: VectorFile[]) => {
  const sorted = [...files].sort((a, b) =>
    a.hostPath.localeCompare(b.hostPath),
  );
  return (
    <Stack spacing={1} data-testid="tool-file-list">
      {sorted.map((file) => {
        const summaryParts = [
          file.hostPath,
          `distance ${file.highestMatch === null ? '—' : file.highestMatch.toFixed(2)}`,
          `chunks ${file.chunkCount}`,
          `lines ${file.lineCount === null ? '—' : file.lineCount}`,
        ];
        return (
          <Accordion
            key={file.hostPath}
            disableGutters
            data-testid="tool-file-item"
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
            }}
            slotProps={accordionTransitionProps}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ wordBreak: 'break-all' }}
              >
                {summaryParts.join(' · ')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Best distance:{' '}
                  {file.highestMatch === null
                    ? '—'
                    : file.highestMatch.toFixed(3)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Chunk count: {file.chunkCount}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Total lines: {file.lineCount === null ? '—' : file.lineCount}
                </Typography>
                {file.repo && (
                  <Typography variant="caption" color="text.secondary">
                    Repo: {file.repo}
                  </Typography>
                )}
                {file.modelId && (
                  <Typography variant="caption" color="text.secondary">
                    Model: {file.modelId}
                  </Typography>
                )}
                {file.hostPathWarning && (
                  <Typography variant="caption" color="warning.main">
                    Warning: {file.hostPathWarning}
                  </Typography>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Stack>
  );
};

const renderVectorMatches = (matches: VectorMatch[]) => (
  <Stack spacing={1} data-testid="tool-match-list">
    {matches.map((match) => (
      <Box
        key={match.id}
        data-testid="tool-match-item"
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          px: 1,
          py: 0.75,
        }}
      >
        <Stack spacing={0.25}>
          <Typography
            variant="body2"
            fontWeight={600}
            sx={{ wordBreak: 'break-all' }}
          >
            {match.repo} · {match.relPath}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Distance: {match.score === null ? '—' : match.score.toFixed(3)}
          </Typography>
          {match.hostPath && (
            <Typography variant="caption" color="text.secondary">
              Host path: {match.hostPath}
            </Typography>
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            Preview: {match.chunk ?? '—'}
          </Typography>
        </Stack>
      </Box>
    ))}
  </Stack>
);

export default function SharedTranscriptToolDetails({
  tool,
  toggleKey,
  isToolErrorOpen,
  onToggleToolError,
  extraContent,
}: SharedTranscriptToolDetailsProps) {
  const payload = (tool.payload ?? {}) as Record<string, unknown>;
  const repos = Array.isArray((payload as { repos?: unknown }).repos)
    ? ((payload as { repos: RepoEntry[] }).repos as RepoEntry[])
    : [];

  const files = Array.isArray((payload as { files?: unknown }).files)
    ? ((payload as { files: VectorFile[] }).files as VectorFile[])
    : [];

  const vectorMatches = Array.isArray(
    (payload as { results?: unknown }).results,
  )
    ? (((payload as { results: unknown[] }).results as unknown[])
        .map((item, index) => {
          if (!item || typeof item !== 'object') return null;
          const record = item as Record<string, unknown>;
          const repo =
            typeof record.repo === 'string' ? record.repo : undefined;
          const relPath =
            typeof record.relPath === 'string' ? record.relPath : undefined;
          if (!repo || !relPath) return null;
          return {
            id:
              typeof record.chunkId === 'string'
                ? record.chunkId
                : `${repo}:${relPath}:${index}`,
            repo,
            relPath,
            hostPath:
              typeof record.hostPath === 'string' ? record.hostPath : undefined,
            containerPath:
              typeof record.containerPath === 'string'
                ? record.containerPath
                : undefined,
            score: typeof record.score === 'number' ? record.score : null,
            chunk: typeof record.chunk === 'string' ? record.chunk : undefined,
            modelId:
              typeof record.modelId === 'string' ? record.modelId : undefined,
          } satisfies VectorMatch;
        })
        .filter(Boolean) as VectorMatch[])
    : [];

  const trimmedError = tool.errorTrimmed ?? null;
  const fullError = tool.errorFull;
  const hasFullError = fullError !== undefined && fullError !== null;
  const hasPayload = tool.payload !== undefined && tool.payload !== null;

  const hasVectorFiles = tool.name === 'VectorSearch' && files.length > 0;
  const hasVectorMatches =
    tool.name === 'VectorSearch' && vectorMatches.length > 0;
  const hasRepos = tool.name === 'ListIngestedRepositories' && repos.length > 0;

  return (
    <Stack spacing={1} mt={0.5} data-testid="tool-details">
      <Typography variant="caption" color="text.secondary">
        Status: {tool.status}
      </Typography>
      {trimmedError && (
        <Stack spacing={0.5}>
          <Typography
            variant="body2"
            color="error.main"
            data-testid="tool-error-trimmed"
          >
            {trimmedError.code ? `${trimmedError.code}: ` : ''}
            {trimmedError.message ?? 'Error'}
          </Typography>
          {hasFullError && (
            <Box>
              <Button
                size="small"
                variant="text"
                onClick={() => onToggleToolError(toggleKey)}
                data-testid="tool-error-toggle"
                aria-expanded={isToolErrorOpen}
                sx={{ textTransform: 'none', minWidth: 0, p: 0 }}
              >
                {isToolErrorOpen ? 'Hide full error' : 'Show full error'}
              </Button>
              <Collapse in={isToolErrorOpen} timeout="auto" unmountOnExit>
                <Box
                  component="pre"
                  mt={0.5}
                  px={1}
                  py={0.5}
                  data-testid="tool-error-full"
                  sx={{
                    bgcolor: 'grey.100',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    fontSize: '0.8rem',
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(fullError, null, 2)}
                </Box>
              </Collapse>
            </Box>
          )}
        </Stack>
      )}

      {renderParamsAccordion(tool.parameters, toggleKey)}
      {extraContent}
      {hasRepos && renderRepoList(repos)}
      {hasVectorFiles && renderVectorFiles(files)}
      {hasVectorMatches && renderVectorMatches(vectorMatches)}

      {!hasRepos && !hasVectorFiles && !hasVectorMatches && hasPayload && (
        <Typography
          variant="caption"
          color="text.secondary"
          style={{
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
          sx={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
          data-testid="tool-payload"
        >
          {JSON.stringify(tool.payload)}
        </Typography>
      )}
    </Stack>
  );
}
