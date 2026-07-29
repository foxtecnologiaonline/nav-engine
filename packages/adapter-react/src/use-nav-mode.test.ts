import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNavMode } from './use-nav-mode.js';

describe('useNavMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('sem valor salvo e sem defaultMode, mode é null e hasChosen é false', () => {
    const { result } = renderHook(() => useNavMode());
    expect(result.current.mode).toBeNull();
    expect(result.current.hasChosen).toBe(false);
  });

  it('defaultMode pula a escolha', () => {
    const { result } = renderHook(() => useNavMode({ defaultMode: 'chat' }));
    expect(result.current.mode).toBe('chat');
    expect(result.current.hasChosen).toBe(true);
  });

  it('setMode persiste no localStorage e atualiza o estado', () => {
    const { result } = renderHook(() => useNavMode({ storageKey: 'test:mode' }));
    act(() => result.current.setMode('app'));
    expect(result.current.mode).toBe('app');
    expect(window.localStorage.getItem('test:mode')).toBe('app');
  });

  it('recupera a escolha salva anteriormente', () => {
    window.localStorage.setItem('test:mode', 'chat');
    const { result } = renderHook(() => useNavMode({ storageKey: 'test:mode' }));
    expect(result.current.mode).toBe('chat');
    expect(result.current.hasChosen).toBe(true);
  });

  it('ignora valor inválido no localStorage', () => {
    window.localStorage.setItem('test:mode', 'algo-invalido');
    const { result } = renderHook(() => useNavMode({ storageKey: 'test:mode' }));
    expect(result.current.mode).toBeNull();
  });

  it('usa storageKey diferentes isoladamente', () => {
    window.localStorage.setItem('a', 'app');
    window.localStorage.setItem('b', 'chat');
    const { result: resultA } = renderHook(() => useNavMode({ storageKey: 'a' }));
    const { result: resultB } = renderHook(() => useNavMode({ storageKey: 'b' }));
    expect(resultA.current.mode).toBe('app');
    expect(resultB.current.mode).toBe('chat');
  });
});
