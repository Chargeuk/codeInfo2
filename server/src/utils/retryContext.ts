import { getErrorMessage } from '../agents/transientReconnect.js';
import { truncateText } from './truncateText.js';

const RETRY_CONTEXT_MAX_LENGTH = 240;

const redactSecrets = (value: string): string =>
  value
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '<redacted>')
    .replace(
      /\b(bearer|authorization|api[_-]?key)\b\s*[:=]\s*\S+/gi,
      '$1=<redacted>',
    )
    .replace(
      /\b[A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g,
      '<redacted>',
    );

export const sanitizeRetryErrorContext = (error: unknown): string => {
  const fromMessage = getErrorMessage(error);
  const base =
    typeof fromMessage === 'string' && fromMessage.trim().length > 0
      ? fromMessage
      : 'Unknown failure';

  const singleLine =
    base
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? 'Unknown failure';

  const withoutObjectNoise = singleLine.replace(
    /^\[object Object\]$/i,
    'Unknown failure',
  );
  const redacted = redactSecrets(withoutObjectNoise);
  return truncateText(redacted, RETRY_CONTEXT_MAX_LENGTH);
};

export const formatRetryInstruction = (params: {
  originalInstruction: string;
  previousError: unknown;
}): { instruction: string; sanitizedErrorLength: number } => {
  const sanitized = sanitizeRetryErrorContext(params.previousError);
  return {
    instruction: `Your previous attempt at this task failed with the error "${sanitized}", please try again:\n${params.originalInstruction}`,
    sanitizedErrorLength: sanitized.length,
  };
};
