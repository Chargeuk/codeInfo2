import { jest } from '@jest/globals';
import { copyTextToClipboard } from '../utils/copyTextToClipboard';

const clipboardWriteText = jest.fn<(text: string) => Promise<void>>();
const execCommandMock = jest.fn<(command: string) => boolean>();

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    clipboardWriteText.mockReset();
    execCommandMock.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    execCommandMock.mockReturnValue(true);

    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });

    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandMock,
    });
  });

  it('uses the async clipboard API when it is available', async () => {
    await expect(copyTextToClipboard('Primary path')).resolves.toBe(
      'clipboard',
    );

    expect(clipboardWriteText).toHaveBeenCalledWith('Primary path');
    expect(execCommandMock).not.toHaveBeenCalled();
  });

  it('falls back to execCommand copy when async clipboard write fails', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('NotAllowedError'));

    await expect(copyTextToClipboard('Fallback path')).resolves.toBe(
      'execCommand',
    );

    expect(clipboardWriteText).toHaveBeenCalledWith('Fallback path');
    expect(execCommandMock).toHaveBeenCalledWith('copy');
  });

  it('uses the execCommand fallback when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    await expect(copyTextToClipboard('No clipboard API')).resolves.toBe(
      'execCommand',
    );

    expect(execCommandMock).toHaveBeenCalledWith('copy');
  });
});
