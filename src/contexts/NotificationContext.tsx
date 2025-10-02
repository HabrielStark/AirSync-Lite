import React, { createContext, useContext, ReactNode } from 'react';
import { SnackbarProvider, useSnackbar, VariantType } from 'notistack';

interface NotificationContextType {
  showNotification: (message: string, variant?: VariantType) => void;
  showError: (error: Error | string) => void;
  showSuccess: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

function NotificationProviderInner({ children }: { children: ReactNode }) {
  const { enqueueSnackbar } = useSnackbar();

  const showNotification = (message: string, variant: VariantType = 'default') => {
    enqueueSnackbar(message, { variant });
  };

  const showError = (error: Error | string) => {
    const message = typeof error === 'string' ? error : error.message;
    enqueueSnackbar(message, { variant: 'error' });
  };

  const showSuccess = (message: string) => {
    enqueueSnackbar(message, { variant: 'success' });
  };

  const showWarning = (message: string) => {
    enqueueSnackbar(message, { variant: 'warning' });
  };

  const showInfo = (message: string) => {
    enqueueSnackbar(message, { variant: 'info' });
  };

  return (
    <NotificationContext.Provider
      value={{ showNotification, showError, showSuccess, showWarning, showInfo }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  return (
    <SnackbarProvider
      maxSnack={3}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'right',
      }}
      autoHideDuration={5000}
    >
      <NotificationProviderInner>{children}</NotificationProviderInner>
    </SnackbarProvider>
  );
}

export function useNotification(): NotificationContextType {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return context;
}
