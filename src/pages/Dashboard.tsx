import React from 'react';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import { useApp } from '../contexts/AppContext';
import { useSync } from '../contexts/SyncContext';
import type { SyncEvent } from '../shared/types/sync';

export function Dashboard(): JSX.Element {
  const { folders, devices } = useApp();
  const { syncStatuses } = useSync();

  const totalConflicts = Array.from(syncStatuses.values()).reduce(
    (count, status) => count + (status.conflicts?.length ?? 0),
    0
  );
  const activeSyncs = Array.from(syncStatuses.values()).filter(
    (status) => status.state === 'syncing'
  ).length;
  const aggregateProgress = (() => {
    const syncingStatuses = Array.from(syncStatuses.values()).filter(
      (status) => status.state === 'syncing' && typeof status.progress === 'number'
    );
    if (syncingStatuses.length === 0) {
      return 0;
    }
    const total = syncingStatuses.reduce((sum, status) => sum + (status.progress ?? 0), 0);
    return Math.round(total / syncingStatuses.length);
  })();
  const currentFile =
    Array.from(syncStatuses.values()).find(
      (status) => status.state === 'syncing' && status.currentFile
    )?.currentFile ?? '';
  const recentEvents = React.useMemo<SyncEvent[]>(() => {
    return Array.from(syncStatuses.values())
      .flatMap((status) => status.events ?? [])
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
  }, [syncStatuses]);

  const formatEventTitle = (event: SyncEvent): string => {
    switch (event.type) {
      case 'sync-started':
        return 'Синхронизация началась';
      case 'sync-completed':
        return 'Синхронизация завершена';
      case 'sync-failed':
        return 'Ошибка синхронизации';
      case 'conflict-detected':
        return 'Обнаружен конфликт';
      case 'conflict-resolved':
        return 'Конфликт разрешен';
      case 'file-added':
        return 'Файл добавлен';
      case 'file-modified':
        return 'Файл изменен';
      case 'file-deleted':
        return 'Файл удален';
      case 'file-renamed':
        return 'Файл переименован';
      case 'device-connected':
        return 'Устройство подключено';
      case 'device-disconnected':
        return 'Устройство отключено';
      default:
        return event.type;
    }
  };

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={6} lg={3}>
        <Card>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">
              Папки
            </Typography>
            <Typography variant="h4">{folders.length}</Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={6} lg={3}>
        <Card>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">
              Устройства онлайн
            </Typography>
            <Typography variant="h4">
              {devices.filter((d) => d.status === 'online').length}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={6} lg={3}>
        <Card>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">
              Активные синхронизации
            </Typography>
            <Typography variant="h4">{activeSyncs}</Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={12} lg={3}>
        <Card>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">
              Конфликты
            </Typography>
            <Typography variant="h4">{totalConflicts}</Typography>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6">Прогресс синхронизации</Typography>
            <LinearProgress variant="determinate" value={aggregateProgress} />
            <Typography variant="body2" color="text.secondary">
              {currentFile || 'Нет активных задач'}
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6">Недавние события</Typography>
            <List dense>
              {recentEvents.map((event) => (
                <ListItem key={event.id}>
                  <ListItemText
                    primary={formatEventTitle(event)}
                    secondary={new Date(event.timestamp).toLocaleString()}
                  />
                </ListItem>
              ))}
              {recentEvents.length === 0 && (
                <ListItem>
                  <ListItemText primary="Пока нет событий" />
                </ListItem>
              )}
            </List>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
