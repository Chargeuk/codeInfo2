import { render, screen } from '@testing-library/react';
import ComposerDesktopPopover from './ComposerDesktopPopover';

describe('ComposerDesktopPopover', () => {
  it('gives long desktop content a bounded scroll container', async () => {
    const anchorEl = document.createElement('button');
    document.body.appendChild(anchorEl);

    render(
      <ComposerDesktopPopover
        open
        anchorEl={anchorEl}
        onClose={() => {}}
        data-testid="desktop-popover"
      >
        <div>Popover body</div>
      </ComposerDesktopPopover>,
    );

    const popover = await screen.findByTestId('desktop-popover');
    const paper = popover.querySelector('.MuiPaper-root') as HTMLElement | null;
    const scrollBody = paper?.firstElementChild as HTMLElement | null;

    expect(paper).not.toBeNull();
    expect(paper).toHaveStyle({
      maxHeight: 'calc(100vh - 32px)',
      overflow: 'hidden',
    });
    expect(scrollBody).not.toBeNull();
    expect(scrollBody).toHaveStyle({
      maxHeight: 'calc(100vh - 64px)',
      overflowY: 'auto',
      overflowX: 'hidden',
    });

    anchorEl.remove();
  });
});
