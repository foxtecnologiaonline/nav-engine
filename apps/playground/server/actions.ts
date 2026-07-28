import { z } from 'zod';
import { createActionRegistry, defineNavigationAction, type ActionRegistry } from '@nav-engine/core';
import type { FakeTaskDb } from './fake-db.js';

const FILLER_SETTINGS_SCREENS = [
  'notificações',
  'faturamento',
  'integrações',
  'segurança',
  'aparência',
  'idioma',
  'privacidade',
  'exportação de relatórios',
  'permissões de equipe',
  'backup',
  'webhooks',
  'domínio personalizado',
  'chaves de api',
  'auditoria',
  'preferências de e-mail',
];

/**
 * Catálogo de demonstração: cobre os 3 riskLevel + navegação, e inclui um
 * bom número de ações "de encheção" (telas fictícias de configuração) só
 * para provar, na prática, que o `KeywordShortlister` reduz o catálogo
 * antes de virar tools do LLM.
 */
export function buildPlaygroundRegistry(db: FakeTaskDb): ActionRegistry {
  const registry = createActionRegistry();

  registry.register({
    key: 'task.create',
    description: 'criar uma nova tarefa numa lista pessoal de afazeres',
    paramsSchema: z.object({ title: z.string().min(1) }),
    riskLevel: 'safe',
    examples: ['cria uma tarefa: comprar pão', 'anota: ligar pro cliente amanhã'],
    checkPermission: async () => true,
    handler: async (params: { title: string }) => {
      const task = db.create(params.title);
      return { ok: true, message: `Tarefa "${task.title}" criada.` };
    },
  });

  registry.register({
    key: 'task.list',
    description: 'listar as tarefas cadastradas na lista de afazeres',
    paramsSchema: z.object({}),
    riskLevel: 'safe',
    examples: ['quais são minhas tarefas', 'lista minhas tarefas'],
    checkPermission: async () => true,
    handler: async () => {
      const tasks = db.list();
      const message = tasks.length
        ? `Você tem ${tasks.length} tarefa(s): ${tasks.map((t) => t.title).join(', ')}.`
        : 'Você não tem nenhuma tarefa ainda.';
      return { ok: true, message };
    },
  });

  registry.register({
    key: 'task.delete_all',
    description: 'apagar TODAS as tarefas cadastradas, ação sem volta',
    paramsSchema: z.object({}),
    riskLevel: 'confirm',
    examples: ['apaga todas as minhas tarefas', 'limpa minha lista de tarefas'],
    checkPermission: async () => true,
    handler: async () => {
      const count = db.deleteAll();
      return { ok: true, message: `${count} tarefa(s) apagada(s).` };
    },
  });

  registry.register({
    key: 'data.export_all',
    description: 'exportar todos os dados da conta em um único arquivo',
    paramsSchema: z.object({}),
    riskLevel: 'blocked',
    checkPermission: async () => true,
    handler: async () => ({ ok: true, message: 'Exportação gerada (demo).' }),
  });

  registry.register(
    defineNavigationAction({
      key: 'nav.go_to_tasks',
      description: 'ir para a tela de tarefas',
      to: () => '/tasks',
      examples: ['me leva pras minhas tarefas', 'abre a tela de tarefas'],
    }),
  );

  registry.register(
    defineNavigationAction({
      key: 'nav.go_to_settings',
      description: 'ir para a tela de configurações gerais',
      to: () => '/settings',
      examples: ['abre as configurações', 'me leva pras configs'],
    }),
  );

  for (const [index, label] of FILLER_SETTINGS_SCREENS.entries()) {
    registry.register(
      defineNavigationAction({
        key: `nav.go_to_filler_${index}`,
        description: `ir para a tela de configuração de ${label}`,
        to: () => `/settings/${label.replace(/\s+/g, '-')}`,
      }),
    );
  }

  return registry;
}
