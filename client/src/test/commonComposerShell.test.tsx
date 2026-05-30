import { jest } from '@jest/globals';
import { TextField } from '@mui/material';
import { render, screen, within } from '@testing-library/react';
import type { FormEvent } from 'react';
import CommonComposerFooter from '../components/workspace/composer/CommonComposerFooter';
import CommonComposerMainInputRow from '../components/workspace/composer/CommonComposerMainInputRow';
import CommonComposerShell from '../components/workspace/composer/CommonComposerShell';
import ComposerSendButton from '../components/workspace/composer/ComposerSendButton';

describe('CommonComposerShell', () => {
  it('keeps the main input row dominant and the footer row below it', () => {
    const handleSubmit = jest.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    render(
      <CommonComposerShell
        data-testid="composer-shell"
        onSubmit={handleSubmit}
        mainInputRow={
          <div data-testid="main-input-row">
            <CommonComposerMainInputRow>
              <TextField label="Message" defaultValue="Hello" />
              <ComposerSendButton />
            </CommonComposerMainInputRow>
          </div>
        }
        footerRow={
          <div data-testid="footer-row">
            <CommonComposerFooter>
              <button type="button">Info</button>
              <button type="button">Options</button>
            </CommonComposerFooter>
          </div>
        }
      />,
    );

    const shell = screen.getByTestId('composer-shell');
    const mainInputRow = screen.getByTestId('main-input-row');
    const footerRow = screen.getByTestId('footer-row');
    const sendButton = within(mainInputRow).getByRole('button', {
      name: 'Send',
    });

    expect(shell).toContainElement(mainInputRow);
    expect(shell).toContainElement(footerRow);
    expect(mainInputRow).toContainElement(sendButton);
    expect(
      mainInputRow.compareDocumentPosition(footerRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
