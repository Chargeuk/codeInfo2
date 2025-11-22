import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { createLogger } from '../logging';
import { _getQueue } from '../logging/transport';

function LogsStub() {
  const log = useMemo(() => createLogger('client-demo', () => '/logs'), []);
  return (
    <button type="button" onClick={() => log('info', 'sample log')}>
      Send sample log
    </button>
  );
}

describe('Logs page stub', () => {
  afterEach(() => {
    _getQueue().length = 0;
    jest.clearAllMocks();
  });

  it('emits a sample log when the button is clicked', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    render(<LogsStub />);

    fireEvent.click(screen.getByText('Send sample log'));

    expect(_getQueue().length).toBe(1);
    const entry = _getQueue()[0];
    expect(entry.message).toBe('sample log');
    expect(entry.route).toBe('/logs');
  });
});
