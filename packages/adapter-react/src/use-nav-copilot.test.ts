import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNavCopilot } from './use-nav-copilot.js';
import type { NavEngineHttpResponse } from './types.js';

function fakeFetch(response: NavEngineHttpResponse, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: async () => response,
  }) as unknown as typeof fetch;
}

describe('useNavCopilot', () => {
  it('sendMessage adiciona a mensagem do usuário e a resposta do assistente', async () => {
    const fetchImpl = fakeFetch({ reply: 'Tarefa criada.', status: 'executed', action: { key: 'task.create', description: 'criar tarefa' } });
    const { result } = renderHook(() =>
      useNavCopilot({ apiBaseUrl: 'http://api.local', sessionId: 's1', fetchImpl }),
    );

    await act(async () => {
      await result.current.sendMessage('cria uma tarefa');
    });

    expect(result.current.messages.map((m) => m.text)).toEqual(['cria uma tarefa', 'Tarefa criada.']);
    expect(result.current.status).toBe('idle');
  });

  it('status vira awaiting_confirmation e expõe pendingConfirmation', async () => {
    const fetchImpl = fakeFetch({
      reply: 'Confirma apagar tudo?',
      status: 'awaiting_confirmation',
      action: { key: 'task.delete_all', description: 'apagar todas as tarefas' },
    });
    const { result } = renderHook(() =>
      useNavCopilot({ apiBaseUrl: 'http://api.local', sessionId: 's1', fetchImpl }),
    );

    await act(async () => {
      await result.current.sendMessage('apaga tudo');
    });

    expect(result.current.status).toBe('awaiting_confirmation');
    expect(result.current.pendingConfirmation).toEqual({ description: 'apagar todas as tarefas' });
  });

  it('confirm(true) envia "sim" como mensagem', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reply: 'Feito.', status: 'executed' }),
    });
    const { result } = renderHook(() =>
      useNavCopilot({ apiBaseUrl: 'http://api.local', sessionId: 's1', fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    await act(async () => {
      await result.current.confirm(true);
    });

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.message).toBe('sim');
  });

  it('onNavigate é chamado quando a resposta traz navigateTo', async () => {
    const onNavigate = vi.fn();
    const fetchImpl = fakeFetch({ reply: 'Indo.', status: 'executed', navigateTo: '/app/settings' });
    const { result } = renderHook(() =>
      useNavCopilot({ apiBaseUrl: 'http://api.local', sessionId: 's1', fetchImpl, onNavigate }),
    );

    await act(async () => {
      await result.current.sendMessage('me leva pras configurações');
    });

    expect(onNavigate).toHaveBeenCalledWith('/app/settings');
  });

  it('erro de rede vira status "error" com mensagem', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useNavCopilot({ apiBaseUrl: 'http://api.local', sessionId: 's1', fetchImpl }),
    );

    await act(async () => {
      await result.current.sendMessage('oi');
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/network down/);
  });
});
