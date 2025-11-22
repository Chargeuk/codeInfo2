import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
} from 'react-router-dom';
import App from '../App';
import HomePage from '../pages/HomePage';
import LmStudioPage from '../pages/LmStudioPage';

export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />}>
      <Route index element={<HomePage />} />
      <Route path="lmstudio" element={<LmStudioPage />} />
    </Route>,
  ),
);

export default router;
