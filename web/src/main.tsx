import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// [2026-09-28] Redesign: Schriften lokal gebuendelt statt Google Fonts (kein
// Abruf bei Dritten beim Oeffnen der App).
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/fraunces/opsz.css'
import './tokens.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
