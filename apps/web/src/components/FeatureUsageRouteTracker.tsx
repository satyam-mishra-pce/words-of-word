import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackFeatureRoute } from '../services/aggregateAnalytics';

/** Records only the current route's fixed enum name; no URL parameters are sent. */
export function FeatureUsageRouteTracker(): null {
  const location = useLocation();

  useEffect(() => {
    trackFeatureRoute(location.pathname);
  }, [location.pathname]);

  return null;
}
