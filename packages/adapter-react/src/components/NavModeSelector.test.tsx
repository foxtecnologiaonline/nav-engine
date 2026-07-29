import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavModeSelector } from './NavModeSelector.js';

describe('NavModeSelector', () => {
  it('chama onSelect("app") ao clicar em Modo App', () => {
    const onSelect = vi.fn();
    render(<NavModeSelector onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('nav-mode-select-app'));
    expect(onSelect).toHaveBeenCalledWith('app');
  });

  it('chama onSelect("chat") ao clicar em Modo Chat', () => {
    const onSelect = vi.fn();
    render(<NavModeSelector onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('nav-mode-select-chat'));
    expect(onSelect).toHaveBeenCalledWith('chat');
  });

  it('aceita labels e título customizados', () => {
    render(
      <NavModeSelector onSelect={vi.fn()} title="Escolha seu modo" appLabel="Clássico" chatLabel="Conversa" />,
    );
    expect(screen.getByText('Escolha seu modo')).toBeInTheDocument();
    expect(screen.getByText('Clássico')).toBeInTheDocument();
    expect(screen.getByText('Conversa')).toBeInTheDocument();
  });
});
