import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/index.css';
import { App } from './App';
import { AppProvider } from './contexts/AppContext';
import { SyncProvider } from './contexts/SyncContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { NotificationProvider } from './contexts/NotificationContext';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <NotificationProvider>
        <SettingsProvider>
          <AppProvider>
            <SyncProvider>
              <App />
            </SyncProvider>
          </AppProvider>
        </SettingsProvider>
      </NotificationProvider>
    </BrowserRouter>
  </React.StrictMode>
);
