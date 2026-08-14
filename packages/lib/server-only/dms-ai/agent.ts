import { prisma } from '@documenso/prisma';

import { env } from '../../utils/env';
import { AiBridgeError, callAiBridge } from '../ai/bridge';
import { resolveAiApiKey } from '../ai/resolve-ai-key';

/**
 * Per-account upgrade: emails or user ids in NEXT_PRIVATE_DMS_AI_UNLIMITED_USERS
 * (comma-separated) get an unlimited cap. Lets specific accounts (e.g. a dev/admin
 * account) be upgraded without lifting the limit for everyone.
 */
const isUpgradedAccount = (user?: { id?: number; email?: string | null }): boolean => {
  if (!user) return false;
  const list = (env('NEXT_PRIVATE_DMS_AI_UNLIMITED_USERS') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return false;
  const email = user.email?.toLowerCase();
  const id = user.id != null ? String(user.id) : undefined;
  return Boolean((email && list.includes(email)) || (id && list.includes(id)));
};

/**
 * Monthly DMS AI query cap for a user. Returns `null` for UNLIMITED — either the
 * account is upgraded (allowlist) or the global env is "unlimited"/"0"/"-1".
 * Unset env keeps the historical default of 20.
 */
export const getDmsAiQueryLimit = (user?: { id?: number; email?: string | null }): number | null => {
  if (isUpgradedAccount(user)) return null;
  const raw = (env('NEXT_PRIVATE_DMS_AI_FREE_QUERIES_PER_MONTH') ?? '').trim();
  if (raw === '') return 20;
  if (/^(unlimited|0|-1)$/i.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 20;
};

export type AiChatOptions = {
  userId: number;
  organizationId?: number | null;
  message: string;
  conversationId?: string;
};

export type AiChatResult = {
  conversationId: string;
  messageId: string;
  content: string; // Rich HTML response
  tokensUsed: { prompt: number; completion: number };
  usage: { queriesThisMonth: number; limit: number | null; remaining: number | null };
};

/**
 * Get the user's DMS data context for the AI agent.
 */
async function getDmsContext(userId: number, organizationId?: number | null) {
  const where = organizationId ? { organizationId } : { uploadedById: userId };

  const [
    totalDocs,
    docsByStatus,
    docsByType,
    docsByClassification,
    recentDocs,
    locations,
    pendingRetrievals,
    pendingApprovals,
  ] = await Promise.all([
    prisma.dmsDocument.count({ where }),
    prisma.dmsDocument.groupBy({ by: ['status'], where, _count: true }),
    prisma.dmsDocument.groupBy({ by: ['documentTypeId'], where, _count: true }),
    prisma.dmsDocument.groupBy({ by: ['classificationId'], where, _count: true }),
    prisma.dmsDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { documentType: true, classification: true },
    }),
    prisma.dmsLocation.findMany({
      where: organizationId ? { organizationId } : { userId },
      include: { cabinets: { include: { shelves: { include: { bins: { include: { _count: { select: { documents: true } } } } } } } } },
    }),
    prisma.dmsRetrievalRequest.count({ where: { document: where, status: 'PENDING' } }),
    prisma.dmsWorkflowStep.count({
      where: { assignedToId: userId, status: 'PENDING' },
    }),
  ]);

  // Get document type names
  const typeIds = docsByType.map((d) => d.documentTypeId).filter(Boolean) as string[];
  const types = await prisma.dmsDocumentType.findMany({ where: { id: { in: typeIds } } });

  const classIds = docsByClassification.map((d) => d.classificationId).filter(Boolean) as string[];
  const classifications = await prisma.dmsClassification.findMany({ where: { id: { in: classIds } } });

  return `
## DMS Data Summary

**Total Documents:** ${totalDocs}

**By Status:**
${docsByStatus.map((s) => `- ${s.status}: ${s._count}`).join('\n')}

**By Document Type:**
${docsByType.map((t) => {
    const typeName = types.find((ty) => ty.id === t.documentTypeId)?.name || 'Uncategorized';
    return `- ${typeName}: ${t._count}`;
  }).join('\n') || '- No types defined'}

**By Classification:**
${docsByClassification.map((c) => {
    const className = classifications.find((cl) => cl.id === c.classificationId)?.name || 'Unclassified';
    return `- ${className}: ${c._count}`;
  }).join('\n') || '- No classifications'}

**Filing Locations:** ${locations.length} locations
${locations.map((loc) => {
    const totalBins = loc.cabinets.reduce((sum, cab) => sum + cab.shelves.reduce((s, sh) => s + sh.bins.length, 0), 0);
    const totalDocs = loc.cabinets.reduce((sum, cab) => sum + cab.shelves.reduce((s, sh) => s + sh.bins.reduce((bs, b) => bs + b._count.documents, 0), 0), 0);
    return `- ${loc.name}: ${loc.cabinets.length} cabinets, ${totalBins} bins, ${totalDocs} documents`;
  }).join('\n')}

**Pending Retrieval Requests:** ${pendingRetrievals}
**Pending Approvals:** ${pendingApprovals}

**Recent Documents (last 10):**
${recentDocs.map((d) => `- "${d.title}" (${d.documentType?.name || 'No type'}, ${d.classification?.name || 'No class'}, ${d.status}, ${d.createdAt.toLocaleDateString()})`).join('\n')}
`.trim();
}

/**
 * Check and track usage.
 */
async function checkUsage(userId: number, organizationId?: number | null) {
  const month = new Date().toISOString().substring(0, 7); // YYYY-MM

  const usage = await prisma.dmsAiUsage.upsert({
    where: { userId_month: { userId, month } },
    create: { userId, month, organizationId },
    update: {},
  });

  const account = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const limit = getDmsAiQueryLimit({ id: userId, email: account?.email });
  const remaining = limit === null ? null : Math.max(limit - usage.totalQueries, 0);

  return { usage, limit, remaining, allowed: limit === null || (remaining ?? 0) > 0 };
}

/**
 * Main AI chat function.
 */
export async function dmsAiChat({ userId, organizationId, message, conversationId }: AiChatOptions): Promise<AiChatResult> {
  const apiKey = await resolveAiApiKey(organizationId ?? null);
  if (!apiKey) {
    throw new Error(
      'AI is not set up yet — an organization admin needs to add an AI key on the AI Credits screen.',
    );
  }

  // Check usage limits
  const usageCheck = await checkUsage(userId, organizationId);
  if (!usageCheck.allowed) {
    throw new Error(`Monthly query limit reached (${usageCheck.limit} queries). Upgrade your plan for more.`);
  }

  // Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = await prisma.dmsAiConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
    });
  }

  if (!conversation) {
    conversation = await prisma.dmsAiConversation.create({
      data: {
        userId,
        organizationId,
        title: message.substring(0, 100),
      },
      include: { messages: { orderBy: { createdAt: 'asc' as const }, take: 20 } },
    });
  }

  // Get DMS context
  const dmsContext = await getDmsContext(userId, organizationId);

  // Build messages for OpenAI
  const systemPrompt = `You are HubSign DMS AI Assistant — an intelligent document management reporting agent.

Your role:
- Answer questions about the user's document management system
- Generate reports, summaries, and analysis
- Provide data in rich HTML format with tables, charts descriptions, and highlights
- Be helpful, accurate, and data-driven

IMPORTANT FORMATTING RULES:
- Always respond in HTML format
- Use <table> with proper <thead> and <tbody> for tabular data
- Use <div class="stat-card"> for key metrics
- Use <strong>, <em>, <mark> for emphasis
- Use <ul>/<ol> for lists
- Use color coding: green for positive, red for alerts, amber for warnings
- Make responses visually rich and easy to scan
- Use inline styles for colors (e.g., style="color: #1a9b6e" for green)

Here is the current DMS data for this organization:

${dmsContext}

Respond to the user's question based on this data. If they ask for something not in the data, explain what data is available.`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    // Previous conversation messages
    ...(conversation.messages || []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: message },
  ];

  // One turn through the WorkHub AI bridge — no tools, and pinned to the
  // cheaper model, which is the deliberate cost split against Aubrey.
  let result;
  try {
    result = await callAiBridge({
      apiKey,
      messages,
      model: 'gpt-4o-mini',
      maxTokens: 4000,
      temperature: 0.3,
    });
  } catch (err) {
    // The provider's own wording never reaches the user. This path used to
    // rethrow `error.error.message` verbatim, which is how a user holding 500
    // HubSign credits got told they had none and was pointed at a third-party
    // billing page. The bridge maps the code; the upstream text stays in its log.
    if (err instanceof AiBridgeError) {
      throw new Error(err.userMessage);
    }
    throw err;
  }

  const aiContent = result.content || 'No response generated.';
  const tokensUsed = {
    prompt: result.usage.input,
    completion: result.usage.output,
  };

  // Save user message
  await prisma.dmsAiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
    },
  });

  // Save assistant message
  const aiMessage = await prisma.dmsAiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: aiContent,
      promptTokens: tokensUsed.prompt,
      completionTokens: tokensUsed.completion,
    },
  });

  // Update usage
  const month = new Date().toISOString().substring(0, 7);
  await prisma.dmsAiUsage.update({
    where: { userId_month: { userId, month } },
    data: {
      totalQueries: { increment: 1 },
      totalPromptTokens: { increment: tokensUsed.prompt },
      totalCompletionTokens: { increment: tokensUsed.completion },
    },
  });

  return {
    conversationId: conversation.id,
    messageId: aiMessage.id,
    content: aiContent,
    tokensUsed,
    usage: {
      queriesThisMonth: usageCheck.usage.totalQueries + 1,
      limit: usageCheck.limit,
      remaining: usageCheck.remaining === null ? null : usageCheck.remaining - 1,
    },
  };
}

/**
 * Get conversation history.
 */
export async function getAiConversations(userId: number) {
  return prisma.dmsAiConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    include: {
      _count: { select: { messages: true } },
    },
  });
}

/**
 * Get conversation messages.
 */
export async function getAiConversationMessages(conversationId: string) {
  return prisma.dmsAiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });
}
