import type {
  ChatAgentFlagDescriptor,
  ChatAgentFlagKey,
  ChatAgentFlagValue,
} from '@codeinfo2/common';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { InputHTMLAttributes } from 'react';
import type { ChatAgentFlagDraft } from '../../hooks/useChatStream';

type Props = {
  descriptors: ChatAgentFlagDescriptor[];
  values: ChatAgentFlagDraft;
  onChange: (
    key: ChatAgentFlagKey,
    value: ChatAgentFlagValue | undefined,
  ) => void;
  disabled?: boolean;
};

const withDataTestId = (value: string) =>
  ({ 'data-testid': value }) as InputHTMLAttributes<HTMLInputElement> & {
    'data-testid': string;
  };

const toControlTestId = (key: ChatAgentFlagKey, controlType: string) => {
  switch (key) {
    case 'sandboxMode':
      return 'sandbox-mode-select';
    case 'approvalPolicy':
      return 'approval-policy-select';
    case 'modelReasoningEffort':
      return 'reasoning-effort-select';
    case 'modelReasoningSummary':
      return 'reasoning-summary-select';
    case 'modelVerbosity':
      return 'verbosity-select';
    case 'networkAccessEnabled':
      return 'network-access-switch';
    case 'webSearchMode':
      return 'web-search-switch';
    case 'toolAccess':
      return 'tool-access-select';
    case 'temperature':
      return 'temperature-input';
    case 'maxTokens':
      return 'max-tokens-input';
    case 'contextOverflowPolicy':
      return 'context-overflow-policy-select';
    default:
      return `${key}-${controlType}`;
  }
};

const formatSelectedValue = (value: ChatAgentFlagValue) =>
  typeof value === 'string'
    ? value
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : String(value);

export default function AgentFlagsPanel({
  descriptors,
  values,
  onChange,
  disabled,
}: Props) {
  return (
    <Accordion
      defaultExpanded={false}
      disableGutters
      data-testid="agent-flags-panel"
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
        <Stack spacing={0.25}>
          <Typography variant="subtitle2" fontWeight={700}>
            Agent Flags
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Shows only the controls supported by the selected provider and
            model.
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5} data-testid="codex-flags-panel">
          {descriptors.map((descriptor) => {
            const value = values[descriptor.key] ?? descriptor.resolvedDefault;
            const testId = toControlTestId(
              descriptor.key,
              descriptor.controlType,
            );

            if (
              descriptor.controlType === 'boolean' ||
              descriptor.key === 'webSearchMode'
            ) {
              const checked =
                descriptor.key === 'webSearchMode'
                  ? value !== 'disabled'
                  : value === true;
              return (
                <Stack key={descriptor.key} spacing={0.25}>
                  <FormControlLabel
                    control={
                      <Switch
                        color="primary"
                        checked={checked}
                        onChange={(event) =>
                          onChange(
                            descriptor.key,
                            descriptor.key === 'webSearchMode'
                              ? event.target.checked
                                ? 'live'
                                : 'disabled'
                              : event.target.checked,
                          )
                        }
                        disabled={disabled || !descriptor.editable}
                        slotProps={{
                          input: withDataTestId(testId),
                        }}
                      />
                    }
                    label={descriptor.label}
                  />
                  {descriptor.description ? (
                    <FormHelperText sx={{ ml: 0 }}>
                      {descriptor.description}
                    </FormHelperText>
                  ) : null}
                </Stack>
              );
            }

            if (descriptor.controlType === 'number') {
              return (
                <FormControl key={descriptor.key} size="small" fullWidth>
                  <TextField
                    size="small"
                    type="number"
                    label={descriptor.label}
                    value={value}
                    disabled={disabled || !descriptor.editable}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      onChange(
                        descriptor.key,
                        nextValue.trim().length > 0
                          ? Number(nextValue)
                          : undefined,
                      );
                    }}
                    inputProps={{
                      ...(typeof descriptor.min === 'number'
                        ? { min: descriptor.min }
                        : {}),
                      ...(typeof descriptor.max === 'number'
                        ? { max: descriptor.max }
                        : {}),
                      ...(descriptor.integer ? { step: 1 } : { step: 'any' }),
                    }}
                    slotProps={{
                      htmlInput: withDataTestId(testId),
                    }}
                  />
                  {descriptor.description ? (
                    <FormHelperText>{descriptor.description}</FormHelperText>
                  ) : null}
                </FormControl>
              );
            }

            return (
              <FormControl
                key={descriptor.key}
                size="small"
                fullWidth
                disabled={disabled || !descriptor.editable}
              >
                <InputLabel id={`${descriptor.key}-label`}>
                  {descriptor.label}
                </InputLabel>
                <Select
                  labelId={`${descriptor.key}-label`}
                  id={`${descriptor.key}-select`}
                  label={descriptor.label}
                  value={typeof value === 'string' ? value : String(value)}
                  onChange={(event) =>
                    onChange(descriptor.key, event.target.value as string)
                  }
                  data-testid={testId}
                >
                  {(descriptor.supportedValues ?? []).map((option) => (
                    <MenuItem
                      key={`${descriptor.key}-${option.value}`}
                      value={String(option.value)}
                    >
                      {option.label ?? formatSelectedValue(option.value)}
                    </MenuItem>
                  ))}
                </Select>
                {descriptor.description ? (
                  <FormHelperText>{descriptor.description}</FormHelperText>
                ) : null}
              </FormControl>
            );
          })}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
