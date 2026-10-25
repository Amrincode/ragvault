import { useSearchParams } from 'react-router'
import { SingleQuestionChat } from './SingleQuestionChat'
import { ConversationChat } from '../features/chat/ConversationChat'

export function ChatPage() {
  const [params] = useSearchParams()
  return params.get('mode') === 'single' ? (
    <SingleQuestionChat />
  ) : (
    <ConversationChat />
  )
}
