export {
  useNavCopilot,
  type UseNavCopilotOptions,
  type UseNavCopilotResult,
  type OnboardingProgress,
} from './use-nav-copilot.js';
export { useNavMode, type NavMode, type UseNavModeOptions, type UseNavModeResult } from './use-nav-mode.js';
export { NavCopilotClient, type NavCopilotClientConfig } from './nav-copilot-client.js';
export { playBase64Audio, type PlayAudioCallbacks } from './play-base64-audio.js';
export type { ChatMessage, NavCopilotStatus, NavEngineHttpResponse } from './types.js';

export { NavCopilotWidget, type NavCopilotWidgetProps } from './components/NavCopilotWidget.js';
export { NavCopilotOrb, type NavCopilotOrbProps, type OrbVisualState } from './components/NavCopilotOrb.js';
export { NavCopilotPanel, type NavCopilotPanelProps } from './components/NavCopilotPanel.js';
export { NavModeSelector, type NavModeSelectorProps } from './components/NavModeSelector.js';
export { ChatBubble, type ChatBubbleProps } from './components/ChatBubble.js';
export { ConfirmationCard, type ConfirmationCardProps } from './components/ConfirmationCard.js';
export { MicButton, type MicButtonProps } from './components/MicButton.js';
