import React from 'react';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import HomeIcon from '@mui/icons-material/Home';
import FolderIcon from '@mui/icons-material/Folder';
import DevicesIcon from '@mui/icons-material/Devices';
import HistoryIcon from '@mui/icons-material/History';
import WarningIcon from '@mui/icons-material/Warning';
import SettingsIcon from '@mui/icons-material/Settings';
import { useNavigate, useLocation } from 'react-router-dom';

const drawerWidth = 240;

const links = [
  { path: '/', label: 'Обзор', icon: <HomeIcon /> },
  { path: '/folders', label: 'Папки', icon: <FolderIcon /> },
  { path: '/devices', label: 'Устройства', icon: <DevicesIcon /> },
  { path: '/history', label: 'История', icon: <HistoryIcon /> },
  { path: '/conflicts', label: 'Конфликты', icon: <WarningIcon /> },
  { path: '/settings', label: 'Настройки', icon: <SettingsIcon /> },
];

export function SideBar(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
        },
      }}
    >
      <List>
        {links.map((link) => (
          <ListItem key={link.path} disablePadding>
            <ListItemButton
              selected={location.pathname === link.path}
              onClick={() => navigate(link.path)}
            >
              <ListItemIcon>{link.icon}</ListItemIcon>
              <ListItemText primary={link.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
}
