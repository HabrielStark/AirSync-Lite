import React, { useMemo } from 'react';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { useSync } from '../contexts/SyncContext';
import type { ConflictInfo } from '../shared/types/sync';

interface ConflictRowData {
  id: string;
  filePath: string;
  localModifiedAt: string;
  remoteModifiedAt: string;
  conflict: ConflictInfo;
  folderId: string;
}

export function Conflicts(): JSX.Element {
  const { conflicts, resolveConflict } = useSync();

  const rows = useMemo<ConflictRowData[]>(
    () =>
      conflicts.map((conflict) => ({
        id: conflict.id,
        filePath: conflict.filePath,
        localModifiedAt: conflict.localVersion?.modifiedAt
          ? new Date(conflict.localVersion.modifiedAt).toLocaleString()
          : '—',
        remoteModifiedAt: conflict.remoteVersion?.modifiedAt
          ? new Date(conflict.remoteVersion.modifiedAt).toLocaleString()
          : '—',
        conflict,
        folderId: conflict.folderId || '',
      })),
    [conflicts]
  );

  const columns = useMemo<GridColDef<ConflictRowData>[]>(
    () => [
      { field: 'filePath', headerName: 'Файл', flex: 1 },
      {
        field: 'localModifiedAt',
        headerName: 'Локальное изменение',
        width: 210,
      },
      {
        field: 'remoteModifiedAt',
        headerName: 'Удаленное изменение',
        width: 210,
      },
      {
        field: 'actions',
        headerName: 'Разрешение',
        sortable: false,
        width: 280,
        renderCell: (params: GridRenderCellParams<ConflictRowData>) => {
          const { conflict } = params.row as ConflictRowData;
          return (
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => resolveConflict(conflict.id, 'local')}>
                Оставить мое
              </Button>
              <Button size="small" onClick={() => resolveConflict(conflict.id, 'remote')}>
                Принять удаленное
              </Button>
              <Button size="small" onClick={() => resolveConflict(conflict.id, 'both')}>
                Сохранить обе
              </Button>
            </Stack>
          );
        },
      },
    ],
    [resolveConflict]
  );

  return (
    <Stack spacing={2}>
      <DataGrid autoHeight rows={rows} columns={columns} />
    </Stack>
  );
}
