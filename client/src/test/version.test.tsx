import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import App from '../App';

globalThis.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ app: 'server', version: '0.0.1' }),
}) as unknown as typeof fetch;

describe('App version display', () => {
  it('shows client and server versions', async () => {
    render(<App />);
    expect(screen.getByText(/Client version/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Server version/i)).toBeInTheDocument(),
    );
  });
});
