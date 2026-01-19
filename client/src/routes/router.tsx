import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
} from 'react-router-dom';
import App from '../App';
import AgentsPage from '../pages/AgentsPage';
import ChatPage from '../pages/ChatPage';
import FlowsPage from '../pages/FlowsPage';
import HomePage from '../pages/HomePage';
import IngestPage from '../pages/IngestPage';
import LmStudioPage from '../pages/LmStudioPage';
import LogsPage from '../pages/LogsPage';
import RouterErrorBoundary from './RouterErrorBoundary';

export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />} errorElement={<RouterErrorBoundary />}>
      <Route index element={<HomePage />} />
      <Route path="chat" element={<ChatPage />} />
      <Route path="agents" element={<AgentsPage />} />
      <Route path="flows" element={<FlowsPage />} />
      <Route path="lmstudio" element={<LmStudioPage />} />
      <Route path="ingest" element={<IngestPage />} />
      <Route path="logs" element={<LogsPage />} />
    </Route>,
  ),
);

export default router;
