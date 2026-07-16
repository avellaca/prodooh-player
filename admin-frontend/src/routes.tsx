import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import RoleGuard from '@/components/layout/RoleGuard';
import AppLayout from '@/components/layout/AppLayout';
import LoginPage from '@/features/auth/pages/LoginPage';
import ForgotPasswordPage from '@/features/auth/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/features/auth/pages/ResetPasswordPage';
import RegisterPage from '@/features/auth/pages/RegisterPage';
import NetworksPage from '@/features/tenants/pages/NetworksPage';
import ScreensPage from '@/features/screens/pages/ScreensPage';
import ScreenDetailPage from '@/features/screens/pages/ScreenDetailPage';
import GroupsPage from '@/features/groups/pages/GroupsPage';
import GroupDetailPage from '@/features/groups/pages/GroupDetailPage';
import PlaylistsPage from '@/features/playlists/pages/PlaylistsPage';
import ContentPage from '@/features/content/pages/ContentPage';
import AnalyticsPage from '@/features/analytics/pages/AnalyticsPage';
import OrdersPage from '@/features/orders/pages/OrdersPage';
import OrderDetailPage from '@/features/orders/pages/OrderDetailPage';
import OrderLineDetailPage from '@/features/orders/pages/OrderLineDetailPage';
import SettingsPage from '@/features/settings/pages/SettingsPage';

export default function AppRoutes() {
  return (
    <Routes>
      {/* Rutas públicas */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Rutas protegidas */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          {/* Solo super_admin */}
          <Route element={<RoleGuard roles={['super_admin']} />}>
            <Route path="/networks" element={<NetworksPage />} />
          </Route>

          {/* super_admin + tenant_admin (excluye trafficker) */}
          <Route element={<RoleGuard roles={['super_admin', 'tenant_admin']} />}>
            <Route path="/screens" element={<ScreensPage />} />
            <Route path="/screens/:id" element={<ScreenDetailPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/groups/:id" element={<GroupDetailPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          {/* Todos los roles autenticados */}
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/orders/:id/lines/:lineId" element={<OrderLineDetailPage />} />
          <Route path="/biblioteca" element={<ContentPage />} />

          {/* Redirect raíz a pedidos */}
          <Route path="/" element={<Navigate to="/orders" replace />} />
        </Route>
      </Route>

      {/* 404 */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
