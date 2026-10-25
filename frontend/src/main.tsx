import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { DashboardPage } from './pages/DashboardPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { SearchPage } from './pages/SearchPage'
import { ChatPage } from './pages/ChatPage'
import { ThemeProvider } from './theme/ThemeProvider'
import { RouteFocus } from './components/RouteFocus'
import './styles.css'

const DesignSystemPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/DesignSystemPreview'))
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <RouteFocus />
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/chat" element={<ChatPage />} />
          {DesignSystemPreview && (
            <Route
              path="/dev/design-system"
              element={
                <Suspense
                  fallback={
                    <p role="status" className="p-6 text-muted">
                      Loading component preview…
                    </p>
                  }
                >
                  <DesignSystemPreview />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
