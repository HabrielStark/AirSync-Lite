import React from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import { useSettings } from '../contexts/SettingsContext';

export function SettingsPage(): JSX.Element {
  const { config, updateConfig } = useSettings();
  const [tab, setTab] = React.useState(0);

  if (!config) {
    return <Box />;
  }

  return (
    <Box>
      <Tabs value={tab} onChange={(_, value) => setTab(value)}>
        <Tab label="Общие" />
        <Tab label="Сеть" />
        <Tab label="Безопасность" />
      </Tabs>
      {tab === 0 && (
        <Stack spacing={2} mt={2}>
          <TextField
            label="Язык"
            value={config.language}
            onChange={(event) => updateConfig({ language: event.target.value as any })}
          />
          <FormControlLabel
            control={
              <Switch
                checked={config.notifications.enabled}
                onChange={() =>
                  updateConfig({
                    notifications: {
                      ...config.notifications,
                      enabled: !config.notifications.enabled,
                    },
                  })
                }
              />
            }
            label="Уведомления"
          />
        </Stack>
      )}
      {tab === 1 && (
        <Stack spacing={2} mt={2}>
          <TextField
            label="Порт"
            type="number"
            value={config.schedules?.networkRules?.port ?? ''}
            onChange={(event) => {
              const port = parseInt(event.target.value, 10);
              // ✅ SECURITY FIX: Validate port number (1024-65535)
              if (isNaN(port)) {
                // Clear invalid input
                return;
              }
              if (port < 1024 || port > 65535) {
                // Ignore out-of-range values
                return;
              }
              updateConfig({
                schedules: {
                  ...config.schedules,
                  networkRules: {
                    ...config.schedules?.networkRules,
                    port,
                  },
                },
              } as any);
            }}
            inputProps={{
              min: 1024,
              max: 65535,
              step: 1,
            }}
            helperText="Допустимые значения: 1024-65535"
            error={
              config.schedules?.networkRules?.port !== undefined &&
              (config.schedules.networkRules.port < 1024 ||
                config.schedules.networkRules.port > 65535)
            }
          />
        </Stack>
      )}
      {tab === 2 && (
        <Stack spacing={2} mt={2}>
          <FormControlLabel
            control={
              <Switch
                checked={config.security?.encryptionEnabled ?? true}
                onChange={() =>
                  updateConfig({
                    security: {
                      ...config.security,
                      encryptionEnabled: !config.security?.encryptionEnabled,
                    },
                  })
                }
              />
            }
            label="Шифрование включено"
          />
          <Button variant="contained">Сгенерировать ключ</Button>
        </Stack>
      )}
    </Box>
  );
}
