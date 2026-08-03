import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackRoute } from '../services/hotjar';

/** Reports SPA navigation without leaking room codes or invitation paths. */
export function HotjarRouteTracker(): null {
  const location = useLocation();

  useEffect(() => {
    trackRoute(location.pathname);
  }, [location.pathname]);

  return null;
}
