import React from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import RefreshIcon from '@mui/icons-material/Refresh';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useSync } from '../../contexts/SyncContext';

export function MainAppBar(): JSX.Element {
  const { syncStatuses, pauseSync, resumeSync, syncNow } = useSync();
  const anyPaused = Array.from(syncStatuses.values()).some((status) => status.state === 'paused');

  return (
    <AppBar position="fixed">
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          AirSync-Lite
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <IconButton color="inherit" onClick={() => (anyPaused ? resumeSync() : pauseSync())}>
            {anyPaused ? <PlayArrowIcon /> : <PauseIcon />}
          </IconButton>
          <IconButton color="inherit" onClick={() => syncNow()}>
            <RefreshIcon />
          </IconButton>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
