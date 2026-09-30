import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import {
  forkAgentConversation,
  getAgentForkOptions,
  type AgentForkOptions,
  type AgentForkResult,
} from '../../api/agents';

export default function AgentForkDialog({
  conversationId,
  sourceTurnId,
  sourceTitle,
  onClose,
  onCreated,
}: {
  conversationId: string;
  sourceTurnId?: string;
  sourceTitle?: string;
  onClose: () => void;
  onCreated: (result: AgentForkResult) => void;
}) {
  const [options, setOptions] = useState<AgentForkOptions | null>(null);
  const [target, setTarget] = useState<
    AgentForkOptions['agents'][number] | null
  >(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const identity = useRef<{ target: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    void getAgentForkOptions(conversationId, sourceTurnId)
      .then((result) => {
        if (!active) return;
        setOptions(result);
        setTarget(result.agents.find((agent) => agent.sameAgent) ?? null);
      })
      .catch((failure) => {
        if (active) setError((failure as Error).message);
      });
    return () => {
      active = false;
    };
  }, [conversationId, sourceTurnId]);

  const create = async () => {
    if (!target || creating) return;
    if (identity.current?.target !== target.name)
      identity.current = {
        target: target.name,
        id:
          crypto.randomUUID?.() ??
          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      };
    setCreating(true);
    setError('');
    try {
      const result = await forkAgentConversation({
        conversationId,
        sourceTurnId: sourceTurnId ?? options?.sourceTurnId,
        targetAgentName: target.name,
        requestId: identity.current.id,
      });
      onCreated(result);
    } catch (failure) {
      setError((failure as Error).message);
      setCreating(false);
    }
  };

  return (
    <Dialog
      open
      onClose={creating ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="agent-fork-title"
      slotProps={{
        paper: {
          sx: {
            m: { xs: 1, sm: 3 },
            width: { xs: 'calc(100% - 16px)', sm: '100%' },
          },
        },
      }}
    >
      <DialogTitle id="agent-fork-title">Fork conversation</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2, overflowWrap: 'anywhere' }}>
          {options?.sourceTitle ?? sourceTitle ?? 'Agent conversation'}
        </Typography>
        {!options && !error && (
          <CircularProgress size={24} aria-label="Loading compatible agents" />
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {options && (
          <>
            <Autocomplete
              options={options.agents}
              value={target}
              disabled={creating}
              onChange={(_event, value) => setTarget(value)}
              getOptionLabel={(agent) =>
                `${agent.name}${agent.sameAgent ? ' (Same agent)' : ''}`
              }
              isOptionEqualToValue={(a, b) => a.name === b.name}
              noOptionsText="No compatible agents available"
              renderOption={(props, agent) => (
                <Box
                  component="li"
                  {...props}
                  key={agent.name}
                  sx={{ minHeight: 44 }}
                >
                  {agent.name}
                  {agent.sameAgent ? ' (Same agent)' : ''}
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  autoFocus
                  label="Target agent"
                  placeholder="Search compatible agents"
                />
              )}
              sx={{ mb: 2 }}
            />
            {options.estimated && (
              <Alert severity="info">
                Older history lacks exact provider IDs. The server will estimate
                the fork point using provider history order and surrounding
                messages.
              </Alert>
            )}
            <Typography variant="body2" sx={{ mt: 2 }}>
              The new conversation shares the working folder and opens ready for
              your next instruction.
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={creating} sx={{ minHeight: 44 }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void create()}
          disabled={!target || creating}
          sx={{ minHeight: 44 }}
        >
          {creating ? 'Creating…' : 'Create fork'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
