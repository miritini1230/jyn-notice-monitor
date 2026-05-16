const USER_IDX = 25488714;
const API_URL = "https://api.pandalive.co.kr/v1/bj_notice";
const NOTICE_PAGE_URL = "https://www.pandalive.co.kr/channel/podo0311/notice";
const ERROR_COOLDOWN_SECONDS = 3600;

async function fetchNotices() {
  const body = new URLSearchParams({
    userIdx: String(USER_IDX),
    offset: "0",
    limit: "10",
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/150.0",
      "Accept": "*/*",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Referer": "https://www.pandalive.co.kr/",
      "Origin": "https://www.pandalive.co.kr",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`PandaTV API HTTP ${response.status}`);
  }
  return await response.json();
}

function findLatestNonPinned(payload) {
  for (const item of payload.list || []) {
    if (!item.isTop) return item;
  }
  return null;
}

function cleanHtml(text) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function telegramEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegram(env, message) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = new URLSearchParams({
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: "false",
  });

  const response = await fetch(url, {
    method: "POST",
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
  }
}

async function notifyError(env, error) {
  const lastAlert = await env.NOTICE_STATE.get("last_error_alert_at");
  if (lastAlert) {
    console.log("Error notification suppressed due to cooldown");
    return;
  }

  try {
    const errorMsg = telegramEscape(error.message || String(error));
    const message =
      `⚠️ <b>주여닝 감시 시스템 에러</b>\n\n` +
      `${errorMsg}\n\n` +
      `<i>1시간 동안 동일 알림이 더 오지 않습니다. 확인해주세요.</i>`;
    await sendTelegram(env, message);
    await env.NOTICE_STATE.put("last_error_alert_at", String(Date.now()), {
      expirationTtl: ERROR_COOLDOWN_SECONDS,
    });
    console.log("Error notification sent");
  } catch (e) {
    console.error("Failed to send error notification:", e);
  }
}

async function run(env) {
  const payload = await fetchNotices();
  if (!payload.result) {
    throw new Error("API returned result=false");
  }

  const latest = findLatestNonPinned(payload);
  if (!latest) {
    console.log("No non-pinned notice found");
    return;
  }

  const latestIdx = latest.idx;
  const contents = telegramEscape(cleanHtml(latest.contents));
  const insertTime = latest.insertDateTime;

  const lastSeenStr = await env.NOTICE_STATE.get("last_seen_idx");
  const lastSeenIdx = lastSeenStr ? parseInt(lastSeenStr, 10) : 0;
  console.log(`Latest idx: ${latestIdx}, last seen: ${lastSeenIdx}`);

  if (lastSeenIdx === 0) {
    const message =
      `✅ <b>주여닝 공지 알림 셋업 완료</b>\n` +
      `앞으로 새 공지가 올라오면 자동으로 알려드립니다.\n\n` +
      `<b>현재 최신 공지 (참고)</b>\n${contents}\n\n` +
      `<i>작성: ${insertTime}</i>`;
    await sendTelegram(env, message);
    await env.NOTICE_STATE.put("last_seen_idx", String(latestIdx));
    console.log("Setup notification sent");
    return;
  }

  if (latestIdx <= lastSeenIdx) {
    console.log("No new notice");
    return;
  }

  const message =
    `🔔 <b>주여닝 새 공지</b>\n\n${contents}\n\n` +
    `<i>작성: ${insertTime}</i>\n` +
    `<a href="${NOTICE_PAGE_URL}">공지 페이지 열기</a>`;
  await sendTelegram(env, message);
  await env.NOTICE_STATE.put("last_seen_idx", String(latestIdx));
  console.log(`Notification sent for idx ${latestIdx}`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      run(env).catch((err) => {
        console.error("Run failed:", err);
        return notifyError(env, err);
      })
    );
  },
  async fetch(request, env, ctx) {
    try {
      await run(env);
      return new Response("OK", { status: 200 });
    } catch (err) {
      ctx.waitUntil(notifyError(env, err));
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};
