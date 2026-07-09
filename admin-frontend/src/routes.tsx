import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import RoleGuard from '@/components/layout/RoleGuard';
import AppLayout from '@/components/layout/AppLayout';
import LoginPage from '@/features/auth/pages/LoginPage';
import TenantsPage from '@/features/tenants/pages/TenantsPage';
import ScreensPage from '@/features/screens/pages/ScreensPage';
import ScreenDetailPage from '@/features/screens/pages/ScreenDetailPage';
import GroupsPage from '@/features/groups/pages/GroupsPage';
import GroupDetailPage from '@/features/groups/pages/GroupDetailPage';
import PlaylistsPage from '@/features/playlists/pages/PlaylistsPage';
import ContentPage from '@/features/content/pages/ContentPage';
import AnalyticsPage from '@/features/analytics/pages/AnalyticsPage';

export default function AppRoutes() {
  return (
    <Routes>
      {/* Ruta pública */}
      <Route path="/login" element={<LoginPage />} />

      {/* Rutas protegidas */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          {/* Solo super_admin */}
          <Route element={<RoleGuard roles={['super_admin']} />}>
            <Route path="/tenants" element={<TenantsPage />} />
          </Route>

          {/* super_admin + tenant_admin */}
          <Route path="/screens" element={<ScreensPage />} />
          <Route path="/screens/:id" element={<ScreenDetailPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:id" element={<GroupDetailPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/content" element={<ContentPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />

          {/* Redirect raíz a pantallas */}
          <Route path="/" element={<Navigate to="/screens" replace />} />
        </Route>
      </Route>

      {/* 404 */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
