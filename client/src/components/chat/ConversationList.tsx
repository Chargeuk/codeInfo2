import ArchiveIcon from '@mui/icons-material/Archive';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
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
  formatConversationRowTimestamp,
  getConversationProviderPresentation,
} from './conversationRowFormatting';
import { useRelativeTimeTick } from './useRelativeTimeTick';

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

const fallbackFilterState: ConversationFilterState = {
  active: true,
  archived: false,
};

type ConversationFlowWithTargetInput = NonNullable<
  ConversationFlags['flow']
> & {
  input?: {
    target?: {
      target_id?: unknown;
    };
  };
};

const getConversationRootTargetId = (flags?: ConversationFlags) => {
  const targetId = (flags?.flow as ConversationFlowWithTargetInput | undefined)
    ?.input?.target?.target_id;
  return typeof targetId === 'string' && targetId.length > 0
    ? targetId
    : undefined;
};

const getVisibleTargetLabel = (targetId: string) => {
  if (targetId.length <= 32) return targetId;

  const suffix = targetId.split('-').slice(-2).join('-');
  return `…${suffix}`;
};

const normalizeVisibleFilterState = (state: ConversationFilterState) =>
  state.active || state.archived ? state : fallbackFilterState;

const getNextVisibleFilterState = (
  current: ConversationFilterState,
  toggled: 'active' | 'archived',
) => {
  if (toggled === 'active') {
    if (current.active) {
      return current.archived
        ? {
            active: false,
            archived: true,
          }
        : fallbackFilterState;
    }

    return {
      active: true,
      archived: current.archived,
    };
  }

  if (current.archived) {
    return current.active
      ? {
          active: true,
          archived: false,
        }
      : fallbackFilterState;
  }

  return {
    active: current.active,
    archived: true,
  };
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
  selectionDisabled?: boolean;
  newActionDisabled?: boolean;
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
  onNewConversation?: () => void;
  newActionLabel?: string;
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
  newActionDisabled = false,
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
  onNewConversation,
  newActionLabel = 'New conversation',
  showHeaderTitle = true,
}: Props) {
  const relativeTimeNowMs = useRelativeTimeTick();
  const log = useMemo(() => createLogger('client'), []);
  const enableBulkUi = Boolean(onBulkArchive || onBulkRestore || onBulkDelete);
  const showBulkUi = enableBulkUi;
  const showFilters = true;
  const showRowActions = true;
  void showHeaderTitle;
  const mutationDisabled = Boolean(disabled || selectionDisabled);
  const newActionLocked = Boolean(disabled || newActionDisabled);
  const bulkDisabled = Boolean(mutationDisabled || mongoConnected === false);
  const visibleFilterState = normalizeVisibleFilterState(filterState);
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
      filterState: visibleFilterState,
      selectedCount: selectedIds.size,
    });
  }, [enableBulkUi, log, selectedIds.size, selectedKey, visibleFilterState]);

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
    !visibleFilterState.active &&
    visibleFilterState.archived &&
    Boolean(onBulkDelete);

  const handleBulk = async (action: 'archive' | 'restore' | 'delete') => {
    if (action === 'archive' && !canBulkArchive) return;
    if (action === 'restore' && !canBulkRestore) return;
    if (action === 'delete' && !canBulkDelete) return;

    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    log('info', 'chat.sidebar.bulk_action_request', {
      filterState: visibleFilterState,
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
        filterState: visibleFilterState,
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
        filterState: visibleFilterState,
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
                selected={visibleFilterState.active}
                onClick={() => {
                  const next = getNextVisibleFilterState(
                    visibleFilterState,
                    'active',
                  );
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
                  color: visibleFilterState.active ? '#F4F6F8' : '#1F2933',
                  bgcolor: visibleFilterState.active ? '#20354A' : '#F4F6F8',
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
                selected={visibleFilterState.archived}
                onClick={() => {
                  const next = getNextVisibleFilterState(
                    visibleFilterState,
                    'archived',
                  );
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
                  color: visibleFilterState.archived ? '#F4F6F8' : '#1F2933',
                  bgcolor: visibleFilterState.archived ? '#20354A' : '#F4F6F8',
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
            <Stack direction="row" spacing={0.25} alignItems="center">
              {onNewConversation ? (
                <Tooltip title={newActionLabel}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={onNewConversation}
                      disabled={newActionLocked}
                      aria-label={newActionLabel}
                      data-testid="conversation-new"
                      sx={{ color: '#1F2933' }}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}
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
            </Stack>
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
          bgcolor: 'rgb(245, 248, 255)',
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
              {!visibleFilterState.active && visibleFilterState.archived && (
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
                const rootTargetId = getConversationRootTargetId(
                  conversation.flags,
                );
                const timestamp = formatConversationRowTimestamp(
                  conversation.lastMessageAt,
                  relativeTimeNowMs,
                );
                const sourceLabel = conversation.source ?? 'REST';
                return (
                  <ListItem
                    key={conversation.conversationId}
                    disableGutters
                    disablePadding
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
                        gap: { xs: 0.5, sm: 0.75 },
                        py: { xs: 1, sm: 1.25 },
                        pl: { xs: 1, sm: 1.5 },
                        pr: { xs: 1, sm: 1.5 },
                        minWidth: 0,
                        width: '100%',
                        borderBottom: '1px solid',
                        borderColor: '#D9E2EC',
                        bgcolor: selected ? '#E7EDF5' : 'rgb(245, 248, 255)',
                        '&.Mui-selected': {
                          bgcolor: '#E7EDF5',
                        },
                        '&.Mui-selected:hover': {
                          bgcolor: '#E7EDF5',
                        },
                      }}
                    >
                      <Box
                        sx={{
                          minWidth: 0,
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.5,
                          pr: 0.5,
                        }}
                      >
                        <Typography
                          variant="body2"
                          fontWeight={selected ? 700 : 600}
                          data-testid="conversation-title"
                          sx={{
                            minWidth: 0,
                            width: '100%',
                            color: '#1F2933',
                            fontSize: { xs: '0.82rem', sm: '0.875rem' },
                            lineHeight: 1.2,
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 2,
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                          }}
                        >
                          {conversation.title || 'Untitled conversation'}
                        </Typography>
                        <Box
                          sx={{
                            width: '100%',
                            minWidth: 0,
                            maxWidth: '100%',
                            display: 'grid',
                            gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                            alignItems: 'center',
                            columnGap: 0.75,
                          }}
                        >
                          <ListItemIcon
                            data-testid="conversation-provider-icon"
                            aria-label={`${providerPresentation.label} provider icon`}
                            sx={{
                              minWidth: 0,
                              color: selected ? '#20354A' : '#52606D',
                              justifyContent: 'center',
                              alignSelf: 'center',
                              '& img': {
                                height: 24,
                                width: 'auto',
                                maxWidth: 32,
                              },
                              '& .MuiSvgIcon-root': {
                                fontSize: 24,
                              },
                            }}
                          >
                            {providerPresentation.icon}
                          </ListItemIcon>
                          <Stack
                            direction="row"
                            spacing={0.75}
                            alignItems="center"
                            sx={{
                              minWidth: 0,
                              justifyContent: 'center',
                              overflow: 'hidden',
                            }}
                          >
                            {conversation.flags?.flow?.executionId &&
                              !conversation.flags?.flowChild?.executionId && (
                                <Chip
                                  label={`Run ${conversation.flags.flow.executionId.split('-')[0]}`}
                                  size="small"
                                  variant="outlined"
                                  color="default"
                                  data-testid="conversation-run-chip"
                                  sx={{
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    flexShrink: 1,
                                    '& .MuiChip-label': {
                                      px: { xs: 0.75, sm: 1 },
                                      fontSize: {
                                        xs: '0.67rem',
                                        sm: '0.75rem',
                                      },
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    },
                                  }}
                                />
                              )}
                            {conversation.flags?.flow?.subflowWaveProgress &&
                              !conversation.flags?.flowChild?.executionId && (
                                <Chip
                                  label={`Wave ${conversation.flags.flow.subflowWaveProgress.completed + conversation.flags.flow.subflowWaveProgress.notApplicable}/${conversation.flags.flow.subflowWaveProgress.expected}`}
                                  title={`Running ${conversation.flags.flow.subflowWaveProgress.running}; failed ${conversation.flags.flow.subflowWaveProgress.failed}; stopped ${conversation.flags.flow.subflowWaveProgress.stopped}; not applicable ${conversation.flags.flow.subflowWaveProgress.notApplicable}`}
                                  size="small"
                                  variant="outlined"
                                  color={
                                    conversation.flags.flow.subflowWaveProgress
                                      .failed > 0 ||
                                    conversation.flags.flow.subflowWaveProgress
                                      .stopped > 0
                                      ? 'warning'
                                      : 'success'
                                  }
                                  data-testid="conversation-wave-progress-chip"
                                  sx={{
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    flexShrink: 1,
                                    '& .MuiChip-label': {
                                      px: { xs: 0.75, sm: 1 },
                                      fontSize: {
                                        xs: '0.67rem',
                                        sm: '0.75rem',
                                      },
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    },
                                  }}
                                />
                              )}
                            {rootTargetId &&
                              !conversation.flags?.flowChild?.instanceId && (
                                <Chip
                                  label={getVisibleTargetLabel(rootTargetId)}
                                  size="small"
                                  variant="outlined"
                                  color="info"
                                  data-testid="conversation-wave-target-chip"
                                  sx={{
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    flexShrink: 0,
                                    '& .MuiChip-label': {
                                      px: { xs: 0.75, sm: 1 },
                                      fontSize: {
                                        xs: '0.67rem',
                                        sm: '0.75rem',
                                      },
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    },
                                  }}
                                />
                              )}
                            {conversation.flags?.flowChild?.executionId &&
                              (!conversation.flags?.flow?.executionId ||
                                conversation.flags.flowChild.instanceId) && (
                                <Chip
                                  label={`Run ${conversation.flags.flowChild.executionId.split('-')[0]}`}
                                  size="small"
                                  variant="outlined"
                                  color="default"
                                  data-testid="conversation-run-chip"
                                  sx={{
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    flexShrink: 1,
                                    '& .MuiChip-label': {
                                      px: { xs: 0.75, sm: 1 },
                                      fontSize: {
                                        xs: '0.67rem',
                                        sm: '0.75rem',
                                      },
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    },
                                  }}
                                />
                              )}
                            {conversation.flags?.flowChild?.instanceId &&
                              conversation.flags.flowChild.targetId && (
                                <Chip
                                  label={getVisibleTargetLabel(
                                    conversation.flags.flowChild.targetId,
                                  )}
                                  size="small"
                                  variant="outlined"
                                  color="info"
                                  data-testid="conversation-wave-target-chip"
                                  sx={{
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    flexShrink: 0,
                                    '& .MuiChip-label': {
                                      px: { xs: 0.75, sm: 1 },
                                      fontSize: {
                                        xs: '0.67rem',
                                        sm: '0.75rem',
                                      },
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    },
                                  }}
                                />
                              )}
                            <Chip
                              label={conversation.model || 'Unknown model'}
                              size="small"
                              variant="outlined"
                              color="default"
                              data-testid="conversation-model-chip"
                              sx={{
                                minWidth: 0,
                                maxWidth: '100%',
                                flexShrink: 1,
                                '& .MuiChip-label': {
                                  px: { xs: 0.75, sm: 1 },
                                  fontSize: { xs: '0.67rem', sm: '0.75rem' },
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                              }}
                            />
                          </Stack>
                          <Chip
                            label={sourceLabel}
                            size="small"
                            variant="outlined"
                            color="default"
                            data-testid="conversation-source-chip"
                            sx={{
                              justifySelf: 'end',
                              '& .MuiChip-label': {
                                px: { xs: 0.75, sm: 1 },
                                fontSize: { xs: '0.67rem', sm: '0.75rem' },
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                            }}
                          />
                        </Box>
                        <Box sx={{ width: '100%', minWidth: 0 }}>
                          <Box
                            sx={{
                              width: '100%',
                              minWidth: 0,
                              display: 'grid',
                              gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                              alignItems: 'center',
                              columnGap: 0.75,
                            }}
                          >
                            {showBulkUi && enableBulkUi && (
                              <Checkbox
                                size="small"
                                checked={selectedIds.has(
                                  conversation.conversationId,
                                )}
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
                                sx={{ my: -0.5, ml: -0.75 }}
                              />
                            )}
                            <Box
                              sx={{
                                minWidth: 0,
                                display: 'flex',
                                justifyContent: 'center',
                              }}
                            >
                              <Typography
                                variant="caption"
                                data-testid="conversation-updated"
                                noWrap
                                sx={{
                                  minWidth: 0,
                                  color: '#52606D',
                                  fontSize: { xs: '0.72rem', sm: '0.78rem' },
                                  textAlign: 'center',
                                }}
                              >
                                {timestamp}
                              </Typography>
                            </Box>
                            {showRowActions ? (
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
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void Promise.resolve(
                                        conversation.archived
                                          ? onRestore(
                                              conversation.conversationId,
                                            )
                                          : onArchive(
                                              conversation.conversationId,
                                            ),
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
                                    sx={{ justifySelf: 'end', mr: -0.5 }}
                                  >
                                    {conversation.archived ? (
                                      <RestoreIcon fontSize="small" />
                                    ) : (
                                      <ArchiveIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </span>
                              </Tooltip>
                            ) : (
                              <Box />
                            )}
                          </Box>
                        </Box>
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
