import React from 'react';
import { Box, CircularProgress, Chip } from '@mui/material';
import { useApp } from '../../contexts/AppContext';
import { useSync } from '../../contexts/SyncContext';

export default function StatusIndicator() {
  const { folders, devices } = useApp();
  const { syncStatuses } = useSync();

  const getOverallStatus = () => {
    if (folders.length === 0) {
      return { text: 'No folders configured', color: 'default' };
    }

    const onlineDevices = devices.filter((d) => d.status === 'online').length;
    if (onlineDevices === 0) {
      return { text: 'All devices offline', color: 'error' };
    }

    const statuses = Array.from(syncStatuses.values());

    if (statuses.some((s) => s.state === 'error')) {
      return { text: 'Sync error', color: 'error' };
    }

    if (statuses.some((s) => s.state === 'conflict')) {
      return { text: 'Conflicts detected', color: 'warning' };
    }

    const syncingCount = statuses.filter(
      (s) => s.state === 'syncing' || s.state === 'scanning'
    ).length;

    if (syncingCount > 0) {
      return {
        text: `Syncing ${syncingCount} folder${syncingCount !== 1 ? 's' : ''}`,
        color: 'primary',
        showProgress: true,
      };
    }

    if (statuses.every((s) => s.state === 'paused')) {
      return { text: 'All paused', color: 'default' };
    }

    return {
      text: `${onlineDevices}/${devices.length} devices online`,
      color: 'success',
    };
  };

  const status = getOverallStatus();

  return (
    <Box display="flex" alignItems="center" gap={1}>
      {status.showProgress && <CircularProgress size={20} thickness={4} color="inherit" />}
      <Chip label={status.text} color={status.color as any} size="small" variant="filled" />
    </Box>
  );
}
