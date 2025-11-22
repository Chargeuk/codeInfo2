import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
} from 'react-router-dom';
import App from '../App';
import HomePage from '../pages/HomePage';
import LmStudioPage from '../pages/LmStudioPage';
import RouterErrorBoundary from './RouterErrorBoundary';

export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />} errorElement={<RouterErrorBoundary />}>
      <Route index element={<HomePage />} />
      <Route path="lmstudio" element={<LmStudioPage />} />
    </Route>,
  ),
);

export default router;
