import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Button, Container, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

import { rendererLogger } from '../utils/rendererLogger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    rendererLogger.error('ErrorBoundary caught error', { error, errorInfo });

    // Send to main process for logging
    if (window.electronAPI?.logError) {
      window.electronAPI.logError({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      });
    }

    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <Container maxWidth="md">
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100vh',
              textAlign: 'center',
              gap: 3,
            }}
          >
            <ErrorOutlineIcon sx={{ fontSize: 64, color: 'error.main' }} />

            <Typography variant="h4" component="h1" gutterBottom>
              Oops! Something went wrong
            </Typography>

            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
              An unexpected error occurred in the application. You can try reloading the page or
              contact support if the problem persists.
            </Typography>

            {this.state.error && (
              <Box
                sx={{
                  mt: 2,
                  p: 2,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  maxWidth: 600,
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <Typography
                  variant="caption"
                  component="pre"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {this.state.error.message}
                  {process.env.NODE_ENV === 'development' && this.state.error.stack && (
                    <>\n\n{this.state.error.stack}</>
                  )}
                </Typography>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button variant="contained" onClick={this.handleReset}>
                Reload Application
              </Button>

              <Button
                variant="outlined"
                onClick={() =>
                  window.electronAPI?.openExternal?.(
                    'https://github.com/yourusername/airsync-lite/issues'
                  )
                }
              >
                Report Issue
              </Button>
            </Box>
          </Box>
        </Container>
      );
    }

    return this.props.children;
  }
}
