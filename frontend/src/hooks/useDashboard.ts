import { useCallback, useEffect, useState } from 'react'
import { listCollections, listConversations, listDocuments } from '../lib/api'
import type { Collection, DocumentPage } from '../types/library'
import type { ConversationPage } from '../types/conversations'

interface Resource<T> {
  data: T | null
  loading: boolean
  error: boolean
}
const initial = { data: null, loading: true, error: false }

// Three bounded requests with independent results; never scan the library for totals.
export function useDashboard() {
  const [documents, setDocuments] = useState<Resource<DocumentPage>>(initial)
  const [collections, setCollections] =
    useState<Resource<Collection[]>>(initial)
  const [conversations, setConversations] =
    useState<Resource<ConversationPage>>(initial)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15_000),
      ])
      function load<T>(request: Promise<T>, set: (value: Resource<T>) => void) {
        set({ ...initial })
        void request
          .then((data) => {
            if (!controller.signal.aborted)
              set({ data, loading: false, error: false })
          })
          .catch(() => {
            if (!controller.signal.aborted)
              set({ data: null, loading: false, error: true })
          })
      }
      load(listDocuments(null, 0, signal), setDocuments)
      load(listCollections(signal), setCollections)
      load(listConversations(0, signal), setConversations)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [version])
  return { documents, collections, conversations, reload }
}
