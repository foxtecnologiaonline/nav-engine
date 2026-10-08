import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UseNavCopilotResult } from '../use-nav-copilot.js';

const useNavCopilotMock = vi.fn<[], UseNavCopilotResult>();
vi.mock('../use-nav-copilot.js', () => ({ useNavCopilot: () => useNavCopilotMock() }));

// `vi.mock` acima é hoisted pelo vitest antes deste import — o módulo real de
// useNavCopilot nunca é exercitado aqui; captura de áudio (getUserMedia/
// MediaRecorder) é cobertura deliberadamente leve, mesma convenção de
// MicButton (APIs de browser difíceis de simular fielmente em jsdom).
import { NavCopilotOrb } from './NavCopilotOrb.js';

function baseResult(overrides: Partial<UseNavCopilotResult> = {}): UseNavCopilotResult {
  return {
    messages: [],
    status: 'idle',
    pendingConfirmation: null,
    sendMessage: vi.fn(),
    sendAudio: vi.fn(),
    confirm: vi.fn(),
    startOnboarding: vi.fn(),
    onboardingProgress: null,
    isSpeaking: false,
    error: null,
    ...overrides,
  };
}

describe('NavCopilotOrb', () => {
  beforeEach(() => {
    useNavCopilotMock.mockReset();
  });

  it('estado idle: sem legenda, botão habilitado e não pressionado', () => {
    useNavCopilotMock.mockReturnValue(baseResult());
    render(<NavCopilotOrb apiBaseUrl="http://api.local" sessionId="s1" />);

    expect(screen.getByTestId('nav-copilot-orb-container')).toHaveAttribute('data-state', 'idle');
    expect(screen.queryByTestId('nav-copilot-orb-caption')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-copilot-orb')).not.toBeDisabled();
    expect(screen.getByTestId('nav-copilot-orb')).toHaveAttribute('aria-pressed', 'false');
  });

  it('estado processing: reflete status "thinking" do hook e desabilita o orbe', () => {
    useNavCopilotMock.mockReturnValue(baseResult({ status: 'thinking' }));
    render(<NavCopilotOrb apiBaseUrl="http://api.local" sessionId="s1" />);

    expect(screen.getByTestId('nav-copilot-orb-container')).toHaveAttribute('data-state', 'processing');
    expect(screen.getByTestId('nav-copilot-orb')).toBeDisabled();
  });

  it('estado speaking: reflete isSpeaking do hook, desabilita o orbe e mostra a legenda', () => {
    useNavCopilotMock.mockReturnValue(
      baseResult({
        isSpeaking: true,
        messages: [{ id: '1', role: 'assistant', text: 'Tarefa criada.', timestamp: Date.now() }],
      }),
    );
    render(<NavCopilotOrb apiBaseUrl="http://api.local" sessionId="s1" />);

    expect(screen.getByTestId('nav-copilot-orb-container')).toHaveAttribute('data-state', 'speaking');
    expect(screen.getByTestId('nav-copilot-orb')).toBeDisabled();
    expect(screen.getByTestId('nav-copilot-orb-caption')).toHaveTextContent('Tarefa criada.');
  });

  it('estado error: reflete status "error" do hook', () => {
    useNavCopilotMock.mockReturnValue(baseResult({ status: 'error', error: 'network down' }));
    render(<NavCopilotOrb apiBaseUrl="http://api.local" sessionId="s1" />);

    expect(screen.getByTestId('nav-copilot-orb-container')).toHaveAttribute('data-state', 'error');
  });

  it('legenda mostra a última mensagem do assistant, ignorando mensagens do usuário depois dela', () => {
    useNavCopilotMock.mockReturnValue(
      baseResult({
        messages: [
          { id: '1', role: 'assistant', text: 'Primeira resposta.', timestamp: 1 },
          { id: '2', role: 'user', text: '🎤 (mensagem de voz)', timestamp: 2 },
          { id: '3', role: 'assistant', text: 'Segunda resposta.', timestamp: 3 },
        ],
      }),
    );
    render(<NavCopilotOrb apiBaseUrl="http://api.local" sessionId="s1" />);

    expect(screen.getByTestId('nav-copilot-orb-caption')).toHaveTextContent('Segunda resposta.');
  });

  it('aplica posição e tamanho customizados', () => {
    useNavCopilotMock.mockReturnValue(baseResult());
    render(
      <NavCopilotOrb
        apiBaseUrl="http://api.local"
        sessionId="s1"
        position={{ top: 10, left: 10 }}
        size={100}
      />,
    );

    expect(screen.getByTestId('nav-copilot-orb-container')).toHaveStyle({ top: '10px', left: '10px' });
    expect(screen.getByTestId('nav-copilot-orb')).toHaveStyle({ width: '100px', height: '100px' });
  });
});
