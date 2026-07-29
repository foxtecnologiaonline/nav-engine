import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_ESCALATION_MARGIN,
  type ConversationTurn,
  type LLMConfirmationRequest,
  type LLMConfirmationResponse,
  type LLMDecision,
  type LLMExtractAnswerRequest,
  type LLMExtractAnswerResponse,
  type LLMProvider,
  type LLMResolveRequest,
  type LLMResolveResponse,
  type StructuredAnswerDecision,
  type TokenUsage,
} from '@nav-engine/core';
import {
  buildActionTool,
  buildAnswerTool,
  buildConfirmationTool,
  buildControlTools,
  buildOnboardingControlTools,
  CONFIRMATION_TOOL_NAME,
  CONTROL_TOOL_NAMES,
  ONBOARDING_TOOL_NAMES,
  type AnthropicToolSpec,
} from './tool-schema.js';
import { buildToolNameMap, type ToolNameMap } from './sanitize-tool-name.js';
import { resolveWithTiering, type ModelResolveOutcome } from './model-tiering.js';

export interface AnthropicLLMProviderConfig {
  /** Injeção para testes; se omitido, cria um client com `apiKey` ou `ANTHROPIC_API_KEY` do ambiente. */
  client?: Anthropic;
  apiKey?: string;
  /** Modelo tentado primeiro em cada resolução. Default: 'claude-haiku-4-5'. */
  fastModel?: string;
  /** Modelo usado quando o resultado do fastModel é ambíguo/marginal. Default: 'claude-sonnet-5'. */
  preciseModel?: string;
  /** Modelo usado para classificar respostas de confirmação (sempre trivial). Default: 'claude-haiku-4-5'. */
  confirmModel?: string;
  confidenceThreshold?: number;
  escalationMargin?: number;
  /** Desliga o roteamento adaptativo — só o fastModel responde. Default: true (ligado). */
  escalateOnLowConfidence?: boolean;
  extraSystemPrompt?: string;
  /** Repassado ao client da Anthropic — o SDK já faz retry com backoff para erros transitórios (429/5xx/conexão). Default do SDK. */
  maxRetries?: number;
}

function extractUsage(response: unknown): TokenUsage | undefined {
  const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
  if (!usage || typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number') {
    return undefined;
  }
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

function isToolUseBlock(block: unknown): block is AnthropicToolUseBlock {
  return !!block && typeof block === 'object' && (block as any).type === 'tool_use';
}

function findToolUse(response: { content: unknown[] }): AnthropicToolUseBlock | undefined {
  return response.content.find(isToolUseBlock);
}

function turnsToMessages(history: ConversationTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  return history.map((t) => ({ role: t.role, content: t.content }));
}

function decisionFromToolUse(block: AnthropicToolUseBlock | undefined, nameMap: ToolNameMap): LLMDecision {
  if (!block) {
    return {
      kind: 'out_of_scope',
      message: 'Não consegui entender o pedido. Pode reformular?',
    };
  }

  if (block.name === CONTROL_TOOL_NAMES.clarify) {
    return {
      kind: 'clarify',
      question: String(block.input.question ?? 'Pode dar mais detalhes?'),
      ambiguousActionKeys: Array.isArray(block.input.ambiguous_action_keys)
        ? (block.input.ambiguous_action_keys as string[])
        : undefined,
    };
  }

  if (block.name === CONTROL_TOOL_NAMES.chat) {
    return { kind: 'chat', message: String(block.input.message ?? '') };
  }

  if (block.name === CONTROL_TOOL_NAMES.outOfScope) {
    return { kind: 'out_of_scope', message: String(block.input.message ?? 'Não posso ajudar com isso aqui.') };
  }

  const actionKey = nameMap.fromTool(block.name);
  if (!actionKey) {
    // Defensivo: o SDK forçou uma tool que não está no nosso mapa. Nunca
    // executa nada nesse caso — o NavEngine trata isso como out_of_scope de
    // qualquer forma (actionKey não bateria com o shortlist).
    return { kind: 'out_of_scope', message: 'Não encontrei uma ação correspondente.' };
  }

  const input = block.input as { params?: unknown; confidence?: unknown };
  return {
    kind: 'action',
    actionKey,
    params: input.params ?? {},
    confidence: typeof input.confidence === 'number' ? input.confidence : 0,
  };
}

function decisionFromAnswerToolUse(block: AnthropicToolUseBlock | undefined): StructuredAnswerDecision {
  if (!block || block.name === 'unclear_reply') {
    return { kind: 'unclear' };
  }
  if (block.name === ONBOARDING_TOOL_NAMES.skip) {
    return { kind: 'skip' };
  }
  if (block.name === ONBOARDING_TOOL_NAMES.cancel) {
    return { kind: 'cancel' };
  }
  if (block.name === ONBOARDING_TOOL_NAMES.answer) {
    const input = block.input as { value?: unknown; confidence?: unknown };
    return {
      kind: 'answer',
      value: input.value,
      confidence: typeof input.confidence === 'number' ? input.confidence : 0,
    };
  }
  return { kind: 'unclear' };
}

/**
 * Provider de referência usando a API da Anthropic. Extrai intenção via
 * TOOL USE FORÇADO (`tool_choice: {type:'any'}`) — nunca por regex sobre
 * texto livre — com roteamento adaptativo de modelo (fast → precise só
 * quando necessário) e prompt caching no bloco de sistema.
 */
export class AnthropicLLMProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly fastModel: string;
  private readonly preciseModel: string;
  private readonly confirmModel: string;
  private readonly confidenceThreshold: number;
  private readonly escalationMargin: number;
  private readonly escalateOnLowConfidence: boolean;
  private readonly extraSystemPrompt?: string;

  constructor(config: AnthropicLLMProviderConfig = {}) {
    this.client =
      config.client ?? new Anthropic({ apiKey: config.apiKey, maxRetries: config.maxRetries });
    this.fastModel = config.fastModel ?? 'claude-haiku-4-5';
    this.preciseModel = config.preciseModel ?? 'claude-sonnet-5';
    this.confirmModel = config.confirmModel ?? 'claude-haiku-4-5';
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.escalationMargin = config.escalationMargin ?? DEFAULT_ESCALATION_MARGIN;
    this.escalateOnLowConfidence = config.escalateOnLowConfidence ?? true;
    this.extraSystemPrompt = config.extraSystemPrompt;
  }

  async resolveIntent(request: LLMResolveRequest): Promise<LLMResolveResponse> {
    const nameMap = buildToolNameMap(request.candidateActions.map((a) => a.key));
    const tools: AnthropicToolSpec[] = [
      ...request.candidateActions.map((a) => buildActionTool(a, nameMap.toTool(a.key))),
      ...buildControlTools(),
    ];
    const systemText = buildSystemPrompt(
      request.candidateActions,
      request.extraSystemPrompt ?? this.extraSystemPrompt,
    );

    const resolveWithModel = async (model: string): Promise<ModelResolveOutcome> => {
      const response = await this.client.messages.create({
        model,
        max_tokens: 1024,
        system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        messages: [...turnsToMessages(request.history), { role: 'user', content: request.userMessage }],
        tools,
        tool_choice: { type: 'any', disable_parallel_tool_use: true },
      });

      if ((response as { stop_reason?: string }).stop_reason === 'refusal') {
        return {
          decision: { kind: 'out_of_scope', message: 'Não posso ajudar com esse pedido.' },
          raw: response,
          usage: extractUsage(response),
        };
      }

      return {
        decision: decisionFromToolUse(findToolUse(response), nameMap),
        raw: response,
        usage: extractUsage(response),
      };
    };

    return resolveWithTiering(
      {
        fastModel: this.fastModel,
        preciseModel: this.preciseModel,
        confidenceThreshold: this.confidenceThreshold,
        escalationMargin: this.escalationMargin,
        escalateOnLowConfidence: this.escalateOnLowConfidence,
      },
      resolveWithModel,
    );
  }

  async resolveConfirmation(request: LLMConfirmationRequest): Promise<LLMConfirmationResponse> {
    const systemText = [
      `O usuário foi perguntado (para confirmar uma ação de risco): "${request.pendingActionDescription}".`,
      'Classifique a resposta dele com a tool disponível: "confirmed" se ele concordou, "declined" se recusou/cancelou, ou "unclear" se não dá para saber com segurança — nesse caso o sistema vai perguntar de novo.',
    ].join('\n');

    const response = await this.client.messages.create({
      model: this.confirmModel,
      max_tokens: 200,
      system: systemText,
      messages: [...turnsToMessages(request.history), { role: 'user', content: request.userReply }],
      tools: [buildConfirmationTool()],
      tool_choice: { type: 'any', disable_parallel_tool_use: true },
    });

    const block = findToolUse(response);
    const decision = block?.name === CONFIRMATION_TOOL_NAME ? block.input.decision : undefined;
    const usage = extractUsage(response);
    if (decision === 'confirmed' || decision === 'declined' || decision === 'unclear') {
      return { decision, usage };
    }
    return { decision: 'unclear', usage };
  }

  async extractStructuredAnswer(request: LLMExtractAnswerRequest): Promise<LLMExtractAnswerResponse> {
    const systemText = [
      `O usuário está sendo guiado por uma configuração passo a passo. A pergunta feita foi: "${request.question}".`,
      'Extraia a resposta estruturada com a tool certa: "answer_step" se a resposta contiver a informação pedida no formato certo, ou "unclear_reply" se não for possível extrair com segurança.',
    ].join('\n');

    const tools: AnthropicToolSpec[] = [
      buildAnswerTool(request.answerJsonSchema, request.examples),
      ...buildOnboardingControlTools({ allowSkip: request.allowSkip, allowCancel: request.allowCancel }),
    ];

    const response = await this.client.messages.create({
      model: this.confirmModel,
      max_tokens: 300,
      system: systemText,
      messages: [...turnsToMessages(request.history), { role: 'user', content: request.userReply }],
      tools,
      tool_choice: { type: 'any', disable_parallel_tool_use: true },
    });

    return {
      decision: decisionFromAnswerToolUse(findToolUse(response)),
      usage: extractUsage(response),
    };
  }
}
