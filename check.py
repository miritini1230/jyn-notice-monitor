import json
import os
import re
import sys
import urllib.parse
import urllib.request

USER_IDX = 25488714
API_URL = "https://api.pandalive.co.kr/v1/bj_notice"
NOTICE_PAGE_URL = "https://www.pandalive.co.kr/channel/podo0311/notice"
STATE_FILE = "state.json"

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]


def fetch_notices():
    body = urllib.parse.urlencode({
        "userIdx": USER_IDX,
        "offset": 0,
        "limit": 10,
    }).encode("utf-8")

    req = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/150.0",
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "Referer": "https://www.pandalive.co.kr/",
            "Origin": "https://www.pandalive.co.kr",
        },
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def find_latest_non_pinned(payload):
    for item in payload.get("list", []):
        if not item.get("isTop"):
            return item
    return None


def load_state():
    if not os.path.exists(STATE_FILE):
        return {"last_seen_idx": 0}
    with open(STATE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_state(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def clean_html(text):
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def telegram_escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": "false",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        if not result.get("ok"):
            raise RuntimeError(f"Telegram API error: {result}")


def main():
    payload = fetch_notices()
    if not payload.get("result"):
        print("API returned result=false")
        sys.exit(1)

    latest = find_latest_non_pinned(payload)
    if not latest:
        print("No non-pinned notice found")
        return

    latest_idx = latest["idx"]
    contents = telegram_escape(clean_html(latest["contents"]))
    insert_time = latest["insertDateTime"]

    state = load_state()
    last_seen_idx = state.get("last_seen_idx", 0)
    print(f"Latest idx: {latest_idx}, last seen: {last_seen_idx}")

    if last_seen_idx == 0:
        message = (
            f"✅ <b>주여닝 공지 알림 셋업 완료</b>\n"
            f"앞으로 새 공지가 올라오면 자동으로 알려드립니다.\n\n"
            f"<b>현재 최신 공지 (참고)</b>\n"
            f"{contents}\n\n"
            f"<i>작성: {insert_time}</i>"
        )
        send_telegram(message)
        save_state({"last_seen_idx": latest_idx})
        print("Setup notification sent")
        return

    if latest_idx <= last_seen_idx:
        print("No new notice")
        return

    message = (
        f"🔔 <b>주여닝 새 공지</b>\n\n"
        f"{contents}\n\n"
        f"<i>작성: {insert_time}</i>\n"
        f'<a href="{NOTICE_PAGE_URL}">공지 페이지 열기</a>'
    )
    send_telegram(message)
    save_state({"last_seen_idx": latest_idx})
    print(f"Notification sent for idx {latest_idx}")


if __name__ == "__main__":
    main()
