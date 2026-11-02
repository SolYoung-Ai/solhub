-- SolHub 认证服务 KV 存储层（Cloudflare Workers KV → CloudBase PG 的兼容替代）
--
-- 语义对齐 Cloudflare KV：
--   key         主键，等价 CF KV 的 key
--   value       字符串值（JSON 文本）
--   expires_at  非空表示 TTL 到期时刻；过期键在读取时视为不存在
--
-- 访问控制：
--   仅 service_role（云函数里的 CloudBase API Key）可读写。
--   anon / authenticated 无任何 GRANT，且 RLS 开启但不建策略 →
--   浏览器直连 PG 一律被拒，密码哈希（pw:*）与会话令牌（session:*）不会外泄。
--   service_role 具备 BYPASSRLS 属性，但仍需要表级 GRANT，故显式授予。

CREATE TABLE kv (
  key         TEXT        PRIMARY KEY,
  value       TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 前缀扫描（list({prefix}) → key LIKE 'prefix%'）需要 C 序 pattern_ops 索引
CREATE INDEX kv_key_pattern_idx ON kv (key text_pattern_ops);

-- 过期键清理任务按 expires_at 扫描
CREATE INDEX kv_expires_at_idx ON kv (expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE kv ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON kv TO service_role;

REVOKE ALL ON kv FROM anon, authenticated;
