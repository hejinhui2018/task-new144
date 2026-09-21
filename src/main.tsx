import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './ui/App'
import { StoreProvider } from './ui/useStore'
import { ToastProvider } from './ui/toast'
import { EventStore } from './engine/store'
import './styles.css'

const store = new EventStore()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider store={store}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>
  </React.StrictMode>,
)
