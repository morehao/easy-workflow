import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DefListPage from './pages/DefListPage'
import DefDesignerPage from './pages/DefDesignerPage'
import DefDetailPage from './pages/DefDetailPage'
import InstanceStartPage from './pages/InstanceStartPage'
import MyInstancesPage from './pages/MyInstancesPage'
import InstanceDetailPage from './pages/InstanceDetailPage'
import TodoPage from './pages/TodoPage'
import FinishedPage from './pages/FinishedPage'
import NotFoundPage from './pages/NotFoundPage'
import OidcCallbackPage from './pages/OidcCallbackPage'
import CcPage from './pages/CcPage'
import DelegationPage from './pages/DelegationPage'
import NotificationPage from './pages/NotificationPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/defs" replace />} />
        <Route path="defs" element={<DefListPage />} />
        <Route path="defs/new" element={<DefDesignerPage />} />
        <Route path="defs/:id/edit" element={<DefDesignerPage />} />
        <Route path="defs/:id" element={<DefDetailPage />} />
        <Route path="instances/start" element={<InstanceStartPage />} />
        <Route path="instances/mine" element={<MyInstancesPage />} />
        <Route path="instances/:id" element={<InstanceDetailPage />} />
        <Route path="tasks/todo" element={<TodoPage />} />
        <Route path="tasks/finished" element={<FinishedPage />} />
        <Route path="cc" element={<CcPage />} />
        <Route path="delegations" element={<DelegationPage />} />
        <Route path="notifications" element={<NotificationPage />} />
        <Route path="oidc/callback" element={<OidcCallbackPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
