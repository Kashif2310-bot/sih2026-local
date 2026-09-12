import { Bot, User } from 'lucide-react'
import clsx from 'clsx'
import type { UIMessage } from '../../assistant/state/assistant-state'
import { SourceStatusBadge } from './SourceStatusBadge'

export function ChatMessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={clsx('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <span
        className={clsx(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full',
          isUser ? 'bg-forest text-white' : 'bg-mist text-forest',
        )}
        aria-hidden
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>
      <div className={clsx('max-w-[85%] space-y-1.5', isUser && 'items-end')}>
        <div
          className={clsx(
            'whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isUser ? 'rounded-tr-sm bg-forest text-white' : 'rounded-tl-sm bg-white text-ink shadow-sm',
          )}
        >
          {message.text}
        </div>
        {!isUser && message.sourceStatus && <SourceStatusBadge status={message.sourceStatus} />}
      </div>
    </div>
  )
}
