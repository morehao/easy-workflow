# example/docs

`example/` 下的服务端示例（`example/main.go`）的接口文档与联调说明。

| 文件 | 内容 |
|---|---|
| `docs.go`、`swagger.yaml`、`swagger.json` | `swag init` 生成的 Swagger 文档，不要手改 |
| `ark-iam-integration.md` | 接入 ark-iam 的本地联调指南：启动方式、环境变量、种子账号、身份与权限模型 |
| `ark-iam-troubleshooting.md` | `WF_FORBIDDEN`（403）排查手册，含平台租户复用与本轮修复记录 |
| `ark-iam-local-seed.sql` | 本地 `iam` 库种子数据（仅开发/联调，勿用于生产） |

> 本地开发用的 `Makefile` 目标（`config-ark` / `dev-all` / `dev-oidc`）说明见 `ark-iam-integration.md`。
