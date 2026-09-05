import { useCallback, useEffect, useRef, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { BotIcon, CheckIcon, Loader, SendIcon, SparklesIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { type AubreyStep, useAubreyStream } from '~/hooks/use-aubrey-stream';

const SUGGESTED_QUERIES = [
  'Give me an overview across all my documents',
  'How many documents are pending signature?',
  'What documents are expiring soon?',
  'Show my pending approvals',
  'Summarise the signature inbox',
  'Which automation workflows are enabled?',
];

/**
 * Aubrey chat surface, shared by the full page and the floating panel.
 * `compact` drops the conversation sidebar and tightens spacing for the Sheet.
 */
export function AubreyChat({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [redeemKey, setRedeemKey] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();

  const { data: conversations } = trpc.aubrey.getConversations.useQuery();
  const { data: messages } = trpc.aubrey.getMessages.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId },
  );
  const { data: usage } = trpc.aubrey.getUsage.useQuery();

  const [chatError, setChatError] = useState<string | null>(null);

  /*
    Streamed rather than a tRPC mutation, so the steps Aubrey takes show up as
    they happen. Not token streaming — the AI bridge returns each turn whole —
    but a tool-using answer is several sequential calls and the wait is real.
  */
  const chat = useAubreyStream({
    onDone: useCallback(
      (result) => {
        setConversationId(result.conversationId);
        void utils.aubrey.getMessages.invalidate();
        void utils.aubrey.getConversations.invalidate();
        void utils.aubrey.getUsage.invalidate();
      },
      [utils],
    ),
    onError: useCallback((message: string) => setChatError(message), []),
  });

  const redeem = trpc.aubrey.redeemCredits.useMutation({
    onSuccess: (result) => {
      toast({
        title: 'AI credits added',
        description: `${result.credits} credits redeemed — ${result.balance} now in the org pool.`,
      });
      setRedeemKey('');
      void utils.aubrey.getUsage.invalidate();
    },
    onError: (err) => {
      toast({ title: 'Could not redeem credits', description: err.message, variant: 'destructive' });
    },
  });

  const outOfCredits = usage ? usage.allowed === false : false;

  const handleSend = () => {
    if (!input.trim() || chat.isRunning || outOfCredits) return;
    setChatError(null);
    void chat.send(input, conversationId || undefined);
    setInput('');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Also on each new step, so the checklist stays in view as it grows.
  }, [messages, chat.isRunning, chat.steps]);

  return (
    <div className={compact ? 'flex h-full flex-col' : 'flex h-[calc(100vh-200px)] min-h-[500px] flex-col'}>
      {!compact && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              <Trans>Aubrey AI</Trans>
            </h2>
            <p className="text-muted-foreground mt-0.5 text-[13px]">
              <Trans>Your assistant across documents, signing, filing, inbox and approvals.</Trans>
            </p>
          </div>
          {usage && <AubreyCreditMeter usage={usage} />}
        </div>
      )}

      <div className={`flex flex-1 gap-4 overflow-hidden ${compact ? '' : 'mt-4'}`}>
        {/* Conversation sidebar (full page only) */}
        {!compact && (
          <div className="hidden w-[180px] flex-shrink-0 flex-col gap-1 overflow-y-auto md:flex">
            <button
              className="bg-primary mb-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
              onClick={() => setConversationId(null)}
            >
              <SparklesIcon className="h-3 w-3" />
              New Chat
            </button>

            {conversations?.map((conv) => (
              <button
                key={conv.id}
                className={`rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  conversationId === conv.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => setConversationId(conv.id)}
              >
                <p className="truncate font-medium">{conv.title || 'Untitled'}</p>
                <p className="text-[10px] opacity-60">{conv._count.messages} messages</p>
              </button>
            ))}
          </div>
        )}

        {/* Chat area */}
        <div className="border-border bg-card flex flex-1 flex-col overflow-hidden rounded-[var(--r)] border">
          <div className="flex-1 overflow-y-auto p-4">
            {!conversationId && !messages?.length ? (
              <div className="flex h-full flex-col items-center justify-center">
                <div className="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <BotIcon className="text-primary h-8 w-8" />
                </div>
                <h3 className="text-lg font-semibold">Aubrey AI</h3>
                <p className="text-muted-foreground mt-1 text-center text-[13px]">
                  Ask about your documents, signing, filing, inbox, workflows or approvals.
                </p>

                <div className={`mt-6 grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {SUGGESTED_QUERIES.map((query, i) => (
                    <button
                      key={i}
                      className="border-border hover:border-primary/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground rounded-md border px-3 py-2 text-left text-[12px] transition-colors"
                      onClick={() => setInput(query)}
                    >
                      {query}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages?.map((msg) => (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && (
                      <div className="bg-primary/10 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
                        <BotIcon className="text-primary h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-primary text-white'
                          : 'border-border bg-muted/30 border'
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
                    </div>
                  </div>
                ))}

                {chat.isRunning && (
                  <div className="flex gap-3">
                    <div className="bg-primary/10 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
                      <BotIcon className="text-primary h-4 w-4" />
                    </div>
                    <div className="border-border bg-muted/30 rounded-lg border px-4 py-3">
                      <AubreyProgress steps={chat.steps} />
                    </div>
                  </div>
                )}

                {chatError && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                    {chatError}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Out-of-credits banner + redeem */}
          {outOfCredits && (
            <div className="border-border bg-muted/30 border-t p-3">
              <p className="mb-2 text-[12px] text-amber-600">
                <Trans>You're out of Aubrey AI credits.</Trans>{' '}
                {usage?.canRedeem ? (
                  <Trans>Redeem an AI credit pack to continue.</Trans>
                ) : (
                  <Trans>Ask an organization admin to redeem an AI credit pack.</Trans>
                )}
              </p>
              {usage?.canRedeem && (
                <div className="flex gap-2">
                  <Input
                    value={redeemKey}
                    onChange={(e) => setRedeemKey(e.target.value)}
                    placeholder="HSAI1..."
                    className="h-9 font-mono text-[12px]"
                    disabled={redeem.isPending}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (redeemKey.trim()) redeem.mutate({ key: redeemKey.trim() });
                      }
                    }}
                  />
                  <Button
                    className="h-9"
                    loading={redeem.isPending}
                    disabled={!redeemKey.trim()}
                    onClick={() => redeem.mutate({ key: redeemKey.trim() })}
                  >
                    <Trans>Redeem</Trans>
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Input */}
          <div className="border-border border-t p-3">
            {compact && usage && (
              <div className="mb-2">
                <AubreyCreditMeter usage={usage} />
              </div>
            )}
            <div className="flex gap-2">
              <input
                className="border-border bg-background focus:border-primary h-10 flex-1 rounded-md border px-3 text-[13px] outline-none"
                placeholder="Ask Aubrey anything about your work..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={chat.isRunning || outOfCredits}
              />
              <Button
                className="h-10 w-10 p-0"
                onClick={handleSend}
                disabled={!input.trim() || chat.isRunning || outOfCredits}
              >
                {chat.isRunning ? <Loader className="h-4 w-4 animate-spin" /> : <SendIcon className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .ai-response table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
        .ai-response th { background: hsl(var(--muted)); padding: 6px 10px; text-align: left; font-weight: 600; border: 1px solid hsl(var(--border)); }
        .ai-response td { padding: 6px 10px; border: 1px solid hsl(var(--border)); }
        .ai-response tr:hover { background: hsl(var(--muted)/0.3); }
        .ai-response ul, .ai-response ol { padding-left: 18px; margin: 4px 0; }
        .ai-response li { margin: 2px 0; }
        .ai-response strong { color: hsl(var(--foreground)); }
        .ai-response mark { background: hsl(var(--gold-light)); padding: 1px 4px; border-radius: 3px; }
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

type UsageShape = {
  monthlyLimit: number | null;
  monthlyRemaining: number | null;
  purchasedBalance: number;
};

/** Compact "free left + org credits" indicator. */
function AubreyCreditMeter({ usage }: { usage: UsageShape }) {
  const unlimited = usage.monthlyLimit === null;
  return (
    <div className="text-right">
      <span className="text-muted-foreground text-[12px]">
        {unlimited ? (
          <>Unlimited this month</>
        ) : (
          <>
            {usage.monthlyRemaining ?? 0} free left
            {usage.purchasedBalance > 0 ? ` · ${usage.purchasedBalance} credits` : ''}
          </>
        )}
      </span>
    </div>
  );
}

/**
 * What Aubrey is doing, while it does it.
 *
 * The AI bridge returns each turn complete, so there are no tokens to reveal —
 * but a tool-using answer is several sequential calls, and those steps are real.
 * Showing them beats a bare spinner twice over: the wait stops feeling stuck,
 * and the user learns what Aubrey actually looked at to answer.
 */
function AubreyProgress({ steps }: { steps: AubreyStep[] }) {
  const tools = steps.filter((step) => step.kind === 'tool');
  const transient = steps.find((step) => step.kind === 'thinking' || step.kind === 'composing');

  // Before the model has decided on anything there is genuinely nothing to
  // report, so the original spinner still has a job on the first beat.
  if (!tools.length && !transient) {
    return <Loader className="text-primary h-4 w-4 animate-spin" />;
  }

  return (
    <div className="space-y-1.5">
      {tools.map((step, index) => (
        <div key={`${step.name}-${index}`} className="flex items-center gap-2 text-[12px]">
          {step.status === 'done' ? (
            <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
          ) : (
            <Loader className="text-primary h-3.5 w-3.5 flex-shrink-0 animate-spin" />
          )}
          <span className={step.status === 'done' ? 'text-muted-foreground' : ''}>{step.label}</span>
          {step.status === 'done' && (
            <span className="text-muted-foreground/60 tabular-nums">
              {step.ms < 1000 ? `${step.ms}ms` : `${(step.ms / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>
      ))}

      {transient && (
        <div className="text-muted-foreground flex items-center gap-2 text-[12px]">
          <Loader className="text-primary h-3.5 w-3.5 flex-shrink-0 animate-spin" />
          <span>
            {transient.kind === 'composing' ? (
              <Trans>Writing the answer…</Trans>
            ) : (
              <Trans>Thinking…</Trans>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
