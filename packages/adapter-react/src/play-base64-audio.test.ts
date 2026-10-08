import { describe, expect, it, vi } from 'vitest';
import { playBase64Audio } from './play-base64-audio.js';

describe('playBase64Audio', () => {
  it('chama onStart antes de reproduzir e onEnded quando a reprodução termina', () => {
    const onStart = vi.fn();
    const onEnded = vi.fn();
    const audio = playBase64Audio('ZmFrZQ==', 'audio/mpeg', { onStart, onEnded });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(audio).toBeInstanceOf(HTMLAudioElement);

    audio!.dispatchEvent(new Event('ended'));
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('chama onEnded se a reprodução automática falhar, para não deixar o chamador travado', async () => {
    const onEnded = vi.fn();
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error('autoplay blocked'));

    playBase64Audio('ZmFrZQ==', 'audio/mpeg', { onEnded });
    await vi.waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));

    HTMLMediaElement.prototype.play = originalPlay;
  });

  it('não quebra quando nenhum callback é passado', () => {
    expect(() => playBase64Audio('ZmFrZQ==', 'audio/mpeg')).not.toThrow();
  });
});
