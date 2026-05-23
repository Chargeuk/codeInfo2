import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import type { ReactNode } from 'react';

export type WorkspaceDestination = {
  path: string;
  label: string;
  description: string;
  icon: ReactNode;
};

export const WORKSPACE_DESTINATIONS: WorkspaceDestination[] = [
  {
    path: '/',
    label: 'Home',
    description: 'System status and provider readiness.',
    icon: <HomeOutlinedIcon fontSize="small" />,
  },
  {
    path: '/chat',
    label: 'Chat',
    description: 'Direct provider/model conversations.',
    icon: <ChatBubbleOutlineIcon fontSize="small" />,
  },
  {
    path: '/agents',
    label: 'Agents',
    description: 'Named agents, commands, and steps.',
    icon: <SmartToyOutlinedIcon fontSize="small" />,
  },
  {
    path: '/flows',
    label: 'Flows',
    description: 'Multi-step workflow conversations.',
    icon: <AccountTreeOutlinedIcon fontSize="small" />,
  },
  {
    path: '/ingest',
    label: 'Ingest',
    description: 'Repository ingest and embedding operations.',
    icon: <Inventory2OutlinedIcon fontSize="small" />,
  },
  {
    path: '/logs',
    label: 'Logs',
    description: 'Live operational logs and diagnostics.',
    icon: <TerminalOutlinedIcon fontSize="small" />,
  },
];

export const WORKSPACE_DESTINATION_LABELS = WORKSPACE_DESTINATIONS.map(
  ({ label }) => label,
);

export const getWorkspaceDestinationPath = (pathname: string) => {
  if (pathname.startsWith('/chat')) return '/chat';
  if (pathname.startsWith('/agents')) return '/agents';
  if (pathname.startsWith('/flows')) return '/flows';
  if (pathname.startsWith('/ingest')) return '/ingest';
  if (pathname.startsWith('/logs')) return '/logs';
  return '/';
};
