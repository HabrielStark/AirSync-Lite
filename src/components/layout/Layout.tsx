import React from 'react';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import { MainAppBar } from './MainAppBar';
import { SideBar } from './SideBar';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps): JSX.Element {
  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <MainAppBar />
      <SideBar />
      <Box component="main" sx={{ flexGrow: 1, p: 3, overflowY: 'auto' }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
