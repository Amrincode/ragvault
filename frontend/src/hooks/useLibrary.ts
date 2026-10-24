import { useCallback, useEffect, useState } from 'react'
import { getLibraryConfig, listCollections, listDocuments } from '../lib/api'
import type { Collection, DocumentPage, LibraryConfig } from '../types/library'

export function useLibrary(collectionId: string | null, offset: number) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [documents, setDocuments] = useState<DocumentPage>({
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  })
  const [config, setConfig] = useState<LibraryConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      void Promise.all([
        listCollections(controller.signal),
        listDocuments(collectionId, offset, controller.signal),
        getLibraryConfig(controller.signal),
      ])
        .then(([nextCollections, nextDocuments, nextConfig]) => {
          if (!controller.signal.aborted) {
            setCollections(nextCollections)
            setDocuments(nextDocuments)
            setConfig(nextConfig)
            setError(null)
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error
                ? cause.message
                : 'Unable to load your library',
            )
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [collectionId, offset, version])

  return { collections, documents, config, loading, error, reload }
}
