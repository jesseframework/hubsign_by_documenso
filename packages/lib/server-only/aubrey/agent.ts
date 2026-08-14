/**
 * Aubrey — HubSign's agentic AI assistant.
 *
 * Unlike the old single-shot DMS chatbot, Aubrey is given real tools and runs a
 * bounded function-calling loop: it decides which role-scoped queries to run,
 * reads the results, and answers from live data. It is decoupled from the DMS
 * add-on and gated purely on the Aubrey credit balance (monthly free allotment
 * → org purchased pool). Conversation history reuses the existing DmsAi* tables.
 *
 * The model call goes through the WorkHub AI bridge — HubSign holds no provider
 * key. The loop below is unchanged by that: WorkHub runs one turn per call and
 * never dispatches a tool, so the tool belt, the scope enforcement and the
 * iteration bound all stay here. See `../ai/bridge.ts`.
 */
import { prisma } from '@documenso/prisma';

import { env } from '../../utils/env';
import {
  type AiMessage,
  type AiToolDefinition,
  AiBridgeError,
  callAiBridge,
} from '../ai/bridge';
import { resolveAiApiKey } from '../ai/resolve-ai-key';
import {
  AubreyCreditError,
  type AubreyCreditSnapshot,
  consumeAubreyCredit,
  getAubreyCredit,
} from './credits';
import { resolveAubreyScope } from './scope';
import { AUBREY_TOOLS, executeAubreyTool } from './tools';

const MAX_TOOL_ITERATIONS = 6;

const model = (): string => (env('NEXT_PRIVATE_AUBREY_MODEL') ?? '').trim() || 'gpt-4o';

/**
 * The tool belt, flattened for the bridge.
 *
 * `AUBREY_TOOLS` is written in OpenAI's nested `{type, function:{…}}` form,
 * which is still the clearest way to read eleven definitions. Normalising to
 * whatever the active vendor wants is the bridge's job now, so it only needs
 * name/description/parameters.
 */
const bridgeTools = (): AiToolDefinition[] =>
  AUBREY_TOOLS.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters as Record<string, unknown>,
  }));

/**
 * What Aubrey is doing right now, for the caller to show while it works.
 *
 * A tool-using turn takes several sequential model calls and can run past ten
 * seconds. WorkHub's bridge returns each turn complete — it cannot stream tokens
 * — so there is nothing to reveal progressively. What there *is* is a real
 * sequence of steps, and reporting those honestly beats a spinner: the user
 * learns what Aubrey looked at, which is useful even after the answer lands.
 */
export type AubreyProgress =
  | { kind: 'thinking' }
  | { kind: 'tool'; name: string; label: string; status: 'running' }
  | { kind: 'tool'; name: string; label: string; status: 'done'; ms: number }
  | { kind: 'composing' };

/** Human wording for each tool. Falls back to the raw name if one is added. */
const TOOL_LABELS: Record<string, string> = {
  get_overview: 'Reading your document overview',
  search_esign_documents: 'Searching signature documents',
  search_dms_documents: 'Searching filed documents',
  get_inbox_summary: 'Checking the signature inbox',
  list_workflows: 'Listing automation workflows',
  list_pending_approvals: 'Checking pending approvals',
  list_templates: 'Listing templates',
};

const toolLabel = (name: string): string =>
  TOOL_LABELS[name] ?? `Running ${name.replace(/_/g, ' ')}`;

export type AubreyChatOptions = {
  userId: number;
  message: string;
  conversationId?: string;
  /** Called as work happens. Never throws into the caller's loop. */
  onProgress?: (event: AubreyProgress) => void;
};

export type AubreyChatResult = {
  conversationId: string;
  messageId: string;
  content: string; // rich HTML
  tokensUsed: { prompt: number; completion: number };
  credit: AubreyCreditSnapshot;
};

/**
 * A failure of the AI service itself, as opposed to the caller running out of
 * HubSign credits. Carries a message safe to show a user and the upstream
 * detail for the log.
 *
 * Kept as its own type so the tRPC layer can map credit exhaustion and service
 * failure to different codes; the wording now comes from the bridge, which maps
 * WorkHub's published error codes centrally for all three AI call sites.
 */
export class AubreyServiceError extends Error {
  constructor(
    message: string,
    public readonly detail: string,
  ) {
    super(message);
    this.name = 'AubreyServiceError';
  }
}

/** One turn through the bridge, with Aubrey's model pin and error type. */
async function aubreyTurn(apiKey: string, messages: AiMessage[], withTools: boolean) {
  try {
    return await callAiBridge({
      apiKey,
      messages,
      model: model(),
      maxTokens: 4000,
      temperature: 0.3,
      ...(withTools ? { tools: bridgeTools(), toolChoice: 'auto' as const } : {}),
    });
  } catch (err) {
    if (err instanceof AiBridgeError) {
      throw new AubreyServiceError(err.userMessage, err.detail);
    }
    throw err;
  }
}

function systemPrompt(scopeNote: string): string {
  return `You are Aubrey, HubSign's AI assistant. You help users understand and act on their documents, signatures, filing (DMS), signature inbox, workflows and approvals.

You have tools that return LIVE data. IMPORTANT:
- Every tool already returns ONLY what this user is permitted to see (their role and access are enforced server-side). Never claim a user can see more than the tools return, and do not speculate about hidden/restricted records.
- Prefer calling a tool over guessing. For "how many / summary / overview" questions, call get_overview first. For specifics, use the search tools.
- If a tool returns nothing, say so plainly rather than inventing data.

${scopeNote}

FORMATTING (the UI renders your reply as HTML):
- Respond in clean HTML.
- Use <table> with <thead>/<tbody> for tabular data.
- Use <strong>, <em>, <mark> for emphasis and <ul>/<ol> for lists.
- Use inline color for signal (e.g. style="color:#1a9b6e" positive, "#c0392b" alerts, "#b7791f" warnings).
- Keep answers scannable: short lead sentence, then the detail.`;
}

async function loadConversation(userId: number, message: string, conversationId?: string) {
  if (conversationId) {
    const existing = await prisma.dmsAiConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
    });
    if (existing && existing.userId === userId) return existing;
  }
  return prisma.dmsAiConversation.create({
    data: { userId, title: message.substring(0, 100) },
    include: { messages: { orderBy: { createdAt: 'asc' as const }, take: 20 } },
  });
}

export async function aubreyChat({
  userId,
  message,
  conversationId,
  onProgress,
}: AubreyChatOptions): Promise<AubreyChatResult> {
  // A broken progress consumer (client vanished mid-stream) must not take the
  // turn down with it — the answer is still worth persisting.
  const report = (event: AubreyProgress) => {
    try {
      onProgress?.(event);
    } catch {
      // Progress is advisory.
    }
  };

  const scope = await resolveAubreyScope(userId);

  // Resolved once per message, not once per turn — Aubrey chains up to seven
  // bridge calls and they all bill the same organization.
  const apiKey = await resolveAiApiKey(scope.organizationId);
  if (!apiKey) {
    throw new AubreyServiceError(
      'Aubrey is not set up yet — an organization admin needs to add an AI key on the AI Credits screen.',
      `no WorkHub AI key for organization ${scope.organizationId ?? '(none)'}`,
    );
  }

  // Credit gate — refuse before doing any expensive work.
  const preCredit = await getAubreyCredit({
    userId,
    organizationId: scope.organizationId,
    email: scope.email,
  });
  if (!preCredit.allowed) {
    throw new AubreyCreditError(
      'You have used all your Aubrey AI credits. An organization admin can redeem an AI credit pack to continue.',
      'no_credits',
    );
  }

  const conversation = await loadConversation(userId, message, conversationId);

  const scopeNote = scope.organizationName
    ? `Context: you are assisting ${scope.name ?? 'a user'} in the organization "${scope.organizationName}" (org role: ${scope.orgRole ?? 'member'}).`
    : `Context: you are assisting ${scope.name ?? 'a user'} on their personal account (no organization).`;

  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt(scopeNote) },
    ...conversation.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  let totalPrompt = 0;
  let totalCompletion = 0;
  let finalContent = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    report({ kind: 'thinking' });

    const res = await aubreyTurn(apiKey, messages, true);
    totalPrompt += res.usage.input;
    totalCompletion += res.usage.output;

    messages.push({
      role: 'assistant',
      content: res.content,
      // Echoed back in the shape the bridge returned it. Re-nesting into a
      // vendor's wire format is the bridge's concern, not ours.
      ...(res.toolCalls.length ? { tool_calls: res.toolCalls } : {}),
    });

    if (res.toolCalls.length) {
      for (const call of res.toolCalls) {
        const label = toolLabel(call.name);
        report({ kind: 'tool', name: call.name, label, status: 'running' });

        const startedAt = Date.now();
        let result: unknown;
        try {
          const args = call.arguments
            ? (JSON.parse(call.arguments) as Record<string, unknown>)
            : {};
          result = await executeAubreyTool(call.name, args, scope);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : 'Tool execution failed.' };
        }

        // Reported done either way: a tool that errored still finished, and the
        // model gets the error back to reason about. Hiding it would leave the
        // step spinning forever in the UI.
        report({
          kind: 'tool',
          name: call.name,
          label,
          status: 'done',
          ms: Date.now() - startedAt,
        });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue; // feed tool results back to the model
    }

    finalContent = res.content ?? '';
    break;
  }

  // If we exhausted the loop still mid-tool-call, force a final textual answer.
  if (!finalContent) {
    report({ kind: 'composing' });

    const res = await aubreyTurn(apiKey, messages, false);
    totalPrompt += res.usage.input;
    totalCompletion += res.usage.output;
    finalContent = res.content ?? 'I could not produce an answer for that.';
  }

  // Persist the exchange (only user + final assistant text, matching history replay).
  await prisma.dmsAiMessage.create({
    data: { conversationId: conversation.id, role: 'user', content: message },
  });
  const aiMessage = await prisma.dmsAiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: finalContent,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
    },
  });
  await prisma.dmsAiConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  // Charge one credit for the message.
  const credit = await consumeAubreyCredit(
    { userId, organizationId: scope.organizationId, email: scope.email },
    { prompt: totalPrompt, completion: totalCompletion },
  );

  return {
    conversationId: conversation.id,
    messageId: aiMessage.id,
    content: finalContent,
    tokensUsed: { prompt: totalPrompt, completion: totalCompletion },
    credit,
  };
}

export async function getAubreyConversations(userId: number) {
  return prisma.dmsAiConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    include: { _count: { select: { messages: true } } },
  });
}

export async function getAubreyConversationMessages(userId: number, conversationId: string) {
  const conversation = await prisma.dmsAiConversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });
  if (!conversation || conversation.userId !== userId) return [];
  return prisma.dmsAiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });
}
