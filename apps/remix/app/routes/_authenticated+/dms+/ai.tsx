import { useEffect, useRef, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { BotIcon, Loader, SendIcon, SparklesIcon, Trash2Icon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('AI Agent');
}

export default function DmsAiPage() {
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();

  const { data: conversations } = trpc.dms.aiGetConversations.useQuery();
  const { data: messages } = trpc.dms.aiGetMessages.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId },
  );
  const { data: usage } = trpc.dms.aiGetUsage.useQuery();

  const chat = trpc.dms.aiChat.useMutation({
    onSuccess: (result) => {
      setConversationId(result.conversationId);
      void utils.dms.aiGetMessages.invalidate();
      void utils.dms.aiGetConversations.invalidate();
      void utils.dms.aiGetUsage.invalidate();
    },
  });

  const handleSend = () => {
    if (!input.trim() || chat.isPending) return;

    chat.mutate({
      message: input,
      conversationId: conversationId || undefined,
    });
    setInput('');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chat.isPending]);

  const suggestedQueries = [
    'Give me a summary of all documents by type',
    'How many documents are pending review?',
    'Show me document activity for this month',
    'What documents are expiring soon?',
    'Create a filing structure report',
    'Analyze document completeness across all types',
  ];

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[500px] flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold"><Trans>AI Agent</Trans></h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>Ask questions about your documents, generate reports, and get insights.</Trans>
          </p>
        </div>
        {usage && (
          <div className="text-right">
            <span className="text-[12px] text-muted-foreground">
              {usage.limit == null
                ? `${usage.queriesThisMonth} queries used · Unlimited`
                : `${usage.queriesThisMonth} / ${usage.limit} queries used`}
            </span>
            {usage.limit != null && (
              <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${(usage.remaining ?? 0) <= 5 ? 'bg-amber-500' : 'bg-primary'}`}
                  style={{ width: `${Math.min((usage.queriesThisMonth / usage.limit) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-1 gap-4 overflow-hidden">
        {/* Conversation sidebar */}
        <div className="hidden w-[180px] flex-shrink-0 flex-col gap-1 overflow-y-auto md:flex">
          <button
            className="mb-2 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-white"
            onClick={() => setConversationId(null)}
          >
            <SparklesIcon className="h-3 w-3" />
            New Chat
          </button>

          {conversations?.map((conv) => (
            <button
              key={conv.id}
              className={`rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                conversationId === conv.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
              }`}
              onClick={() => setConversationId(conv.id)}
            >
              <p className="truncate font-medium">{conv.title || 'Untitled'}</p>
              <p className="text-[10px] opacity-60">{conv._count.messages} messages</p>
            </button>
          ))}
        </div>

        {/* Chat area */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-[var(--r)] border border-border bg-card">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            {!conversationId && !messages?.length ? (
              /* Welcome screen */
              <div className="flex h-full flex-col items-center justify-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <BotIcon className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">HubSign DMS AI</h3>
                <p className="mt-1 text-center text-[13px] text-muted-foreground">
                  Ask me about your documents, get reports, or analyze your filing system.
                </p>

                <div className="mt-6 grid grid-cols-2 gap-2">
                  {suggestedQueries.map((query, i) => (
                    <button
                      key={i}
                      className="rounded-md border border-border px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted/50 hover:text-foreground"
                      onClick={() => {
                        setInput(query);
                      }}
                    >
                      {query}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages?.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <BotIcon className="h-4 w-4 text-primary" />
                      </div>
                    )}

                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-primary text-white'
                          : 'border border-border bg-muted/30'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <p className="text-[13px]">{msg.content}</p>
                      ) : (
                        <div
                          className="ai-response prose prose-sm max-w-none text-[13px]"
                          dangerouslySetInnerHTML={{ __html: msg.content }}
                        />
                      )}

                      {msg.role === 'assistant' && msg.promptTokens > 0 && (
                        <p className="mt-2 text-[9px] text-muted-foreground">
                          {msg.promptTokens + msg.completionTokens} tokens
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                {chat.isPending && (
                  <div className="flex gap-3">
                    <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <BotIcon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                      <Loader className="h-4 w-4 animate-spin text-primary" />
                    </div>
                  </div>
                )}

                {chat.error && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                    {chat.error.message}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <input
                className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                placeholder="Ask about your documents..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                disabled={chat.isPending || (usage?.remaining === 0)}
              />
              <Button
                className="h-10 w-10 p-0"
                onClick={handleSend}
                disabled={!input.trim() || chat.isPending || (usage?.remaining === 0)}
              >
                {chat.isPending ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <SendIcon className="h-4 w-4" />
                )}
              </Button>
            </div>
            {usage?.remaining === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                Monthly query limit reached. Upgrade your plan for more queries.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* AI response styles */}
      <style>{`
        .ai-response table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
        .ai-response th { background: hsl(var(--muted)); padding: 6px 10px; text-align: left; font-weight: 600; border: 1px solid hsl(var(--border)); }
        .ai-response td { padding: 6px 10px; border: 1px solid hsl(var(--border)); }
        .ai-response tr:hover { background: hsl(var(--muted)/0.3); }
        .ai-response ul, .ai-response ol { padding-left: 18px; margin: 4px 0; }
        .ai-response li { margin: 2px 0; }
        .ai-response strong { color: hsl(var(--foreground)); }
        .ai-response mark { background: hsl(var(--gold-light)); padding: 1px 4px; border-radius: 3px; }
        .ai-response .stat-card { display: inline-block; background: hsl(var(--muted)/0.3); border: 1px solid hsl(var(--border)); border-radius: 8px; padding: 8px 14px; margin: 4px; }
        .ai-response h1, .ai-response h2, .ai-response h3 { margin: 12px 0 6px; font-weight: 600; }
        .ai-response h1 { font-size: 16px; }
        .ai-response h2 { font-size: 14px; }
        .ai-response h3 { font-size: 13px; }
        .ai-response p { margin: 4px 0; }
        .ai-response code { background: hsl(var(--muted)); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
      `}</style>
    </div>
  );
}
