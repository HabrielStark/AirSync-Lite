import React, { useEffect, useState } from 'react';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import { useApp } from '../contexts/AppContext';
import { rendererLogger } from '../utils/rendererLogger';

interface PairingDialogState {
  code: string;
  qrCode: string;
  loading: boolean;
}

export function Devices(): JSX.Element {
  const { t } = useTranslation();
  const { devices, refreshDevices } = useApp();
  const [pairingDialog, setPairingDialog] = useState<PairingDialogState | null>(null);
  const [isPairingOpen, setPairingOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);

  useEffect(() => {
    if (!isPairingOpen) {
      setManualCode('');
      setPairingError(null);
    }
  }, [isPairingOpen]);

  const handleGeneratePairingCode = async () => {
    try {
      setPairingDialog({ code: '', qrCode: '', loading: true });
      const result = await window.electronAPI.generatePairingCode();
      setPairingDialog({ code: result.code, qrCode: result.qrCode, loading: false });
    } catch (error) {
      rendererLogger.error('Failed to generate pairing code', error);
      setPairingDialog(null);
    }
  };

  const handlePairDevice = async () => {
    if (!manualCode || manualCode.length !== 6) {
      setPairingError('Введите 6-значный код');
      return;
    }

    try {
      setPairingError(null);
      setBusyDeviceId('pair');
      await window.electronAPI.pairDevice(manualCode);
      setPairingOpen(false);
      await refreshDevices();
    } catch (error) {
      rendererLogger.error('Failed to pair device', error);
      setPairingError((error as Error).message);
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleUnpair = async (deviceId: string) => {
    try {
      setBusyDeviceId(deviceId);
      await window.electronAPI.unpairDevice(deviceId);
      await refreshDevices();
    } catch (error) {
      rendererLogger.error('Failed to unpair device', error);
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch (error) {
      rendererLogger.error('Failed to copy pairing code', error);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('devices.title')}</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={refreshDevices}>
            {t('devices.refresh')}
          </Button>
          <Button variant="contained" onClick={() => setPairingOpen(true)}>
            {t('devices.connect_device')}
          </Button>
          <Tooltip title={t('devices.show_qr')}>
            <Button
              variant="outlined"
              startIcon={<QrCode2Icon />}
              onClick={handleGeneratePairingCode}
            >
              {t('devices.show_qr')}
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        {devices.map((device) => (
          <Grid item xs={12} md={6} lg={4} key={device.id}>
            <Card variant="outlined">
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="h6">{device.name}</Typography>
                  <Stack direction="row" spacing={1}>
                    <Chip
                      label={device.status}
                      color={device.status === 'online' ? 'success' : 'default'}
                    />
                    <Chip label={device.platform} />
                  </Stack>
                  {device.address && (
                    <Typography variant="body2" color="text.secondary">
                      {device.address}:{device.port}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1}>
                    <Button size="small">{t('devices.more_details')}</Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => handleUnpair(device.id)}
                      disabled={busyDeviceId === device.id}
                      startIcon={
                        busyDeviceId === device.id ? (
                          <CircularProgress size={16} />
                        ) : (
                          <LinkOffIcon fontSize="small" />
                        )
                      }
                    >
                      {t('devices.unpair')}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog
        open={Boolean(pairingDialog)}
        onClose={() => setPairingDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('devices.scan_qr')}</DialogTitle>
        <DialogContent>
          {pairingDialog?.loading ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 4 }}>
              <CircularProgress />
            </Stack>
          ) : (
            <Stack spacing={2} alignItems="center">
              {pairingDialog?.qrCode ? (
                <img src={pairingDialog.qrCode} alt="Pairing QR" style={{ maxWidth: '100%' }} />
              ) : null}
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h6">{pairingDialog?.code}</Typography>
                <IconButton
                  onClick={() => pairingDialog?.code && handleCopyCode(pairingDialog.code)}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t('devices.pairing_code_instructions')}
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPairingDialog(null)}>{t('devices.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isPairingOpen} onClose={() => setPairingOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('devices.connect_device')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('devices.connect_device_instructions')}
          </Typography>
          <TextField
            label={t('devices.pairing_code')}
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value.toUpperCase())}
            inputProps={{ maxLength: 6, style: { letterSpacing: '0.3em' } }}
            fullWidth
            margin="normal"
          />
          {pairingError && (
            <Typography variant="body2" color="error">
              {pairingError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPairingOpen(false)} disabled={busyDeviceId === 'pair'}>
            {t('devices.cancel')}
          </Button>
          <Button variant="contained" onClick={handlePairDevice} disabled={busyDeviceId === 'pair'}>
            {busyDeviceId === 'pair' ? <CircularProgress size={18} /> : t('devices.pair')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
