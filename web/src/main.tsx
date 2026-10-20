import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { CurrentUserProvider } from './components/CurrentUserContext'
import { OidcProvider } from './auth/oidc'
import AuthGate from './auth/AuthGate'
import './styles/global.css'

dayjs.locale('zh-cn')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>
        <OidcProvider>
          <CurrentUserProvider>
            <BrowserRouter>
              <AuthGate>
                <App />
              </AuthGate>
            </BrowserRouter>
          </CurrentUserProvider>
        </OidcProvider>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
)
