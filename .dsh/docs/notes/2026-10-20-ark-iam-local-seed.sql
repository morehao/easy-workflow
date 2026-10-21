-- Local ark-iam seed for easy-workflow OA.
-- Target DB: postgres18 container, database iam.
-- Test password for all workflow_* users: Workflow123
BEGIN;

INSERT INTO tenant (id, created_at, updated_at, code, created_by, db_user, deleted_by, status, name, type, tag, updated_by)
VALUES ('t-1', now(), now(), 't-1', 'system', 'easy_workflow', '', 'active', '工作流测试租户', 'customer', 'workflow', 'system')
ON CONFLICT DO NOTHING;

INSERT INTO application (id, created_at, updated_at, code, seed_key, allow_person_create_tenant, allow_join_by_invite, role_template, name, description, logo_url, homepage_url, source, status, sort, created_by, updated_by, deleted_by)
VALUES ('app-easy-workflow', now(), now(), 'easy_workflow', '', 'disable', 'disable', '[]'::json,
        'easy-workflow OA', 'easy-workflow OA 审批工作台', '', 'http://localhost:5173', 'third_party', 'enable', 0, 'system', 'system', '')
ON CONFLICT DO NOTHING;

INSERT INTO application_client (
  id, created_at, updated_at, tenant_id, app_id, code, name,
  redirect_uris, post_logout_redirect_uris, back_channel_logout_uri,
  grant_types, response_types, token_endpoint_auth_method, allowed_origins,
  require_pkce, require_auth_time, default_scopes, access_token_ttl, refresh_token_ttl,
  source, status, created_by, updated_by, deleted_by
) VALUES (
  'client-workflow-web', now(), now(), 't-1', 'app-easy-workflow', 'workflow_web', 'easy-workflow Web',
  '["http://localhost:5173/oidc/callback","http://127.0.0.1:5173/oidc/callback"]'::json,
  '["http://localhost:5173/","http://127.0.0.1:5173/"]'::json, '',
  '["authorization_code","refresh_token"]'::json, '["code"]'::json, 'none',
  '["http://localhost:5173","http://127.0.0.1:5173"]'::json,
  'enable', 'disable', '["openid","profile","email","offline_access"]'::json, 900, 2592000,
  'third_party', 'enable', 'system', 'system', ''
)
ON CONFLICT DO NOTHING;

INSERT INTO tenant_application (id, created_at, updated_at, tenant_id, app_id, status, created_by, updated_by, deleted_by)
VALUES ('ta-easy-workflow', now(), now(), 't-1', 'app-easy-workflow', 'enable', 'system', 'system', '')
ON CONFLICT DO NOTHING;

INSERT INTO department (id, created_at, updated_at, tenant_id, parent_id, dept_path, dept_depth, name, sort, status, created_by, updated_by, deleted_by)
VALUES ('dept-t1-root', now(), now(), 't-1', '', '/dept-t1-root', 1, '工作流测试租户', 0, 'enable', 'system', 'system', '')
ON CONFLICT DO NOTHING;

INSERT INTO person (id, created_at, updated_at, username, primary_email, password_encrypted, password_method, password_status, name, avatar, status, created_by, updated_by, deleted_by)
VALUES
 ('person-workflow-admin', now(), now(), 'workflow_admin', 'workflow_admin@example.com', '$2a$10$VMAMS3SCtYHhQ3agJv1BHukB.vzxMYr2yJumqFKbCuzA3T1FsKAV2', 'bcrypt', 'normal', '流程管理员', '', 'active', 'system', 'system', ''),
 ('person-workflow-approver', now(), now(), 'workflow_approver', 'workflow_approver@example.com', '$2a$10$VMAMS3SCtYHhQ3agJv1BHukB.vzxMYr2yJumqFKbCuzA3T1FsKAV2', 'bcrypt', 'normal', '流程审批人', '', 'active', 'system', 'system', ''),
 ('person-workflow-designer', now(), now(), 'workflow_designer', 'workflow_designer@example.com', '$2a$10$VMAMS3SCtYHhQ3agJv1BHukB.vzxMYr2yJumqFKbCuzA3T1FsKAV2', 'bcrypt', 'normal', '流程设计者', '', 'active', 'system', 'system', ''),
 ('person-workflow-viewer', now(), now(), 'workflow_viewer', 'workflow_viewer@example.com', '$2a$10$VMAMS3SCtYHhQ3agJv1BHukB.vzxMYr2yJumqFKbCuzA3T1FsKAV2', 'bcrypt', 'normal', '流程查看者', '', 'active', 'system', 'system', ''),
 ('person-workflow-auditor', now(), now(), 'workflow_auditor', 'workflow_auditor@example.com', '$2a$10$VMAMS3SCtYHhQ3agJv1BHukB.vzxMYr2yJumqFKbCuzA3T1FsKAV2', 'bcrypt', 'normal', '流程审计员', '', 'active', 'system', 'system', '')
ON CONFLICT DO NOTHING;

INSERT INTO tenant_user (id, created_at, updated_at, tenant_id, person_id, user_type, source, name, description, avatar, status, owner_type, joined_at, created_by, updated_by, deleted_by)
VALUES
 ('tu-workflow-admin', now(), now(), 't-1', 'person-workflow-admin', 'member', 'manual', '流程管理员', '', '', 'active', 'owner', now(), 'system', 'system', ''),
 ('tu-workflow-approver', now(), now(), 't-1', 'person-workflow-approver', 'member', 'manual', '流程审批人', '', '', 'active', 'normal', now(), 'system', 'system', ''),
 ('tu-workflow-designer', now(), now(), 't-1', 'person-workflow-designer', 'member', 'manual', '流程设计者', '', '', 'active', 'normal', now(), 'system', 'system', ''),
 ('tu-workflow-viewer', now(), now(), 't-1', 'person-workflow-viewer', 'member', 'manual', '流程查看者', '', '', 'active', 'normal', now(), 'system', 'system', ''),
 ('tu-workflow-auditor', now(), now(), 't-1', 'person-workflow-auditor', 'member', 'manual', '流程审计员', '', '', 'active', 'normal', now(), 'system', 'system', '')
ON CONFLICT DO NOTHING;

INSERT INTO department_user (id, created_at, updated_at, tenant_id, department_id, user_id, relation_type, created_by, updated_by, deleted_by)
VALUES
 ('du-workflow-admin', now(), now(), 't-1', 'dept-t1-root', 'tu-workflow-admin', 'primary', 'system', 'system', ''),
 ('du-workflow-approver', now(), now(), 't-1', 'dept-t1-root', 'tu-workflow-approver', 'primary', 'system', 'system', ''),
 ('du-workflow-designer', now(), now(), 't-1', 'dept-t1-root', 'tu-workflow-designer', 'primary', 'system', 'system', ''),
 ('du-workflow-viewer', now(), now(), 't-1', 'dept-t1-root', 'tu-workflow-viewer', 'primary', 'system', 'system', ''),
 ('du-workflow-auditor', now(), now(), 't-1', 'dept-t1-root', 'tu-workflow-auditor', 'primary', 'system', 'system', '')
ON CONFLICT DO NOTHING;

INSERT INTO role (id, created_at, updated_at, tenant_id, app_id, name, code, description, source, admin_type, created_by, updated_by, deleted_by)
VALUES
 ('role-workflow-admin', now(), now(), 't-1', 'app-easy-workflow', '流程管理员', 'workflow_admin', '流程定义、实例、任务与审计管理', 'custom', 'admin', 'system', 'system', ''),
 ('role-workflow-designer', now(), now(), 't-1', 'app-easy-workflow', '流程设计者', 'workflow_designer', '创建/发布流程定义与表单', 'custom', 'normal', 'system', 'system', ''),
 ('role-workflow-approver', now(), now(), 't-1', 'app-easy-workflow', '流程审批人', 'workflow_approver', '发起流程与处理待办', 'custom', 'normal', 'system', 'system', ''),
 ('role-workflow-viewer', now(), now(), 't-1', 'app-easy-workflow', '流程查看者', 'workflow_viewer', '查看本人流程与任务', 'custom', 'normal', 'system', 'system', ''),
 ('role-workflow-auditor', now(), now(), 't-1', 'app-easy-workflow', '流程审计员', 'workflow_auditor', '查看租户实例与审计日志', 'custom', 'normal', 'system', 'system', '')
ON CONFLICT DO NOTHING;

INSERT INTO user_role (id, created_at, updated_at, tenant_id, user_id, role_id, created_by, updated_by, deleted_by)
VALUES
 ('ur-workflow-admin', now(), now(), 't-1', 'tu-workflow-admin', 'role-workflow-admin', 'system', 'system', ''),
 ('ur-workflow-approver', now(), now(), 't-1', 'tu-workflow-approver', 'role-workflow-approver', 'system', 'system', ''),
 ('ur-workflow-designer', now(), now(), 't-1', 'tu-workflow-designer', 'role-workflow-designer', 'system', 'system', ''),
 ('ur-workflow-viewer', now(), now(), 't-1', 'tu-workflow-viewer', 'role-workflow-viewer', 'system', 'system', ''),
 ('ur-workflow-auditor', now(), now(), 't-1', 'tu-workflow-auditor', 'role-workflow-auditor', 'system', 'system', '')
ON CONFLICT DO NOTHING;

INSERT INTO user_application (id, created_at, updated_at, tenant_id, user_id, app_id, status, source, created_by, updated_by, deleted_by)
VALUES
 ('ua-workflow-admin', now(), now(), 't-1', 'tu-workflow-admin', 'app-easy-workflow', 'enable', 'manual', 'system', 'system', ''),
 ('ua-workflow-approver', now(), now(), 't-1', 'tu-workflow-approver', 'app-easy-workflow', 'enable', 'manual', 'system', 'system', ''),
 ('ua-workflow-designer', now(), now(), 't-1', 'tu-workflow-designer', 'app-easy-workflow', 'enable', 'manual', 'system', 'system', ''),
 ('ua-workflow-viewer', now(), now(), 't-1', 'tu-workflow-viewer', 'app-easy-workflow', 'enable', 'manual', 'system', 'system', ''),
 ('ua-workflow-auditor', now(), now(), 't-1', 'tu-workflow-auditor', 'app-easy-workflow', 'enable', 'manual', 'system', 'system', '')
ON CONFLICT DO NOTHING;

-- Local M2M API key for the directory client. Raw key is provided out-of-band.
INSERT INTO api_key (id, created_at, updated_at, tenant_id, owner_user_id, name, key_hash, key_prefix, expired_at, revoked_at, created_by, updated_by, deleted_by)
VALUES ('ak-workflow-directory', now(), now(), 't-1', 'tu-workflow-admin', 'easy-workflow directory', 'be9e207685503d16a28788620d4dc427ba53f8aef3556a3546fd78f62a4bc97f', 'wf_live_', NULL, NULL, 'tu-workflow-admin', 'tu-workflow-admin', '')
ON CONFLICT DO NOTHING;

COMMIT;
