import { useEffect, useMemo } from 'react';
import {
  isRouteErrorResponse,
  useLocation,
  useRouteError,
} from 'react-router-dom';
import { createLogger } from '../logging';

export default function RouterErrorBoundary() {
  const error = useRouteError();
  const location = useLocation();
  const logger = useMemo(() => createLogger('client-router'), []);

  useEffect(() => {
    const detail = isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : error instanceof Error
        ? error.message
        : String(error);
    logger('error', 'route error', { route: location.pathname, error: detail });
  }, [error, location.pathname, logger]);

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  return <div role="alert">Something went wrong: {message}</div>;
}
