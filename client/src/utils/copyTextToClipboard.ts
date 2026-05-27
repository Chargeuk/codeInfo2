export type CopyTextMethod = 'clipboard' | 'execCommand';

const fallbackCopyText = (text: string): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }
  if (typeof document.execCommand !== 'function') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.fontSize = '16px';

  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = window.getSelection();
  const previousRanges =
    selection == null
      ? []
      : Array.from({ length: selection.rangeCount }, (_, index) =>
          selection.getRangeAt(index).cloneRange(),
        );

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
    if (selection) {
      selection.removeAllRanges();
      previousRanges.forEach((range) => selection.addRange(range));
    }
    activeElement?.focus();
  }

  return copied;
};

export async function copyTextToClipboard(
  text: string,
): Promise<CopyTextMethod> {
  const clipboard = globalThis.navigator?.clipboard;

  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return 'clipboard';
    } catch (error) {
      if (fallbackCopyText(text)) {
        return 'execCommand';
      }
      throw error;
    }
  }

  if (fallbackCopyText(text)) {
    return 'execCommand';
  }

  throw new Error('clipboard_unavailable');
}
