import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { getApiBaseUrl } from '../../api/baseUrl';
import { createLogger } from '../../logging';
import DirectoryPickerDialog from './DirectoryPickerDialog';

const serverBase = getApiBaseUrl();

export type IngestModel = {
  id: string;
  displayName: string;
  contextLength?: number;
};

type FormErrors = Partial<Record<'path' | 'name' | 'model', string>>;

export type IngestFormProps = {
  models: IngestModel[];
  lockedModelId?: string;
  defaultModelId?: string;
  onStarted?: (runId: string) => void;
  disabled?: boolean;
};

export default function IngestForm({
  models,
  lockedModelId,
  defaultModelId,
  onStarted,
  disabled = false,
}: IngestFormProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<string | undefined>(
    lockedModelId ?? defaultModelId,
  );
  const [dryRun, setDryRun] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const isFormDisabled = disabled || isSubmitting;
  const logger = useMemo(() => createLogger('client'), []);

  const modelOptions = useMemo(() => {
    const list = [...models];
    if (lockedModelId && !list.find((m) => m.id === lockedModelId)) {
      list.push({ id: lockedModelId, displayName: lockedModelId });
    }
    return list;
  }, [models, lockedModelId]);

  useEffect(() => {
    setModel((prev) => {
      if (lockedModelId) return lockedModelId;
      if (prev && modelOptions.some((m) => m.id === prev)) return prev;
      if (defaultModelId && modelOptions.some((m) => m.id === defaultModelId)) {
        return defaultModelId;
      }
      return modelOptions[0]?.id;
    });
  }, [lockedModelId, defaultModelId, modelOptions]);

  const validate = () => {
    const next: FormErrors = {};
    if (!path.trim()) next.path = 'Path is required';
    if (!name.trim()) next.name = 'Name is required';
    if (!model) next.model = 'Select a model';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const updateFieldError = (field: keyof FormErrors, value: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      if (!value.trim()) {
        next[field] =
          field === 'path'
            ? 'Path is required'
            : field === 'name'
              ? 'Name is required'
              : 'Select a model';
      } else {
        delete next[field];
      }
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(undefined);
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(new URL('/ingest/start', serverBase).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: path.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          model,
          dryRun,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const message = payload?.message || `Start failed (${res.status})`;
        throw new Error(message);
      }
      const data = (await res.json()) as { runId?: string };
      if (!data.runId) throw new Error('Missing runId in response');
      onStarted?.(data.runId);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = path.trim() && name.trim() && model;

  useEffect(() => {
    logger('info', 'DEV-0000028[T7] ingest controls sizing applied', {
      page: 'ingest',
    });
  }, [logger]);

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            label="Folder path"
            name="path"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              if (errors.path) updateFieldError('path', e.target.value);
            }}
            onBlur={(e) => updateFieldError('path', e.target.value)}
            required
            fullWidth
            disabled={isFormDisabled}
            error={Boolean(errors.path)}
            helperText={errors.path}
            sx={{ flex: 1 }}
            size="small"
          />
          <Button
            variant="outlined"
            onClick={() => setDirPickerOpen(true)}
            disabled={isFormDisabled}
            size="small"
          >
            Choose folder…
          </Button>
        </Stack>

        <TextField
          label="Display name"
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) updateFieldError('name', e.target.value);
          }}
          onBlur={(e) => updateFieldError('name', e.target.value)}
          required
          fullWidth
          disabled={isFormDisabled}
          error={Boolean(errors.name)}
          helperText={errors.name}
          size="small"
        />

        <TextField
          label="Description (optional)"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          disabled={isFormDisabled}
          multiline
          minRows={2}
          size="small"
        />

        <TextField
          select
          SelectProps={{ native: true }}
          label="Embedding model"
          name="model"
          value={model ?? ''}
          onChange={(e) => {
            setModel(e.target.value);
            if (errors.model) updateFieldError('model', e.target.value);
          }}
          onBlur={(e) => updateFieldError('model', e.target.value)}
          required
          fullWidth
          disabled={
            Boolean(lockedModelId) ||
            isFormDisabled ||
            modelOptions.length === 0
          }
          error={Boolean(errors.model)}
          helperText={errors.model}
          size="small"
        >
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </TextField>

        <FormControlLabel
          control={
            <Switch
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={isFormDisabled}
              name="dryRun"
              color="primary"
            />
          }
          label="Dry run (skip embedding writes)"
        />

        {submitError ? (
          <Alert severity="error" data-testid="submit-error">
            {submitError}
          </Alert>
        ) : null}

        <Stack direction="row" spacing={2} alignItems="center">
          <Button
            type="submit"
            variant="contained"
            disabled={!isValid || isFormDisabled}
            data-testid="start-ingest"
            size="small"
          >
            {isSubmitting ? 'Starting…' : 'Start ingest'}
          </Button>
          {isSubmitting ? (
            <Typography color="text.secondary" variant="body2">
              Submitting ingest request…
            </Typography>
          ) : null}
        </Stack>
      </Stack>

      <DirectoryPickerDialog
        open={dirPickerOpen}
        path={path}
        onClose={() => setDirPickerOpen(false)}
        onPick={(picked) => {
          setPath(picked);
          if (errors.path) updateFieldError('path', picked);
          setDirPickerOpen(false);
        }}
      />
    </Box>
  );
}
