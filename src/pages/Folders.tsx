import React, { useMemo, useState } from 'react';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';
import { useApp } from '../contexts/AppContext';
import { useSync } from '../contexts/SyncContext';
import type { FolderConfig } from '../shared/types/sync';
import { rendererLogger } from '../utils/rendererLogger';

interface FolderFormState {
  path: string;
  name: string;
  mode: FolderConfig['mode'];
}

export function Folders(): JSX.Element {
  const { t } = useTranslation();
  const { folders, refreshFolders } = useApp();
  const { syncNow, pauseSync, resumeSync } = useSync();

  const [isDialogOpen, setDialogOpen] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [formState, setFormState] = useState<FolderFormState>({
    path: '',
    name: '',
    mode: 'send-receive',
  });

  const [removeTarget, setRemoveTarget] = useState<FolderConfig | null>(null);

  const handleBrowse = async () => {
    try {
      const path = await window.electronAPI.browseFolder();
      if (path) {
        setFormState((prev) => ({
          ...prev,
          path,
          name: prev.name || path.split(/[\\/]/).pop() || path,
        }));
      }
    } catch (error) {
      rendererLogger.error('Failed to browse folder', error);
    }
  };

  const handleOpenDialog = () => {
    setFormState({ path: '', name: '', mode: 'send-receive' });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    if (isBusy) return;
    setDialogOpen(false);
  };

  const handleAddFolder = async () => {
    if (!formState.path) return;
    try {
      setBusy(true);
      const newFolder = await window.electronAPI.addFolder({
        path: formState.path,
        name: formState.name || formState.path.split(/[\\/]/).pop() || formState.path,
        mode: formState.mode,
      } as Partial<FolderConfig>);
      if (newFolder) {
        await refreshFolders();
        setDialogOpen(false);
      }
    } catch (error) {
      rendererLogger.error('Failed to add folder', error);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFolder = async () => {
    if (!removeTarget) return;
    try {
      setBusy(true);
      await window.electronAPI.removeFolder(removeTarget.id);
      await refreshFolders();
    } catch (error) {
      rendererLogger.error('Failed to remove folder', error);
    } finally {
      setBusy(false);
      setRemoveTarget(null);
    }
  };

  const columns = useMemo<GridColDef<FolderConfig>[]>(
    () => [
      { field: 'name', headerName: t('folders.columns.name'), flex: 1 },
      { field: 'path', headerName: t('folders.columns.path'), flex: 2 },
      {
        field: 'mode',
        headerName: t('folders.columns.mode'),
        width: 150,
        valueFormatter: ({ value }) =>
          (value as FolderConfig['mode']) === 'receive-only'
            ? t('folders.modes.receiveOnly')
            : t('folders.modes.sendReceive'),
      },
      {
        field: 'stats.totalFiles',
        headerName: t('folders.columns.files'),
        width: 120,
        valueGetter: ({ row }) => (row as FolderConfig).stats?.totalFiles ?? 0,
      },
      {
        field: 'stats.totalSize',
        headerName: t('folders.columns.size'),
        width: 160,
        valueGetter: ({ row }) => (row as FolderConfig).stats?.totalSize ?? 0,
        valueFormatter: ({ value }) => formatBytes((value as number) ?? 0),
      },
      {
        field: 'stats.lastScanAt',
        headerName: t('folders.columns.lastScan'),
        width: 200,
        valueGetter: ({ row }) => (row as FolderConfig).stats?.lastScanAt ?? null,
        valueFormatter: ({ value }) =>
          value ? new Date(value as string | number).toLocaleString() : '—',
      },
      {
        field: 'actions',
        headerName: t('folders.columns.actions'),
        sortable: false,
        width: 320,
        renderCell: (params: GridRenderCellParams<FolderConfig>) => (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => syncNow(params.row.id)}>
              {t('folders.actions.sync')}
            </Button>
            <Button size="small" onClick={() => pauseSync(params.row.id)}>
              {t('folders.actions.pause')}
            </Button>
            <Button size="small" onClick={() => resumeSync(params.row.id)}>
              {t('folders.actions.resume')}
            </Button>
            <Tooltip title={t('folders.actions.refreshTooltip')}>
              <IconButton size="small" onClick={() => syncNow(params.row.id)}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('folders.actions.removeTooltip')}>
              <IconButton size="small" color="error" onClick={() => setRemoveTarget(params.row)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    [pauseSync, resumeSync, syncNow, t]
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('folders.title')}</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={refreshFolders} startIcon={<RefreshIcon />}>
            {t('folders.actions.refresh')}
          </Button>
          <Button variant="contained" onClick={handleOpenDialog}>
            {t('folders.add')}
          </Button>
        </Stack>
      </Stack>
      <DataGrid autoHeight rows={folders} columns={columns} disableRowSelectionOnClick />

      <Dialog open={isDialogOpen} onClose={handleCloseDialog} fullWidth maxWidth="sm">
        <DialogTitle>{t('folders.addTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Stack direction="row" spacing={1}>
            <TextField
              label={t('folders.fields.path')}
              value={formState.path}
              onChange={(event) => setFormState((prev) => ({ ...prev, path: event.target.value }))}
              fullWidth
            />
            <Button onClick={handleBrowse} variant="outlined">
              {t('folders.actions.browse')}
            </Button>
          </Stack>
          <TextField
            label={t('folders.fields.name')}
            value={formState.name}
            onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
            fullWidth
          />
          <TextField
            select
            label={t('folders.fields.mode')}
            value={formState.mode}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                mode: event.target.value as FolderConfig['mode'],
              }))
            }
            fullWidth
          >
            <MenuItem value="send-receive">{t('folders.modes.sendReceive')}</MenuItem>
            <MenuItem value="receive-only">{t('folders.modes.receiveOnly')}</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={isBusy}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleAddFolder}
            variant="contained"
            disabled={!formState.path || isBusy}
          >
            {isBusy ? <CircularProgress size={20} /> : t('folders.add')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(removeTarget)} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>{t('folders.removeConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('folders.removeConfirmDescription', { name: removeTarget?.name })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)} disabled={isBusy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleRemoveFolder} color="error" disabled={isBusy}>
            {isBusy ? <CircularProgress size={20} /> : t('folders.remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(1)} ${units[index]}`;
}
