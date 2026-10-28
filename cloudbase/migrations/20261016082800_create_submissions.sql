-- SolHub 社区提交表（产品 / 工具统一存储）
-- 自动公开策略：anon 仅能插入 status='approved' 的行（RLS WITH CHECK），
-- 审核/隐藏/删除由 service_role（API Key）或管理面执行，不暴露给浏览器。

CREATE TABLE submissions (
  id                BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind              TEXT        NOT NULL CHECK (kind IN ('product', 'tool')),
  name              TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  short_description TEXT        CHECK (short_description IS NULL OR length(short_description) <= 200),
  description       TEXT        CHECK (description IS NULL OR length(description) <= 2000),
  url               TEXT        CHECK (url IS NULL OR url ~ '^https?://'),
  category          TEXT        CHECK (category IS NULL OR length(category) <= 40),
  tags              TEXT[]      NOT NULL DEFAULT '{}',
  icon_url          TEXT        CHECK (icon_url IS NULL OR icon_url ~ '^https?://'),
  developer         TEXT        CHECK (developer IS NULL OR length(developer) <= 80),
  contact           TEXT        CHECK (contact IS NULL OR length(contact) <= 200),
  tool_type         TEXT        CHECK (tool_type IS NULL OR tool_type IN ('external', 'hosted')),
  hosted_key        TEXT        CHECK (hosted_key IS NULL OR length(hosted_key) <= 300),
  status            TEXT        NOT NULL DEFAULT 'approved'
                                 CHECK (status IN ('approved', 'hidden', 'rejected')),
  review_note       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON submissions TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE submissions_id_seq TO anon, authenticated;

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- 匿名/未登录（Publishable Key 即 anon 身份）：仅可插入「已公开」状态、仅可读取「已公开」行
CREATE POLICY submissions_insert_anon ON submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'approved');

CREATE POLICY submissions_select_anon ON submissions
  FOR SELECT TO anon, authenticated
  USING (status = 'approved');

-- 管理面（service_role / API Key）绕过 RLS，由管理员执行隐藏、拒绝、清理操作。
