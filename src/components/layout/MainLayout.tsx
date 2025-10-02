import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Badge,
  useTheme,
  useMediaQuery,
  Tooltip,
  Avatar,
  Chip,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Folder as FolderIcon,
  Devices as DevicesIcon,
  History as HistoryIcon,
  Warning as WarningIcon,
  Settings as SettingsIcon,
  Sync as SyncIcon,
  Pause as PauseIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { useApp } from '../../contexts/AppContext';
import { useSync } from '../../contexts/SyncContext';
import StatusIndicator from '../common/StatusIndicator';
import { rendererLogger } from '../../utils/rendererLogger';

const drawerWidth = 240;

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const { folders, devices, currentDevice } = useApp();
  const { syncStatuses, conflicts, syncNow, pauseSync, resumeSync } = useSync();

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const menuItems = [
    {
      text: 'Dashboard',
      icon: <DashboardIcon />,
      path: '/dashboard',
      badge: null,
    },
    {
      text: 'Folders',
      icon: <FolderIcon />,
      path: '/folders',
      badge: folders.length,
    },
    {
      text: 'Devices',
      icon: <DevicesIcon />,
      path: '/devices',
      badge: devices.filter((d) => d.status === 'online').length,
    },
    {
      text: 'Conflicts',
      icon: <WarningIcon />,
      path: '/conflicts',
      badge: conflicts.length,
      color: 'error' as const,
    },
    {
      text: 'History',
      icon: <HistoryIcon />,
      path: '/history',
      badge: null,
    },
  ];

  const isAllPaused = () => {
    if (folders.length === 0) return false;
    return Array.from(syncStatuses.values()).every((status) => status.state === 'paused');
  };

  const isSyncing = () => {
    return Array.from(syncStatuses.values()).some(
      (status) => status.state === 'syncing' || status.state === 'scanning'
    );
  };

  const handleTogglePauseAll = async () => {
    try {
      if (isAllPaused()) {
        await resumeSync();
      } else {
        await pauseSync();
      }
    } catch (error) {
      rendererLogger.error('Failed to toggle pause', error);
    }
  };

  const handleSyncAll = async () => {
    try {
      await syncNow();
    } catch (error) {
      rendererLogger.error('Failed to sync all', error);
    }
  };

  const drawer = (
    <Box>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={1} width="100%">
          <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 32, height: 32 }}>AS</Avatar>
          <Typography variant="h6" noWrap component="div">
            AirSync-Lite
          </Typography>
        </Box>
      </Toolbar>
      <Divider />

      {currentDevice && (
        <Box p={2}>
          <Typography variant="caption" color="text.secondary">
            This Device
          </Typography>
          <Typography variant="body2" noWrap>
            {currentDevice.name}
          </Typography>
          <Chip label={currentDevice.role || 'Not Set'} size="small" sx={{ mt: 0.5 }} />
        </Box>
      )}

      <Divider />

      <List>
        {menuItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              selected={location.pathname.startsWith(item.path)}
              onClick={() => {
                navigate(item.path);
                if (isMobile) {
                  setMobileOpen(false);
                }
              }}
            >
              <ListItemIcon>
                {item.badge !== null && item.badge > 0 ? (
                  <Badge badgeContent={item.badge} color={item.color || 'primary'}>
                    {item.icon}
                  </Badge>
                ) : (
                  item.icon
                )}
              </ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Divider />

      <List>
        <ListItem disablePadding>
          <ListItemButton
            selected={location.pathname.startsWith('/settings')}
            onClick={() => {
              navigate('/settings');
              if (isMobile) {
                setMobileOpen(false);
              }
            }}
          >
            <ListItemIcon>
              <SettingsIcon />
            </ListItemIcon>
            <ListItemText primary="Settings" />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ flexGrow: 1 }} />

          <StatusIndicator />

          <Tooltip title={isAllPaused() ? 'Resume All' : 'Pause All'}>
            <IconButton
              color="inherit"
              onClick={handleTogglePauseAll}
              disabled={folders.length === 0}
            >
              {isAllPaused() ? <PlayArrowIcon /> : <PauseIcon />}
            </IconButton>
          </Tooltip>

          <Tooltip title="Sync All Now">
            <IconButton
              color="inherit"
              onClick={handleSyncAll}
              disabled={folders.length === 0 || isSyncing()}
            >
              <SyncIcon className={isSyncing() ? 'rotating' : ''} />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant={isMobile ? 'temporary' : 'permanent'}
          open={isMobile ? mobileOpen : true}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: '64px',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
