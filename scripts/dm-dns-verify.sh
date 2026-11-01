#!/usr/bin/env bash
# 校验阿里云 DirectMail 发信域名所需的 4 条 DNS 记录是否已生效。
# 用法: bash scripts/dm-dns-verify.sh
set -u
DOMAIN="${1:-solyoung.top}"
SUBDOMAIN="mail"

echo "=== 发信域名 ${SUBDOMAIN}.${DOMAIN} DNS 校验 ==="
echo

ok() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$1"; }

# 1) DKIM
echo "[1] DKIM  aliyun-cn-hangzhou._domainkey.${SUBDOMAIN}"
DK=$(dig +short TXT "aliyun-cn-hangzhou._domainkey.${SUBDOMAIN}.${DOMAIN}" | tr -d '"')
if echo "$DK" | grep -q "^v=DKIM1; k=rsa; p="; then
  # 用 OpenSSL 反向验证公钥结构完整
  if echo "$DK" | sed 's/.*p=//' | base64 -d 2>/dev/null | openssl rsa -pubin -inform DER -text -noout 2>/dev/null | grep -q "Public-Key"; then
    ok "记录存在且公钥可被 OpenSSL 正确解析"
  else
    bad "TXT 存在但公钥解析失败 —— 内容可能被截断或字符错位"
  fi
else
  bad "未查到有效的 DKIM TXT"
fi

# 2) SPF
echo "[2] SPF  ${SUBDOMAIN}"
SPF=$(dig +short TXT "${SUBDOMAIN}.${DOMAIN}" | tr -d '"')
if echo "$SPF" | grep -q "v=spf1"; then
  N=$(dig +short TXT "${SUBDOMAIN}.${DOMAIN}" | grep -c "v=spf1")
  if [ "$N" = "1" ]; then
    ok "SPF 存在且只有一条 —— ${SPF}"
  else
    bad "SPF 有 ${N} 条，RFC 要求只能有一条，必须合并"
  fi
else
  bad "未查到 SPF TXT"
fi

# 3) DMARC
echo "[3] DMARC  _dmarc.${SUBDOMAIN}"
DM=$(dig +short TXT "_dmarc.${SUBDOMAIN}.${DOMAIN}" | tr -d '"')
if echo "$DM" | grep -q "^v=DMARC1"; then
  ok "DMARC 存在 —— ${DM}"
else
  bad "未查到 DMARC TXT"
fi

# 4) MX
echo "[4] MX  ${SUBDOMAIN}"
MX=$(dig +short MX "${SUBDOMAIN}.${DOMAIN}")
if echo "$MX" | grep -q "dm.aliyun.com"; then
  ok "MX 存在 —— ${MX}"
else
  bad "未查到指向 dm.aliyun.com 的 MX"
fi

echo
echo "=== 权威服务器直查（绕过本地缓存） ==="
NS=$(dig +short NS "${DOMAIN}" | head -1)
for H in "aliyun-cn-hangzhou._domainkey.${SUBDOMAIN}.${DOMAIN}" "${SUBDOMAIN}.${DOMAIN}" "_dmarc.${SUBDOMAIN}.${DOMAIN}"; do
  echo "--- ${H} @ ${NS} ---"
  dig +noall +answer +short @"${NS}" TXT "${H}" | head -2
done
echo "--- ${SUBDOMAIN}.${DOMAIN} @ ${NS} (MX) ---"
dig +noall +answer +short @"${NS}" MX "${SUBDOMAIN}.${DOMAIN}" | head -2
