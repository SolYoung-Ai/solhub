-- SolHub 每日数据快照（逻辑备份）
--
-- 背景：本环境是 CloudBase PostgreSQL 的**共享实例**（体验版套餐），
-- 平台级自动备份 / 时间点恢复是独享实例的能力，控制台里没有备份入口。
-- 所以这里自己留一份每日快照，兜住真正会发生的事故：
--   - 误执行 DELETE / UPDATE
--   - 迁移脚本或代码缺陷把整批数据写坏
--
-- 形态：一天一份，按 (taken_on, key) 存全量键值，保留 30 天。
--   - 用「一行一个键」而不是「一行一整包 JSON」：单个大 JSONB 行会触发 TOAST，
--     恢复时要一次性读出、插入要一次性写入，数据长大了容易顶到行大小与请求体上限；
--     拆开后每行都很小，按 taken_on 批量翻页即可。
--   - 写入用 ON CONFLICT (taken_on, key) DO UPDATE：同一天重复跑只覆盖不插入，
--     手动补跑不会产生重复快照。
--
-- 访问控制与 kv 一致：只有 service_role（云函数里的 API Key）可读写；
-- anon / authenticated 不给任何 GRANT，RLS 开启但不建策略。
-- 快照里同样含密码哈希与会话令牌，绝不能给浏览器直连读取的机会。

CREATE TABLE kv_backup (
  taken_on   DATE        NOT NULL,
  key        TEXT        NOT NULL,
  value      TEXT        NOT NULL,
  expires_at TIMESTAMPTZ,
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (taken_on, key)
);

-- 按日期取某一份快照 / 按日期范围清理旧快照
CREATE INDEX kv_backup_taken_on_idx ON kv_backup (taken_on);

ALTER TABLE kv_backup ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON kv_backup TO service_role;

REVOKE ALL ON kv_backup FROM anon, authenticated;
