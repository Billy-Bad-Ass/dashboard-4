'use client';

/**
 * The chat surface.
 *
 * Reads the SSE stream from /api/chat and renders three kinds of event
 * differently: the thinking summary (collapsed, muted), the tool progress
 * lines (what it looked up), and the answer itself. Showing the lookups is not
 * decoration — on a question about money, seeing which figures it reconciled is
 * most of the reason to believe the answer.
 *
 * History lives in component state and is posted back in full each turn. The
 * API is stateless, and a conversation that survives a page reload is not worth
 * a database table for a single-operator tool.
 */

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  tools?: { name: string; detail: string }[];
  error?: string;
}

const SUGGESTIONS = [
  'How are we actually doing?',
  'What have I spent, and on what?',
  'What is blocking Project 2 from earning?',
  'Which projects have gone quiet?',
  'What needs me this week?',
];

export function AskPanel({ configured }: { configured: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;

    const history = [...turns, { role: 'user' as const, content: text }];
    setTurns([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);

    // Mutated as the stream arrives, then written into state each tick. Building
    // the string in a ref-like local avoids a re-render per token.
    let answer = '';
    let thinking = '';
    const tools: { name: string; detail: string }[] = [];
    let failure: string | undefined;

    function paint() {
      setTurns([
        ...history,
        { role: 'assistant', content: answer, thinking, tools: [...tools], error: failure },
      ]);
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role, content: t.content })),
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        throw new Error(detail || `Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // SSE frames are separated by a blank line, and a chunk boundary can land
      // mid-frame — so hold the remainder over rather than parsing per chunk.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith('data:')) continue;
          let event: { type: string; text?: string; name?: string; detail?: string; message?: string };
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          if (event.type === 'text') answer += event.text ?? '';
          else if (event.type === 'thinking') thinking += event.text ?? '';
          else if (event.type === 'tool')
            tools.push({ name: event.name ?? '', detail: event.detail ?? '' });
          else if (event.type === 'error') failure = event.message;
          paint();
        }
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      paint();
      setBusy(false);
      box.current?.focus();
    }
  }

  return (
    <div className="stack">
      {!configured ? (
        <div className="notice notice-warn">
          <Icon name="database" size={16} />
          <div>
            <strong>No database connected.</strong>
            <div className="small muted" style={{ marginTop: 3 }}>
              It can still answer from the live connectors and the project register, but anything
              about spend, clients or history will correctly come back empty.
            </div>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ minHeight: 380 }}>
        {turns.length === 0 ? (
          <div style={{ padding: '28px 8px', textAlign: 'center' }}>
            <Icon name="heart-pulse" size={28} className="faint" />
            <div style={{ fontWeight: 620, fontSize: 15, marginTop: 10 }}>
              Ask about the business.
            </div>
            <div className="small muted" style={{ marginTop: 4, maxWidth: '46ch', margin: '4px auto 0' }}>
              It reads the live ledger, the CRM and the connectors, and runs the query rather than
              guessing. It cannot change anything.
            </div>
            <div
              className="row"
              style={{ justifyContent: 'center', gap: 7, marginTop: 18, flexWrap: 'wrap' }}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="badge badge-neutral"
                  style={{ cursor: 'pointer', padding: '6px 11px', fontSize: 12.5 }}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 18 }}>
            {turns.map((turn, i) => (
              <div key={i}>
                {turn.role === 'user' ? (
                  <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                    <Icon name="crosshairs" size={13} className="faint" />
                    <strong style={{ fontSize: 14.5 }}>{turn.content}</strong>
                  </div>
                ) : (
                  <div style={{ paddingLeft: 22 }}>
                    {turn.thinking ? <Thinking text={turn.thinking} /> : null}

                    {turn.tools && turn.tools.length > 0 ? (
                      <div className="stack" style={{ gap: 3, marginBottom: 9 }}>
                        {turn.tools.map((tool, t) => (
                          <div key={t} className="tiny faint row" style={{ gap: 6 }}>
                            <Icon name="database" size={10} />
                            {tool.detail}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {turn.content ? (
                      <Answer text={turn.content} />
                    ) : !turn.error && busy && i === turns.length - 1 ? (
                      <div className="tiny faint row" style={{ gap: 6 }}>
                        <Icon name="rotate" size={11} className="spin" />
                        Thinking
                      </div>
                    ) : null}

                    {turn.error ? (
                      <div className="notice notice-warn tiny" style={{ marginTop: 8 }}>
                        <Icon name="circle-exclamation" size={13} />
                        <span>{turn.error}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="row"
        style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'nowrap' }}
      >
        <textarea
          ref={box}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line. This is a question box,
            // not a document — sending is overwhelmingly the common case.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="What did I spend on infrastructure this month?"
          rows={2}
          style={{ minHeight: 44, resize: 'none' }}
          disabled={busy}
          aria-label="Ask a question about the business"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
          <Icon name={busy ? 'rotate' : 'arrow-right'} size={13} className={busy ? 'spin' : undefined} />
          {busy ? 'Working' : 'Ask'}
        </button>
        {turns.length > 0 ? (
          <button
            type="button"
            className="btn"
            onClick={() => setTurns([])}
            disabled={busy}
            title="Start a new conversation"
          >
            <Icon name="rotate" size={13} />
          </button>
        ) : null}
      </form>
    </div>
  );
}

/** The reasoning summary, collapsed by default — available, not in the way. */
function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 9 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tiny faint row"
        style={{ gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
      >
        <Icon name={open ? 'moon' : 'ellipsis'} size={10} />
        {open ? 'Hide reasoning' : 'Show reasoning'}
      </button>
      {open ? (
        <div
          className="tiny muted"
          style={{
            marginTop: 6,
            padding: '9px 11px',
            borderLeft: '2px solid var(--border)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.6,
          }}
        >
          {text}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Minimal markdown: paragraphs, bullets, and **bold**.
 *
 * A full markdown renderer is a dependency and an XSS surface for output that
 * is three sentences and a number. Anything unrecognised renders as plain text,
 * which is the safe direction to fail.
 */
function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div style={{ fontSize: 14.5, lineHeight: 1.62 }}>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        const bulleted = lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (bulleted) {
          return (
            <ul key={i} style={{ margin: '0 0 10px', paddingLeft: 20 }}>
              {lines.map((line, j) => (
                <li key={j} style={{ marginBottom: 3 }}>
                  {bold(line.replace(/^\s*[-*]\s+/, ''))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ margin: '0 0 10px' }}>
            {bold(block)}
          </p>
        );
      })}
    </div>
  );
}

function bold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
