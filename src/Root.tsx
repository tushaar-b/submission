import { lazy, Suspense } from 'react';
import LandingPage from './LandingPage';

const App = lazy(() => import('./ui/App'));

export default function Root() {
  return window.location.pathname.replace(/\/$/, '') === '/dashboard'
    ? <Suspense fallback={<div className="dashboard-route-loading" aria-label="Loading live radar" />}><App /></Suspense>
    : <LandingPage />;
}
