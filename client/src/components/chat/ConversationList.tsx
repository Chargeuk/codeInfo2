import ArchiveIcon from '@mui/icons-material/Archive';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestoreIcon from '@mui/icons-material/Restore';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';

export type ConversationListItem = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source?: 'REST' | 'MCP';
  lastMessageAt?: string;
  archived?: boolean;
};

type Props = {
  conversations: ConversationListItem[];
  selectedId?: string;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  hasMore: boolean;
  includeArchived: boolean;
  disabled?: boolean;
  onSelect: (conversationId: string) => void;
  onToggleArchived: (include: boolean) => void;
  onArchive: (conversationId: string) => void;
  onRestore: (conversationId: string) => void;
  onLoadMore: () => Promise<void> | void;
  onRefresh: () => void;
  onRetry: () => void;
};

function formatTimestamp(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function ConversationList({
  conversations,
  selectedId,
  isLoading,
  isError,
  error,
  hasMore,
  includeArchived,
  disabled,
  onSelect,
  onToggleArchived,
  onArchive,
  onRestore,
  onLoadMore,
  onRefresh,
  onRetry,
}: Props) {
  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      }),
    [conversations],
  );

  return (
    <Stack spacing={1} sx={{ height: '100%' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle1" fontWeight={700}>
          Conversations
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Show archived
            </Typography>
            <Switch
              size="small"
              checked={includeArchived}
              onChange={(event) => onToggleArchived(event.target.checked)}
              inputProps={{ 'data-testid': 'conversation-archived-toggle' }}
              disabled={disabled}
            />
          </Stack>
          <Tooltip title="Refresh list">
            <span>
              <IconButton
                size="small"
                onClick={onRefresh}
                disabled={disabled}
                aria-label="Refresh conversations"
                data-testid="conversation-refresh"
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {isError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
          data-testid="conversation-error"
        >
          {error ?? 'Failed to load conversations.'}
        </Alert>
      )}

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'background.paper',
          flex: 1,
          minHeight: 240,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {sorted.length === 0 && !isLoading ? (
          <Stack
            alignItems="center"
            justifyContent="center"
            sx={{ flex: 1, p: 2 }}
            spacing={1}
            data-testid="conversation-empty"
          >
            <Typography color="text.secondary" align="center">
              No conversations yet. Start a chat to see history here.
            </Typography>
          </Stack>
        ) : (
          <List dense disablePadding sx={{ flex: 1 }}>
            {sorted.map((conversation) => {
              const selected = selectedId === conversation.conversationId;
              return (
                <ListItem
                  key={conversation.conversationId}
                  disableGutters
                  secondaryAction={
                    conversation.archived ? (
                      <Tooltip title="Restore conversation">
                        <span>
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() =>
                              onRestore(conversation.conversationId)
                            }
                            disabled={disabled}
                            data-testid="conversation-restore"
                            aria-label="Restore conversation"
                          >
                            <RestoreIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Archive conversation">
                        <span>
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() =>
                              onArchive(conversation.conversationId)
                            }
                            disabled={disabled}
                            data-testid="conversation-archive"
                            aria-label="Archive conversation"
                          >
                            <ArchiveIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )
                  }
                >
                  <ListItemButton
                    selected={selected}
                    onClick={() => onSelect(conversation.conversationId)}
                    disabled={disabled}
                    data-testid="conversation-row"
                    sx={{ alignItems: 'flex-start', py: 1.25, px: 1.5 }}
                  >
                    <ListItemText
                      disableTypography
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography
                            variant="body2"
                            fontWeight={selected ? 700 : 600}
                            noWrap
                            data-testid="conversation-title"
                            sx={{ maxWidth: '14rem' }}
                          >
                            {conversation.title || 'Untitled conversation'}
                          </Typography>
                          {conversation.archived && (
                            <Chip
                              label="Archived"
                              size="small"
                              color="default"
                              variant="outlined"
                              data-testid="conversation-archived-chip"
                            />
                          )}
                        </Stack>
                      }
                      secondary={
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            data-testid="conversation-meta"
                          >
                            {conversation.provider} · {conversation.model} ·{' '}
                            {conversation.source ?? 'REST'}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            data-testid="conversation-updated"
                          >
                            {formatTimestamp(conversation.lastMessageAt)}
                          </Typography>
                        </Stack>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
            <Divider />
          </List>
        )}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ p: 1 }}
        >
          <Button
            size="small"
            variant="text"
            onClick={() => onLoadMore()}
            disabled={disabled || isLoading || !hasMore}
            data-testid="conversation-load-more"
          >
            {hasMore ? 'Load more' : 'No more'}
          </Button>
          {isLoading && (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="conversation-loading"
            >
              Loading...
            </Typography>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}

export default ConversationList;
