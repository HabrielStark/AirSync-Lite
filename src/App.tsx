import React, { Suspense, useMemo } from 'react';
import { Route, Routes } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Dashboard } from './pages/Dashboard';
import { Folders } from './pages/Folders';
import { Devices } from './pages/Devices';
import { History } from './pages/History';
import { Conflicts } from './pages/Conflicts';
import { SettingsPage } from './pages/Settings';
import Onboarding from './pages/Onboarding';
import { useApp } from './contexts/AppContext';
import { useSettings } from './contexts/SettingsContext';
import { Layout } from './components/layout/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App(): JSX.Element {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const { theme: themePreference } = useSettings();
  const { isOnboardingComplete } = useApp();

  const muiTheme = useMemo(() => {
    const mode =
      themePreference === 'system' ? (prefersDarkMode ? 'dark' : 'light') : themePreference;
    return createTheme({
      palette: { mode },
    });
  }, [prefersDarkMode, themePreference]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <ErrorBoundary>
        <Suspense
          fallback={
            <Box height="100vh" display="flex" alignItems="center" justifyContent="center">
              <CircularProgress />
            </Box>
          }
        >
          {isOnboardingComplete ? (
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/folders" element={<Folders />} />
                <Route path="/devices" element={<Devices />} />
                <Route path="/history" element={<History />} />
                <Route path="/conflicts" element={<Conflicts />} />
                <Route path="/settings/*" element={<SettingsPage />} />
              </Routes>
            </Layout>
          ) : (
            <Onboarding />
          )}
        </Suspense>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
