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
import type { OpenAiStatus } from '../../hooks/useIngestModels';
import DirectoryPickerDialog from './DirectoryPickerDialog';

const serverBase = getApiBaseUrl();

export type IngestModel = {
  id: string;
  displayName: string;
  provider?: 'lmstudio' | 'openai';
  contextLength?: number;
};

type LockIdentity = {
  embeddingProvider?: 'lmstudio' | 'openai';
  embeddingModel?: string;
  embeddingDimensions?: number;
};

type FormErrors = Partial<Record<'path' | 'name' | 'model', string>>;

export type IngestFormProps = {
  models: IngestModel[];
  lockedModelId?: string;
  lockedModel?: LockIdentity;
  openai?: OpenAiStatus;
  defaultModelId?: string;
  onStarted?: (runId: string) => void;
  disabled?: boolean;
};

export default function IngestForm({
  models,
  lockedModelId,
  lockedModel,
  openai,
  defaultModelId,
  onStarted,
  disabled = false,
}: IngestFormProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedModelKey, setSelectedModelKey] = useState<
    string | undefined
  >();
  const [dryRun, setDryRun] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const isFormDisabled = disabled || isSubmitting;
  const logger = useMemo(() => createLogger('client'), []);

  const modelOptions = useMemo(() => {
    const list = [...models];
    const lockProvider = lockedModel?.embeddingProvider ?? 'lmstudio';
    const lockModelId = lockedModel?.embeddingModel ?? lockedModelId;
    if (lockModelId && !list.find((m) => m.id === lockModelId)) {
      list.push({
        id: lockModelId,
        displayName: lockModelId,
        provider: lockProvider,
      });
    }
    return list.map((entry) => ({
      ...entry,
      provider: entry.provider ?? 'lmstudio',
      optionKey: `${entry.provider ?? 'lmstudio'}::${entry.id}`,
      providerQualifiedLabel: `${entry.provider ?? 'lmstudio'} / ${
        entry.displayName || entry.id
      }`,
    }));
  }, [
    models,
    lockedModel?.embeddingModel,
    lockedModel?.embeddingProvider,
    lockedModelId,
  ]);

  const selectedModel = useMemo(
    () => modelOptions.find((entry) => entry.optionKey === selectedModelKey),
    [modelOptions, selectedModelKey],
  );

  useEffect(() => {
    setSelectedModelKey((prev) => {
      const lockProvider = lockedModel?.embeddingProvider ?? 'lmstudio';
      const lockModelId = lockedModel?.embeddingModel ?? lockedModelId;
      if (lockModelId) return `${lockProvider}::${lockModelId}`;
      if (prev && modelOptions.some((m) => m.optionKey === prev)) return prev;
      if (defaultModelId) {
        const defaultOption = modelOptions.find((m) => m.id === defaultModelId);
        if (defaultOption) return defaultOption.optionKey;
      }
      return modelOptions[0]?.optionKey;
    });
  }, [
    lockedModel?.embeddingModel,
    lockedModel?.embeddingProvider,
    lockedModelId,
    defaultModelId,
    modelOptions,
  ]);

  const openAiBanner = useMemo(() => {
    const statusCode = openai?.statusCode;
    if (!statusCode) return null;
    if (statusCode === 'OPENAI_DISABLED') {
      return {
        severity: 'info' as const,
        testId: 'ingest-openai-banner-openai-disabled',
        statusCode,
        message:
          'OpenAI embedding models are unavailable. Set OPENAI_EMBEDDING_KEY on the server to enable them.',
      };
    }
    if (statusCode === 'OPENAI_MODELS_LIST_TEMPORARY_FAILURE') {
      return {
        severity: 'warning' as const,
        testId: 'ingest-openai-banner-openai-models-list-temporary-failure',
        statusCode,
        message:
          'OpenAI embedding model listing is temporarily unavailable. LM Studio models are still available.',
      };
    }
    if (statusCode === 'OPENAI_MODELS_LIST_AUTH_FAILED') {
      return {
        severity: 'warning' as const,
        testId: 'ingest-openai-banner-openai-models-list-auth-failed',
        statusCode,
        message:
          'OpenAI embedding model listing failed authentication. Verify OPENAI_EMBEDDING_KEY and account access.',
      };
    }
    if (statusCode === 'OPENAI_MODELS_LIST_UNAVAILABLE') {
      return {
        severity: 'warning' as const,
        testId: 'ingest-openai-banner-openai-models-list-unavailable',
        statusCode,
        message:
          'OpenAI embedding model listing is currently unavailable. LM Studio models are still available.',
      };
    }
    if (statusCode === 'OPENAI_ALLOWLIST_NO_MATCH') {
      return {
        severity: 'warning' as const,
        testId: 'ingest-openai-banner-openai-allowlist-no-match',
        statusCode,
        message:
          'No allowlisted OpenAI embedding models are available for this key. LM Studio models are still available.',
      };
    }
    return null;
  }, [openai?.statusCode]);

  const validate = () => {
    const next: FormErrors = {};
    if (!path.trim()) next.path = 'Path is required';
    if (!name.trim()) next.name = 'Name is required';
    if (!selectedModel) next.model = 'Select a model';
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
      if (!selectedModel) {
        throw new Error('Select a model');
      }
      const payload = {
        path: path.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        model: selectedModel.id,
        embeddingProvider: selectedModel.provider,
        embeddingModel: selectedModel.id,
        dryRun,
      };
      logger('info', 'DEV-0000036:T13:ingest_ui_submit_payload', {
        embeddingProvider: payload.embeddingProvider,
        embeddingModel: payload.embeddingModel,
        hasDimensionsInput: false,
      });
      const res = await fetch(new URL('/ingest/start', serverBase).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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

  const isValid = path.trim() && name.trim() && selectedModel;

  useEffect(() => {
    logger('info', 'DEV-0000028[T7] ingest controls sizing applied', {
      page: 'ingest',
    });
  }, [logger]);

  useEffect(() => {
    logger('info', 'DEV-0000036:T13:ingest_ui_state_rendered', {
      component: 'IngestForm',
      selectedEmbeddingProvider: selectedModel?.provider ?? null,
      selectedEmbeddingModel: selectedModel?.id ?? null,
      openAiStatusCode: openAiBanner?.statusCode ?? openai?.statusCode ?? null,
      hasDimensionsInput: false,
    });
  }, [
    logger,
    selectedModel?.id,
    selectedModel?.provider,
    openAiBanner?.statusCode,
    openai?.statusCode,
  ]);

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={2}>
        {openAiBanner ? (
          <Alert
            severity={openAiBanner.severity}
            data-testid={openAiBanner.testId}
          >
            {openAiBanner.message}
          </Alert>
        ) : null}

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
          value={selectedModelKey ?? ''}
          onChange={(e) => {
            setSelectedModelKey(e.target.value);
            if (errors.model) updateFieldError('model', e.target.value);
          }}
          onBlur={(e) => updateFieldError('model', e.target.value)}
          required
          fullWidth
          disabled={
            Boolean(lockedModel?.embeddingModel ?? lockedModelId) ||
            isFormDisabled ||
            modelOptions.length === 0
          }
          error={Boolean(errors.model)}
          helperText={errors.model}
          size="small"
        >
          {modelOptions.map((m) => (
            <option key={m.optionKey} value={m.optionKey}>
              {m.providerQualifiedLabel}
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
