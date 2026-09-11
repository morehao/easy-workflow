import { Layout, Menu, Input, Tooltip, Space, Typography } from 'antd'
import {
  ApartmentOutlined,
  CheckSquareOutlined,
  CloudUploadOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate, Outlet } from 'react-router-dom'
import { useCurrentUser } from './CurrentUserContext'
import { API_BASE } from '@/api/client'

const { Header, Sider, Content } = Layout

const MENU_ITEMS = [
  {
    key: 'def',
    label: '流程设计',
    icon: <ApartmentOutlined />,
    children: [
      { key: '/defs', label: '流程定义', icon: <FileTextOutlined /> },
      { key: '/defs/new', label: '新建流程', icon: <ApartmentOutlined /> },
    ],
  },
  {
    key: 'inst',
    label: '流程实例',
    icon: <PlayCircleOutlined />,
    children: [
      { key: '/instances/start', label: '发起流程', icon: <CloudUploadOutlined /> },
      { key: '/instances/mine', label: '我的发起', icon: <HistoryOutlined /> },
    ],
  },
  {
    key: 'task',
    label: '我的任务',
    icon: <CheckSquareOutlined />,
    children: [
      { key: '/tasks/todo', label: '待办任务' },
      { key: '/tasks/finished', label: '已办任务' },
    ],
  },
]

/** 根据当前路径推导需要高亮的菜单项 */
function resolveSelectedKey(pathname: string): string {
  if (pathname === '/defs/new') return '/defs/new'
  if (pathname.startsWith('/defs')) return pathname === '/defs' ? '/defs' : '/defs'
  if (pathname === '/instances/start') return '/instances/start'
  if (pathname.startsWith('/instances')) return '/instances/mine'
  if (pathname.startsWith('/tasks/finished')) return '/tasks/finished'
  if (pathname.startsWith('/tasks')) return '/tasks/todo'
  return '/defs'
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userId, setUserId } = useCurrentUser()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={216} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 16px',
            fontWeight: 600,
            fontSize: 15,
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <ApartmentOutlined style={{ color: '#1677ff' }} />
          easy-workflow
        </div>
        <Menu
          mode="inline"
          selectedKeys={[resolveSelectedKey(location.pathname)]}
          defaultOpenKeys={['def', 'inst', 'task']}
          items={MENU_ITEMS}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 20px',
            height: 56,
            lineHeight: '56px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            接口前缀 <span className="inline-code">{API_BASE}</span>
            <span style={{ marginLeft: 12 }}>基于 LogicFlow 的流程设计器 + 审批工作台</span>
          </Typography.Text>

          <Space size={8}>
            <Tooltip title="所有接口都以该用户身份调用，可切换成流程中任意处理人">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前用户
              </Typography.Text>
            </Tooltip>
            <Input
              size="small"
              prefix={<UserOutlined />}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              style={{ width: 160 }}
              placeholder="用户ID"
            />
          </Space>
        </Header>

        <Content style={{ padding: 16, minHeight: 0 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
