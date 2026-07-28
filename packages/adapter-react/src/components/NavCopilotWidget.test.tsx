import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavCopilotWidget } from './NavCopilotWidget.js';

function mockFetchOnce(json: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json }),
  );
}

describe('NavCopilotWidget', () => {
  it('começa fechado e abre ao clicar no botão flutuante', () => {
    render(<NavCopilotWidget apiBaseUrl="http://api.local" sessionId="s1" />);
    expect(screen.queryByTestId('nav-copilot-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('nav-copilot-toggle'));
    expect(screen.getByTestId('nav-copilot-panel')).toBeInTheDocument();
  });

  it('envia uma mensagem e renderiza a resposta do assistente', async () => {
    mockFetchOnce({ reply: 'Tarefa criada.', status: 'executed' });
    render(<NavCopilotWidget apiBaseUrl="http://api.local" sessionId="s1" />);
    fireEvent.click(screen.getByTestId('nav-copilot-toggle'));

    fireEvent.change(screen.getByTestId('nav-copilot-input'), { target: { value: 'cria uma tarefa' } });
    fireEvent.click(screen.getByTestId('nav-copilot-send'));

    await waitFor(() => expect(screen.getByText('Tarefa criada.')).toBeInTheDocument());
    expect(screen.getByText('cria uma tarefa')).toBeInTheDocument();
  });

  it('renderiza o cartão de confirmação quando o motor pede confirmação', async () => {
    mockFetchOnce({
      reply: 'Confirma apagar tudo?',
      status: 'awaiting_confirmation',
      action: { key: 'task.delete_all', description: 'apagar todas as tarefas' },
    });
    render(<NavCopilotWidget apiBaseUrl="http://api.local" sessionId="s1" />);
    fireEvent.click(screen.getByTestId('nav-copilot-toggle'));

    fireEvent.change(screen.getByTestId('nav-copilot-input'), { target: { value: 'apaga tudo' } });
    fireEvent.click(screen.getByTestId('nav-copilot-send'));

    await waitFor(() => expect(screen.getByTestId('confirmation-card')).toBeInTheDocument());
    expect(screen.getByText('apagar todas as tarefas')).toBeInTheDocument();
  });

  it('chama onNavigate quando a resposta traz navigateTo', async () => {
    const onNavigate = vi.fn();
    mockFetchOnce({ reply: 'Indo para configurações.', status: 'executed', navigateTo: '/app/settings' });
    render(<NavCopilotWidget apiBaseUrl="http://api.local" sessionId="s1" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('nav-copilot-toggle'));

    fireEvent.change(screen.getByTestId('nav-copilot-input'), { target: { value: 'vai pras configurações' } });
    fireEvent.click(screen.getByTestId('nav-copilot-send'));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/app/settings'));
  });
});
