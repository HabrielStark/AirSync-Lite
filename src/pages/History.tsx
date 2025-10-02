import React from 'react';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { useSync } from '../contexts/SyncContext';
import type { SyncEvent } from '../shared/types/sync';

interface HistoryRow {
  id: string;
  file: string;
  action: SyncEvent['type'];
  device: string;
  folderId: string;
  timestamp: Date | string | number;
}

const filterOptions = [
  { value: 'all', label: 'Все' },
  { value: 'sync', label: 'Синхронизации' },
  { value: 'conflict', label: 'Конфликты' },
];

export function History(): JSX.Element {
  const { syncStatuses } = useSync();
  const [filter, setFilter] = React.useState('all');

  const rows = React.useMemo<HistoryRow[]>(() => {
    const events = Array.from(syncStatuses.entries()).flatMap(([folderId, status]) =>
      (status.events ?? []).map((event) => ({ ...event, folderId }))
    );
    return events
      .filter((event) => {
        if (filter === 'all') return true;
        if (filter === 'sync') return event.type.startsWith('sync');
        if (filter === 'conflict') return event.type.includes('conflict');
        return true;
      })
      .map((event) => ({
        id: event.id,
        file: event.filePath ?? '—',
        action: event.type,
        device: event.deviceId ?? '—',
        folderId: event.folderId,
        timestamp: event.timestamp,
      }));
  }, [filter, syncStatuses]);

  const columns = React.useMemo<GridColDef[]>(
    () => [
      { field: 'file', headerName: 'Файл', flex: 1 },
      { field: 'action', headerName: 'Действие', width: 180 },
      { field: 'device', headerName: 'Устройство', width: 200 },
      { field: 'folderId', headerName: 'Папка', width: 180 },
      {
        field: 'timestamp',
        headerName: 'Время',
        width: 200,
        renderCell: (params: GridRenderCellParams<HistoryRow>) => (
          <Typography variant="body2">
            {params.value ? new Date(params.value as string | number).toLocaleString() : '—'}
          </Typography>
        ),
      },
    ],
    []
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2}>
        <TextField
          select
          label="Фильтр"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {filterOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <DataGrid autoHeight rows={rows} columns={columns} />
    </Stack>
  );
}
