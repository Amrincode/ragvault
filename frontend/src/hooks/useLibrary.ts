import { useCallback, useEffect, useState } from 'react'
import { getLibraryConfig, listCollections, listDocuments } from '../lib/api'
import type { Collection, DocumentPage, LibraryConfig } from '../types/library'

const emptyPage: DocumentPage = { items: [], total: 0, limit: 20, offset: 0 }
interface LibraryState {
  key: string
  collections: Collection[]
  documents: DocumentPage
  config: LibraryConfig | null
  loading: boolean
  loaded: boolean
  error: string | null
}
export function useLibrary(collectionId: string | null, offset: number) {
  const key = JSON.stringify([collectionId, offset])
  const [state, setState] = useState<LibraryState>({
    key: '',
    collections: [],
    documents: emptyPage,
    config: null,
    loading: true,
    loaded: false,
    error: null,
  })
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  useEffect(() => {
    if (
      state.loading ||
      state.error ||
      state.key !== key ||
      !state.documents.items.some(
        (item) =>
          item.processing_status === 'processing' ||
          item.indexing_status === 'indexing',
      )
    )
      return
    const interval = window.setInterval(reload, 2000)
    return () => window.clearInterval(interval)
  }, [
    state.key,
    state.documents.items,
    state.loading,
    state.error,
    key,
    reload,
  ])
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState((previous) => ({
        ...previous,
        key,
        documents: previous.key === key ? previous.documents : emptyPage,
        loaded: previous.key === key && previous.loaded,
        loading: true,
        error: null,
      }))
      void Promise.all([
        listCollections(controller.signal),
        listDocuments(collectionId, offset, controller.signal),
        getLibraryConfig(controller.signal),
      ])
        .then(([collections, documents, config]) => {
          if (!controller.signal.aborted)
            setState({
              key,
              collections,
              documents,
              config,
              loading: false,
              loaded: true,
              error: null,
            })
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setState((previous) => ({
              ...previous,
              loading: false,
              error:
                cause instanceof Error
                  ? cause.message
                  : 'Unable to load your library',
            }))
        })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [collectionId, offset, key, version])
  return {
    collections: state.collections,
    documents: state.key === key ? state.documents : emptyPage,
    config: state.config,
    loading: state.key !== key || state.loading,
    hasData: state.key === key && state.loaded,
    error: state.key === key ? state.error : null,
    reload,
  }
}
