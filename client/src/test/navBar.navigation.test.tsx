import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NavBar from '../components/NavBar';

describe('visible navigation chrome', () => {
  it('renders the shared workspace navigation without a standalone LM Studio destination', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavBar />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('workspace-app-rail')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /LM Studio/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Home/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Chat/i })).toBeInTheDocument();
  });
});
