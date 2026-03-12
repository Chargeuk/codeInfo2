import type { ReingestError } from './reingestService.js';

export function formatReingestPrestartReason(error: ReingestError): string {
  const fieldMessage = error.data.fieldErrors[0]?.message?.trim();
  if (fieldMessage) return fieldMessage;
  return `${error.message}: ${error.data.code}`;
}
