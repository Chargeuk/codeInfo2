import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
} from 'react-router-dom';
import App from '../App';
import HomePage from '../pages/HomePage';
import LmStudioPage from '../pages/LmStudioPage';
import LogsPage from '../pages/LogsPage';
import RouterErrorBoundary from './RouterErrorBoundary';

export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />} errorElement={<RouterErrorBoundary />}>
      <Route index element={<HomePage />} />
      <Route path="lmstudio" element={<LmStudioPage />} />
      <Route path="logs" element={<LogsPage />} />
    </Route>,
  ),
);

export default router;
