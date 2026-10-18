#!/usr/bin/env python3
"""
SolHub 邮件自动收录脚本
通过 IMAP 读取 Outlook 未读邮件，解析产品提交邮件，追加到 community.json
"""
import imaplib
import email
import json
import re
import os
import subprocess
from email.header import decode_header

IMAP_SERVER = "outlook.office365.com"
IMAP_PORT = 993
EMAIL = os.environ["OUTLOOK_EMAIL"]
PASSWORD = os.environ["OUTLOOK_APP_PASSWORD"]
REPO = "SolYoung-Ai/solhub"
BRANCH = "main"


def decode_str(s):
    if not s:
        return ""
    parts = decode_header(s)
    result = []
    for data, charset in parts:
        if isinstance(data, bytes):
            result.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(data)
    return "".join(result)


def get_body(msg):
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    body += payload.decode("utf-8", errors="replace")
            elif ct == "text/html" and not body:
                payload = part.get_payload(decode=True)
                if payload:
                    html = payload.decode("utf-8", errors="replace")
                    # strip HTML tags
                    body = re.sub(r"<[^>]+>", " ", html)
                    body = re.sub(r"\s+", " ", body).strip()
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode("utf-8", errors="replace")
    return body


def extract_field(body, label):
    """Extract field from email body like '产品名称：xxx'"""
    patterns = [
        rf"{label}[：:]\s*(.+?)(?=\n|$)",
        rf"{label}[：:]\s*(.+?)(?=\n\S+[：:]|$)",
    ]
    for pat in patterns:
        m = re.search(pat, body)
        if m:
            return m.group(1).strip()
    return ""


def parse_product(body):
    """Parse product from email body."""
    name = extract_field(body, "产品名称|名称|产品名")
    if not name:
        return None

    short_desc = extract_field(body, "一句话描述|简介|短描述")
    description = extract_field(body, "详细描述|描述|介绍")
    website = extract_field(body, "网站地址|网址|URL|链接")
    category = extract_field(body, "分类|类别")
    tags = extract_field(body, "标签|Tags")
    icon = extract_field(body, "图标|Logo|图标URL")
    developer = extract_field(body, "开发者|团队|作者")

    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    product = {
        "id": slug,
        "slug": slug,
        "name": name,
        "shortDescription": short_desc or "",
        "description": description or "",
        "websiteUrl": website or "",
        "category": category or "other",
        "tags": [t.strip() for t in tags.split(",") if t.strip()] if tags else [],
        "iconUrl": icon or "",
        "developerName": developer or "",
        "publishedAt": __import__("datetime").datetime.now().strftime("%Y-%m-%d"),
        "launchBatch": "Email Submission",
        "verificationStatus": "pending",
        "isDemo": False,
    }
    return product


def main():
    print("Connecting to IMAP...")
    mail = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
    mail.login(EMAIL, PASSWORD)
    mail.select("INBOX")

    # Search unread emails
    status, data = mail.search(None, "UNSEEN")
    if status != "OK":
        print("No unread emails")
        return

    ids = data[0].split()
    print(f"Found {len(ids)} unread emails")

    new_products = []
    for eid in ids:
        status, msg_data = mail.fetch(eid, "(RFC822)")
        if status != "OK":
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        subject = decode_str(msg.get("Subject", ""))
        body = get_body(msg)

        # Only process emails that look like product submissions
        if "SolHub" in subject or "产品提交" in subject or "提交" in subject or extract_field(body, "产品名称"):
            product = parse_product(body)
            if product:
                new_products.append(product)
                print(f"Parsed: {product['name']}")

        # Mark as read
        mail.store(eid, "+FLAGS", "\\Seen")

    mail.logout()

    if not new_products:
        print("No new products to add")
        return

    # Read existing community.json
    community_path = "src/data/community.json"
    try:
        with open(community_path, "r") as f:
            community = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        community = []

    existing_slugs = {p.get("slug") for p in community}
    for p in new_products:
        if p["slug"] not in existing_slugs:
            community.append(p)
            print(f"Added: {p['name']}")

    with open(community_path, "w") as f:
        json.dump(community, f, ensure_ascii=False, indent=2)

    # Commit and push
    subprocess.run(["git", "config", "--global", "user.name", "SolHub Bot"], check=True)
    subprocess.run(["git", "config", "--global", "user.email", "solhub-bot@users.noreply.github.com"], check=True)
    subprocess.run(["git", "add", community_path], check=True)

    # Check if there are changes
    result = subprocess.run(["git", "diff", "--staged", "--quiet"], capture_output=True)
    if result.returncode == 0:
        print("No changes to commit")
        return

    subprocess.run(["git", "commit", "-m", f"auto: add {len(new_products)} product(s) from email"], check=True)
    subprocess.run(["git", "push"], check=True)
    print("Done! Products added and deployed.")


if __name__ == "__main__":
    main()
