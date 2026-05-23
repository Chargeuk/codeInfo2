import ArchiveIcon from '@mui/icons-material/Archive';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestoreIcon from '@mui/icons-material/Restore';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  Snackbar,
  Stack,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { type InputHTMLAttributes } from 'react';
import type { ConversationFlags } from '../../api/conversations';
import type {
  ConversationBulkResult,
  ConversationFilterState,
} from '../../hooks/useConversations';
import { createLogger } from '../../logging/logger';
import {
  buildConversationPreviewText,
  formatConversationRowTimestamp,
  getConversationProviderPresentation,
} from './conversationRowFormatting';

export type ConversationListItem = {
  conversationId: string;
  title: string;
  provider: string;
  model: string;
  source?: 'REST' | 'MCP';
  lastMessageAt?: string;
  archived?: boolean;
  flags?: ConversationFlags;
  agentName?: string;
  flowName?: string;
  previewUserText?: string;
  previewAssistantSummary?: string;
  previewSystemSummary?: string;
};

const checkboxInputProps = (
  ariaLabel: string,
  dataTestId: string,
): InputHTMLAttributes<HTMLInputElement> & {
  'aria-label': string;
  'data-testid': string;
} => ({
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
});

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
  selectionDisabled?: boolean;
  variant?: 'chat' | 'agents';
  onSelect: (conversationId: string) => void;
  onFilterChange: (state: ConversationFilterState) => void;
  onArchive: (conversationId: string) => void;
  onRestore: (conversationId: string) => void;
  onBulkArchive?: (
    conversationIds: string[],
  ) => Promise<ConversationBulkResult>;
  onBulkRestore?: (
    conversationIds: string[],
  ) => Promise<ConversationBulkResult>;
  onBulkDelete?: (conversationIds: string[]) => Promise<ConversationBulkResult>;
  onLoadMore: () => Promise<void> | void;
  onRefresh: () => void;
  onRetry: () => void;
  showHeaderTitle?: boolean;
};

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
  selectionDisabled = false,
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
  showHeaderTitle = true,
}: Props) {
  const log = useMemo(() => createLogger('client'), []);
  const enableBulkUi = Boolean(onBulkArchive || onBulkRestore || onBulkDelete);
  const showBulkUi = enableBulkUi;
  const showFilters = true;
  const showRowActions = true;
  void showHeaderTitle;
  const mutationDisabled = Boolean(disabled || selectionDisabled);
  const bulkDisabled = Boolean(mutationDisabled || mongoConnected === false);
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
    !filterState.active &&
    filterState.archived &&
    Boolean(onBulkDelete);

  const handleBulk = async (action: 'archive' | 'restore' | 'delete') => {
    if (action === 'archive' && !canBulkArchive) return;
    if (action === 'restore' && !canBulkRestore) return;
    if (action === 'delete' && !canBulkDelete) return;

    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    log('info', 'chat.sidebar.bulk_action_request', {
      filterState,
      selectedCount: ids.length,
      action,
    });

    try {
      let result: ConversationBulkResult | null = null;
      if (action === 'archive') {
        if (!onBulkArchive) return;
        result = await onBulkArchive(ids);
      }
      if (action === 'restore') {
        if (!onBulkRestore) return;
        result = await onBulkRestore(ids);
      }
      if (action === 'delete') {
        if (!onBulkDelete) return;
        result = await onBulkDelete(ids);
      }
      if (!result) return;

      const affectedCount =
        action === 'delete'
          ? (result.deletedCount ?? result.resolvedConversationIds.length)
          : (result.updatedCount ?? result.resolvedConversationIds.length);
      const actionVerb =
        action === 'archive'
          ? 'Archived'
          : action === 'restore'
            ? 'Restored'
            : 'Deleted';
      const pendingCount = result.pendingConversationIds.length;

      setToast({
        severity: 'success',
        message:
          pendingCount > 0
            ? `${actionVerb} ${affectedCount} conversations; ${pendingCount} still pending`
            : `${actionVerb} ${affectedCount} conversations`,
      });
      setSelectedIds(new Set(result.pendingConversationIds));

      log('info', 'chat.sidebar.bulk_action_result', {
        filterState,
        selectedCount: ids.length,
        action,
        status: pendingCount > 0 ? 'partial' : 'ok',
        affectedCount,
        pendingCount,
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
    <Stack
      spacing={1}
      sx={{ height: '100%', minHeight: 0, width: '100%', bgcolor: '#F4F6F8' }}
    >
      <Stack
        spacing={0.75}
        sx={{
          px: 1.5,
          py: 1,
          bgcolor: '#DCE7F2',
          borderBottom: '1px solid',
          borderColor: '#D9E2EC',
        }}
        style={{ paddingLeft: 12, paddingRight: 12 }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{ minWidth: 0 }}
          data-testid="conversation-filter"
        >
          {showFilters ? (
            <Stack direction="row" spacing={0.75} alignItems="center">
              <ToggleButton
                value="active"
                selected={filterState.active}
                onClick={() => {
                  const next = {
                    active: !filterState.active,
                    archived: filterState.archived,
                  };
                  log('info', 'chat.sidebar.filter_changed', {
                    filterState: next,
                  });
                  onFilterChange(next);
                }}
                data-testid="conversation-filter-active"
                aria-label="Active conversations"
                disabled={disabled}
                size="small"
                sx={{
                  minWidth: 0,
                  px: 1.25,
                  py: 0.5,
                  borderColor: '#D9E2EC',
                  color: filterState.active ? '#F4F6F8' : '#1F2933',
                  bgcolor: filterState.active ? '#20354A' : '#F4F6F8',
                  '&.Mui-selected': {
                    color: '#F4F6F8',
                    bgcolor: '#20354A',
                  },
                  '&.Mui-selected:hover': {
                    bgcolor: '#20354A',
                  },
                }}
              >
                Active
              </ToggleButton>
              <ToggleButton
                value="archived"
                selected={filterState.archived}
                onClick={() => {
                  const next = {
                    active: filterState.active,
                    archived: !filterState.archived,
                  };
                  log('info', 'chat.sidebar.filter_changed', {
                    filterState: next,
                  });
                  onFilterChange(next);
                }}
                data-testid="conversation-filter-archived"
                aria-label="Archived conversations"
                disabled={disabled}
                size="small"
                sx={{
                  minWidth: 0,
                  px: 1.25,
                  py: 0.5,
                  borderColor: '#D9E2EC',
                  color: filterState.archived ? '#F4F6F8' : '#1F2933',
                  bgcolor: filterState.archived ? '#20354A' : '#F4F6F8',
                  '&.Mui-selected': {
                    color: '#F4F6F8',
                    bgcolor: '#20354A',
                  },
                  '&.Mui-selected:hover': {
                    bgcolor: '#20354A',
                  },
                }}
              >
                Archived
              </ToggleButton>
            </Stack>
          ) : (
            <Box />
          )}
          {showFilters && (
            <Tooltip title="Refresh list">
              <span>
                <IconButton
                  size="small"
                  onClick={onRefresh}
                  disabled={disabled}
                  aria-label="Refresh conversations"
                  data-testid="conversation-refresh"
                  sx={{ color: '#1F2933' }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
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
        data-testid="conversation-list"
        sx={{
          border: '1px solid',
          borderColor: '#D9E2EC',
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: '#EEF2F6',
          flex: 1,
          width: '100%',
          minHeight: 240,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {showBulkUi && enableBulkUi && sorted.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
            sx={{
              px: 1.5,
              py: 0.5,
              borderBottom: '1px solid',
              borderColor: '#D9E2EC',
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
                slotProps={{
                  input: checkboxInputProps(
                    'Select all conversations',
                    'conversation-select-all',
                  ),
                }}
              />
              <Typography variant="caption" sx={{ color: '#52606D' }}>
                {selectedIds.size} selected
              </Typography>
              {mongoConnected === false && (
                <Typography variant="caption" sx={{ color: '#52606D' }}>
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
              {!filterState.active && filterState.archived && (
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
        <Box
          sx={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}
        >
          {sorted.length === 0 && !isLoading ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{ flex: 1, p: 2 }}
              spacing={1}
              data-testid="conversation-empty"
            >
              <Typography sx={{ color: '#52606D' }} align="center">
                No conversations yet. Start a chat to see history here.
              </Typography>
            </Stack>
          ) : (
            <List dense disablePadding sx={{ width: '100%', minWidth: 0 }}>
              {sorted.map((conversation) => {
                const selected = selectedId === conversation.conversationId;
                const providerPresentation =
                  getConversationProviderPresentation(
                    conversation.provider,
                    conversation.model,
                  );
                const previewText = buildConversationPreviewText({
                  userText: conversation.previewUserText,
                  assistantSummary: conversation.previewAssistantSummary,
                  systemSummary: conversation.previewSystemSummary,
                });
                const timestamp = formatConversationRowTimestamp(
                  conversation.lastMessageAt,
                );
                const sourceLabel = conversation.source ?? 'REST';
                return (
                  <ListItem
                    key={conversation.conversationId}
                    disableGutters
                    disablePadding
                    secondaryAction={
                      showRowActions ? (
                        <Box
                          sx={{
                            width: 80,
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.25,
                            pl: 1,
                            borderLeft: '1px solid',
                            borderColor: '#D9E2EC',
                          }}
                        >
                          <Tooltip
                            title={
                              conversation.archived
                                ? 'Restore conversation'
                                : 'Archive conversation'
                            }
                          >
                            <span>
                              <IconButton
                                edge="end"
                                size="small"
                                onClick={() => {
                                  void Promise.resolve(
                                    conversation.archived
                                      ? onRestore(conversation.conversationId)
                                      : onArchive(conversation.conversationId),
                                  )
                                    .then(() => {
                                      setToast({
                                        severity: 'success',
                                        message: conversation.archived
                                          ? 'Conversation restored'
                                          : 'Conversation archived',
                                      });
                                    })
                                    .catch((err) => {
                                      setToast({
                                        severity: 'error',
                                        message:
                                          (err as Error).message ||
                                          (conversation.archived
                                            ? 'Restore failed'
                                            : 'Archive failed'),
                                      });
                                    });
                                }}
                                disabled={bulkDisabled}
                                data-testid={
                                  conversation.archived
                                    ? 'conversation-restore'
                                    : 'conversation-archive'
                                }
                                aria-label={
                                  conversation.archived
                                    ? 'Restore conversation'
                                    : 'Archive conversation'
                                }
                              >
                                {conversation.archived ? (
                                  <RestoreIcon fontSize="small" />
                                ) : (
                                  <ArchiveIcon fontSize="small" />
                                )}
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Typography
                            variant="caption"
                            sx={{
                              lineHeight: 1.1,
                              textAlign: 'center',
                              minWidth: 0,
                              color: conversation.archived
                                ? '#52606D'
                                : '#1F2933',
                            }}
                          >
                            {conversation.archived ? 'Restore' : 'Archive'}
                          </Typography>
                        </Box>
                      ) : null
                    }
                    sx={{
                      width: '100%',
                      minWidth: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <ListItemButton
                      selected={selected}
                      onClick={() => onSelect(conversation.conversationId)}
                      disabled={mutationDisabled}
                      data-testid="conversation-row"
                      sx={{
                        alignItems: 'flex-start',
                        gap: 1.25,
                        py: 1.25,
                        pl: 1.5,
                        pr: 10,
                        minWidth: 0,
                        width: '100%',
                        borderBottom: '1px solid',
                        borderColor: '#D9E2EC',
                        bgcolor: selected ? '#E8F1FB' : '#EEF2F6',
                        '&.Mui-selected': {
                          bgcolor: '#E8F1FB',
                        },
                        '&.Mui-selected:hover': {
                          bgcolor: '#E8F1FB',
                        },
                      }}
                    >
                      {showBulkUi && enableBulkUi && (
                        <Checkbox
                          size="small"
                          checked={selectedIds.has(conversation.conversationId)}
                          disabled={bulkDisabled}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (bulkDisabled) return;
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(conversation.conversationId))
                                next.delete(conversation.conversationId);
                              else next.add(conversation.conversationId);
                              return next;
                            });
                          }}
                          slotProps={{
                            input: checkboxInputProps(
                              'Select conversation',
                              'conversation-select',
                            ),
                          }}
                          sx={{ mr: 1, alignSelf: 'center', mt: 0.25 }}
                        />
                      )}
                      <ListItemIcon
                        data-testid="conversation-provider-icon"
                        aria-label={`${providerPresentation.label} provider icon`}
                        sx={{
                          minWidth: 40,
                          mt: 0.25,
                          color: selected ? '#20354A' : '#52606D',
                          justifyContent: 'center',
                        }}
                      >
                        {providerPresentation.icon}
                      </ListItemIcon>
                      <Box
                        sx={{
                          minWidth: 0,
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.5,
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="flex-start"
                          justifyContent="space-between"
                          sx={{ minWidth: 0, width: '100%' }}
                        >
                          <Typography
                            variant="body2"
                            fontWeight={selected ? 700 : 600}
                            noWrap
                            data-testid="conversation-title"
                            sx={{ minWidth: 0, flex: 1, color: '#1F2933' }}
                          >
                            {conversation.title || 'Untitled conversation'}
                          </Typography>
                          <Typography
                            variant="caption"
                            data-testid="conversation-updated"
                            noWrap
                            sx={{
                              flexShrink: 0,
                              pt: 0.125,
                              color: '#52606D',
                            }}
                          >
                            {timestamp}
                          </Typography>
                        </Stack>
                        <Typography
                          variant="body2"
                          data-testid="conversation-preview"
                          noWrap
                          sx={{ minWidth: 0, color: '#52606D' }}
                        >
                          {previewText}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          alignItems="center"
                          flexWrap="wrap"
                          useFlexGap
                          sx={{ minWidth: 0, maxWidth: '100%' }}
                        >
                          {conversation.flags?.flow?.executionId &&
                            !conversation.flags?.flowChild?.executionId && (
                              <Chip
                                label={`Run ${conversation.flags.flow.executionId.split('-')[0]}`}
                                size="small"
                                variant="outlined"
                                color="default"
                                data-testid="conversation-run-chip"
                              />
                            )}
                          {conversation.flags?.flowChild?.executionId &&
                            !conversation.flags?.flow?.executionId && (
                              <Chip
                                label={`Run ${conversation.flags.flowChild.executionId.split('-')[0]}`}
                                size="small"
                                variant="outlined"
                                color="default"
                                data-testid="conversation-run-chip"
                              />
                            )}
                          <Chip
                            label={providerPresentation.label}
                            size="small"
                            variant="outlined"
                            color="default"
                            data-testid="conversation-provider-chip"
                          />
                          <Chip
                            label={conversation.model || 'Unknown model'}
                            size="small"
                            variant="outlined"
                            color="default"
                            data-testid="conversation-model-chip"
                          />
                          <Chip
                            label={sourceLabel}
                            size="small"
                            variant="outlined"
                            color="default"
                            data-testid="conversation-source-chip"
                          />
                        </Stack>
                      </Box>
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
            disabled={!canBulkDelete}
            onClick={() => {
              if (!canBulkDelete) return;
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
