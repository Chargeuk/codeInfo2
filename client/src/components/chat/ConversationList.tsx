import ArchiveIcon from '@mui/icons-material/Archive';
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
import type { ConversationFilterState } from '../../hooks/useConversations';
import { createLogger } from '../../logging/logger';

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
  filterState: ConversationFilterState;
  mongoConnected?: boolean | null;
  disabled?: boolean;
  variant?: 'chat' | 'agents';
  onSelect: (conversationId: string) => void;
  onFilterChange: (state: ConversationFilterState) => void;
  onArchive: (conversationId: string) => void;
  onRestore: (conversationId: string) => void;
  onBulkArchive?: (
    conversationIds: string[],
  ) => Promise<{ updatedCount: number }>;
  onBulkRestore?: (
    conversationIds: string[],
  ) => Promise<{ updatedCount: number }>;
  onBulkDelete?: (
    conversationIds: string[],
  ) => Promise<{ deletedCount: number }>;
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
  filterState,
  mongoConnected,
  disabled,
  variant = 'chat',
  onSelect,
  onFilterChange,
  onArchive,
  onRestore,
  onBulkArchive,
  onBulkRestore,
  onBulkDelete,
  onLoadMore,
  onRefresh,
  onRetry,
}: Props) {
  const log = useMemo(() => createLogger('client'), []);
  const enableBulkUi = Boolean(onBulkArchive || onBulkRestore || onBulkDelete);
  const showFilters = Boolean(onFilterChange && onRefresh);
  const showRowActions = Boolean(onArchive && onRestore);
  const bulkDisabled = Boolean(disabled || mongoConnected === false);
  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      }),
    [conversations],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [toast, setToast] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);

  const closeToast = () => setToast(null);

  useEffect(() => {
    if (!enableBulkUi) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set());
  }, [filterState, enableBulkUi]);

  useEffect(() => {
    if (!enableBulkUi) return;
    const visibleIds = new Set(sorted.map((c) => c.conversationId));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [sorted, enableBulkUi]);

  const selectedKey = useMemo(
    () => Array.from(selectedIds).sort().join('|'),
    [selectedIds],
  );
  useEffect(() => {
    if (!enableBulkUi) return;
    log('info', 'chat.sidebar.selection_changed', {
      filterState,
      selectedCount: selectedIds.size,
    });
  }, [enableBulkUi, filterState, log, selectedIds.size, selectedKey]);

  useEffect(() => {
    log('info', '0000023 conversationlist controls visible', {
      variant,
      showFilters,
      enableBulkUi,
      showRowActions,
    });
  }, [enableBulkUi, log, showFilters, showRowActions, variant]);

  useEffect(() => {
    log('info', '0000023 sidebar list panel layout', {
      paddingPx: 12,
      scrollContainer: true,
      loadMoreInside: true,
    });
  }, [log]);

  const allConversationIds = useMemo(
    () => sorted.map((c) => c.conversationId),
    [sorted],
  );
  const allSelected =
    enableBulkUi && allConversationIds.length > 0
      ? selectedIds.size === allConversationIds.length
      : false;
  const indeterminate =
    enableBulkUi &&
    selectedIds.size > 0 &&
    selectedIds.size < allConversationIds.length;

  const selectedConversations = useMemo(
    () => sorted.filter((c) => selectedIds.has(c.conversationId)),
    [sorted, selectedIds],
  );
  const selectionAllActive =
    selectedConversations.length > 0 &&
    selectedConversations.every((c) => !c.archived);
  const selectionAllArchived =
    selectedConversations.length > 0 &&
    selectedConversations.every((c) => Boolean(c.archived));

  const canBulkArchive =
    enableBulkUi &&
    !bulkDisabled &&
    selectedIds.size > 0 &&
    selectionAllActive &&
    Boolean(onBulkArchive);
  const canBulkRestore =
    enableBulkUi &&
    !bulkDisabled &&
    selectedIds.size > 0 &&
    selectionAllArchived &&
    Boolean(onBulkRestore);
  const canBulkDelete =
    enableBulkUi &&
    !bulkDisabled &&
    selectedIds.size > 0 &&
    filterState === 'archived' &&
    Boolean(onBulkDelete);

  const handleBulk = async (action: 'archive' | 'restore' | 'delete') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    log('info', 'chat.sidebar.bulk_action_request', {
      filterState,
      selectedCount: ids.length,
      action,
    });

    try {
      if (action === 'archive') {
        if (!onBulkArchive) return;
        const result = await onBulkArchive(ids);
        setToast({
          severity: 'success',
          message: `Archived ${result.updatedCount} conversations`,
        });
      }
      if (action === 'restore') {
        if (!onBulkRestore) return;
        const result = await onBulkRestore(ids);
        setToast({
          severity: 'success',
          message: `Restored ${result.updatedCount} conversations`,
        });
      }
      if (action === 'delete') {
        if (!onBulkDelete) return;
        const result = await onBulkDelete(ids);
        setToast({
          severity: 'success',
          message: `Deleted ${result.deletedCount} conversations`,
        });
      }
      setSelectedIds(new Set());

      log('info', 'chat.sidebar.bulk_action_result', {
        filterState,
        selectedCount: ids.length,
        action,
        status: 'ok',
      });
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : undefined;
      log('info', 'chat.sidebar.bulk_action_result', {
        filterState,
        selectedCount: ids.length,
        action,
        status: 'failed',
        ...(code ? { errorCode: code } : {}),
      });
      setToast({
        severity: 'error',
        message: `${code ? `${code}: ` : ''}${(err as Error).message || 'Bulk action failed'}`,
      });
    }
  };

  return (
    <Stack spacing={1} sx={{ height: '100%' }}>
      <Stack
        spacing={0.75}
        sx={{ px: 1.5 }}
        style={{ paddingLeft: 12, paddingRight: 12 }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Typography variant="subtitle1" fontWeight={700}>
            Conversations
          </Typography>
          {showFilters && (
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
          )}
        </Stack>

        {showFilters && (
          <ToggleButtonGroup
            size="small"
            exclusive
            fullWidth
            value={filterState}
            onChange={(_event, next) => {
              if (!next) return;
              log('info', 'chat.sidebar.filter_changed', {
                filterState: next as ConversationFilterState,
              });
              onFilterChange(next as ConversationFilterState);
            }}
            aria-label="Conversation filter"
            disabled={disabled}
            data-testid="conversation-filter"
            sx={{ alignSelf: 'stretch', flexWrap: 'wrap' }}
          >
            <ToggleButton
              value="active"
              data-testid="conversation-filter-active"
            >
              Active
            </ToggleButton>
            <ToggleButton value="all" data-testid="conversation-filter-all">
              Active &amp; Archived
            </ToggleButton>
            <ToggleButton
              value="archived"
              data-testid="conversation-filter-archived"
            >
              Archived
            </ToggleButton>
          </ToggleButtonGroup>
        )}
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
        {enableBulkUi && sorted.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
            sx={{
              px: 1.5,
              py: 0.5,
              borderBottom: '1px solid',
              borderColor: 'divider',
              flexWrap: 'wrap',
              rowGap: 0.5,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Checkbox
                size="small"
                checked={allSelected}
                indeterminate={indeterminate}
                disabled={bulkDisabled}
                onChange={() => {
                  if (bulkDisabled) return;
                  setSelectedIds((prev) => {
                    const selectingAll =
                      prev.size !== allConversationIds.length;
                    return selectingAll
                      ? new Set(allConversationIds)
                      : new Set<string>();
                  });
                }}
                inputProps={{
                  'aria-label': 'Select all conversations',
                  'data-testid': 'conversation-select-all',
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {selectedIds.size} selected
              </Typography>
              {mongoConnected === false && (
                <Typography variant="caption" color="warning.main">
                  Bulk actions disabled (Mongo disconnected)
                </Typography>
              )}
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: 'wrap', rowGap: 0.5, justifyContent: 'flex-end' }}
            >
              <Button
                size="small"
                variant="outlined"
                disabled={!canBulkArchive}
                data-testid="conversation-bulk-archive"
                sx={{ minWidth: 0, px: 1 }}
                onClick={() => {
                  void handleBulk('archive');
                }}
              >
                Archive
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={!canBulkRestore}
                data-testid="conversation-bulk-restore"
                sx={{ minWidth: 0, px: 1 }}
                onClick={() => {
                  void handleBulk('restore');
                }}
              >
                Restore
              </Button>
              {filterState === 'archived' && (
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  disabled={!canBulkDelete}
                  data-testid="conversation-bulk-delete"
                  sx={{ minWidth: 0, px: 1 }}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  Delete
                </Button>
              )}
            </Stack>
          </Stack>
        )}
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
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
            <List dense disablePadding>
              {sorted.map((conversation) => {
                const selected = selectedId === conversation.conversationId;
                return (
                  <ListItem
                    key={conversation.conversationId}
                    disableGutters
                    secondaryAction={
                      showRowActions ? (
                        conversation.archived ? (
                          <Tooltip title="Restore conversation">
                            <span>
                              <IconButton
                                edge="end"
                                size="small"
                                onClick={() => {
                                  void Promise.resolve(
                                    onRestore(conversation.conversationId),
                                  )
                                    .then(() => {
                                      setToast({
                                        severity: 'success',
                                        message: 'Conversation restored',
                                      });
                                    })
                                    .catch((err) => {
                                      setToast({
                                        severity: 'error',
                                        message:
                                          (err as Error).message ||
                                          'Restore failed',
                                      });
                                    });
                                }}
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
                                onClick={() => {
                                  void Promise.resolve(
                                    onArchive(conversation.conversationId),
                                  )
                                    .then(() => {
                                      setToast({
                                        severity: 'success',
                                        message: 'Conversation archived',
                                      });
                                    })
                                    .catch((err) => {
                                      setToast({
                                        severity: 'error',
                                        message:
                                          (err as Error).message ||
                                          'Archive failed',
                                      });
                                    });
                                }}
                                disabled={disabled}
                                data-testid="conversation-archive"
                                aria-label="Archive conversation"
                              >
                                <ArchiveIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )
                      ) : null
                    }
                  >
                    <ListItemButton
                      selected={selected}
                      onClick={() => onSelect(conversation.conversationId)}
                      disabled={disabled}
                      data-testid="conversation-row"
                      style={{ paddingLeft: 12, paddingRight: 12 }}
                      sx={{ alignItems: 'flex-start', py: 1.25, px: 1.5 }}
                    >
                      {enableBulkUi && (
                        <Checkbox
                          size="small"
                          checked={selectedIds.has(conversation.conversationId)}
                          disabled={bulkDisabled}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(conversation.conversationId)) {
                                next.delete(conversation.conversationId);
                              } else {
                                next.add(conversation.conversationId);
                              }
                              return next;
                            });
                          }}
                          inputProps={{
                            'aria-label': 'Select conversation',
                            'data-testid': 'conversation-select',
                          }}
                          sx={{ mt: 0.25, mr: 0.5 }}
                        />
                      )}
                      <ListItemText
                        disableTypography
                        primary={
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{ minWidth: 0 }}
                          >
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
            sx={{ px: 1.5, py: 1 }}
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
      </Box>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        aria-labelledby="conversation-delete-title"
        aria-describedby="conversation-delete-description"
      >
        <DialogTitle id="conversation-delete-title">
          Permanently delete conversations?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="conversation-delete-description">
            This will permanently delete {selectedIds.size}{' '}
            {selectedIds.size === 1 ? 'conversation' : 'conversations'}. This
            action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setDeleteDialogOpen(false);
              void handleBulk('delete');
            }}
            data-testid="conversation-delete-confirm"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast !== null}
        autoHideDuration={4000}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return;
          closeToast();
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={closeToast}
          severity={toast?.severity ?? 'success'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {toast?.message ?? ''}
        </Alert>
      </Snackbar>
    </Stack>
  );
}

export default ConversationList;
