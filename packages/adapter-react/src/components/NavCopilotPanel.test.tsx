import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavCopilotPanel } from './NavCopilotPanel.js';

function mockFetchOnce(json: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json }));
}

describe('NavCopilotPanel', () => {
  it('já renderiza aberto, sem botão de toggle nem de fechar', () => {
    render(<NavCopilotPanel apiBaseUrl="http://api.local" sessionId="s1" />);
    expect(screen.getByTestId('nav-copilot-fixed-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-copilot-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-copilot-close')).not.toBeInTheDocument();
  });

  it('envia mensagem e renderiza a resposta, igual ao widget flutuante', async () => {
    mockFetchOnce({ reply: 'Tarefa criada.', status: 'executed' });
    render(<NavCopilotPanel apiBaseUrl="http://api.local" sessionId="s1" />);

    fireEvent.change(screen.getByTestId('nav-copilot-input'), { target: { value: 'cria uma tarefa' } });
    fireEvent.click(screen.getByTestId('nav-copilot-send'));

    await waitFor(() => expect(screen.getByText('Tarefa criada.')).toBeInTheDocument());
  });

  it('aplica a largura customizada', () => {
    render(<NavCopilotPanel apiBaseUrl="http://api.local" sessionId="s1" width={420} />);
    expect(screen.getByTestId('nav-copilot-fixed-panel')).toHaveStyle({ width: '420px' });
  });

  it('autoStartOnboarding dispara o onboarding automaticamente ao montar, sem turno de usuário', async () => {
    mockFetchOnce({
      reply: 'Qual o nome do seu negócio?',
      status: 'awaiting_onboarding_answer',
      onboarding: { flowKey: 'business-setup', stepIndex: 0, totalSteps: 3, completed: false },
    });
    render(<NavCopilotPanel apiBaseUrl="http://api.local" sessionId="s1" autoStartOnboarding="business-setup" />);

    await waitFor(() => expect(screen.getByText('Qual o nome do seu negócio?')).toBeInTheDocument());
    expect(screen.getByTestId('nav-copilot-messages').children).toHaveLength(1);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'http://api.local/nav-engine/onboarding/start',
    );
  });

  it('autoStartOnboarding dispara só uma vez mesmo com re-renders (guard contra StrictMode)', async () => {
    mockFetchOnce({
      reply: 'Qual o nome do seu negócio?',
      status: 'awaiting_onboarding_answer',
      onboarding: { flowKey: 'business-setup', stepIndex: 0, totalSteps: 3, completed: false },
    });
    const { rerender } = render(
      <NavCopilotPanel apiBaseUrl="http://api.local" sessionId="s1" autoStartOnboarding="business-setup" />,
    );
    await waitFor(() => expect(screen.getByText('Qual o nome do seu negócio?')).toBeInTheDocument());

    rerender(<NavCopilotPanel apiBaseUrl="http://api.local" sessionId="s1" autoStartOnboarding="business-setup" />);

    expect(fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});
