import ArchiveIcon from '@mui/icons-material/Archive';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestoreIcon from '@mui/icons-material/Restore';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Snackbar,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';

export type ConversationListItem = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source?: 'REST' | 'MCP';
  lastMessageAt?: string;
  archived?: boolean;
};

export type ConversationArchivedFilter = 'active' | 'all' | 'archived';

type Props = {
  conversations: ConversationListItem[];
  selectedId?: string;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  hasMore: boolean;
  archivedFilter: ConversationArchivedFilter;
  disabled?: boolean;
  persistenceUnavailable?: boolean;
  variant?: 'chat' | 'agents';
  onSelect: (conversationId: string) => void;
  onArchivedFilterChange: (filter: ConversationArchivedFilter) => void;
  onArchive: (conversationId: string) => Promise<void> | void;
  onRestore: (conversationId: string) => Promise<void> | void;
  onBulkArchive: (conversationIds: string[]) => Promise<void> | void;
  onBulkRestore: (conversationIds: string[]) => Promise<void> | void;
  onBulkDelete: (conversationIds: string[]) => Promise<void> | void;
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
  archivedFilter,
  disabled,
  persistenceUnavailable,
  variant = 'chat',
  onSelect,
  onArchivedFilterChange,
  onArchive,
  onRestore,
  onBulkArchive,
  onBulkRestore,
  onBulkDelete,
  onLoadMore,
  onRefresh,
  onRetry,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [snackbar, setSnackbar] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      }),
    [conversations],
  );

  const busy = Boolean(disabled || isLoading);
  const visibleIds = useMemo(
    () => sorted.map((c) => c.conversationId),
    [sorted],
  );

  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const clearSelection = () => setSelectedIds(new Set());

  const selectionCount = selectedIds.size;
  const allSelected =
    visibleIds.length > 0 && selectionCount === visibleIds.length;
  const indeterminate =
    selectionCount > 0 && selectionCount < visibleIds.length;

  const toggleOne = (conversationId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (busy) return;
    setSelectedIds((prev) => {
      if (visibleIds.length === 0) return prev;
      if (prev.size === visibleIds.length) return new Set();
      return new Set(visibleIds);
    });
  };

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await onBulkArchive(ids);
      clearSelection();
      setSnackbar({
        severity: 'success',
        message: `Archived ${ids.length} conversation(s).`,
      });
    } catch (err) {
      setSnackbar({
        severity: 'error',
        message: (err as Error).message || 'Bulk archive failed.',
      });
    }
  };

  const handleBulkRestore = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await onBulkRestore(ids);
      clearSelection();
      setSnackbar({
        severity: 'success',
        message: `Restored ${ids.length} conversation(s).`,
      });
    } catch (err) {
      setSnackbar({
        severity: 'error',
        message: (err as Error).message || 'Bulk restore failed.',
      });
    }
  };

  const confirmBulkDelete = () => {
    if (!selectedIds.size) return;
    setDeleteOpen(true);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await onBulkDelete(ids);
      clearSelection();
      setDeleteOpen(false);
      setSnackbar({
        severity: 'success',
        message: `Deleted ${ids.length} conversation(s).`,
      });
    } catch (err) {
      setSnackbar({
        severity: 'error',
        message: (err as Error).message || 'Bulk delete failed.',
      });
    }
  };

  return (
    <Stack spacing={1} sx={{ height: '100%' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle1" fontWeight={700}>
          Conversations
        </Typography>
        {variant === 'chat' && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="Refresh list">
              <span>
                <IconButton
                  size="small"
                  onClick={onRefresh}
                  disabled={busy}
                  aria-label="Refresh conversations"
                  data-testid="conversation-refresh"
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        )}
      </Stack>

      {variant === 'chat' && (
        <Stack spacing={1}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={archivedFilter}
            onChange={(_, value) => {
              if (!value) return;
              clearSelection();
              setDeleteOpen(false);
              onArchivedFilterChange(value as ConversationArchivedFilter);
            }}
            aria-label="Conversation filter"
            disabled={busy}
            data-testid="conversation-filter"
          >
            <ToggleButton value="active">Active</ToggleButton>
            <ToggleButton value="all">Active & Archived</ToggleButton>
            <ToggleButton value="archived">Archived</ToggleButton>
          </ToggleButtonGroup>

          <Stack direction="row" spacing={1} alignItems="center">
            <Checkbox
              inputProps={{ 'aria-label': 'Select all conversations' }}
              checked={allSelected}
              indeterminate={indeterminate}
              onChange={handleSelectAll}
              disabled={busy || visibleIds.length === 0}
              data-testid="conversation-select-all"
              size="small"
            />
            <Typography variant="body2" color="text.secondary">
              {selectionCount} selected
            </Typography>

            {archivedFilter === 'archived' ? (
              <>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => void handleBulkRestore()}
                  disabled={busy || selectionCount === 0}
                  data-testid="conversation-bulk-restore"
                >
                  Restore selected
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  onClick={confirmBulkDelete}
                  disabled={busy || selectionCount === 0}
                  startIcon={<DeleteForeverIcon fontSize="small" />}
                  data-testid="conversation-bulk-delete"
                >
                  Delete selected
                </Button>
              </>
            ) : (
              <Button
                variant="outlined"
                size="small"
                onClick={() => void handleBulkArchive()}
                disabled={busy || selectionCount === 0}
                data-testid="conversation-bulk-archive"
              >
                Archive selected
              </Button>
            )}

            {persistenceUnavailable ? (
              <Typography variant="caption" color="text.secondary">
                Bulk actions disabled while history is unavailable.
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      )}

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
              const isActive = selectedId === conversation.conversationId;
              return (
                <ListItem
                  key={conversation.conversationId}
                  disableGutters
                  secondaryAction={
                    variant === 'agents' ? null : conversation.archived ? (
                      <Tooltip title="Restore conversation">
                        <span>
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => {
                              void Promise.resolve(
                                onRestore(conversation.conversationId),
                              ).catch((err) => {
                                setSnackbar({
                                  severity: 'error',
                                  message:
                                    (err as Error).message ||
                                    'Failed to restore conversation.',
                                });
                              });
                            }}
                            disabled={busy}
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
                            onClick={() => {
                              void Promise.resolve(
                                onArchive(conversation.conversationId),
                              ).catch((err) => {
                                setSnackbar({
                                  severity: 'error',
                                  message:
                                    (err as Error).message ||
                                    'Failed to archive conversation.',
                                });
                              });
                            }}
                            disabled={busy}
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
                    selected={isActive}
                    onClick={() => onSelect(conversation.conversationId)}
                    disabled={busy}
                    data-testid="conversation-row"
                    sx={{ alignItems: 'flex-start', py: 1.25, px: 1.5 }}
                  >
                    {variant === 'chat' && (
                      <Checkbox
                        size="small"
                        checked={selectedIds.has(conversation.conversationId)}
                        disabled={busy}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleOne(conversation.conversationId)}
                        inputProps={{
                          'aria-label': `Select ${conversation.title || 'conversation'}`,
                        }}
                        data-testid="conversation-select"
                        sx={{ p: 0.5, mr: 1 }}
                      />
                    )}
                    <ListItemText
                      disableTypography
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography
                            variant="body2"
                            fontWeight={isActive ? 700 : 600}
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
            disabled={busy || !hasMore}
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

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        data-testid="conversation-delete-dialog"
      >
        <DialogTitle>Delete conversations permanently?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete {selectionCount} archived
            conversation(s). This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleBulkDelete()}
            data-testid="conversation-delete-confirm"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(snackbar)}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
      >
        {snackbar ? (
          <Alert
            severity={snackbar.severity}
            onClose={() => setSnackbar(null)}
            sx={{ width: '100%' }}
          >
            {snackbar.message}
          </Alert>
        ) : null}
      </Snackbar>
    </Stack>
  );
}

export default ConversationList;
